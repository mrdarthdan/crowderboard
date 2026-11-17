-- CrowderBoard v1.3 migration: spam protection + moderation tools.
-- Adds: "Report post" queue, approval queue for new members, link blocking for new members,
-- moderation log, ban reasons, and an optional Turnstile (human check) requirement for joining.
-- Only needed for forums created before v1.3. New installs get this from schema.sql.
-- Run once in the Supabase SQL Editor.

-- ---------- Spam settings (one row, admin-editable, publicly readable) ----------
create table public.forum_spam_settings (
  id int primary key default 1 check (id = 1),
  require_captcha boolean not null default false,
  turnstile_site_key text check (turnstile_site_key is null or char_length(turnstile_site_key) <= 100),
  approval_posts int not null default 0 check (approval_posts between 0 and 50),      -- first N posts of a new member are held for review (0 = off)
  link_block_posts int not null default 3 check (link_block_posts between 0 and 50),  -- members with fewer than N posts can't post links/images (0 = off)
  updated_at timestamptz not null default now(),
  updated_by uuid references public.forum_profiles(id) on delete set null
);
insert into public.forum_spam_settings (id) values (1);

-- ---------- Moderation log ----------
create table public.forum_modlog (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid references public.forum_profiles(id) on delete set null,
  actor_name text,
  action text not null,
  board_id bigint references public.forum_boards(id) on delete set null,
  target_user uuid references public.forum_profiles(id) on delete set null,
  target_name text,
  detail text
);
create index forum_modlog_created on public.forum_modlog (created_at desc);

create or replace function public.forum_log(p_action text, p_board bigint default null, p_target uuid default null, p_detail text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into forum_modlog (actor_id, actor_name, action, board_id, target_user, target_name, detail)
  values (auth.uid(), (select username from forum_profiles where id = auth.uid()), p_action, p_board, p_target,
          (select username from forum_profiles where id = p_target), left(p_detail, 300));
end $$;

-- ---------- Ban reasons ----------
create table public.forum_bans (
  user_id uuid primary key references public.forum_profiles(id) on delete cascade,
  reason text check (char_length(reason) <= 300),
  banned_by uuid references public.forum_profiles(id) on delete set null,
  banned_at timestamptz not null default now()
);

-- ---------- Reports ----------
create table public.forum_reports (
  id bigint generated always as identity primary key,
  post_id bigint references public.forum_posts(id) on delete set null,
  thread_id bigint references public.forum_threads(id) on delete set null,
  board_id bigint not null references public.forum_boards(id) on delete cascade,
  reporter_id uuid references public.forum_profiles(id) on delete set null,
  author_id uuid references public.forum_profiles(id) on delete set null,
  reason text not null check (reason in ('spam','abuse','offtopic','other')),
  note text check (char_length(note) <= 500),
  excerpt text,
  thread_title text,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolution text,
  resolved_by uuid references public.forum_profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index forum_reports_once on public.forum_reports (post_id, reporter_id);
create index forum_reports_open on public.forum_reports (status, created_at desc);

-- ---------- Approval queue (posts from new members held for review) ----------
create table public.forum_pending (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.forum_profiles(id) on delete cascade,
  kind text not null check (kind in ('thread','reply')),
  board_id bigint not null references public.forum_boards(id) on delete cascade,
  thread_id bigint references public.forum_threads(id) on delete cascade,
  title text check (title is null or char_length(title) between 1 and 120),
  icon text,
  body text not null check (char_length(body) between 1 and 20000),
  created_at timestamptz not null default now()
);
create index forum_pending_board on public.forum_pending (board_id, created_at);
create index forum_pending_user on public.forum_pending (user_id);

-- ---------- Helpers ----------
create or replace function public.forum_needs_approval() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select p.role = 'member' and p.post_count < s.approval_posts
                   from forum_profiles p, forum_spam_settings s where p.id = auth.uid()), false)
$$;
create or replace function public.forum_captcha_required() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select require_captcha from forum_spam_settings where id = 1), false)
$$;
create or replace function public.forum_has_link(p_text text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(p_text ~* '(https?://|www\.|\[url|\[img)', false)
$$;
-- Returns N when this member is still too new to post links (N = posts required), otherwise 0.
create or replace function public.forum_link_blocked(p_user uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select s.link_block_posts from forum_profiles p, forum_spam_settings s
                   where p.id = p_user and p.role = 'member' and s.link_block_posts > 0 and p.post_count < s.link_block_posts), 0)
$$;

