-- CrowderBoard v1.1 migration: forum & member search.
-- Only needed for forums created with v1.0. New installs get this from schema.sql.
-- Run once in the Supabase SQL Editor.

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
