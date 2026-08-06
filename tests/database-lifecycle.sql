\set ON_ERROR_STOP on

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444')
on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

select public.create_room(2, 30, true, false, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as host_state \gset
select (:'host_state'::jsonb->'room'->>'id') as room_id, (:'host_state'::jsonb->'room'->>'code') as room_code \gset
select set_config('test.room_code', :'room_code', false);
select set_config('test.room_id', :'room_id', false);

select ((public.create_room(2, 30, true, false, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->'room'->>'id')::uuid = :'room_id'::uuid) as idempotent \gset
\if :idempotent
\else
  \warn 'Room creation is not idempotent'
  \quit 1
\endif

do $$
begin
  begin
    perform public.join_room(current_setting('test.room_code'), 'HostPlayer');
    raise exception 'Host unexpectedly joined as a player';
  exception when others then
    if sqlerrm = 'Host unexpectedly joined as a player' then raise; end if;
  end;
end $$;

select public.join_room(:'room_code', 'HostPlayer', true) as host_player \gset
select (:'host_player'::jsonb->'player'->>'nickname' = 'HostPlayer') as host_join_valid \gset
\if :host_join_valid
\else
  \warn 'Explicit host player join failed'
  \quit 1
\endif

select public.room_tick(:'room_id'::uuid) as solo_lobby \gset
select (:'solo_lobby'::jsonb->'room'->>'phase' = 'lobby') as solo_waiting \gset
\if :solo_waiting
\else
  \warn 'A single player room started before its lobby deadline'
  \quit 1
\endif

select public.create_room(2, 30, true, false, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') as instant_room \gset
select (:'instant_room'::jsonb->'room'->>'id') as instant_room_id, (:'instant_room'::jsonb->'room'->>'code') as instant_room_code \gset
select public.join_room(:'instant_room_code', 'SoloHost', true);
select public.start_game(:'instant_room_id'::uuid) as instant_start \gset
select (:'instant_start'::jsonb->'room'->>'phase' = 'voting') as instant_start_valid \gset
\if :instant_start_valid
\else
  \warn 'Host instant start did not begin voting'
  \quit 1
\endif

select (public.get_host_state(:'room_id'::uuid)->'players'->0 ? 'removed_at') as removal_field_present \gset
\if :removal_field_present
\else
  \warn 'Host state is missing kick history metadata'
  \quit 1
\endif

reset role;
update public.rooms set lobby_deadline = clock_timestamp() - interval '1 second' where id = :'room_id'::uuid;
set role authenticated;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select public.join_room(:'room_code', 'Alpha') as player_one \gset
select set_config('test.player_one_id', :'player_one'::jsonb->'player'->>'id', false);
select (:'player_one'::jsonb->'room'->>'phase' = 'lobby' and :'player_one'::jsonb->'room'->>'lobby_stage' = 'countdown' and (:'player_one'::jsonb->'room'->>'lobby_deadline')::timestamptz > clock_timestamp()) as countdown_valid \gset
\if :countdown_valid
\else
  \warn 'Second player did not receive a fresh countdown window'
  \quit 1
\endif

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select public.join_room(:'room_code', 'Bravo') as player_two \gset
select set_config('test.player_two_id', :'player_two'::jsonb->'player'->>'id', false);

do $$
begin
  begin
    perform public.kick_player(current_setting('test.room_id')::uuid, current_setting('test.player_two_id')::uuid);
    raise exception 'Non-host kick unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'Non-host kick unexpectedly succeeded' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.kick_player(:'room_id'::uuid, current_setting('test.player_two_id')::uuid) as kick_bravo \gset
select public.kick_player(:'room_id'::uuid, current_setting('test.player_one_id')::uuid) as kick_alpha \gset
select (:'kick_alpha'::jsonb->'room'->>'phase' = 'lobby' and :'kick_alpha'::jsonb->'room'->>'lobby_stage' = 'waiting') as kick_waiting \gset
\if :kick_waiting
\else
  \warn 'Kicking down to one player did not restore solo waiting mode'
  \quit 1
\endif

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
do $$
begin
  begin
    perform public.join_room(current_setting('test.room_code'), 'BravoAgain');
    raise exception 'Kicked player unexpectedly rejoined';
  exception when others then
    if sqlerrm = 'Kicked player unexpectedly rejoined' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
select public.join_room(:'room_code', 'Charlie') as player_two_again \gset
select set_config('test.player_two_id', :'player_two_again'::jsonb->'player'->>'id', false);

reset role;
update public.rooms set lobby_deadline = clock_timestamp() - interval '1 second' where id = :'room_id'::uuid;
set role authenticated;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.room_tick(:'room_id'::uuid);

select (public.get_player_state(:'room_code')->'room' ? 'answer_index') as answer_hidden \gset
\if :answer_hidden
  \warn 'Viewer state exposed answer_index'
  \quit 1
\endif

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.submit_vote(:'room_id'::uuid, 0);
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
select public.submit_vote(:'room_id'::uuid, 1);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.get_host_state(:'room_id'::uuid) as reveal_state \gset

select (
  :'reveal_state'::jsonb->'room'->>'phase' = 'reveal'
  and :'reveal_state'::jsonb->'reveal'->>'correctIndex' is not null
) as reveal_valid \gset
\if :reveal_valid
\else
  \warn 'Reveal did not close correctly or answer is missing'
  \quit 1
\endif

select public.kick_player(:'room_id'::uuid, current_setting('test.player_two_id')::uuid) as reveal_kick \gset
select exists (
  select 1 from jsonb_array_elements(:'reveal_kick'::jsonb->'players') player
  where player->>'id' = current_setting('test.player_two_id') and player->>'removed_at' is not null
) as reveal_kick_checked \gset
\if :reveal_kick_checked
\else
  \warn 'Reveal kick did not mark the player as removed'
  \quit 1
\endif

select public.finish_reveal(:'room_id'::uuid);
select public.finish_reveal(:'room_id'::uuid);

reset role;
select (max(score) <= 10) as score_valid from public.players where room_id = :'room_id'::uuid \gset
\if :score_valid
\else
  \warn 'Idempotent reveal awarded points twice'
  \quit 1
\endif

update public.rooms set next_round_at = clock_timestamp() - interval '1 second' where id = :'room_id'::uuid;
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.room_tick(:'room_id'::uuid) as advanced_state \gset
select (:'advanced_state'::jsonb->'room'->>'phase' in ('voting', 'gameover')) as advanced \gset
\if :advanced
\else
  \warn 'Room did not automatically advance'
  \quit 1
\endif

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);

do $$
begin
  begin
    perform * from public.rooms;
    raise exception 'Direct room table access unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from private.questions;
    raise exception 'Private question access unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'Database lifecycle checks passed.' as result;
