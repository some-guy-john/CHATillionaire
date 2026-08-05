-- CHATillionaire free multiplayer schema.
-- Run this once in Supabase SQL Editor after enabling anonymous sign-ins.

create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  phase text not null default 'lobby' check (phase in ('lobby', 'voting', 'reveal', 'gameover')),
  lobby_stage text not null default 'waiting' check (lobby_stage in ('waiting', 'countdown')),
  lobby_deadline timestamptz,
  round_number integer not null default 0 check (round_number >= 0),
  total_rounds integer not null default 10 check (total_rounds between 1 and 10),
  timer_seconds integer not null default 30 check (timer_seconds between 5 and 120),
  speedup_enabled boolean not null default true,
  sfx_enabled boolean not null default true,
  current_question jsonb,
  round_started_at timestamptz,
  round_deadline timestamptz,
  reveal_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rooms add column if not exists speedup_enabled boolean not null default true;
alter table public.rooms add column if not exists sfx_enabled boolean not null default true;

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 18),
  normalized_nickname text not null,
  alive boolean not null default true,
  score integer not null default 0,
  joined_at timestamptz not null default now(),
  unique (room_id, normalized_nickname),
  unique (room_id, user_id)
);

create table if not exists public.room_rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number integer not null,
  question_id text not null,
  question_public jsonb not null,
  answer_index integer not null check (answer_index between 0 and 3),
  started_at timestamptz not null default now(),
  round_deadline timestamptz not null,
  unique (room_id, round_number)
);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  round_number integer not null,
  option_index integer not null check (option_index between 0 and 3),
  submitted_at timestamptz not null default now(),
  unique (room_id, player_id, round_number)
);

create table if not exists public.player_round_results (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  round_number integer not null,
  survived boolean not null,
  vote_index integer check (vote_index between 0 and 3),
  message text not null,
  created_at timestamptz not null default now(),
  unique (room_id, player_id, round_number)
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists rooms_touch_updated_at on public.rooms;
create trigger rooms_touch_updated_at
before update on public.rooms
for each row execute function public.touch_updated_at();

create or replace function public.is_room_host(target_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.rooms
    where id = target_room and host_user_id = auth.uid()
  );
$$;

create or replace function public.can_submit_vote(target_room uuid, target_player uuid, target_round integer)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.players p
    join public.rooms r on r.id = p.room_id
    where p.id = target_player
      and p.room_id = target_room
      and p.user_id = auth.uid()
      and p.alive = true
      and r.id = target_room
      and r.phase = 'voting'
      and r.round_number = target_round
      and (r.round_deadline is null or r.round_deadline > now())
  );
$$;

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.room_rounds enable row level security;
alter table public.votes enable row level security;

drop policy if exists "rooms are readable" on public.rooms;
create policy "rooms are readable" on public.rooms
for select to authenticated using (true);

drop policy if exists "authenticated users create rooms" on public.rooms;
create policy "authenticated users create rooms" on public.rooms
for insert to authenticated
with check (host_user_id = auth.uid());

drop policy if exists "hosts update rooms" on public.rooms;
create policy "hosts update rooms" on public.rooms
for update to authenticated
using (host_user_id = auth.uid())
with check (host_user_id = auth.uid());

drop policy if exists "hosts delete rooms" on public.rooms;
create policy "hosts delete rooms" on public.rooms
for delete to authenticated using (host_user_id = auth.uid());

drop policy if exists "players are readable" on public.players;
create policy "players are readable" on public.players
for select to authenticated using (true);

drop policy if exists "viewers join lobby rooms" on public.players;
create policy "viewers join lobby rooms" on public.players
for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.rooms r
    where r.id = room_id and r.phase = 'lobby'
  )
);

drop policy if exists "hosts update players" on public.players;
create policy "hosts update players" on public.players
for update to authenticated
using (public.is_room_host(room_id))
with check (public.is_room_host(room_id));

drop policy if exists "hosts read round secrets" on public.room_rounds;
create policy "hosts read round secrets" on public.room_rounds
for select to authenticated using (public.is_room_host(room_id));

drop policy if exists "hosts create round secrets" on public.room_rounds;
create policy "hosts create round secrets" on public.room_rounds
for insert to authenticated with check (public.is_room_host(room_id));

drop policy if exists "hosts update round secrets" on public.room_rounds;
create policy "hosts update round secrets" on public.room_rounds
for update to authenticated
using (public.is_room_host(room_id))
with check (public.is_room_host(room_id));

drop policy if exists "vote owners and hosts read votes" on public.votes;
create policy "vote owners and hosts read votes" on public.votes
for select to authenticated
using (user_id = auth.uid() or public.is_room_host(room_id));

drop policy if exists "players submit their own vote" on public.votes;
create policy "players submit their own vote" on public.votes
for insert to authenticated
with check (
  user_id = auth.uid()
  and public.can_submit_vote(room_id, player_id, round_number)
);

drop policy if exists "hosts delete votes" on public.votes;
create policy "hosts delete votes" on public.votes
for delete to authenticated using (public.is_room_host(room_id));

alter table public.player_round_results enable row level security;

drop policy if exists "players read their own outcomes" on public.player_round_results;
create policy "players read their own outcomes" on public.player_round_results
for select to authenticated
using (user_id = auth.uid() or public.is_room_host(room_id));

drop policy if exists "hosts create outcomes" on public.player_round_results;
create policy "hosts create outcomes" on public.player_round_results
for insert to authenticated
with check (public.is_room_host(room_id));

drop policy if exists "hosts update outcomes" on public.player_round_results;
create policy "hosts update outcomes" on public.player_round_results
for update to authenticated
using (public.is_room_host(room_id))
with check (public.is_room_host(room_id));

do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.players;
exception when duplicate_object then null;
end $$;

do $$
begin
alter publication supabase_realtime add table public.votes;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.player_round_results;
exception when duplicate_object then null;
end $$;
