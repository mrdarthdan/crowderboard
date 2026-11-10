-- =====================================================================
-- CrowderBoard database schema
-- Run this once in your Supabase project's SQL Editor (Dashboard -> SQL Editor -> New query).
-- All tables are prefixed "forum_" so the forum can share a project with other apps.
-- Copyright (c) 2026 Dan Crowder. MIT License.
-- =====================================================================

-- ---------- Tables ----------
create table public.forum_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_\-]{3,20}$'),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  signature text check (char_length(signature) <= 300),
  location text check (char_length(location) <= 60),
  title text check (char_length(title) <= 40),
  role text not null default 'member' check (role in ('admin','mod','member','banned')),
  post_count int not null default 0,
  mark_read_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index forum_profiles_username_lower on public.forum_profiles (lower(username));

create table public.forum_categories (
  id bigint generated always as identity primary key,
  name text not null,
  sort int not null default 0
);

create table public.forum_boards (
  id bigint generated always as identity primary key,
  category_id bigint not null references public.forum_categories(id) on delete cascade,
  name text not null,
  description text,
  sort int not null default 0,
  mod_only_threads boolean not null default false,
  thread_count int not null default 0,
  post_count int not null default 0,
  last_post_id bigint,
  last_post_at timestamptz,
  last_post_user_id uuid references public.forum_profiles(id) on delete set null,
  last_thread_id bigint
);

create table public.forum_threads (
  id bigint generated always as identity primary key,
  board_id bigint not null references public.forum_boards(id) on delete cascade,
  user_id uuid references public.forum_profiles(id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  icon text not null default 'default',
  sticky boolean not null default false,
  locked boolean not null default false,
  reply_count int not null default 0,
  view_count int not null default 0,
  created_at timestamptz not null default now(),
  last_post_id bigint,
  last_post_at timestamptz not null default now(),
  last_post_user_id uuid references public.forum_profiles(id) on delete set null
);
create index forum_threads_board on public.forum_threads (board_id, sticky desc, last_post_at desc);

create table public.forum_posts (
  id bigint generated always as identity primary key,
  thread_id bigint not null references public.forum_threads(id) on delete cascade,
  user_id uuid references public.forum_profiles(id) on delete set null,
  body text not null check (char_length(body) between 1 and 20000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  edited_by uuid references public.forum_profiles(id) on delete set null
);
create index forum_posts_thread on public.forum_posts (thread_id, id);
create index forum_posts_user on public.forum_posts (user_id, created_at);

create table public.forum_read (
  user_id uuid not null references public.forum_profiles(id) on delete cascade,
  thread_id bigint not null references public.forum_threads(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, thread_id)
);

create table public.forum_messages (
  id bigint generated always as identity primary key,
  from_user uuid not null references public.forum_profiles(id) on delete cascade,
  to_user uuid not null references public.forum_profiles(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 120),
  body text not null check (char_length(body) between 1 and 10000),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index forum_messages_to on public.forum_messages (to_user, created_at desc);
create index forum_messages_from on public.forum_messages (from_user, created_at desc);

create table public.forum_settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb check (octet_length(data::text) < 200000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.forum_profiles(id) on delete set null
);
insert into public.forum_settings (id) values (1);

-- ---------- Role helpers (used by policies) ----------
create or replace function public.forum_my_role() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.forum_profiles where id = auth.uid()
$$;
create or replace function public.forum_is_mod() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.forum_my_role() in ('admin','mod'), false)
$$;
create or replace function public.forum_is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.forum_my_role() = 'admin', false)
$$;
create or replace function public.forum_can_post() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.forum_my_role() in ('admin','mod','member'), false)
$$;

