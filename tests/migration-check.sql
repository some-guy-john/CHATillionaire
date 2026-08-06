\set ON_ERROR_STOP on

select to_regprocedure('public.start_game(uuid)') is not null as migration_rpc_present \gset
\if :migration_rpc_present
\else
  \warn 'Migration start_game RPC could not be called'
  \quit 1
\endif

select has_function_privilege('authenticated', 'public.player_tick(text)', 'execute') as player_tick_granted \gset
\if :player_tick_granted
\else
  \warn 'Migration player_tick grant is missing'
  \quit 1
\endif

select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'players' and column_name = 'removed_at'
) as removed_column_present \gset
\if :removed_column_present
\else
  \warn 'Migration removed_at column is missing'
  \quit 1
\endif

select 'Migration structure checks passed.';
