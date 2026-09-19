-- NFL PrizePicks snapshot. Run once in the Supabase SQL editor.
-- The row is written by GitHub Actions with the service-role key and is readable
-- only by All Access / legacy Pro subscribers (or owner accounts).

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.nfl_projections (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists nfl_projections_set_updated_at on public.nfl_projections;
create trigger nfl_projections_set_updated_at
before update on public.nfl_projections
for each row execute function public.set_updated_at();

alter table public.nfl_projections enable row level security;

drop policy if exists nfl_projections_read_pro on public.nfl_projections;
create policy nfl_projections_read_pro
on public.nfl_projections
for select to authenticated
using (
  lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'cgpropz@gmail.com', 'vicelocksx@gmail.com', 'brittaneycollard@yahoo.com', 'gbaby_95@yahoo.com'
  )
  or exists (
    select 1
    from public.user_profiles profile
    where profile.id = auth.uid()
      and profile.tier in ('owner', 'pro', 'monthly', 'weekly', 'season', 'all', 'combined')
  )
);