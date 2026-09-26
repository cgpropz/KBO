-- ============================================================================
-- Security Phase 1 · Migration 01 — graded_props_history snapshot table
-- ============================================================================
-- SAFE TO RUN AT ANY TIME (additive only). Recommended: run BEFORE merging the
-- "server-side paywall" PR so the first deploy can publish graded history.
--
-- The Tracker tab used to read /data/graded_props_history.json, a static file
-- in the public repo. It is now published to this table by the pipeline and
-- served through the server-gated /api/data endpoint.
--
-- RLS is enabled with NO policies: only the service role (pipeline + Vercel
-- API functions) can read or write it. The browser never queries it directly.
-- Not executed automatically — paste into the Supabase SQL editor.
-- ============================================================================

create table if not exists public.graded_props_history (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- set_updated_at() is defined in supabase_schema.sql.
drop trigger if exists graded_props_history_set_updated_at on public.graded_props_history;
create trigger graded_props_history_set_updated_at
before update on public.graded_props_history
for each row execute function set_updated_at();

alter table public.graded_props_history enable row level security;
revoke all on public.graded_props_history from anon, authenticated;