-- ---------- Link blocking for new members (posts, edits, PMs) ----------
create or replace function public.forum_posts_before_ins() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  new.created_at := now(); new.edited_at := null; new.edited_by := null;
  if not forum_is_mod() and coalesce(current_setting('request.jwt.claims', true), '') <> '' then
    if (select count(*) from forum_posts where user_id = new.user_id and created_at > now() - interval '60 seconds') >= 5 then
      raise exception 'You are posting too fast. Please wait a minute and try again.';
    end if;
  end if;
  if coalesce(current_setting('forum.bypass_spam', true), '') <> '1' then
    n := forum_link_blocked(new.user_id);
    if n > 0 and forum_has_link(new.body) then
      raise exception 'New members can''t post links or images until they have % posts. Please remove the link and try again.', n;
    end if;
  end if;
  return new;
end $$;

create or replace function public.forum_posts_before_upd() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  new.edited_at := now(); new.edited_by := auth.uid();
  new.thread_id := old.thread_id; new.user_id := old.user_id; new.created_at := old.created_at;
  if new.body is distinct from old.body and auth.uid() = old.user_id then
    n := forum_link_blocked(old.user_id);
    if n > 0 and forum_has_link(new.body) and not forum_has_link(old.body) then
      raise exception 'New members can''t post links or images until they have % posts.', n;
    end if;
  end if;
  return new;
end $$;

create or replace function public.forum_messages_before_ins() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  new.created_at := now(); new.is_read := false;
  if not forum_is_mod() and (select count(*) from forum_messages where from_user = new.from_user and created_at > now() - interval '60 seconds') >= 5 then
    raise exception 'You are sending messages too fast. Please wait a minute and try again.';
  end if;
  n := forum_link_blocked(new.from_user);
  if n > 0 and (forum_has_link(new.body) or forum_has_link(new.subject)) then
    raise exception 'New members can''t send links or images until they have % posts.', n;
  end if;
  return new;
end $$;

