-- CHATillionaire secure multiplayer schema.
-- Run in Supabase SQL Editor, then run questions-seed.sql.

begin;

create extension if not exists pgcrypto;

drop function if exists public.is_room_host(uuid) cascade;
drop function if exists public.can_submit_vote(uuid, uuid, integer) cascade;
drop function if exists public.create_room(integer, integer, boolean, boolean) cascade;
drop function if exists public.create_room(integer, integer, boolean, boolean, uuid) cascade;
drop function if exists public.join_room(text, text) cascade;
drop function if exists public.join_room(text, text, boolean) cascade;
drop function if exists public.get_player_state(text) cascade;
drop function if exists public.get_host_state(uuid) cascade;
drop function if exists public.room_tick(uuid) cascade;
drop function if exists public.submit_vote(uuid, integer) cascade;
drop function if exists public.force_close_round(uuid) cascade;
drop function if exists public.finish_reveal(uuid) cascade;
drop function if exists public.end_room(uuid) cascade;
drop schema if exists private cascade;
create schema private;

-- Pre-launch reset: rerunning this migration removes prototype rooms and old policies.
drop table if exists public.player_round_results cascade;
drop table if exists public.votes cascade;
drop table if exists public.room_rounds cascade;
drop table if exists private.room_rounds cascade;
drop table if exists public.players cascade;
drop table if exists public.rooms cascade;
drop table if exists private.questions cascade;

create table if not exists private.questions (
  id text primary key,
  difficulty integer not null check (difficulty between 1 and 10),
  question text not null,
  options jsonb not null check (jsonb_array_length(options) = 4),
  answer_index integer not null check (answer_index between 0 and 3)
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-F0-9]{12}$'),
  creation_token uuid not null unique,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  phase text not null default 'lobby' check (phase in ('lobby', 'voting', 'reveal', 'gameover')),
  lobby_stage text not null default 'waiting' check (lobby_stage in ('waiting', 'countdown')),
  lobby_deadline timestamptz not null default (now() + interval '5 minutes'),
  round_number integer not null default 0 check (round_number >= 0),
  total_rounds integer not null default 10 check (total_rounds between 1 and 10),
  timer_seconds integer not null default 30 check (timer_seconds between 5 and 120),
  speedup_enabled boolean not null default true,
  sfx_enabled boolean not null default true,
  current_question jsonb,
  round_deadline timestamptz,
  reveal_complete boolean not null default false,
  next_round_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 18),
  normalized_nickname text not null,
  alive boolean not null default true,
  score integer not null default 0 check (score >= 0),
  joined_at timestamptz not null default now(),
  unique (room_id, normalized_nickname),
  unique (room_id, user_id),
  unique (room_id, id, user_id)
);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null,
  user_id uuid not null,
  round_number integer not null,
  option_index integer not null check (option_index between 0 and 3),
  submitted_at timestamptz not null default now(),
  unique (room_id, player_id, round_number),
  foreign key (room_id, player_id, user_id)
    references public.players(room_id, id, user_id) on delete cascade
);

create table if not exists public.player_round_results (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null,
  user_id uuid not null,
  round_number integer not null,
  survived boolean not null,
  vote_index integer check (vote_index between 0 and 3),
  message text not null,
  created_at timestamptz not null default now(),
  unique (room_id, player_id, round_number),
  foreign key (room_id, player_id, user_id)
    references public.players(room_id, id, user_id) on delete cascade
);

create table if not exists private.room_rounds (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number integer not null,
  question_id text not null references private.questions(id),
  question_public jsonb not null,
  answer_index integer not null check (answer_index between 0 and 3),
  result_payload jsonb,
  started_at timestamptz not null default now(),
  reveal_started_at timestamptz,
  primary key (room_id, round_number)
);

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rooms_touch_updated_at on public.rooms;
create trigger rooms_touch_updated_at
before update on public.rooms
for each row execute function private.touch_updated_at();

create or replace function private.is_host(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rooms
    where id = p_room_id and host_user_id = auth.uid()
  );
$$;

create or replace function private.is_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_host(p_room_id) or exists (
    select 1 from public.players
    where room_id = p_room_id and user_id = auth.uid()
  );
$$;

