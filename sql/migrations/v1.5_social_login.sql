-- CrowderBoard v1.5 migration: optional "Continue with Google / Apple" sign-in buttons.
-- Additive and safe: two flags on the existing public settings row, both OFF by default.
-- Turn them on in Admin -> Spam Protection only AFTER enabling the provider in Supabase Auth -> Providers.
-- Only needed for forums created before v1.5. New installs get this from schema.sql.
alter table public.forum_spam_settings
  add column if not exists oauth_google boolean not null default false,
  add column if not exists oauth_apple  boolean not null default false;

grant update (oauth_google, oauth_apple) on public.forum_spam_settings to authenticated;  -- admins only, via RLS

create or replace function public.forum_spam_settings_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform forum_log('settings.spam', null, null,
    format('hold first %s posts; links need %s posts; human check %s; Google sign-in %s; Apple sign-in %s',
           new.approval_posts, new.link_block_posts,
           case when new.require_captcha then 'required' else 'off' end,
           case when new.oauth_google then 'on' else 'off' end,
           case when new.oauth_apple then 'on' else 'off' end));
  return null;
end $$;
revoke execute on function public.forum_spam_settings_log() from public, anon, authenticated;
