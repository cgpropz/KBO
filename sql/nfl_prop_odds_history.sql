-- NFL sportsbook prop price history for the CG odds backtest
-- (spec: /workspace/shared/lab/cg_odds_2026-10-16/spec.md, section 7).
--
-- public.nfl_sharp_odds is one overwritten snapshot, so past book prices
-- are lost every run. This table keeps exactly TWO prices per
-- (event, player, prop, book, side, line):
--   open_*  : the first run that saw that quote. Never changed afterwards.
--   close_* : the latest run captured before kickoff. Each pre-kickoff run
--             overwrites it; once captured_at >= commence_time it is frozen.
-- Data comes from the Unabated pull nfl/sharp_odds.py already makes. No new
-- requests. Nothing on the site reads this table.
--
-- NOT applied by CI. Review, then paste into the Supabase SQL editor.
-- Until it exists, nfl/prop_odds_history.py logs a skip and exits 0.

begin;

create table if not exists public.nfl_prop_odds_history (
  event_id        text        not null,
  player_key      text        not null,
  prop            text        not null,
  book_key        text        not null,
  side            text        not null check (side in ('over', 'under')),
  line            numeric(6,1) not null,
  player          text,
  team            text,
  book            text,
  commence_time   timestamptz,
  open_price      integer     not null,
  open_at         timestamptz not null,
  close_price     integer     not null,
  close_at        timestamptz not null,
  seen_count      integer     not null default 1,
  primary key (event_id, player_key, prop, book_key, side, line)
);

create index if not exists nfl_prop_odds_history_commence_idx
  on public.nfl_prop_odds_history (commence_time);
create index if not exists nfl_prop_odds_history_player_prop_idx
  on public.nfl_prop_odds_history (player_key, prop, commence_time);

alter table public.nfl_prop_odds_history enable row level security;
revoke all on public.nfl_prop_odds_history from anon, authenticated;

-- Batch upsert called by the pipeline (service role) via PostgREST RPC.
-- rows: jsonb array of {event_id, player_key, prop, book_key, side, line,
-- player, team, book, commence_time, price}. captured_at: pull time.
create or replace function public.record_nfl_prop_odds(rows jsonb, captured_at timestamptz)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  insert into public.nfl_prop_odds_history as h (
    event_id, player_key, prop, book_key, side, line,
    player, team, book, commence_time,
    open_price, open_at, close_price, close_at
  )
  select
    r->>'event_id', r->>'player_key', r->>'prop', r->>'book_key', r->>'side',
    (r->>'line')::numeric, r->>'player', r->>'team', r->>'book',
    nullif(r->>'commence_time', '')::timestamptz,
    (r->>'price')::integer, captured_at, (r->>'price')::integer, captured_at
  from jsonb_array_elements(rows) as r
  -- No quote is recorded once its game has started.
  where nullif(r->>'commence_time', '') is null
     or captured_at < (r->>'commence_time')::timestamptz
  on conflict (event_id, player_key, prop, book_key, side, line) do update
    set close_price   = excluded.close_price,
        close_at      = excluded.close_at,
        commence_time = coalesce(excluded.commence_time, h.commence_time),
        seen_count    = h.seen_count + 1
    -- open_* is never touched. close_* only moves forward and only pre-kickoff.
    where excluded.close_at > h.close_at
      and (h.commence_time is null or excluded.close_at < h.commence_time);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.record_nfl_prop_odds(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.record_nfl_prop_odds(jsonb, timestamptz) to service_role;

commit;
