-- NBA game-market shadow board (spread, total, moneyline).
-- The publisher writes one jsonb row (id = 1) to public.nba_game_markets.
-- Same single-row shape as nfl_game_markets. The site does not read this
-- table until a later cheatsheets change is approved. There is no public
-- read policy. anon and authenticated cannot select or write.
--
-- Not applied by CI. Paste this into the Supabase SQL editor before the
-- first publish. Do not apply it just to put a live formula in front of
-- subscribers. Merge of the shadow pipeline still needs Code Green OK.
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

commit;
