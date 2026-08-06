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
  ('33333333-3333-4333-8333-333333333333')
on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);

select public.create_room(2, 30, true, false, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as host_state \gset
select (:'host_state'::jsonb->'room'->>'id') as room_id, (:'host_state'::jsonb->'room'->>'code') as room_code \gset
select set_config('test.room_code', :'room_code', false);

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

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select public.join_room(:'room_code', 'Alpha') as player_one \gset

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select public.join_room(:'room_code', 'Bravo') as player_two \gset

reset role;
update public.rooms set lobby_deadline = clock_timestamp() - interval '1 second' where id = :'room_id'::uuid;
set role authenticated;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select public.room_tick(:'room_id'::uuid);

select (public.get_player_state(:'room_code')->'room' ? 'answer_index') as answer_hidden \gset
\if :answer_hidden
  \warn 'Viewer state exposed answer_index'
  \quit 1
\endif

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select public.submit_vote(:'room_id'::uuid, 0);
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
select public.submit_vote(:'room_id'::uuid, 1);

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.submit_vote(:'room_id'::uuid, 0);

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
