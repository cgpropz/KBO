-- Private Storage bucket for last-good board copies written by publish_supabase.py.
-- api/data reads it with the server key when the REST API times out.
-- public = false: no public URL. No RLS policies for anon/authenticated, so only
-- the service role (which bypasses RLS) can read or write objects.
insert into storage.buckets (id, name, public)
values ('board-last-good', 'board-last-good', false)
on conflict (id) do update set public = false;
