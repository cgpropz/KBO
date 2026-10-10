-- NHL Defense vs Position snapshots. Run this in the Supabase SQL editor
-- before the first nhl/dvp publish. The repo does not apply it.
-- It does not turn on nhl_public. That flag does not grant NHL access.
-- Admin access stays the existing gate: only cgpropz@gmail.com can read
-- nhl_* datasets from /api/data. There is no public read policy.
--
-- After the tables exist, the NHL refresh publishes them with the other nhl/ files:
--   PUBLISH_ONLY_PREFIX=nhl/ python publish_supabase.py

begin;

create table if not exists public.nhl_dvp_f (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nhl_dvp_d (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nhl_dvp_g (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.nhl_dvp_f enable row level security;
alter table public.nhl_dvp_d enable row level security;
alter table public.nhl_dvp_g enable row level security;

revoke all on public.nhl_dvp_f from anon, authenticated;
revoke all on public.nhl_dvp_d from anon, authenticated;
revoke all on public.nhl_dvp_g from anon, authenticated;

commit;
