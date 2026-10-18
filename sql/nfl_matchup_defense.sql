-- NFL opponent-adjusted defense-vs-position snapshot (matchup context only).
-- Written by .github/workflows/nfl-matchup-defense.yml with the service role.
-- Read only through /api/data?ds=nfl_matchup_defense (service role, free).
-- Same single-row jsonb shape and RLS pattern as nfl_sharp_odds /
-- nfl_game_markets: RLS on, no policies, anon/authenticated revoked.
-- No board_reader or agent_reader grant: the job never reads it back.
-- Applied to production 2026-10-18 ~1:45 AM ET via Supabase apply_migration
-- (migration name: nfl_matchup_defense).
-- Data: nflverse (CC BY 4.0). No FTN charting / participation columns.

create table if not exists public.nfl_matchup_defense (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists nfl_matchup_defense_set_updated_at on public.nfl_matchup_defense;
create trigger nfl_matchup_defense_set_updated_at
before update on public.nfl_matchup_defense
for each row execute function public.set_updated_at();

alter table public.nfl_matchup_defense enable row level security;
revoke all on public.nfl_matchup_defense from anon, authenticated;
