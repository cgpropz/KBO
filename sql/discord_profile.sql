-- ============================================================================
-- Discord membership · user_profiles columns
-- ============================================================================
--
-- Run in the Supabase SQL editor when you are ready. Nothing in this repo
-- applies it automatically, and it does not change Stripe, Vercel, or any
-- existing tier value.
--
-- What it adds:
--   discord_user_id   — Discord snowflake from OAuth (identify). Null until
--                       the member clicks Connect Discord.
--   discord_username  — display name at connect time, for the account page.
--   discord_only      — true when an active Discord-only Stripe subscription
--                       is present. Does NOT grant site access. Can be true
--                       alongside an All-Access tier (both Discord roles).
--
-- Authenticated users already have SELECT on their own row. No client write
-- policy is added. The service role (webhook, sync, reconcile, OAuth
-- callback) updates these columns.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

begin;

alter table public.user_profiles
  add column if not exists discord_user_id text,
  add column if not exists discord_username text,
  add column if not exists discord_only boolean not null default false;

comment on column public.user_profiles.discord_user_id is
  'Discord user id from OAuth identify. Null until the member connects.';
comment on column public.user_profiles.discord_username is
  'Discord display name captured at connect time.';
comment on column public.user_profiles.discord_only is
  'Active Discord-only subscription. Does not unlock site content.';

-- One Discord account maps to one site user. Nulls stay allowed.
create unique index if not exists user_profiles_discord_user_id_key
  on public.user_profiles (discord_user_id)
  where discord_user_id is not null;

commit;