create or replace function private.start_round_locked(p_room_id uuid, p_round_number integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_existing private.room_rounds%rowtype;
  v_question private.questions%rowtype;
  v_public jsonb;
begin
  select * into strict v_room from public.rooms where id = p_room_id for update;
  if v_room.phase not in ('lobby', 'reveal') then return; end if;

  select * into v_existing from private.room_rounds
    where room_id = p_room_id and round_number = p_round_number;
  if found then
    v_public := v_existing.question_public;
  else
    select * into strict v_question
    from private.questions
    where difficulty = least(p_round_number, 10)
    order by random()
    limit 1;

    v_public := jsonb_build_object(
      'id', v_question.id,
      'question', v_question.question,
      'options', v_question.options
    );

    insert into private.room_rounds (
      room_id, round_number, question_id, question_public, answer_index, started_at
    ) values (
      p_room_id, p_round_number, v_question.id, v_public, v_question.answer_index, now()
    );
  end if;

  update public.rooms set
    phase = 'voting',
    lobby_stage = 'waiting',
    round_number = p_round_number,
    current_question = v_public,
    round_deadline = now() + make_interval(secs => timer_seconds),
    reveal_complete = false,
    next_round_at = null
  where id = p_room_id;
end;
$$;

create or replace function private.close_voting_locked(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_round private.room_rounds%rowtype;
  v_counts jsonb;
  v_results jsonb;
  v_eliminated jsonb;
  v_payload jsonb;
begin
  select * into strict v_room from public.rooms where id = p_room_id for update;
  if v_room.phase <> 'voting' then return; end if;
  select * into strict v_round from private.room_rounds
    where room_id = p_room_id and round_number = v_room.round_number;

  select jsonb_agg(coalesce(v.vote_count, 0) order by choices.option_index)
  into v_counts
  from generate_series(0, 3) choices(option_index)
  left join (
    select option_index, count(*)::integer vote_count
    from public.votes
    where room_id = p_room_id and round_number = v_room.round_number
    group by option_index
  ) v using (option_index);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.nickname,
    'vote', v.option_index,
    'correct', coalesce(v.option_index = v_round.answer_index, false),
    'reason', case
      when v.option_index is null then 'no answer'
      else 'voted ' || substr('ABCD', v.option_index + 1, 1)
    end
  ) order by p.joined_at), '[]'::jsonb)
  into v_results
  from public.players p
  left join public.votes v on
    v.room_id = p.room_id and v.player_id = p.id and v.round_number = v_room.round_number
  where p.room_id = p_room_id and p.alive = true;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', item->>'name',
    'reason', item->>'reason'
  )), '[]'::jsonb)
  into v_eliminated
  from jsonb_array_elements(v_results) item
  where (item->>'correct')::boolean = false;

  v_payload := jsonb_build_object(
    'question', v_round.question_public,
    'correctIndex', v_round.answer_index,
    'voteCounts', v_counts,
    'playerResults', v_results,
    'eliminated', v_eliminated
  );

  update private.room_rounds set
    result_payload = v_payload,
    reveal_started_at = now()
  where room_id = p_room_id and round_number = v_room.round_number;

  update public.rooms set
    phase = 'reveal',
    round_deadline = null,
    reveal_complete = false,
    next_round_at = null
  where id = p_room_id;
end;
$$;

