-- CrowderBoard v1.2 migration: board/category moderators + banner image uploads.
-- Only needed for forums created before v1.2. New installs get this from schema.sql.
-- Run once in the Supabase SQL Editor.

-- ---------- New "boardmod" position (Moderator of specific boards/categories) ----------
alter table public.forum_profiles drop constraint forum_profiles_role_check;
alter table public.forum_profiles add constraint forum_profiles_role_check
  check (role in ('admin','mod','boardmod','member','banned'));

create table public.forum_board_mods (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.forum_profiles(id) on delete cascade,
  board_id bigint references public.forum_boards(id) on delete cascade,
  category_id bigint references public.forum_categories(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.forum_profiles(id) on delete set null,
  check ((board_id is null) <> (category_id is null))
);
create unique index forum_board_mods_unique on public.forum_board_mods (user_id, coalesce(board_id, 0), coalesce(category_id, 0));
create index forum_board_mods_user on public.forum_board_mods (user_id);

-- Board moderators can post like members
create or replace function public.forum_can_post() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.forum_my_role() in ('admin','mod','boardmod','member'), false)
$$;

-- Can the current user moderate this board? (admins, global mods, or an assigned board/category moderator)
create or replace function public.forum_can_mod_board(p_board bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.forum_is_mod() or (
    public.forum_my_role() = 'boardmod' and exists (
      select 1 from public.forum_board_mods m join public.forum_boards b on b.id = p_board
      where m.user_id = auth.uid() and (m.board_id = b.id or m.category_id = b.category_id)))
$$;

-- Keep the profile position in sync with assignments
create or replace function public.forum_board_mods_sync() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    update forum_profiles set role = 'boardmod' where id = new.user_id and role = 'member';
    return null;
  end if;
  if not exists (select 1 from forum_board_mods where user_id = old.user_id) then
    update forum_profiles set role = 'member' where id = old.user_id and role = 'boardmod';
  end if;
  return null;
end $$;
create trigger forum_board_mods_after_ins after insert on public.forum_board_mods for each row execute function public.forum_board_mods_sync();
create trigger forum_board_mods_after_del after delete on public.forum_board_mods for each row execute function public.forum_board_mods_sync();

-- Admins and global moderators assign / remove board moderators
create or replace function public.forum_add_board_mod(p_user uuid, p_board bigint default null, p_category bigint default null)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare r text; new_id bigint;
begin
  if not forum_is_mod() then raise exception 'Only administrators and global moderators can assign moderators.'; end if;
  if (p_board is null) = (p_category is null) then raise exception 'Choose either one board or one category.'; end if;
  select role into r from forum_profiles where id = p_user;
  if r is null then raise exception 'Member not found.'; end if;
  if r in ('admin','mod') then raise exception 'That member is already staff and can moderate every board.'; end if;
  if r = 'banned' then raise exception 'Banned members cannot be moderators.'; end if;
  insert into forum_board_mods (user_id, board_id, category_id, created_by)
    values (p_user, p_board, p_category, auth.uid()) returning id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'That member already moderates it.';
end $$;

create or replace function public.forum_remove_board_mod(p_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not forum_is_mod() then raise exception 'Only administrators and global moderators can remove moderators.'; end if;
  delete from forum_board_mods where id = p_id;
end $$;

-- Changing someone to any other position clears their board assignments
create or replace function public.forum_set_role(p_user uuid, p_role text, p_title text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not forum_is_admin() then raise exception 'Admins only.'; end if;
  if p_role <> 'boardmod' then delete from forum_board_mods where user_id = p_user; end if;
  update forum_profiles set role = p_role, title = coalesce(p_title, title) where id = p_user;
end $$;

-- Moderation actions are now checked per board
create or replace function public.forum_mod_thread(p_thread bigint, p_action text, p_board bigint default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare old_b bigint;
begin
  select board_id into old_b from forum_threads where id = p_thread;
  if old_b is null then raise exception 'Topic not found.'; end if;
  if not forum_can_mod_board(old_b) then raise exception 'You do not moderate this board.'; end if;
  if p_action = 'sticky' then update forum_threads set sticky = not sticky where id = p_thread;
  elsif p_action = 'lock' then update forum_threads set locked = not locked where id = p_thread;
  elsif p_action = 'move' then
    if p_board is null or not forum_can_mod_board(p_board) then raise exception 'You can only move topics to boards you moderate.'; end if;
    update forum_threads set board_id = p_board where id = p_thread;
    perform forum_refresh_board(old_b); perform forum_refresh_board(p_board);
  elsif p_action = 'delete' then delete from forum_threads where id = p_thread;
  else raise exception 'Unknown action'; end if;
end $$;

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
  insert into forum_threads (board_id, user_id, title, icon, last_post_user_id)
    values (p_board, auth.uid(), trim(p_title), p_icon, auth.uid()) returning id into t;
  insert into forum_posts (thread_id, user_id, body) values (t, auth.uid(), p_body);
  return t;
end $$;

drop policy "reply to open threads" on public.forum_posts;
create policy "reply to open threads" on public.forum_posts for insert to authenticated
  with check (
    user_id = auth.uid() and public.forum_can_post()
    and exists (select 1 from public.forum_threads t where t.id = thread_id and (not t.locked or public.forum_can_mod_board(t.board_id)))
  );
drop policy "edit own or mod" on public.forum_posts;
create policy "edit own or mod" on public.forum_posts for update to authenticated
  using ((user_id = auth.uid() and public.forum_can_post())
         or public.forum_can_mod_board((select t.board_id from public.forum_threads t where t.id = thread_id)))
  with check ((user_id = auth.uid() and public.forum_can_post())
         or public.forum_can_mod_board((select t.board_id from public.forum_threads t where t.id = thread_id)));
drop policy "delete own reply or mod" on public.forum_posts;
create policy "delete own reply or mod" on public.forum_posts for delete to authenticated
  using (
    public.forum_can_mod_board((select t.board_id from public.forum_threads t where t.id = thread_id)) or (
      user_id = auth.uid() and public.forum_can_post()
      and id <> (select min(p2.id) from public.forum_posts p2 where p2.thread_id = forum_posts.thread_id)
    )
  );

alter table public.forum_board_mods enable row level security;
create policy "board mods readable" on public.forum_board_mods for select using (true);
revoke all on public.forum_board_mods from anon, authenticated;
grant select on public.forum_board_mods to anon, authenticated;

revoke execute on function public.forum_board_mods_sync() from public, anon, authenticated;
revoke execute on function public.forum_can_mod_board(bigint), public.forum_add_board_mod(uuid,bigint,bigint),
  public.forum_remove_board_mod(bigint) from public, anon;
grant execute on function public.forum_can_mod_board(bigint), public.forum_add_board_mod(uuid,bigint,bigint),
  public.forum_remove_board_mod(bigint) to authenticated;

-- ---------- Banner image uploads (Supabase Storage) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('forum-assets', 'forum-assets', true, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

create policy "forum admins upload assets" on storage.objects for insert to authenticated
  with check (bucket_id = 'forum-assets' and public.forum_is_admin());
create policy "forum admins update assets" on storage.objects for update to authenticated
  using (bucket_id = 'forum-assets' and public.forum_is_admin())
  with check (bucket_id = 'forum-assets' and public.forum_is_admin());
create policy "forum admins delete assets" on storage.objects for delete to authenticated
  using (bucket_id = 'forum-assets' and public.forum_is_admin());
