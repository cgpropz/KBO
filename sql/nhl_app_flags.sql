-- NHL visibility switch.
-- Run once in the Supabase SQL editor. Nothing in the repo applies this file.
--
-- NHL stays locked for every account except cgpropz@gmail.com.
-- The API reads that email from the Supabase session. A paid tier does not
-- qualify, and setting nhl_public to true does not open the tab.
-- A missing row fails closed the same way. Leave the flag false.

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