create or replace function private.finalize_reveal_locked(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_round private.room_rounds%rowtype;
begin
  select * into strict v_room from public.rooms where id = p_room_id for update;
  if v_room.phase <> 'reveal' or v_room.reveal_complete then return; end if;
  select * into strict v_round from private.room_rounds
    where room_id = p_room_id and round_number = v_room.round_number;
  if v_round.result_payload is null then return; end if;

  insert into public.player_round_results (
    room_id, player_id, user_id, round_number, survived, vote_index, message
  )
  select
    p_room_id,
    (item->>'id')::uuid,
    p.user_id,
    v_room.round_number,
    (item->>'correct')::boolean,
    (item->>'vote')::integer,
    case
      when (item->>'correct')::boolean then 'Nailed it!'
      when item->>'vote' is null then 'No answer - bonked!'
      else 'Bonked!'
    end
  from jsonb_array_elements(v_round.result_payload->'playerResults') item
  join public.players p on p.id = (item->>'id')::uuid and p.room_id = p_room_id
  on conflict (room_id, player_id, round_number) do nothing;

  update public.players p set
    alive = result.correct,
    score = p.score + case when result.correct then v_room.round_number * 10 else 0 end
  from (
    select
      (item->>'id')::uuid id,
      (item->>'correct')::boolean correct
    from jsonb_array_elements(v_round.result_payload->'playerResults') item
  ) result
  where p.id = result.id and p.room_id = p_room_id;

  update public.rooms set
    reveal_complete = true,
    next_round_at = now() + interval '4 seconds'
  where id = p_room_id;
end;
$$;

create or replace function private.advance_round_locked(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_alive integer;
begin
  select * into strict v_room from public.rooms where id = p_room_id for update;
  if v_room.phase <> 'reveal' or not v_room.reveal_complete then return; end if;
  if v_room.next_round_at is null or v_room.next_round_at > now() then return; end if;

  select count(*) into v_alive from public.players where room_id = p_room_id and alive = true;
  if v_room.round_number >= v_room.total_rounds or v_alive = 0 then
    update public.rooms set phase = 'gameover', next_round_at = null where id = p_room_id;
  else
    perform private.start_round_locked(p_room_id, v_room.round_number + 1);
  end if;
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
        'joined_at', p.joined_at,
        'has_voted', exists (
          select 1 from public.votes v
          where v.room_id = r.id and v.player_id = p.id and v.round_number = r.round_number
        )
      ) order by p.joined_at)
      from public.players p where p.room_id = r.id
    ), '[]'::jsonb),
    'reveal', case when r.phase in ('reveal', 'gameover') then (
      select rr.result_payload from private.room_rounds rr
      where rr.room_id = r.id and rr.round_number = r.round_number
    ) else null end
  )
  from public.rooms r
  where r.id = p_room_id and r.host_user_id = auth.uid();
$$;

create or replace function public.create_room(
  p_total_rounds integer default 10,
  p_timer_seconds integer default 30,
  p_speedup_enabled boolean default true,
  p_sfx_enabled boolean default true,
  p_creation_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_creation_token is null then raise exception 'Creation token required'; end if;
  p_total_rounds := greatest(1, least(coalesce(p_total_rounds, 10), 10));
  p_timer_seconds := greatest(5, least(coalesce(p_timer_seconds, 30), 120));

  select id into v_room_id from public.rooms
    where host_user_id = auth.uid() and creation_token = p_creation_token;
  if found then return private.host_state(v_room_id); end if;

  if (select count(*) from public.rooms where host_user_id = auth.uid()) >= 5 then
    raise exception 'You already have five active rooms. End one before creating another.';
  end if;

  loop
    v_code := upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 12));
    begin
      insert into public.rooms (
        code, creation_token, host_user_id, total_rounds, timer_seconds, speedup_enabled, sfx_enabled
      ) values (
        v_code, p_creation_token, auth.uid(), p_total_rounds, p_timer_seconds,
        coalesce(p_speedup_enabled, true), coalesce(p_sfx_enabled, true)
      ) returning id into v_room_id;
      exit;
    exception when unique_violation then null;
    end;
  end loop;

  return private.host_state(v_room_id);
end;
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
      'player', null
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
  if v_count >= 2 and v_room.lobby_stage = 'waiting' then
    update public.rooms set
      lobby_stage = 'countdown',
      lobby_deadline = least(lobby_deadline, now() + interval '30 seconds')
    where id = v_room.id;
  end if;

  return public.get_player_state(v_room.code);
end;
$$;

