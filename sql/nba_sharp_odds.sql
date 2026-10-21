-- NBA Unabated line-matched odds. The publisher writes one jsonb row
-- (id = 1) to public.nba_sharp_odds. That table is not in the database
-- yet, so those upserts come back HTTP 404 (PGRST205).
--
-- Same shape and RLS as nfl_sharp_odds and nhl_sharp_odds: the site reads
-- the row through /api/data with the service role. There is no public
-- read policy. anon and authenticated cannot select or write.
--
-- Not applied by CI. Paste this into the Supabase SQL editor.
-- public.set_updated_at() already exists and is secured with a fixed
-- search_path. This file does not replace that function.

begin;

create table if not exists public.nba_sharp_odds (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists nba_sharp_odds_set_updated_at on public.nba_sharp_odds;
create trigger nba_sharp_odds_set_updated_at
before update on public.nba_sharp_odds
for each row execute function public.set_updated_at();

alter table public.nba_sharp_odds enable row level security;
revoke all on public.nba_sharp_odds from anon, authenticated;

commit;
