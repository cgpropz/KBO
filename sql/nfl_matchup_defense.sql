-- NFL opponent-adjusted defense-vs-position snapshot (matchup context only).
-- Written by .github/workflows/nfl-matchup-defense.yml with the service role.
-- Read only through /api/data?ds=nfl_matchup_defense (service role, free).
-- Same single-row jsonb shape as nfl_sharp_odds / nfl_game_markets: RLS on,
-- anon/authenticated revoked. agent_reader read access (SELECT grant plus
-- the agent_reader_select policy, as on nfl_game_markets) is in
-- sql/security/08_agent_reader_nfl_matchup_defense.sql.
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