-- ---------- Counters (topic/post counts, "last post" info) ----------
create or replace function public.forum_refresh_thread(p_thread bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare lp record;
begin
  select id, created_at, user_id into lp from forum_posts where thread_id = p_thread order by id desc limit 1;
  update forum_threads set
    reply_count = greatest((select count(*) from forum_posts where thread_id = p_thread) - 1, 0),
    last_post_id = lp.id,
    last_post_at = coalesce(lp.created_at, created_at),
    last_post_user_id = lp.user_id
  where id = p_thread;
end $$;

create or replace function public.forum_refresh_board(p_board bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare lp record;
begin
  select p.id, p.created_at, p.user_id, p.thread_id into lp
    from forum_posts p join forum_threads t on t.id = p.thread_id
    where t.board_id = p_board order by p.id desc limit 1;
  update forum_boards set
    thread_count = (select count(*) from forum_threads where board_id = p_board),
    post_count = (select count(*) from forum_posts p join forum_threads t on t.id = p.thread_id where t.board_id = p_board),
    last_post_id = lp.id, last_post_at = lp.created_at,
    last_post_user_id = lp.user_id, last_thread_id = lp.thread_id
  where id = p_board;
end $$;

create or replace function public.forum_posts_after_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare b bigint; r record;
begin
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  select board_id into b from forum_threads where id = r.thread_id;
  if b is not null then
    perform forum_refresh_thread(r.thread_id);
    perform forum_refresh_board(b);
  end if;
  if r.user_id is not null then
    update forum_profiles set post_count = greatest(post_count + case when tg_op = 'INSERT' then 1 else -1 end, 0)
      where id = r.user_id;
  end if;
  return null;
end $$;
create trigger forum_posts_after_ins after insert on public.forum_posts for each row execute function public.forum_posts_after_change();
create trigger forum_posts_after_del after delete on public.forum_posts for each row execute function public.forum_posts_after_change();

create or replace function public.forum_threads_after_del() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin perform forum_refresh_board(old.board_id); return null; end $$;
create trigger forum_threads_after_del after delete on public.forum_threads for each row execute function public.forum_threads_after_del();

-- ---------- Integrity + flood control triggers ----------
create or replace function public.forum_posts_before_ins() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.created_at := now(); new.edited_at := null; new.edited_by := null;
  if not forum_is_mod() and coalesce(current_setting('request.jwt.claims', true), '') <> '' then
    if (select count(*) from forum_posts where user_id = new.user_id and created_at > now() - interval '60 seconds') >= 5 then
      raise exception 'You are posting too fast. Please wait a minute and try again.';
    end if;
  end if;
  return new;
end $$;
create trigger forum_posts_before_ins before insert on public.forum_posts for each row execute function public.forum_posts_before_ins();

create or replace function public.forum_posts_before_upd() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.edited_at := now(); new.edited_by := auth.uid();
  new.thread_id := old.thread_id; new.user_id := old.user_id; new.created_at := old.created_at;
  return new;
end $$;
create trigger forum_posts_before_upd before update on public.forum_posts for each row execute function public.forum_posts_before_upd();

create or replace function public.forum_messages_before_ins() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.created_at := now(); new.is_read := false;
  if not forum_is_mod() and (select count(*) from forum_messages where from_user = new.from_user and created_at > now() - interval '60 seconds') >= 5 then
    raise exception 'You are sending messages too fast. Please wait a minute and try again.';
  end if;
  return new;
end $$;
create trigger forum_messages_before_ins before insert on public.forum_messages for each row execute function public.forum_messages_before_ins();

create or replace function public.forum_profiles_before_upd() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.last_seen := least(new.last_seen, now());
  new.mark_read_at := least(new.mark_read_at, now());
  return new;
end $$;
create trigger forum_profiles_before_upd before update on public.forum_profiles for each row execute function public.forum_profiles_before_upd();

-- ---------- RPCs called by the web app ----------
create or replace function public.forum_new_thread(p_board bigint, p_title text, p_body text, p_icon text default 'default')
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare t bigint; mo boolean;
begin
  if not forum_can_post() then raise exception 'You must be a registered, non-banned member to post.'; end if;
  select mod_only_threads into mo from forum_boards where id = p_board;
  if mo is null then raise exception 'Board not found'; end if;
  if mo and not forum_is_mod() then raise exception 'Only moderators can start topics in this board.'; end if;
  if not forum_is_mod() and (select count(*) from forum_threads where user_id = auth.uid() and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'You are starting topics too fast. Please wait a few minutes.';
  end if;
  if p_icon not in ('default','question','idea','alert','happy','sad','thumbsup','thumbsdown') then p_icon := 'default'; end if;
  insert into forum_threads (board_id, user_id, title, icon, last_post_user_id)
    values (p_board, auth.uid(), trim(p_title), p_icon, auth.uid()) returning id into t;
  insert into forum_posts (thread_id, user_id, body) values (t, auth.uid(), p_body);
  return t;
end $$;

create or replace function public.forum_view_thread(p_thread bigint) returns void
language sql security definer set search_path = public, pg_temp as $$
  update forum_threads set view_count = view_count + 1 where id = p_thread
$$;

create or replace function public.forum_mod_thread(p_thread bigint, p_action text, p_board bigint default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare old_b bigint;
begin
  if not forum_is_mod() then raise exception 'Moderators only.'; end if;
  if p_action = 'sticky' then update forum_threads set sticky = not sticky where id = p_thread;
  elsif p_action = 'lock' then update forum_threads set locked = not locked where id = p_thread;
  elsif p_action = 'move' then
    select board_id into old_b from forum_threads where id = p_thread;
    update forum_threads set board_id = p_board where id = p_thread;
    perform forum_refresh_board(old_b); perform forum_refresh_board(p_board);
  elsif p_action = 'delete' then delete from forum_threads where id = p_thread;
  else raise exception 'Unknown action'; end if;
end $$;

create or replace function public.forum_set_role(p_user uuid, p_role text, p_title text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not forum_is_admin() then raise exception 'Admins only.'; end if;
  update forum_profiles set role = p_role, title = coalesce(p_title, title) where id = p_user;
end $$;

create or replace function public.forum_unread()
returns table(thread_id bigint, board_id bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.board_id from forum_threads t
  join forum_profiles p on p.id = auth.uid()
  left join forum_read r on r.thread_id = t.id and r.user_id = p.id
  where t.last_post_at > p.mark_read_at
    and (r.last_read_at is null or t.last_post_at > r.last_read_at)
$$;

-- ---------- Search (v1.1) ----------
create index forum_posts_fts on public.forum_posts using gin (to_tsvector('english', body));
create index forum_threads_fts on public.forum_threads using gin (to_tsvector('english', title));

create or replace function public.forum_search(
  p_q text default null, p_board bigint default null, p_author text default null,
  p_titles_only boolean default false, p_limit int default 20, p_offset int default 0)
returns table(post_id bigint, thread_id bigint, thread_title text, board_id bigint, board_name text,
              author_id uuid, author_name text, author_role text, created_at timestamptz,
              post_page int, snippet text, total bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  with q as (
    select case when coalesce(trim(p_q), '') = '' then null else websearch_to_tsquery('english', left(p_q, 200)) end as tq
  ),
  firsts as (select fp.thread_id, min(fp.id) as first_id from forum_posts fp group by fp.thread_id),
  hits as (
    select p.id as post_id, t.id as thread_id, t.title, b.id as board_id, b.name as board_name,
           pr.id as author_id, pr.username, pr.role, p.created_at, p.body,
           coalesce(ts_rank(to_tsvector('english', p.body), q.tq), 0)
             + case when q.tq is not null and p.id = f.first_id and to_tsvector('english', t.title) @@ q.tq then 0.6 else 0 end as rank
    from forum_posts p
    join forum_threads t on t.id = p.thread_id
    join forum_boards b on b.id = t.board_id
    join firsts f on f.thread_id = t.id
    left join forum_profiles pr on pr.id = p.user_id
    cross join q
    where (p_board is null or b.id = p_board)
      and (coalesce(trim(p_author), '') = '' or lower(pr.username) = lower(trim(p_author)))
      and (q.tq is not null or coalesce(trim(p_author), '') <> '')
      and case
            when q.tq is null then (not p_titles_only or p.id = f.first_id)
            when p_titles_only then p.id = f.first_id and to_tsvector('english', t.title) @@ q.tq
            else to_tsvector('english', p.body) @@ q.tq or (p.id = f.first_id and to_tsvector('english', t.title) @@ q.tq)
          end
  )
  select h.post_id, h.thread_id, h.title, h.board_id, h.board_name, h.author_id, h.username, h.role, h.created_at,
         ((select count(*) from forum_posts x where x.thread_id = h.thread_id and x.id <= h.post_id) - 1)::int / 15 + 1,
         case when q.tq is null then left(h.body, 300)
              else ts_headline('english', h.body, q.tq, 'StartSel=[[[hl, StopSel=hl]]], MaxWords=40, MinWords=15, MaxFragments=2, FragmentDelimiter=" ... "') end,
         count(*) over ()
  from hits h cross join q
  order by h.rank desc, h.created_at desc
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)
$$;
revoke execute on function public.forum_search(text, bigint, text, boolean, int, int) from public;
grant execute on function public.forum_search(text, bigint, text, boolean, int, int) to anon, authenticated;

-- ---------- Row Level Security ----------
alter table public.forum_profiles enable row level security;
alter table public.forum_categories enable row level security;
alter table public.forum_boards enable row level security;
alter table public.forum_threads enable row level security;
alter table public.forum_posts enable row level security;
alter table public.forum_read enable row level security;
alter table public.forum_messages enable row level security;
alter table public.forum_settings enable row level security;

create policy "profiles readable" on public.forum_profiles for select using (true);
create policy "create own profile" on public.forum_profiles for insert to authenticated
  with check (id = auth.uid() and role = 'member' and post_count = 0);
create policy "update own profile" on public.forum_profiles for update to authenticated
  using (id = auth.uid() and role <> 'banned') with check (id = auth.uid() and role <> 'banned');

create policy "categories readable" on public.forum_categories for select using (true);
create policy "admin manage categories" on public.forum_categories for all to authenticated
  using (public.forum_is_admin()) with check (public.forum_is_admin());

create policy "boards readable" on public.forum_boards for select using (true);
create policy "admin manage boards" on public.forum_boards for all to authenticated
  using (public.forum_is_admin()) with check (public.forum_is_admin());

create policy "threads readable" on public.forum_threads for select using (true);

create policy "posts readable" on public.forum_posts for select using (true);
create policy "reply to open threads" on public.forum_posts for insert to authenticated
  with check (
    user_id = auth.uid() and public.forum_can_post()
    and exists (select 1 from public.forum_threads t where t.id = thread_id and (not t.locked or public.forum_is_mod()))
  );
create policy "edit own or mod" on public.forum_posts for update to authenticated
  using ((user_id = auth.uid() and public.forum_can_post()) or public.forum_is_mod())
  with check ((user_id = auth.uid() and public.forum_can_post()) or public.forum_is_mod());
create policy "delete own reply or mod" on public.forum_posts for delete to authenticated
  using (
    public.forum_is_mod() or (
      user_id = auth.uid() and public.forum_can_post()
      and id <> (select min(p2.id) from public.forum_posts p2 where p2.thread_id = forum_posts.thread_id)
    )
  );

create policy "own read marks" on public.forum_read for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "see own messages" on public.forum_messages for select to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());
create policy "send messages" on public.forum_messages for insert to authenticated
  with check (from_user = auth.uid() and public.forum_can_post() and is_read = false);
create policy "mark read" on public.forum_messages for update to authenticated
  using (to_user = auth.uid()) with check (to_user = auth.uid());
create policy "delete own messages" on public.forum_messages for delete to authenticated
  using (from_user = auth.uid() or to_user = auth.uid());

create policy "settings readable" on public.forum_settings for select using (true);
create policy "admin updates settings" on public.forum_settings for update to authenticated
  using (public.forum_is_admin()) with check (public.forum_is_admin());

-- ---------- Table & column privileges (least privilege for the public API roles) ----------
revoke all on public.forum_profiles, public.forum_categories, public.forum_boards, public.forum_threads,
  public.forum_posts, public.forum_read, public.forum_messages, public.forum_settings from anon, authenticated;

grant select on public.forum_profiles, public.forum_categories, public.forum_boards, public.forum_threads,
  public.forum_posts, public.forum_settings to anon, authenticated;
grant select on public.forum_messages to authenticated;

grant insert (id, username, avatar_url, signature, location) on public.forum_profiles to authenticated;
grant update (avatar_url, signature, location, mark_read_at, last_seen) on public.forum_profiles to authenticated;
grant insert, update, delete on public.forum_categories, public.forum_boards to authenticated;   -- admins only, via RLS
grant insert (thread_id, user_id, body) on public.forum_posts to authenticated;
grant update (body) on public.forum_posts to authenticated;
grant delete on public.forum_posts to authenticated;
grant select, insert, update, delete on public.forum_read to authenticated;
grant insert (from_user, to_user, subject, body) on public.forum_messages to authenticated;
grant update (is_read) on public.forum_messages to authenticated;
grant delete on public.forum_messages to authenticated;
grant update (data, updated_at, updated_by) on public.forum_settings to authenticated;           -- admins only, via RLS

-- ---------- Function privileges ----------
revoke execute on function
  public.forum_refresh_thread(bigint), public.forum_refresh_board(bigint),
  public.forum_posts_after_change(), public.forum_threads_after_del(), public.forum_posts_before_ins(),
  public.forum_posts_before_upd(), public.forum_messages_before_ins(), public.forum_profiles_before_upd(),
  public.forum_my_role(), public.forum_is_mod(), public.forum_is_admin(), public.forum_can_post(),
  public.forum_new_thread(bigint,text,text,text), public.forum_mod_thread(bigint,text,bigint),
  public.forum_set_role(uuid,text,text), public.forum_unread(), public.forum_view_thread(bigint)
  from public, anon, authenticated;
grant execute on function
  public.forum_my_role(), public.forum_is_mod(), public.forum_is_admin(), public.forum_can_post(),
  public.forum_new_thread(bigint,text,text,text), public.forum_mod_thread(bigint,text,bigint),
  public.forum_set_role(uuid,text,text), public.forum_unread()
  to authenticated;
grant execute on function public.forum_view_thread(bigint) to anon, authenticated;

-- ---------- Starter boards (rename or delete them later in Admin -> Boards & Members) ----------
with c1 as (insert into public.forum_categories (name, sort) values ('General', 1) returning id),
     c2 as (insert into public.forum_categories (name, sort) values ('The Lounge', 2) returning id)
insert into public.forum_boards (category_id, name, description, sort, mod_only_threads)
select id, 'Announcements', 'News and updates from the staff. Read these first!', 1, true from c1
union all select id, 'General Discussion', 'Talk about anything and everything.', 2, false from c1
union all select id, 'Introductions', 'New here? Say hello and tell us about yourself.', 3, false from c1
union all select id, 'Off-Topic', 'Random chatter, jokes and everything else.', 1, false from c2
union all select id, 'Games & Tech', 'Video games, gadgets, and computer talk.', 2, false from c2;
