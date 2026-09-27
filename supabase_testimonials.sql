-- ============================================================
-- testimonials: real subscriber feedback, shown on landing pages
-- only after manual approval. Run this in the Supabase SQL Editor.
--
-- Moderation: new/edited submissions always land with approved=false.
-- Approve a real testimonial by running:
--   update testimonials set approved = true where id = <id>;
-- (Run as the SQL Editor's postgres role, which bypasses RLS below.)
-- ============================================================

create table if not exists testimonials (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  quote        text not null,
  approved     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id)
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists testimonials_set_updated_at on testimonials;
create trigger testimonials_set_updated_at
before update on testimonials
for each row execute function set_updated_at();

-- ── Row Level Security ──────────────────────────────────────
-- The site writes/reads through /api/testimonials (service role key), so
-- these policies are defense-in-depth in case the table is ever queried
-- directly with the anon/authenticated key.
alter table testimonials enable row level security;

drop policy if exists testimonials_read_approved_or_own on testimonials;
create policy testimonials_read_approved_or_own
  on testimonials for select
  using (approved = true or auth.uid() = user_id);

drop policy if exists testimonials_insert_own on testimonials;
create policy testimonials_insert_own
  on testimonials for insert
  with check (auth.uid() = user_id);

drop policy if exists testimonials_update_own on testimonials;
create policy testimonials_update_own
  on testimonials for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
