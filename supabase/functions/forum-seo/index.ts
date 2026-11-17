// CrowderBoard "forum-seo" edge function (v1.4).
// Crawlers can't see hash routes (#/thread/12), so this function serves plain,
// server-rendered HTML for each public topic and board, plus /sitemap.xml and /robots.txt.
//
//   GET  <fn>/thread/<id>[?page=N]   topic page (title, description, canonical, Open Graph, post text)
//   GET  <fn>/board/<id>[?page=N]    board page (topic list)
//   GET  <fn>/sitemap.xml            every public topic and board
//   GET  <fn>/robots.txt             allows crawling and points at the sitemap
//   GET  <fn>/                       redirects to the forum app
//
// Read-only and anon-safe: it only uses the project's PUBLISHABLE (anon) key, so it can
// see exactly what a logged-out visitor sees (Postgres RLS decides). Deploy with --no-verify-jwt.
// Optional secret: FORUM_APP_URL = the public address of your forum, e.g. https://example.com/forum/
import { createClient } from 'jsr:@supabase/supabase-js@2';

const POSTS_PER_PAGE = 15, TOPICS_PER_PAGE = 20, SITEMAP_LIMIT = 5000;
const SB_URL = Deno.env.get('SUPABASE_URL')!;
const sb = createClient(SB_URL, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
// Public address of the forum app. Set the FORUM_APP_URL secret, or edit DEFAULT_APP_URL below.
const DEFAULT_APP_URL = '';
const APP_URL = (Deno.env.get('FORUM_APP_URL') || DEFAULT_APP_URL).replace(/#.*$/, '');
const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|whatsapp|telegram|discord|slack|twitter|linkedin|pinterest|skype|google-|bing|yandex|duckduck|baidu/i;

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Where this function is publicly reachable (no trailing slash, no sub-path). */
function selfBase(u: URL): string {
  const i = u.pathname.indexOf('/forum-seo');
  return u.origin.replace(/^http:/, 'https:') + (i >= 0 ? u.pathname.slice(0, i) : '') + '/forum-seo';
}
/** Path after the function name, e.g. "/thread/12". */
function subPath(u: URL): string {
  const i = u.pathname.indexOf('/forum-seo');
  const p = i >= 0 ? u.pathname.slice(i + '/forum-seo'.length) : u.pathname;
  return p.replace(/\/+$/, '') || '/';
}

/** BBCode -> plain text (descriptions) */
function plain(src: string): string {
  return String(src ?? '')
    .replace(/\[quote(?:=[^\]]*)?\][\s\S]*?\[\/quote\]/gi, ' ')
    .replace(/\[img\][\s\S]*?\[\/img\]/gi, ' ')
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1')
    .replace(/\[\/?[a-z*]+(?:=[^\]]*)?\]/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);

/** BBCode -> safe HTML. Everything is escaped first; only whitelisted tags are re-introduced. */
function bb(src: string): string {
  const keep: string[] = [];
  const hold = (h: string) => { keep.push(h); return `\u0001${keep.length - 1}\u0001`; };
  let s = esc(src).replace(/\r/g, '');
  s = s.replace(/\[code\]\n?([\s\S]*?)\[\/code\]/gi, (_m, c) => hold(`<pre>${c}</pre>`));
  s = s.replace(/\[img\](https:\/\/[^\s\[\]"<>]+?)\[\/img\]/gi, () => hold('<i>[image]</i>'));
  s = s.replace(/\[url\](https?:\/\/[^\s\[\]"<>]+?)\[\/url\]/gi, (_m, u) => hold(`<a href="${u}" rel="nofollow ugc noopener">${u}</a>`));
  s = s.replace(/\[url=(https?:\/\/[^\s\[\]"<>]+?)\]([\s\S]*?)\[\/url\]/gi, (_m, u, t) => hold(`<a href="${u}" rel="nofollow ugc noopener">`) + t + hold('</a>'));
  for (let i = 0; i < 3; i++) s = s.replace(/\[(b|i|u|s)\]([\s\S]*?)\[\/\1\]/gi, (_m, t, c) => `<${t.toLowerCase()}>${c}</${t.toLowerCase()}>`);
  for (let i = 0; i < 6; i++) {
    const before = s;
    s = s.replace(/\[quote(?:=([^\]\n]{1,40}))?\]\n?((?:(?!\[quote)[\s\S])*?)\[\/quote\]\n?/i,
      (_m, who, body) => `<blockquote>${who ? `<b>${who} wrote:</b><br>` : ''}${body}</blockquote>`);
    if (s === before) break;
  }
  s = s.replace(/\[list\]\n?([\s\S]*?)\[\/list\]\n?/gi, (_m, body) =>
    '<ul>' + body.split(/\[\*\]/).map((x: string) => x.trim()).filter(Boolean).map((x: string) => `<li>${x}</li>`).join('') + '</ul>');
  s = s.replace(/\[\/?(?:center|color|size)(?:=[^\]]*)?\]/gi, '').replace(/\n/g, '<br>');
  return s.replace(/\u0001(\d+)\u0001/g, (_m, i) => keep[+i]);
}

async function siteName(): Promise<string> {
  const { data } = await sb.from('forum_settings').select('data').eq('id', 1).maybeSingle();
  return String(data?.data?.name || 'Forum');
}

const CSS = `body{font:14px/1.5 Verdana,Arial,sans-serif;background:#1e1f21;color:#ddd;margin:0}
.w{max-width:900px;margin:0 auto;padding:12px}a{color:#7fb2ff}h1{font-size:20px;margin:.4em 0}
.crumb,.meta{font-size:12px;color:#999}.post{background:#2a2c2f;border:1px solid #3a3d41;border-radius:4px;margin:10px 0;padding:10px}
.post h2{font-size:12px;margin:0 0 6px;color:#aaa;font-weight:normal}blockquote{border-left:3px solid #f90;margin:6px 0;padding:2px 10px;background:#232426}
pre{background:#161718;padding:8px;overflow:auto}.open{display:inline-block;margin:8px 0;padding:6px 12px;background:#1b3c69;border-radius:3px;color:#fff;text-decoration:none}
nav a{margin-right:10px}`;

function layout(o: { title: string; desc: string; canonical: string; app?: string; site: string; body: string; ogType?: string; noindex?: boolean; bot: boolean; prev?: string; next?: string }): string {
  const redirect = o.app && !o.bot ? `<script>location.replace(${JSON.stringify(o.app)});</script>` : '';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(o.title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(o.desc)}">
<meta name="robots" content="${o.noindex ? 'noindex,follow' : 'index,follow,max-snippet:-1'}">
<link rel="canonical" href="${esc(o.canonical)}">${o.prev ? `\n<link rel="prev" href="${esc(o.prev)}">` : ''}${o.next ? `\n<link rel="next" href="${esc(o.next)}">` : ''}
<meta property="og:site_name" content="${esc(o.site)}">
<meta property="og:type" content="${o.ogType || 'website'}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:url" content="${esc(o.canonical)}">
<meta name="twitter:card" content="summary">
<style>${CSS}</style></head><body><div class="w">${o.body}
<p class="meta">${esc(o.site)} &middot; powered by CrowderBoard</p></div>${redirect}</body></html>`;
}

const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=600', 'X-Content-Type-Options': 'nosniff', ...extra } });

function notFound(site: string, base: string, bot: boolean) {
  return new Response(layout({ title: 'Not found - ' + site, desc: 'This page does not exist.', canonical: base + '/', site, noindex: true, bot: true, body: `<h1>Not found</h1><p>That topic or board does not exist (it may have been deleted).</p>${APP_URL ? `<p><a href="${esc(APP_URL)}">Go to the forum</a></p>` : ''}` }),
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' } });
}

async function threadPage(id: number, page: number, u: URL, bot: boolean): Promise<Response> {
  const base = selfBase(u), site = await siteName();
  const { data: th } = await sb.from('forum_threads').select('id,title,reply_count,created_at,last_post_at,board:forum_boards(id,name)').eq('id', id).maybeSingle();
  if (!th) return notFound(site, base, bot);
  const pages = Math.max(1, Math.ceil((th.reply_count + 1) / POSTS_PER_PAGE));
  if (page > pages) page = pages;
  const { data: posts } = await sb.from('forum_posts')
    .select('id,body,created_at,edited_at,author:forum_profiles!forum_posts_user_id_fkey(username)')
    .eq('thread_id', id).order('id').range((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE - 1);
  const board = th.board as unknown as { id: number; name: string };
  const canonical = `${base}/thread/${id}${page > 1 ? `?page=${page}` : ''}`;
  const first = posts?.[0];
  const desc = clip(plain(first?.body || '') || th.title, 160);
  const app = APP_URL ? `${APP_URL}#/thread/${id}${page > 1 ? `?page=${page}` : ''}` : undefined;
  const items = (posts || []).map((p) => {
    const a = p.author as unknown as { username: string } | null;
    return `<div class="post" id="post-${p.id}"><h2>${esc(a?.username || 'Deleted user')} &middot; <time datetime="${esc(p.created_at)}">${esc(String(p.created_at).slice(0, 10))}</time></h2><div>${bb(p.body)}</div></div>`;
  }).join('');
  const nav = `<nav>${page > 1 ? `<a href="${esc(`${base}/thread/${id}${page > 2 ? `?page=${page - 1}` : ''}`)}">&laquo; Previous</a>` : ''}${page < pages ? `<a href="${esc(`${base}/thread/${id}?page=${page + 1}`)}">Next &raquo;</a>` : ''}</nav>`;
  const body = `<div class="crumb"><a href="${esc(base + '/board/' + board.id)}">${esc(board.name)}</a> &raquo; ${esc(th.title)}</div>
<h1>${esc(th.title)}</h1>${app ? `<a class="open" href="${esc(app)}">Open in ${esc(site)}</a>` : ''}${items}${nav}`;
  const title = `${th.title}${page > 1 ? ` (page ${page})` : ''} - ${board.name} - ${site}`;
  return html(layout({ title, desc, canonical, app, site, body, ogType: 'article', bot,
    prev: page > 1 ? `${base}/thread/${id}${page > 2 ? `?page=${page - 1}` : ''}` : undefined,
    next: page < pages ? `${base}/thread/${id}?page=${page + 1}` : undefined }));
}

async function boardPage(id: number, page: number, u: URL, bot: boolean): Promise<Response> {
  const base = selfBase(u), site = await siteName();
  const { data: b } = await sb.from('forum_boards').select('id,name,description,thread_count').eq('id', id).maybeSingle();
  if (!b) return notFound(site, base, bot);
  const pages = Math.max(1, Math.ceil((b.thread_count || 0) / TOPICS_PER_PAGE));
  if (page > pages) page = pages;
  const { data: ts } = await sb.from('forum_threads').select('id,title,reply_count,last_post_at')
    .eq('board_id', id).order('sticky', { ascending: false }).order('last_post_at', { ascending: false })
    .range((page - 1) * TOPICS_PER_PAGE, page * TOPICS_PER_PAGE - 1);
  const canonical = `${base}/board/${id}${page > 1 ? `?page=${page}` : ''}`;
  const app = APP_URL ? `${APP_URL}#/board/${id}${page > 1 ? `?page=${page}` : ''}` : undefined;
  const list = (ts || []).map((t) => `<li><a href="${esc(`${base}/thread/${t.id}`)}">${esc(t.title)}</a> <span class="meta">${t.reply_count} repl${t.reply_count === 1 ? 'y' : 'ies'}</span></li>`).join('');
  const nav = `<nav>${page > 1 ? `<a href="${esc(`${base}/board/${id}${page > 2 ? `?page=${page - 1}` : ''}`)}">&laquo; Previous</a>` : ''}${page < pages ? `<a href="${esc(`${base}/board/${id}?page=${page + 1}`)}">Next &raquo;</a>` : ''}</nav>`;
  const body = `<h1>${esc(b.name)}</h1><p>${esc(b.description || '')}</p>${app ? `<a class="open" href="${esc(app)}">Open in ${esc(site)}</a>` : ''}<ul>${list || '<li>No topics yet.</li>'}</ul>${nav}`;
  return html(layout({ title: `${b.name}${page > 1 ? ` (page ${page})` : ''} - ${site}`, desc: clip(b.description || `Topics in ${b.name}`, 160), canonical, app, site, body, bot,
    prev: page > 1 ? `${base}/board/${id}${page > 2 ? `?page=${page - 1}` : ''}` : undefined,
    next: page < pages ? `${base}/board/${id}?page=${page + 1}` : undefined }));
}

async function sitemap(u: URL): Promise<Response> {
  const base = selfBase(u);
  const [bs, ts] = await Promise.all([
    sb.from('forum_boards').select('id,last_post_at').order('id'),
    sb.from('forum_threads').select('id,reply_count,last_post_at').order('last_post_at', { ascending: false }).limit(SITEMAP_LIMIT),
  ]);
  const url = (loc: string, mod?: string | null) => `<url><loc>${esc(loc)}</loc>${mod ? `<lastmod>${new Date(mod).toISOString()}</lastmod>` : ''}</url>`;
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const b of bs.data || []) out += url(`${base}/board/${b.id}`, b.last_post_at) + '\n';
  for (const t of ts.data || []) {
    out += url(`${base}/thread/${t.id}`, t.last_post_at) + '\n';
    const pages = Math.ceil((t.reply_count + 1) / POSTS_PER_PAGE);
    for (let p = 2; p <= pages; p++) out += url(`${base}/thread/${t.id}?page=${p}`, t.last_post_at) + '\n';
  }
  out += '</urlset>\n';
  return new Response(out, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  const u = new URL(req.url), path = subPath(u), bot = BOT_RE.test(req.headers.get('user-agent') || '');
  const page = Math.max(1, Math.min(10000, parseInt(u.searchParams.get('page') || '1', 10) || 1));
  try {
    if (path === '/sitemap.xml') return await sitemap(u);
    if (path === '/robots.txt') return new Response(`User-agent: *\nAllow: /\nSitemap: ${selfBase(u)}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/thread\/(\d{1,15})$/))) return await threadPage(+m[1], page, u, bot);
    if ((m = path.match(/^\/board\/(\d{1,15})$/))) return await boardPage(+m[1], page, u, bot);
    if (path === '/' && APP_URL) return new Response(null, { status: 302, headers: { Location: APP_URL } });
    return notFound(await siteName(), selfBase(u), bot);
  } catch (e) {
    console.error('forum-seo error', e);
    return new Response('Temporarily unavailable', { status: 503, headers: { 'Retry-After': '60' } });
  }
});
