-- Apply this non-destructive migration to an existing CHATillionaire database.
-- It adds host-only player kicking without resetting rooms or questions.

begin;

create table if not exists public.kicked_players (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null,
  kicked_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

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
  if v_room.phase not in ('lobby', 'voting') then raise exception 'Players can only be kicked during the lobby or voting.'; end if;

  select * into v_player from public.players
    where room_id = p_room_id and id = p_player_id
    for update;
  if not found then raise exception 'Player is no longer in this room.'; end if;
  if v_player.user_id = v_room.host_user_id then raise exception 'The host player cannot be kicked.'; end if;

  insert into public.kicked_players (room_id, user_id, nickname)
  values (p_room_id, v_player.user_id, v_player.nickname)
  on conflict (room_id, user_id) do update set
    nickname = excluded.nickname,
    kicked_at = now();
  delete from public.players where room_id = p_room_id and id = p_player_id;

  if v_room.phase = 'lobby' then
    select count(*) into v_count from public.players where room_id = p_room_id;
    if v_count < 2 then
      update public.rooms set
        lobby_stage = 'waiting',
        lobby_deadline = now() + interval '5 minutes'
      where id = p_room_id;
    end if;
  elsif v_room.phase = 'voting' then
    select count(*) into v_alive from public.players where room_id = p_room_id and alive = true;
    select count(*) into v_votes from public.votes
      where room_id = p_room_id and round_number = v_room.round_number;
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

  if not found then
    return jsonb_build_object(
      'room', jsonb_build_object('id', v_room.id, 'code', v_room.code, 'phase', v_room.phase),
      'player', null,
      'kicked', exists (
        select 1 from public.kicked_players
        where room_id = v_room.id and user_id = auth.uid()
      )
    );
  end if;

  return jsonb_build_object(
    'room', to_jsonb(v_room) - 'host_user_id' - 'creation_token',
    'player', jsonb_build_object(
      'id', v_player.id,
      'nickname', v_player.nickname,
      'alive', v_player.alive,
      'score', v_player.score
    ),
    'player_count', (select count(*) from public.players where room_id = v_room.id),
    'kicked', false,
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
  if found then return public.get_player_state(v_room.code); end if;
  if v_room.phase <> 'lobby' then raise exception 'This room has already started.'; end if;

  if (select count(*) from public.players where room_id = v_room.id) >= 100 then
    raise exception 'This room is full.';
  end if;

  begin
    insert into public.players (room_id, user_id, nickname, normalized_nickname)
    values (v_room.id, auth.uid(), v_name, lower(v_name))
    returning * into v_player;
  exception when unique_violation then
    raise exception 'That nickname is already taken in this room. Pick another.';
  end;

  select count(*) into v_count from public.players where room_id = v_room.id;
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

commit;
