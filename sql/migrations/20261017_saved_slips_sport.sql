-- Saved slips: remember which sport a slip belongs to.
-- Idempotent. Safe to run more than once.
-- Does not create, drop, or replace any RLS policy. Existing policies stay as they are.
-- Apply by hand after Board QA confirms. Do not run this from the publish pipeline.

set lock_timeout = '3s';

alter table public.saved_slips
  add column if not exists sport text;

create index if not exists idx_saved_slips_grading
  on public.saved_slips (graded, game_date);