create or replace function public.get_host_state(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_host(p_room_id) then raise exception 'Host access required'; end if;
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
    select count(*) into v_players from public.players where room_id = p_room_id;
    if v_players > 0 then perform private.start_round_locked(p_room_id, 1); end if;
  elsif v_room.phase = 'voting' then
    select count(*) into v_alive from public.players where room_id = p_room_id and alive = true;
    select count(*) into v_votes from public.votes
      where room_id = p_room_id and round_number = v_room.round_number;
    if v_room.round_deadline <= now() or (v_alive > 0 and v_votes >= v_alive) then
      perform private.close_voting_locked(p_room_id);
    elsif v_room.speedup_enabled and v_votes >= ceil(v_alive / 2.0)
      and v_room.round_deadline > now() + interval '12 seconds' then
      update public.rooms set round_deadline = now() + interval '12 seconds' where id = p_room_id;
    end if;
  elsif v_room.phase = 'reveal' and not v_room.reveal_complete then
    select reveal_started_at into v_reveal_started from private.room_rounds
      where room_id = p_room_id and round_number = v_room.round_number;
    if v_reveal_started <= now() - interval '20 seconds' then
      perform private.finalize_reveal_locked(p_room_id);
    end if;
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
  select * into v_player from public.players
    where room_id = p_room_id and user_id = auth.uid();
  if not found or not v_player.alive then raise exception 'You are not an active player'; end if;
  if v_room.phase <> 'voting' or v_room.round_deadline <= clock_timestamp() then
    raise exception 'Voting is closed';
  end if;

  insert into public.votes (room_id, player_id, user_id, round_number, option_index)
  values (p_room_id, v_player.id, auth.uid(), v_room.round_number, p_option_index)
  on conflict (room_id, player_id, round_number) do nothing;

  select count(*) into v_alive from public.players where room_id = p_room_id and alive = true;
  select count(*) into v_votes from public.votes
    where room_id = p_room_id and round_number = v_room.round_number;
  if v_alive > 0 and v_votes >= v_alive then
    perform private.close_voting_locked(p_room_id);
  elsif v_room.speedup_enabled and v_votes >= ceil(v_alive / 2.0)
    and v_room.round_deadline > clock_timestamp() + interval '12 seconds' then
    update public.rooms set round_deadline = clock_timestamp() + interval '12 seconds' where id = p_room_id;
  end if;

  return public.get_player_state(v_room.code);
end;
$$;

create or replace function public.force_close_round(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_host(p_room_id) then raise exception 'Host access required'; end if;
  perform private.close_voting_locked(p_room_id);
  return private.host_state(p_room_id);
end;
$$;

create or replace function public.finish_reveal(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_host(p_room_id) then raise exception 'Host access required'; end if;
  perform private.finalize_reveal_locked(p_room_id);
  return private.host_state(p_room_id);
end;
$$;

create or replace function public.end_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_host(p_room_id) then raise exception 'Host access required'; end if;
  delete from public.rooms where id = p_room_id;
end;
$$;

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.votes enable row level security;
alter table public.player_round_results enable row level security;

do $$
declare policy_record record;
begin
  for policy_record in select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('rooms', 'players', 'votes', 'player_round_results')
  loop
    execute format('drop policy if exists %I on %I.%I', policy_record.policyname, policy_record.schemaname, policy_record.tablename);
  end loop;
end $$;

revoke all on public.rooms, public.players, public.votes, public.player_round_results from public, anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;
revoke usage on schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

revoke all on function public.create_room(integer, integer, boolean, boolean, uuid) from public, anon, authenticated;
revoke all on function public.join_room(text, text, boolean) from public, anon, authenticated;
revoke all on function public.get_player_state(text) from public, anon, authenticated;
revoke all on function public.get_host_state(uuid) from public, anon, authenticated;
revoke all on function public.room_tick(uuid) from public, anon, authenticated;
revoke all on function public.submit_vote(uuid, integer) from public, anon, authenticated;
revoke all on function public.force_close_round(uuid) from public, anon, authenticated;
revoke all on function public.finish_reveal(uuid) from public, anon, authenticated;
revoke all on function public.end_room(uuid) from public, anon, authenticated;

grant execute on function public.create_room(integer, integer, boolean, boolean, uuid) to authenticated;
grant execute on function public.join_room(text, text, boolean) to authenticated;
grant execute on function public.get_player_state(text) to authenticated;
grant execute on function public.get_host_state(uuid) to authenticated;
grant execute on function public.room_tick(uuid) to authenticated;
grant execute on function public.submit_vote(uuid, integer) to authenticated;
grant execute on function public.force_close_round(uuid) to authenticated;
grant execute on function public.finish_reveal(uuid) to authenticated;
grant execute on function public.end_room(uuid) to authenticated;

-- Direct table Realtime is intentionally not used; all state is returned by RPCs.

commit;
