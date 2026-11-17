#!/usr/bin/env node
/* CrowderBoard v1.4 — static prerender for search engines.
   Hash routes (#/thread/12) are invisible to crawlers, so this script writes plain HTML pages
   next to index.html that ARE crawlable on any static host:

     t/<id>.html   one file per topic (title, description, canonical, Open Graph, post text)
     b/<id>.html   one file per board (topic list)
     sitemap.xml   every page above

   Humans who open one of these pages are sent on to the real app (#/thread/<id>); crawlers stay.
   Only content a logged-out visitor can read is used (it queries Supabase with your PUBLISHABLE key).

   Usage:
     node tools/prerender.mjs --base https://example.com/forum/            # reads config.js, fetches from Supabase
     node tools/prerender.mjs --base https://example.com/forum/ --input data.json   # offline (see README)
   Options: --out <dir> (default .)   --config <file> (default config.js)
   Re-run it (and re-upload t/, b/ and sitemap.xml) whenever you want search engines to see new posts. */
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : a), []));
const BASE = String(args.base || '').replace(/[#?].*$/, '').replace(/\/?$/, '/');
if (!/^https?:\/\//.test(BASE)) { console.error('Usage: node tools/prerender.mjs --base https://example.com/forum/ [--input data.json] [--out dir]'); process.exit(1); }
const OUT = path.resolve(String(args.out || '.'));
const POSTS_PER_PAGE = 15;

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export function plain(src) {
  return String(src ?? '').replace(/\[quote(?:=[^\]]*)?\][\s\S]*?\[\/quote\]/gi, ' ').replace(/\[img\][\s\S]*?\[\/img\]/gi, ' ')
    .replace(/\[url=[^\]]*\]([\s\S]*?)\[\/url\]/gi, '$1').replace(/\[\/?[a-z*]+(?:=[^\]]*)?\]/gi, ' ').replace(/\s+/g, ' ').trim();
}
export const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);
export function bb(src) {
  const keep = []; const hold = (h) => { keep.push(h); return `\u0001${keep.length - 1}\u0001`; };
  let s = esc(src).replace(/\r/g, '');
  s = s.replace(/\[code\]\n?([\s\S]*?)\[\/code\]/gi, (m, c) => hold(`<pre>${c}</pre>`));
  s = s.replace(/\[img\](https:\/\/[^\s\[\]"<>]+?)\[\/img\]/gi, () => hold('<i>[image]</i>'));
  s = s.replace(/\[url\](https?:\/\/[^\s\[\]"<>]+?)\[\/url\]/gi, (m, u) => hold(`<a href="${u}" rel="nofollow ugc noopener">${u}</a>`));
  s = s.replace(/\[url=(https?:\/\/[^\s\[\]"<>]+?)\]([\s\S]*?)\[\/url\]/gi, (m, u, t) => hold(`<a href="${u}" rel="nofollow ugc noopener">`) + t + hold('</a>'));
  for (let i = 0; i < 3; i++) s = s.replace(/\[(b|i|u|s)\]([\s\S]*?)\[\/\1\]/gi, (m, t, c) => `<${t.toLowerCase()}>${c}</${t.toLowerCase()}>`);
  for (let i = 0; i < 6; i++) { const b = s;
    s = s.replace(/\[quote(?:=([^\]\n]{1,40}))?\]\n?((?:(?!\[quote)[\s\S])*?)\[\/quote\]\n?/i, (m, who, body) => `<blockquote>${who ? `<b>${who} wrote:</b><br>` : ''}${body}</blockquote>`);
    if (s === b) break; }
  s = s.replace(/\[list\]\n?([\s\S]*?)\[\/list\]\n?/gi, (m, body) => '<ul>' + body.split(/\[\*\]/).map((x) => x.trim()).filter(Boolean).map((x) => `<li>${x}</li>`).join('') + '</ul>');
  s = s.replace(/\[\/?(?:center|color|size)(?:=[^\]]*)?\]/gi, '').replace(/\n/g, '<br>');
  return s.replace(/\u0001(\d+)\u0001/g, (m, i) => keep[+i]);
}

const CSS = `body{font:14px/1.5 Verdana,Arial,sans-serif;background:#1e1f21;color:#ddd;margin:0}.w{max-width:900px;margin:0 auto;padding:12px}a{color:#7fb2ff}h1{font-size:20px;margin:.4em 0}.crumb,.meta{font-size:12px;color:#999}.post{background:#2a2c2f;border:1px solid #3a3d41;border-radius:4px;margin:10px 0;padding:10px}.post h2{font-size:12px;margin:0 0 6px;color:#aaa;font-weight:normal}blockquote{border-left:3px solid #f90;margin:6px 0;padding:2px 10px;background:#232426}pre{background:#161718;padding:8px;overflow:auto}.open{display:inline-block;margin:8px 0;padding:6px 12px;background:#1b3c69;border-radius:3px;color:#fff;text-decoration:none}nav a{margin-right:10px}`;
const BOT = '/bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|whatsapp|telegram|discord|slack|twitter|linkedin|pinterest|skype|google-|bing|yandex|duckduck|baidu/i';

export function page(o) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(o.title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${esc(o.desc)}">
<meta name="robots" content="index,follow,max-snippet:-1">
<link rel="canonical" href="${esc(o.canonical)}">
<meta property="og:site_name" content="${esc(o.site)}">
<meta property="og:type" content="${o.ogType || 'website'}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.desc)}">
<meta property="og:url" content="${esc(o.canonical)}">
<meta name="twitter:card" content="summary">
<style>${CSS}</style></head><body><div class="w">${o.body}
<p class="meta">${esc(o.site)} &middot; powered by CrowderBoard</p></div>
<script>if(!${BOT}.test(navigator.userAgent))location.replace(${JSON.stringify(o.app)});</script></body></html>
`;
}

export function build(data, base) {
  const site = data.site || 'Forum';
  const boards = new Map(data.boards.map((b) => [b.id, b]));
  const files = new Map(); const urls = [];
  const lastmod = (d) => (d ? new Date(d).toISOString() : null);
  for (const b of data.boards) {
    const ts = data.threads.filter((t) => t.board_id === b.id).sort((x, y) => (y.sticky - x.sticky) || (new Date(y.last_post_at) - new Date(x.last_post_at)));
    const canonical = `${base}b/${b.id}.html`, app = `${base}#/board/${b.id}`;
    const list = ts.map((t) => `<li><a href="${esc(`${base}t/${t.id}.html`)}">${esc(t.title)}</a> <span class="meta">${t.reply_count} repl${t.reply_count === 1 ? 'y' : 'ies'}</span></li>`).join('');
    files.set(`b/${b.id}.html`, page({ title: `${b.name} - ${site}`, desc: clip(b.description || `Topics in ${b.name}`, 160), canonical, app, site,
      body: `<h1>${esc(b.name)}</h1><p>${esc(b.description || '')}</p><a class="open" href="${esc(app)}">Open in ${esc(site)}</a><ul>${list || '<li>No topics yet.</li>'}</ul>` }));
    urls.push([canonical, b.last_post_at]);
  }
  for (const t of data.threads) {
    const board = boards.get(t.board_id); if (!board) continue;
    const posts = data.posts.filter((p) => p.thread_id === t.id).sort((x, y) => x.id - y.id);
    if (!posts.length) continue;
    const canonical = `${base}t/${t.id}.html`, app = `${base}#/thread/${t.id}`;
    const shown = posts.slice(0, POSTS_PER_PAGE * 4); // static page carries the first 60 posts; the app has the rest
    const items = shown.map((p) => `<div class="post" id="post-${p.id}"><h2>${esc(p.author || 'Deleted user')} &middot; <time datetime="${esc(p.created_at)}">${esc(String(p.created_at).slice(0, 10))}</time></h2><div>${bb(p.body)}</div></div>`).join('');
    files.set(`t/${t.id}.html`, page({ title: `${t.title} - ${board.name} - ${site}`, desc: clip(plain(posts[0].body) || t.title, 160), canonical, app, site, ogType: 'article',
      body: `<div class="crumb"><a href="${esc(`${base}b/${board.id}.html`)}">${esc(board.name)}</a> &raquo; ${esc(t.title)}</div><h1>${esc(t.title)}</h1><a class="open" href="${esc(app)}">Open in ${esc(site)}</a>${items}${posts.length > shown.length ? `<p><a href="${esc(app)}">Read the remaining ${posts.length - shown.length} posts in the forum</a></p>` : ''}` }));
    urls.push([canonical, t.last_post_at]);
  }
  const loc = (u, m) => `<url><loc>${esc(u)}</loc>${m ? `<lastmod>${lastmod(m)}</lastmod>` : ''}</url>`;
  files.set('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, m]) => loc(u, m)).join('\n')}\n</urlset>\n`);
  return files;
}

async function load() {
  if (args.input) return JSON.parse(fs.readFileSync(String(args.input), 'utf8'));
  const cfgSrc = fs.readFileSync(String(args.config || 'config.js'), 'utf8');
  const url = (cfgSrc.match(/supabaseUrl:\s*'([^']+)'/) || [])[1], key = (cfgSrc.match(/supabaseKey:\s*'([^']+)'/) || [])[1];
  if (!url || !key || /YOUR-/.test(url + key)) throw new Error('config.js has no Supabase URL/key');
  const get = async (q) => { const r = await fetch(`${url}/rest/v1/${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }); if (!r.ok) throw new Error(`${q}: HTTP ${r.status}`); return r.json(); };
  const [set, boards, threads] = await Promise.all([get('forum_settings?select=data&id=eq.1'), get('forum_boards?select=id,name,description&order=sort'), get('forum_threads?select=id,board_id,title,sticky,reply_count,last_post_at&order=id')]);
  const posts = []; for (let off = 0; ; off += 1000) { const chunk = await get(`forum_posts?select=id,thread_id,body,created_at,author:forum_profiles!forum_posts_user_id_fkey(username)&order=id&limit=1000&offset=${off}`); posts.push(...chunk.map((p) => ({ ...p, author: p.author?.username }))); if (chunk.length < 1000) break; }
  return { site: set[0]?.data?.name, boards, threads, posts };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = build(await load(), BASE);
  for (const [rel, text] of files) { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
  console.log(`Wrote ${files.size} files to ${OUT} (${[...files.keys()].join(', ')})`);
}
