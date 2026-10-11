-- nhl_projections.updated_at is set only by the column default, so it stays
-- at the moment the row was first inserted. Later publishes replace `data`
-- and leave the timestamp behind. The NHL board reads that column as
-- "last updated".
--
-- public.set_updated_at() already exists and is secured with a fixed
-- search_path. This file only attaches the trigger. It does not replace
-- the function.
--
-- Not applied by CI. Paste this into the Supabase SQL editor.
-- publish_supabase.py also writes updated_at on each upsert, so the column
-- moves on the next successful NHL publish even before this trigger exists.

begin;

drop trigger if exists nhl_projections_set_updated_at on public.nhl_projections;
create trigger nhl_projections_set_updated_at
before update on public.nhl_projections
for each row execute function public.set_updated_at();

commit;
