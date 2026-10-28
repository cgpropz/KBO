-- NBA game-market shadow board (spread, total, moneyline).
-- The publisher writes one jsonb row (id = 1) to public.nba_game_markets.
-- Same single-row shape as nfl_game_markets. Cheatsheets reads it through
-- /api/data (service role). There is no anon or authenticated policy.
--
-- Reader SELECT matches nfl_game_markets: agent_reader only, plus the
-- agent_reader_select policy. board_reader is not granted. The same grant
-- is repeated in sql/security/10_nba_game_markets_agent_reader.sql so a
-- database that already has the table can be updated without recreating it.
-- 02_lock_down_rls.sql drops policies; rerun that security file after 02.
--
-- Not applied by CI. Paste this into the Supabase SQL editor before the
-- first publish. Do not apply it just to put a live formula in front of
-- subscribers.
--
-- public.set_updated_at() already exists. This file does not replace it.

begin;

create table if not exists public.nba_game_markets (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists nba_game_markets_set_updated_at on public.nba_game_markets;
create trigger nba_game_markets_set_updated_at
before update on public.nba_game_markets
for each row execute function public.set_updated_at();

alter table public.nba_game_markets enable row level security;
revoke all on public.nba_game_markets from anon, authenticated;

grant select on public.nba_game_markets to agent_reader;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'nba_game_markets'
      and policyname = 'agent_reader_select'
  ) then
    create policy agent_reader_select on public.nba_game_markets
      as permissive for select to agent_reader using (true);
  end if;
end
$$;

commit;
