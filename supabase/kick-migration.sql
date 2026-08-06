-- Apply this non-destructive migration to an existing CHATillionaire database.
-- It upgrades an existing database without resetting rooms or questions.

begin;

alter table public.players add column if not exists removed_at timestamptz;

drop function if exists public.player_tick(text);
drop function if exists public.start_game(uuid);
drop function if exists public.room_tick(uuid);
drop function if exists public.submit_vote(uuid, integer);

create table if not exists public.kicked_players (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null,
  kicked_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create or replace function private.is_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_host(p_room_id) or exists (
    select 1 from public.players
    where room_id = p_room_id and user_id = auth.uid() and removed_at is null
  );
$$;

create or replace function public.kick_player(p_room_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_player public.players%rowtype;
  v_count integer;
  v_alive integer;
  v_votes integer;
begin
  if not private.is_host(p_room_id) then raise exception 'Host access required'; end if;
  select * into strict v_room from public.rooms where id = p_room_id for update;
  if v_room.phase = 'gameover' then raise exception 'This room has already ended.'; end if;
   if v_room.phase not in ('lobby', 'voting', 'reveal') then raise exception 'Players can only be kicked before the game ends.'; end if;

  select * into v_player from public.players
     where room_id = p_room_id and id = p_player_id and removed_at is null
    for update;
  if not found then raise exception 'Player is no longer in this room.'; end if;
  if v_player.user_id = v_room.host_user_id then raise exception 'The host player cannot be kicked.'; end if;

  insert into public.kicked_players (room_id, user_id, nickname)
  values (p_room_id, v_player.user_id, v_player.nickname)
  on conflict (room_id, user_id) do update set
    nickname = excluded.nickname,
    kicked_at = now();
   update public.players set alive = false, removed_at = now()
   where room_id = p_room_id and id = p_player_id;
   delete from public.votes
   where room_id = p_room_id and player_id = p_player_id and round_number = v_room.round_number;

  if v_room.phase = 'lobby' then
     select count(*) into v_count from public.players where room_id = p_room_id and removed_at is null;
    if v_count < 2 then
      update public.rooms set
        lobby_stage = 'waiting',
        lobby_deadline = now() + interval '5 minutes'
      where id = p_room_id;
    end if;
  elsif v_room.phase = 'voting' then
     select count(*) into v_alive from public.players where room_id = p_room_id and alive = true and removed_at is null;
     select count(*) into v_votes from public.votes v_vote
       join public.players p_vote on p_vote.id = v_vote.player_id
         and p_vote.room_id = p_room_id and p_vote.removed_at is null
       where v_vote.room_id = p_room_id and v_vote.round_number = v_room.round_number;
    if v_alive = 0 then
      update public.rooms set phase = 'gameover', next_round_at = null where id = p_room_id;
    elsif v_votes >= v_alive then
      perform private.close_voting_locked(p_room_id);
    end if;
  end if;

  return private.host_state(p_room_id);
end;
$$;

create or replace function private.host_state(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'room', to_jsonb(r) - 'host_user_id' - 'creation_token',
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
         'nickname', p.nickname,
         'alive', p.alive,
         'score', p.score,
         'removed_at', p.removed_at,
         'is_host_player', p.user_id = auth.uid(),
        'joined_at', p.joined_at,
        'has_voted', exists (
          select 1 from public.votes v
          where v.room_id = r.id and v.player_id = p.id and v.round_number = r.round_number
        )
      ) order by p.joined_at)
      from public.players p where p.room_id = r.id
     ), '[]'::jsonb),
     'kick_enabled', true,
     'host_vote', (
       select jsonb_build_object('option_index', v.option_index, 'submitted_at', v.submitted_at)
       from public.players hp
       join public.votes v on v.player_id = hp.id
         and v.room_id = r.id and v.round_number = r.round_number
       where hp.room_id = r.id and hp.user_id = auth.uid() and hp.removed_at is null
     ),
     'reveal', case when r.phase in ('reveal', 'gameover') then (
      select rr.result_payload from private.room_rounds rr
      where rr.room_id = r.id and rr.round_number = r.round_number
    ) else null end
  )
  from public.rooms r
  where r.id = p_room_id and r.host_user_id = auth.uid();
$$;

