-- NBA visibility switch.
-- Run once in the Supabase SQL editor (project ocaqjkfdjqxszevtllew).
-- Nothing in the repo applies this file automatically.
--
-- While nba_public is false, /api/data denies every NBA dataset except the
-- account cgpropz@gmail.com. A missing table fails closed the same way.
--
-- Unlock later (All-Access tiers then receive NBA; no new Stripe price):
--   update public.app_flags set value = true where key = 'nba_public';
--
-- Lock again:
--   update public.app_flags set value = false where key = 'nba_public';
--
-- The insert does not overwrite an existing row, so re-running this file
-- will not flip a live switch back to false.

begin;

create table if not exists public.app_flags (
  key text primary key,
  value boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.app_flags (key, value)
values ('nba_public', false)
on conflict (key) do nothing;

alter table public.app_flags enable row level security;

revoke all on public.app_flags from anon, authenticated;

commit;
