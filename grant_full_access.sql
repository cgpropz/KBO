-- Grant full access to cgpropz.com for the requested email.
-- Run this in the Supabase SQL editor after ensuring the auth user exists.

-- 1) Ensure the user has a profile row.
insert into public.user_profiles (id, tier)
select au.id, 'combined'
from auth.users au
where au.email = 'gbaby_95@yahoo.com'
on conflict (id) do update
set tier = 'combined';

-- 2) If the site uses a separate email-based override, keep it aligned as well.
-- This is a no-op unless your app has a custom access table.