create or replace function public.get_player_state(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_player public.players%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_room from public.rooms where code = upper(trim(p_code));
  if not found then return null; end if;
  select * into v_player from public.players
    where room_id = v_room.id and user_id = auth.uid();

   if exists (
     select 1 from public.kicked_players
     where room_id = v_room.id and user_id = auth.uid()
   ) then
     return jsonb_build_object(
       'room', jsonb_build_object('id', v_room.id, 'code', v_room.code, 'phase', v_room.phase),
       'player', null,
       'kicked', true
     );
   end if;

   if not found then
     return jsonb_build_object(
       'room', jsonb_build_object('id', v_room.id, 'code', v_room.code, 'phase', v_room.phase),
       'player', null,
       'kicked', false
     );
   end if;

  return jsonb_build_object(
    'room', to_jsonb(v_room) - 'host_user_id' - 'creation_token',
    'player', jsonb_build_object(
      'id', v_player.id,
      'nickname', v_player.nickname,
      'alive', v_player.alive,
       'score', v_player.score,
       'removed_at', v_player.removed_at
     ),
     'player_count', (select count(*) from public.players where room_id = v_room.id and removed_at is null),
     'kicked', v_player.removed_at is not null,
    'my_vote', case when v_room.phase = 'voting' then (
      select jsonb_build_object('option_index', v.option_index, 'submitted_at', v.submitted_at)
      from public.votes v
      where v.room_id = v_room.id and v.player_id = v_player.id and v.round_number = v_room.round_number
    ) else null end,
    'outcome', case when v_room.reveal_complete or v_room.phase = 'gameover' then (
      select jsonb_build_object(
        'round_number', pr.round_number,
        'survived', pr.survived,
        'vote_index', pr.vote_index,
        'message', pr.message
      ) from public.player_round_results pr
      where pr.room_id = v_room.id and pr.player_id = v_player.id and pr.round_number = v_room.round_number
    ) else null end
  );
end;
$$;

create or replace function public.join_room(
  p_code text,
  p_nickname text,
  p_host_join boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_player public.players%rowtype;
  v_name text;
  v_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  v_name := regexp_replace(trim(p_nickname), '\s+', ' ', 'g');
  if char_length(v_name) not between 2 and 18 then
    raise exception 'Pick a nickname between 2 and 18 characters.';
  end if;

  select * into v_room from public.rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'That room code does not exist.'; end if;
  if v_room.host_user_id = auth.uid() and not coalesce(p_host_join, false) then
    raise exception 'Open the player link on another device or in a private window.';
  end if;
  if exists (
    select 1 from public.kicked_players
    where room_id = v_room.id and user_id = auth.uid()
  ) then
    raise exception 'You were kicked from this room.';
  end if;

  select * into v_player from public.players
    where room_id = v_room.id and user_id = auth.uid();
   if found and v_player.removed_at is null then return public.get_player_state(v_room.code); end if;
   if found then raise exception 'You were kicked from this room.'; end if;
  if v_room.phase <> 'lobby' then raise exception 'This room has already started.'; end if;

   if (select count(*) from public.players where room_id = v_room.id and removed_at is null) >= 100 then
    raise exception 'This room is full.';
  end if;

  begin
    insert into public.players (room_id, user_id, nickname, normalized_nickname)
    values (v_room.id, auth.uid(), v_name, lower(v_name))
    returning * into v_player;
  exception when unique_violation then
    raise exception 'That nickname is already taken in this room. Pick another.';
  end;

   select count(*) into v_count from public.players where room_id = v_room.id and removed_at is null;
  if v_count = 1 and v_room.lobby_stage = 'waiting' then
    update public.rooms set lobby_deadline = now() + interval '5 minutes'
    where id = v_room.id;
  elsif v_count >= 2 and v_room.lobby_stage = 'waiting' then
    update public.rooms set
      lobby_stage = 'countdown',
      lobby_deadline = now() + interval '30 seconds'
    where id = v_room.id;
  end if;

  return public.get_player_state(v_room.code);
end;
$$;

alter table public.kicked_players enable row level security;
revoke all on public.kicked_players from public, anon, authenticated;
revoke all on function public.kick_player(uuid, uuid) from public, anon, authenticated;
grant execute on function public.kick_player(uuid, uuid) to authenticated;

create or replace function public.player_tick(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
begin
  select * into v_room from public.rooms where code = upper(trim(p_code));
  if not found then return null; end if;
  if exists (select 1 from public.kicked_players where room_id = v_room.id and user_id = auth.uid()) then
    return public.get_player_state(v_room.code);
  end if;
  if not private.is_member(v_room.id) then raise exception 'Room access required'; end if;
  perform public.room_tick(v_room.id);
  return public.get_player_state(v_room.code);
end;
$$;

create or replace function public.start_game(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_players integer;
begin
  if not private.is_host(p_room_id) then raise exception 'Host access required'; end if;
  select * into strict v_room from public.rooms where id = p_room_id for update;
  if v_room.phase <> 'lobby' then return private.host_state(p_room_id); end if;
  select count(*) into v_players from public.players where room_id = p_room_id and removed_at is null;
  if v_players = 0 then raise exception 'At least one player must join before starting.'; end if;
  perform private.start_round_locked(p_room_id, 1);
  return private.host_state(p_room_id);
end;
$$;

create or replace function public.room_tick(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_players integer;
  v_alive integer;
  v_votes integer;
  v_reveal_started timestamptz;
begin
  if not private.is_member(p_room_id) then raise exception 'Room access required'; end if;
  select * into strict v_room from public.rooms where id = p_room_id for update;
  if v_room.phase = 'lobby' and v_room.lobby_deadline <= now() then
    select count(*) into v_players from public.players where room_id = p_room_id and removed_at is null;
    if v_players > 0 then perform private.start_round_locked(p_room_id, 1); end if;
  elsif v_room.phase = 'voting' then
    select count(*) into v_alive from public.players where room_id = p_room_id and alive = true and removed_at is null;
    select count(*) into v_votes from public.votes v_vote
      join public.players p_vote on p_vote.id = v_vote.player_id
        and p_vote.room_id = p_room_id and p_vote.removed_at is null
      where v_vote.room_id = p_room_id and v_vote.round_number = v_room.round_number;
    if v_room.round_deadline <= now() or (v_alive > 0 and v_votes >= v_alive) then
      perform private.close_voting_locked(p_room_id);
    elsif v_room.speedup_enabled and v_votes >= ceil(v_alive / 2.0)
      and v_room.round_deadline > now() + interval '12 seconds' then
      update public.rooms set round_deadline = now() + interval '12 seconds' where id = p_room_id;
    end if;
  elsif v_room.phase = 'reveal' and not v_room.reveal_complete then
    select reveal_started_at into v_reveal_started from private.room_rounds
      where room_id = p_room_id and round_number = v_room.round_number;
    if v_reveal_started <= now() - interval '20 seconds' then perform private.finalize_reveal_locked(p_room_id); end if;
  elsif v_room.phase = 'reveal' and v_room.reveal_complete and v_room.next_round_at <= now() then
    perform private.advance_round_locked(p_room_id);
  end if;
  if private.is_host(p_room_id) then return private.host_state(p_room_id); end if;
  return public.get_player_state(v_room.code);
end;
$$;

create or replace function public.submit_vote(p_room_id uuid, p_option_index integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_player public.players%rowtype;
  v_alive integer;
  v_votes integer;
begin
  if p_option_index not between 0 and 3 then raise exception 'Invalid answer'; end if;
  select * into strict v_room from public.rooms where id = p_room_id for update;
  select * into v_player from public.players where room_id = p_room_id and user_id = auth.uid();
  if not found or not v_player.alive or v_player.removed_at is not null then raise exception 'You are not an active player'; end if;
  if v_room.phase <> 'voting' or v_room.round_deadline <= clock_timestamp() then raise exception 'Voting is closed'; end if;
  insert into public.votes (room_id, player_id, user_id, round_number, option_index)
  values (p_room_id, v_player.id, auth.uid(), v_room.round_number, p_option_index)
  on conflict (room_id, player_id, round_number) do nothing;
  select count(*) into v_alive from public.players where room_id = p_room_id and alive = true and removed_at is null;
  select count(*) into v_votes from public.votes v_vote
    join public.players p_vote on p_vote.id = v_vote.player_id
      and p_vote.room_id = p_room_id and p_vote.removed_at is null
    where v_vote.room_id = p_room_id and v_vote.round_number = v_room.round_number;
  if v_alive > 0 and v_votes >= v_alive then perform private.close_voting_locked(p_room_id);
  elsif v_room.speedup_enabled and v_votes >= ceil(v_alive / 2.0)
    and v_room.round_deadline > clock_timestamp() + interval '12 seconds' then
    update public.rooms set round_deadline = clock_timestamp() + interval '12 seconds' where id = p_room_id;
  end if;
  if private.is_host(p_room_id) then return private.host_state(p_room_id); end if;
  return public.get_player_state(v_room.code);
end;
$$;

revoke all on function public.room_tick(uuid) from public, anon, authenticated;
revoke all on function public.submit_vote(uuid, integer) from public, anon, authenticated;
grant execute on function public.room_tick(uuid) to authenticated;
grant execute on function public.submit_vote(uuid, integer) to authenticated;

revoke all on function public.player_tick(text) from public, anon, authenticated;
revoke all on function public.start_game(uuid) from public, anon, authenticated;
grant execute on function public.player_tick(text) to authenticated;
grant execute on function public.start_game(uuid) to authenticated;

commit;
