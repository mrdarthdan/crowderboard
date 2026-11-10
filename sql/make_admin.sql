-- Make yourself the forum Administrator.
-- 1) Open your forum, click Register, and create your account (pick a username).
-- 2) Replace YOUR_USERNAME below with that username and run this in the Supabase SQL Editor.
update public.forum_profiles set role = 'admin' where lower(username) = lower('YOUR_USERNAME');
-- After that, refresh the forum: an "Admin" link appears in the navigation bar.
