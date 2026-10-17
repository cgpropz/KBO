-- ============================================================================
-- Security · Migration 03 — read-only login for the NHL/NFL board builders
-- ============================================================================
-- The builders read the previous published board (row id = 1, column data)
-- to mark PrizePicks lines that vanished from a good fetch. anon is revoked on
-- these paid tables, and the service role is too broad for a read.
--
-- board_reader: LOGIN, no inheritance, no BYPASSRLS, SELECT on exactly
-- nhl_projections and nfl_projections, plus one SELECT-only RLS policy per
-- table scoped to this role. Its password is set out of band (never committed)
-- and stored only as the GitHub Actions secret BOARD_READER_DB_URL.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'board_reader') then
    create role board_reader login noinherit nosuperuser nocreatedb nocreaterole
      noreplication nobypassrls connection limit 10;
  end if;
end $$;

alter role board_reader set statement_timeout = '30s';
alter role board_reader set default_transaction_read_only = on;

revoke all on schema public from board_reader;
grant usage on schema public to board_reader;

revoke all on public.nhl_projections, public.nfl_projections from board_reader;
grant select on public.nhl_projections, public.nfl_projections to board_reader;

drop policy if exists board_reader_select on public.nhl_projections;
create policy board_reader_select on public.nhl_projections
  for select to board_reader using (true);

drop policy if exists board_reader_select on public.nfl_projections;
create policy board_reader_select on public.nfl_projections
  for select to board_reader using (true);
