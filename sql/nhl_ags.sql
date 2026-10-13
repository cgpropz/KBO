-- Admin-only NHL anytime goal scorer preview. Run this in the Supabase SQL
-- editor before the first nhl/ags publish. The repo does not apply it.
--
-- There is no public read policy and no free preview. /api/data?ds=nhl_ags
-- returns the row only for the admin email. Members and anonymous callers
-- get 403. Do not add this dataset to the public board.
--
-- After the table exists, the NHL refresh publishes it with the other nhl/ files:
--   PUBLISH_ONLY_PREFIX=nhl/ python publish_supabase.py

begin;

create table if not exists public.nhl_ags (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.nhl_ags enable row level security;

revoke all on public.nhl_ags from anon, authenticated;

commit;