-- ---------- Posting RPCs (new topic / reply, with the approval queue) ----------
create or replace function public.forum_new_thread(p_board bigint, p_title text, p_body text, p_icon text default 'default')
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare t bigint; mo boolean;
begin
  if not forum_can_post() then raise exception 'You must be a registered, non-banned member to post.'; end if;
  select mod_only_threads into mo from forum_boards where id = p_board;
  if mo is null then raise exception 'Board not found'; end if;
  if mo and not forum_can_mod_board(p_board) then raise exception 'Only moderators can start topics in this board.'; end if;
  if not forum_is_mod() and (select count(*) from forum_threads where user_id = auth.uid() and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'You are starting topics too fast. Please wait a few minutes.';
  end if;
  if p_icon not in ('default','question','idea','alert','happy','sad','thumbsup','thumbsdown') then p_icon := 'default'; end if;
  if forum_needs_approval() then
    if (select count(*) from forum_pending where user_id = auth.uid()) >= 5 then
      raise exception 'You already have 5 posts waiting for approval. Please wait for a moderator to review them.';
    end if;
    insert into forum_pending (user_id, kind, board_id, title, icon, body)
      values (auth.uid(), 'thread', p_board, trim(p_title), p_icon, p_body);
    return 0;
  end if;
  insert into forum_threads (board_id, user_id, title, icon, last_post_user_id)
    values (p_board, auth.uid(), trim(p_title), p_icon, auth.uid()) returning id into t;
  insert into forum_posts (thread_id, user_id, body) values (t, auth.uid(), p_body);
  return t;
end $$;

-- Returns the new post id, or 0 when the reply was held for approval.
create or replace function public.forum_reply(p_thread bigint, p_body text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare t record; pid bigint;
begin
  if not forum_can_post() then raise exception 'You must be a registered, non-banned member to post.'; end if;
  select id, board_id, locked into t from forum_threads where id = p_thread;
  if t.id is null then raise exception 'Topic not found.'; end if;
  if t.locked and not forum_can_mod_board(t.board_id) then raise exception 'This topic is locked.'; end if;
  if p_body is null or char_length(trim(p_body)) = 0 then raise exception 'Please write a message.'; end if;
  if forum_needs_approval() then
    if (select count(*) from forum_pending where user_id = auth.uid()) >= 5 then
      raise exception 'You already have 5 posts waiting for approval. Please wait for a moderator to review them.';
    end if;
    insert into forum_pending (user_id, kind, board_id, thread_id, body) values (auth.uid(), 'reply', t.board_id, t.id, p_body);
    return 0;
  end if;
  insert into forum_posts (thread_id, user_id, body) values (p_thread, auth.uid(), p_body) returning id into pid;
  return pid;
end $$;

create or replace function public.forum_review_pending(p_id bigint, p_action text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r forum_pending%rowtype; t bigint;
begin
  select * into r from forum_pending where id = p_id;
  if r.id is null then raise exception 'That post was already reviewed.'; end if;
  if not forum_can_mod_board(r.board_id) then raise exception 'You do not moderate this board.'; end if;
  if p_action = 'approve' then
    perform set_config('forum.bypass_spam', '1', true);
    if r.kind = 'thread' then
      insert into forum_threads (board_id, user_id, title, icon, last_post_user_id)
        values (r.board_id, r.user_id, r.title, coalesce(r.icon, 'default'), r.user_id) returning id into t;
      insert into forum_posts (thread_id, user_id, body) values (t, r.user_id, r.body);
    else
      insert into forum_posts (thread_id, user_id, body) values (r.thread_id, r.user_id, r.body);
    end if;
    perform set_config('forum.bypass_spam', '0', true);
    perform forum_log('pending.approve', r.board_id, r.user_id, coalesce(r.title, r.body));
  elsif p_action = 'reject' then
    perform forum_log('pending.reject', r.board_id, r.user_id, coalesce(r.title, r.body));
  else
    raise exception 'Unknown action';
  end if;
  delete from forum_pending where id = p_id;
end $$;

-- ---------- Reports ----------
create or replace function public.forum_report_post(p_post bigint, p_reason text, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p record;
begin
  if not forum_can_post() then raise exception 'You must be logged in to report posts.'; end if;
  if p_reason not in ('spam','abuse','offtopic','other') then raise exception 'Please choose a reason.'; end if;
  select po.id, po.body, po.user_id, t.id as thread_id, t.title, t.board_id into p
    from forum_posts po join forum_threads t on t.id = po.thread_id where po.id = p_post;
  if p.id is null then raise exception 'That post no longer exists.'; end if;
  if p.user_id = auth.uid() then raise exception 'You can''t report your own post.'; end if;
  if (select count(*) from forum_reports where reporter_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You are reporting too fast. Please try again later.';
  end if;
  insert into forum_reports (post_id, thread_id, board_id, reporter_id, author_id, reason, note, excerpt, thread_title)
    values (p.id, p.thread_id, p.board_id, auth.uid(), p.user_id, p_reason, nullif(left(trim(coalesce(p_note, '')), 500), ''), left(p.body, 300), p.title);
exception when unique_violation then
  raise exception 'You already reported this post.';
end $$;

create or replace function public.forum_resolve_report(p_report bigint, p_action text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r forum_reports%rowtype; first_id bigint;
begin
  select * into r from forum_reports where id = p_report;
  if r.id is null then raise exception 'Report not found.'; end if;
  if not forum_can_mod_board(r.board_id) then raise exception 'You do not moderate this board.'; end if;
  if p_action not in ('delete','dismiss','resolve') then raise exception 'Unknown action'; end if;
  update forum_reports set status = case when p_action = 'dismiss' then 'dismissed' else 'resolved' end,
         resolution = p_action, resolved_by = auth.uid(), resolved_at = now()
   where status = 'open' and (id = r.id or (r.post_id is not null and post_id = r.post_id));
  perform forum_log('report.' || p_action, r.board_id, r.author_id, coalesce(r.thread_title, '') || ': ' || coalesce(r.excerpt, ''));
  if p_action = 'delete' and r.post_id is not null then
    select min(id) into first_id from forum_posts where thread_id = r.thread_id;
    perform set_config('forum.skip_log', '1', true);
    if first_id = r.post_id then delete from forum_threads where id = r.thread_id;
    else delete from forum_posts where id = r.post_id; end if;
    perform set_config('forum.skip_log', '0', true);
  end if;
end $$;

-- ---------- Moderation actions now write to the log ----------
create or replace function public.forum_mod_thread(p_thread bigint, p_action text, p_board bigint default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare old_b bigint; ttl text; owner uuid; flag boolean;
begin
  select board_id, title, user_id into old_b, ttl, owner from forum_threads where id = p_thread;
  if old_b is null then raise exception 'Topic not found.'; end if;
  if not forum_can_mod_board(old_b) then raise exception 'You do not moderate this board.'; end if;
  if p_action = 'sticky' then
    update forum_threads set sticky = not sticky where id = p_thread returning sticky into flag;
    perform forum_log('thread.sticky', old_b, owner, ttl || case when flag then ' (made sticky)' else ' (unsticky)' end);
  elsif p_action = 'lock' then
    update forum_threads set locked = not locked where id = p_thread returning locked into flag;
    perform forum_log('thread.lock', old_b, owner, ttl || case when flag then ' (locked)' else ' (unlocked)' end);
  elsif p_action = 'move' then
    if p_board is null or not forum_can_mod_board(p_board) then raise exception 'You can only move topics to boards you moderate.'; end if;
    update forum_threads set board_id = p_board where id = p_thread;
    perform forum_refresh_board(old_b); perform forum_refresh_board(p_board);
    perform forum_log('thread.move', old_b, owner, ttl || ' -> ' || coalesce((select name from forum_boards where id = p_board), '?'));
  elsif p_action = 'delete' then
    perform forum_log('thread.delete', old_b, owner, ttl);
    perform set_config('forum.skip_log', '1', true);
    delete from forum_threads where id = p_thread;
    perform set_config('forum.skip_log', '0', true);
  else raise exception 'Unknown action'; end if;
end $$;

drop function public.forum_set_role(uuid, text, text);
create or replace function public.forum_set_role(p_user uuid, p_role text, p_title text default null, p_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare old_role text;
begin
  if not forum_is_admin() then raise exception 'Admins only.'; end if;
  if p_role not in ('admin','mod','boardmod','member','banned') then raise exception 'Unknown position.'; end if;
  if p_user = auth.uid() and p_role <> 'admin' then raise exception 'You can''t change your own position.'; end if;
  select role into old_role from forum_profiles where id = p_user;
  if old_role is null then raise exception 'Member not found.'; end if;
  if p_role <> 'boardmod' then delete from forum_board_mods where user_id = p_user; end if;
  update forum_profiles set role = p_role, title = coalesce(p_title, title) where id = p_user;
  if p_role = 'banned' then
    insert into forum_bans (user_id, reason, banned_by) values (p_user, nullif(left(trim(coalesce(p_reason, '')), 300), ''), auth.uid())
      on conflict (user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by, banned_at = now();
  else
    delete from forum_bans where user_id = p_user;
  end if;
  if old_role is distinct from p_role then
    perform forum_log(case when p_role = 'banned' then 'ban' when old_role = 'banned' then 'unban' else 'role.set' end, null, p_user,
      old_role || ' -> ' || p_role || coalesce(' (' || nullif(trim(p_reason), '') || ')', ''));
  end if;
end $$;

create or replace function public.forum_add_board_mod(p_user uuid, p_board bigint default null, p_category bigint default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare r text; new_id bigint; what text;
begin
  if not forum_is_mod() then raise exception 'Only administrators and global moderators can assign moderators.'; end if;
  if (p_board is null) = (p_category is null) then raise exception 'Choose either one board or one category.'; end if;
  select role into r from forum_profiles where id = p_user;
  if r is null then raise exception 'Member not found.'; end if;
  if r in ('admin','mod') then raise exception 'That member is already staff and can moderate every board.'; end if;
  if r = 'banned' then raise exception 'Banned members cannot be moderators.'; end if;
  insert into forum_board_mods (user_id, board_id, category_id, created_by)
    values (p_user, p_board, p_category, auth.uid()) returning id into new_id;
  what := case when p_board is not null then 'board ' || coalesce((select name from forum_boards where id = p_board), '?')
               else 'category ' || coalesce((select name from forum_categories where id = p_category), '?') end;
  perform forum_log('boardmod.add', p_board, p_user, what);
  return new_id;
exception when unique_violation then
  raise exception 'That member already moderates it.';
end $$;

create or replace function public.forum_remove_board_mod(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare m forum_board_mods%rowtype; what text;
begin
  if not forum_is_mod() then raise exception 'Only administrators and global moderators can remove moderators.'; end if;
  select * into m from forum_board_mods where id = p_id;
  if m.id is null then return; end if;
  what := case when m.board_id is not null then 'board ' || coalesce((select name from forum_boards where id = m.board_id), '?')
               else 'category ' || coalesce((select name from forum_categories where id = m.category_id), '?') end;
  delete from forum_board_mods where id = p_id;
  perform forum_log('boardmod.remove', m.board_id, m.user_id, what);
end $$;

-- Staff edits/deletes of other members' posts (done directly on the table) are logged by triggers
create or replace function public.forum_posts_log_del() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare b bigint;
begin
  if auth.uid() is null or old.user_id is not distinct from auth.uid()
     or coalesce(current_setting('forum.skip_log', true), '') = '1' then return null; end if;
  select board_id into b from forum_threads where id = old.thread_id;
  if b is null then return null; end if;   -- the whole topic is already gone
  if forum_can_mod_board(b) then perform forum_log('post.delete', b, old.user_id, old.body); end if;
  return null;
end $$;
create trigger forum_posts_log_del after delete on public.forum_posts for each row execute function public.forum_posts_log_del();

create or replace function public.forum_posts_log_upd() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare b bigint;
begin
  if new.edited_by is not null and new.edited_by is distinct from old.user_id and new.body is distinct from old.body then
    select board_id into b from forum_threads where id = old.thread_id;
    perform forum_log('post.edit', b, old.user_id, new.body);
  end if;
  return null;
end $$;
create trigger forum_posts_log_upd after update on public.forum_posts for each row execute function public.forum_posts_log_upd();

create or replace function public.forum_spam_settings_log() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform forum_log('settings.spam', null, null,
    format('hold first %s posts; links need %s posts; human check %s', new.approval_posts, new.link_block_posts,
           case when new.require_captcha then 'required' else 'off' end));
  return null;
end $$;
create trigger forum_spam_settings_log after update on public.forum_spam_settings for each row execute function public.forum_spam_settings_log();

-- ---------- Row-level security ----------
drop policy "reply to open threads" on public.forum_posts;
create policy "reply to open threads" on public.forum_posts for insert to authenticated
  with check (
    user_id = auth.uid() and public.forum_can_post() and not public.forum_needs_approval()
    and exists (select 1 from public.forum_threads t where t.id = thread_id and (not t.locked or public.forum_can_mod_board(t.board_id)))
  );

drop policy "create own profile" on public.forum_profiles;
create policy "create own profile" on public.forum_profiles for insert to authenticated
  with check (id = auth.uid() and role = 'member' and post_count = 0 and not public.forum_captcha_required());

alter table public.forum_spam_settings enable row level security;
alter table public.forum_modlog enable row level security;
alter table public.forum_bans enable row level security;
alter table public.forum_reports enable row level security;
alter table public.forum_pending enable row level security;

create policy "spam settings readable" on public.forum_spam_settings for select using (true);
create policy "admin updates spam settings" on public.forum_spam_settings for update to authenticated
  using (public.forum_is_admin()) with check (public.forum_is_admin());
create policy "staff read modlog" on public.forum_modlog for select to authenticated
  using (public.forum_is_mod() or (board_id is not null and public.forum_can_mod_board(board_id)));
create policy "own ban or staff" on public.forum_bans for select to authenticated
  using (user_id = auth.uid() or public.forum_is_mod());
create policy "staff read reports" on public.forum_reports for select to authenticated
  using (public.forum_can_mod_board(board_id));
create policy "own or staff pending" on public.forum_pending for select to authenticated
  using (user_id = auth.uid() or public.forum_can_mod_board(board_id));

-- ---------- Privileges ----------
revoke all on public.forum_spam_settings, public.forum_modlog, public.forum_bans, public.forum_reports, public.forum_pending
  from anon, authenticated;
grant select on public.forum_spam_settings to anon, authenticated;
grant update (require_captcha, turnstile_site_key, approval_posts, link_block_posts, updated_at, updated_by)
  on public.forum_spam_settings to authenticated;                                  -- admins only, via RLS
grant select on public.forum_modlog, public.forum_bans, public.forum_reports, public.forum_pending to authenticated;

revoke execute on function
  public.forum_log(text,bigint,uuid,text), public.forum_has_link(text), public.forum_link_blocked(uuid),
  public.forum_needs_approval(), public.forum_captcha_required(),
  public.forum_posts_before_ins(), public.forum_posts_before_upd(), public.forum_messages_before_ins(),
  public.forum_posts_log_del(), public.forum_posts_log_upd(), public.forum_spam_settings_log(),
  public.forum_reply(bigint,text), public.forum_review_pending(bigint,text),
  public.forum_report_post(bigint,text,text), public.forum_resolve_report(bigint,text),
  public.forum_set_role(uuid,text,text,text), public.forum_new_thread(bigint,text,text,text),
  public.forum_mod_thread(bigint,text,bigint), public.forum_add_board_mod(uuid,bigint,bigint),
  public.forum_remove_board_mod(bigint)
  from public, anon, authenticated;
grant execute on function
  public.forum_needs_approval(), public.forum_captcha_required(),
  public.forum_reply(bigint,text), public.forum_review_pending(bigint,text),
  public.forum_report_post(bigint,text,text), public.forum_resolve_report(bigint,text),
  public.forum_set_role(uuid,text,text,text), public.forum_new_thread(bigint,text,text,text),
  public.forum_mod_thread(bigint,text,bigint), public.forum_add_board_mod(uuid,bigint,bigint),
  public.forum_remove_board_mod(bigint)
  to authenticated;
