-- NHL visibility switch.
-- Run once in the Supabase SQL editor. Nothing in the repo applies this file.
--
-- While nhl_public is false, /api/data denies every NHL dataset except
-- cgpropz@gmail.com. A missing row fails closed the same way.
--
-- Do not flip this for an October 13 launch. The 2025-26 backtest did not pass.
--
-- Unlock later, only after a backtest pass:
--   update public.app_flags set value = true where key = 'nhl_public';

begin;

create table if not exists public.app_flags (
  key text primary key,
  value boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.app_flags (key, value)
values ('nhl_public', false)
on conflict (key) do nothing;

alter table public.app_flags enable row level security;
revoke all on public.app_flags from anon, authenticated;

commit;
