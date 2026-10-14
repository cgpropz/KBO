-- Market signals for the paid Command Center panel.
--
-- One row per item. signal_key is the primary key, so the same pulled line,
-- returned line, or big move cannot be inserted twice. The job inserts with
-- PostgREST resolution=ignore-duplicates (see publish_supabase.upsert_ignore_duplicates).
-- A later run deletes the row once game_start has passed: that is when the
-- game locks, and the panel drops the item.
--
-- Built only from feeds the repo already fetches:
--   PrizePicks board snapshots (partner-api.prizepicks.com/projections)
--   Unabated player props (content.unabated.com/markets/b_playerprops.json)
--   public.nfl_prop_odds_history (open and close prices already stored)
-- Nothing here is a projection or a CG Score.
--
-- NOT applied by CI. Paste this file into the Supabase SQL editor for
-- project ocaqjkfdjqxszevtllew (https://ocaqjkfdjqxszevtllew.supabase.co).
-- Until the table exists, pipeline/market_signals.py logs a skip and exits 0.
-- The site reads it with the service-role key via /api/data?ds=market_signals.
-- Anonymous and signed-in browser clients cannot select the table.

begin;

create table if not exists public.market_signals (
  signal_key   text primary key,
  sport        text not null check (sport in ('kbo', 'nfl', 'nhl', 'wnba', 'nba')),
  kind         text not null check (kind in ('line_pulled', 'line_back', 'big_move')),
  player       text not null,
  team         text,
  game_start   timestamptz not null,
  signaled_at  timestamptz not null,
  source       text not null check (source in ('prizepicks', 'unabated', 'nfl_odds')),
  created_at   timestamptz not null default now()
);

create index if not exists market_signals_sport_lock_idx
  on public.market_signals (sport, game_start);

alter table public.market_signals enable row level security;
revoke all on public.market_signals from anon, authenticated, public;

commit;
