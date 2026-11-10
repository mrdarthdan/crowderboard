/* CrowderBoard v1.2 — a classic message board on Supabase.
   Copyright (c) 2026 Dan Crowder. MIT License — see LICENSE. */
const SB_URL = (window.CROWDERBOARD_CONFIG || {}).supabaseUrl;
const SB_KEY = (window.CROWDERBOARD_CONFIG || {}).supabaseKey;
if (!SB_URL || !SB_KEY || /YOUR-/.test(SB_URL + SB_KEY)) {
  document.getElementById('main').innerHTML = '<div class="error"><b>Setup needed:</b> edit <code>config.js</code> and add your Supabase project URL and publishable key. See README.md.</div>';
  throw new Error('CrowderBoard: missing Supabase config');
}
const TOPICS_PER_PAGE = 20, POSTS_PER_PAGE = 15, HOT_REPLIES = 15;
const sb = supabase.createClient(SB_URL, SB_KEY);

const state = { session: null, me: null, myMods: [], unreadThreads: new Set(), unreadBoards: new Set(), pmUnread: 0, lastSeenPing: 0 };
const $main = document.getElementById('main');
const PROF = 'id,username,role,avatar_url,post_count,title';

/* ================= helpers ================= */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const img = (src, alt = '', cls = '', title = '') => `<img src="${src}" alt="${esc(alt)}" title="${esc(title || alt)}"${cls ? ` class="${cls}"` : ''}>`;
const isMod = () => state.me && ['admin', 'mod'].includes(state.me.role);
const isAdmin = () => state.me && state.me.role === 'admin';
const canPost = () => state.me && state.me.role !== 'banned';
/* Can I moderate this board? Admins/global mods: everywhere. Board moderators: their boards or categories. */
const canModBoard = (boardId, catId) => isMod() || (state.me?.role === 'boardmod' &&
  state.myMods.some(m => (m.board_id && m.board_id == boardId) || (m.category_id && m.category_id == catId)));
async function loadMyMods() {
  state.myMods = [];
  if (state.me?.role !== 'boardmod') return;
  const { data } = await sb.from('forum_board_mods').select('board_id,category_id').eq('user_id', state.me.id);
  state.myMods = data || [];
}
function uname(p) {
  if (!p) return '<i class="muted">Guest</i>';
  return `<a class="u u-${esc(p.role)}" href="#/profile/${p.id}">${esc(p.username)}</a>`;
}
function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 864e5;
  if (diff === 0) return `<b>Today</b> at ${t}`;
  if (diff === 1) return `Yesterday at ${t}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + `, ${t}`;
}
const fmtDay = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
function rank(p) {
  if (p.role === 'admin') return { name: p.title || 'Administrator', stars: 5 };
  if (p.role === 'mod') return { name: p.title || 'Global Moderator', stars: 5 };
  if (p.role === 'boardmod') return { name: p.title || 'Moderator', stars: 4 };
  if (p.role === 'banned') return { name: 'Banned', stars: 0 };
  const tiers = [[500, 'Forum Legend', 5], [250, 'Senior Member', 4], [100, 'Full Member', 3], [25, 'Junior Member', 2], [0, 'Newbie', 1]];
  const t = tiers.find(([n]) => p.post_count >= n);
  return { name: p.title || t[1], stars: t[2] };
}
const stars = (n) => Array.from({ length: 5 }, (_, i) => img(ICON.star(i < n))).join('');
function err(e) { return `<div class="error"><b>Error:</b> ${esc(e?.message || e)}</div>`; }
function render(html) { $main.innerHTML = html; window.scrollTo(0, 0); }
function loading() { $main.innerHTML = '<div class="loading">Loading...</div>'; }
function pager(base, page, pages) {
  if (pages <= 1) return '';
  let out = `<span class="pages">Pages: `;
  for (let i = 1; i <= pages; i++) {
    if (pages > 9 && i > 2 && i < pages - 1 && Math.abs(i - page) > 2) { if (!out.endsWith('... ')) out += '... '; continue; }
    out += i === page ? `<b>${i}</b>` : `<a href="${base}${base.includes('?') ? '&' : '?'}page=${i}">${i}</a>`;
  }
  return out + '</span>';
}
function crumb(parts) {
  return `<div class="crumb">${img(ICON.board.on, '', '', '').replace('<img', '<img width="16" height="16"')} <a href="#/">${esc(SITE.name)}</a>${parts.map(p => ' &raquo; ' + p).join('')}</div>`;
}
function box(title, inner, cls = '') { return `<table class="tborder ${cls}"><tr><th colspan="2">${title}</th></tr>${inner}</table>`; }

/* ================= BBCode ================= */
const SMILEY_RE = ICON.smilies.map(s => ({
  ...s,
  re: new RegExp('(?<![A-Za-z0-9&;])' + esc(s.code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
}));
function bbcode(src) {
  const keep = [];
  const hold = (html) => { keep.push(html); return `\u0001${keep.length - 1}\u0001`; };
  let s = esc(src).replace(/\r/g, '');
  s = s.replace(/\[code\]\n?([\s\S]*?)\[\/code\]/gi, (m, c) => hold(`<div class="code"><div class="qh">Code:</div><pre>${c}</pre></div>`));
  s = s.replace(/\[img\](https:\/\/[^\s\[\]"<>]+?)\[\/img\]/gi, (m, u) => hold(`<img class="postimg" src="${u}" alt="" loading="lazy" referrerpolicy="no-referrer">`));
  s = s.replace(/\[url\](https?:\/\/[^\s\[\]"<>]+?)\[\/url\]/gi, (m, u) => hold(`<a href="${u}" target="_blank" rel="nofollow noopener ugc">${u}</a>`));
  s = s.replace(/\[url=(https?:\/\/[^\s\[\]"<>]+?)\]([\s\S]*?)\[\/url\]/gi, (m, u, t) => hold(`<a href="${u}" target="_blank" rel="nofollow noopener ugc">`) + t + hold('</a>'));
  for (const sm of SMILEY_RE) s = s.replace(sm.re, () => hold(`<img class="smiley" src="${sm.src}" alt="${esc(sm.code)}" title="${sm.name}">`));
  s = s.replace(/\[(b|i|u|s|center)\]([\s\S]*?)\[\/\1\]/gi, (m, t, c) => t.toLowerCase() === 'center' ? `<div style="text-align:center">${c}</div>` : `<${t.toLowerCase()}>${c}</${t.toLowerCase()}>`);
  for (let i = 0; i < 3; i++) s = s.replace(/\[(b|i|u|s)\]([\s\S]*?)\[\/\1\]/gi, (m, t, c) => `<${t.toLowerCase()}>${c}</${t.toLowerCase()}>`);
  for (let i = 0; i < 4; i++) {
    s = s.replace(/\[color=(#[0-9a-f]{3,6}|[a-z]{3,20})\]((?:(?!\[color)[\s\S])*?)\[\/color\]/gi, (m, c, t) => `<span style="color:${c}">${t}</span>`);
    s = s.replace(/\[size=([1-7])\]((?:(?!\[size)[\s\S])*?)\[\/size\]/gi, (m, n, t) => `<span style="font-size:${[0, 9, 10, 12, 14, 18, 24, 32][n]}px">${t}</span>`);
  }
  for (let i = 0; i < 8; i++) {
    const before = s;
    s = s.replace(/\[quote(?:=([^\]\n]{1,40}))?\]\n?((?:(?!\[quote)[\s\S])*?)\[\/quote\]\n?/i,
      (m, who, body) => `<div class="quote"><div class="qh">${who ? `Quote from: ${who}` : 'Quote'}</div><div class="qb">${body}</div></div>`);
    if (s === before) break;
  }
  s = s.replace(/\[list\]\n?([\s\S]*?)\[\/list\]\n?/gi, (m, body) =>
    '<ul>' + body.split(/\[\*\]/).map(x => x.trim()).filter(Boolean).map(x => `<li>${x}</li>`).join('') + '</ul>');
  s = s.replace(/\n/g, '<br>');
  s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => keep[+i]);
  return s;
}

/* ================= editor ================= */
function editor(name, value = '') {
  const colors = ['', 'red', 'orange', 'yellow', 'lime', 'cyan', 'deepskyblue', 'violet', 'white', 'gray'];
  return `
  <div class="toolbar" data-for="${name}">
    <button type="button" data-wrap="b" title="Bold"><b>B</b></button>
    <button type="button" data-wrap="i" title="Italic"><i>I</i></button>
    <button type="button" data-wrap="u" title="Underline"><u>U</u></button>
    <button type="button" data-wrap="s" title="Strikethrough"><s>S</s></button>
    <button type="button" data-wrap="center" title="Center">&#8801;</button>
    <button type="button" data-wrap="url" title="Insert link">URL</button>
    <button type="button" data-wrap="img" title="Insert image (https link)">IMG</button>
    <button type="button" data-wrap="quote" title="Quote">&ldquo;Q&rdquo;</button>
    <button type="button" data-wrap="code" title="Code">#</button>
    <button type="button" data-wrap="list" title="List">&bull;List</button>
    <select data-color title="Text color">${colors.map(c => `<option value="${c}">${c ? c : 'Color'}</option>`).join('')}</select>
    <select data-size title="Text size"><option value="">Size</option>${[1, 2, 3, 4, 5, 6, 7].map(n => `<option>${n}</option>`).join('')}</select>
  </div>
  <textarea name="${name}" id="ta_${name}">${esc(value)}</textarea>
  <div class="smilebar">${ICON.smilies.map(s => `<img src="${s.src}" data-smile="${esc(s.code)}" title="${esc(s.code)}" alt="${esc(s.code)}">`).join('')}</div>`;
}
function wireEditor(root = document) {
  root.querySelectorAll('.toolbar').forEach(tb => {
    const ta = document.getElementById('ta_' + tb.dataset.for);
    const wrap = (open, close) => {
      const a = ta.selectionStart, b = ta.selectionEnd, sel = ta.value.slice(a, b);
      ta.value = ta.value.slice(0, a) + open + sel + close + ta.value.slice(b);
      ta.focus(); ta.selectionStart = a + open.length; ta.selectionEnd = a + open.length + sel.length;
    };
    tb.querySelectorAll('button[data-wrap]').forEach(btn => btn.onclick = () => {
      const t = btn.dataset.wrap;
      if (t === 'list') return wrap('[list]\n[*]', '\n[*]\n[/list]');
      wrap(`[${t}]`, `[/${t}]`);
    });
    tb.querySelector('[data-color]').onchange = (e) => { if (e.target.value) wrap(`[color=${e.target.value}]`, '[/color]'); e.target.value = ''; };
    tb.querySelector('[data-size]').onchange = (e) => { if (e.target.value) wrap(`[size=${e.target.value}]`, '[/size]'); e.target.value = ''; };
    tb.parentElement.querySelectorAll('[data-smile]').forEach(im => im.onclick = () => wrap(' ' + im.dataset.smile + ' ', ''));
  });
}

/* ================= session / chrome ================= */
async function loadMe() {
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  state.me = null;
  if (state.session) {
    const { data: p } = await sb.from('forum_profiles').select('*').eq('id', state.session.user.id).maybeSingle();
    state.me = p;
  }
  await Promise.all([refreshUnread(), loadMyMods()]);
}
async function refreshUnread() {
  state.unreadThreads = new Set(); state.unreadBoards = new Set(); state.pmUnread = 0;
  if (!state.me) return;
  const [u, pm] = await Promise.all([
    sb.rpc('forum_unread'),
    sb.from('forum_messages').select('id', { count: 'exact', head: true }).eq('to_user', state.me.id).eq('is_read', false),
  ]);
  (u.data || []).forEach(r => { state.unreadThreads.add(r.thread_id); state.unreadBoards.add(r.board_id); });
  state.pmUnread = pm.count || 0;
}
function pingSeen() {
  if (!state.me || Date.now() - state.lastSeenPing < 60000) return;
  state.lastSeenPing = Date.now();
  sb.from('forum_profiles').update({ last_seen: new Date().toISOString() }).eq('id', state.me.id).then(() => {});
}
function drawChrome(active) {
  const n = (href, label, icon, key) => `<a href="${href}" class="${active === key ? 'on' : ''}">${icon ? img(icon) : ''}${label}</a>`;
  let nav = n('#/', 'Home', '', 'home') + n('#/search', 'Search', '', 'search') + n('#/members', 'Members', '', 'members');
  if (state.me) {
    nav += n('#/pm', `Inbox${state.pmUnread ? ` (${state.pmUnread})` : ''}`, state.pmUnread ? ICON.misc.pmnew : '', 'pm');
    nav += n('#/editprofile', 'Profile', '', 'profile');
    if (isAdmin()) nav += n('#/admin', 'Admin', '', 'admin');
    else if (isMod()) nav += n('#/admin', 'Mod CP', '', 'admin');
    nav += `<a href="#" id="logout">Logout</a>`;
  } else if (state.session) {
    nav += n('#/setup', 'Finish Sign-up', '', 'setup') + `<a href="#" id="logout">Logout</a>`;
  } else {
    nav += n('#/login', 'Login', '', 'login') + n('#/register', 'Register', '', 'register');
  }
  document.getElementById('nav').innerHTML = nav;
  const lo = document.getElementById('logout');
  if (lo) lo.onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); await loadMe(); if (location.hash === '#/' || location.hash === '') route(); else location.hash = '#/'; };
  const w = document.getElementById('welcome');
  const date = new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const quick = `<span class="quicksearch"><input type="text" id="qs" placeholder="Search posts..." maxlength="200"> <button class="btn sm blue" id="qsgo">Go</button> &nbsp; ${date}</span>`;
  if (state.me) {
    w.innerHTML = `<span>Hey, <b>${esc(state.me.username)}</b>! You have <a href="#/pm">${state.pmUnread} new message${state.pmUnread === 1 ? '' : 's'}</a>. &nbsp;<a href="#" id="markall">Mark all as read</a></span>${quick}`;
    document.getElementById('markall').onclick = async (e) => {
      e.preventDefault();
      await sb.from('forum_profiles').update({ mark_read_at: new Date().toISOString() }).eq('id', state.me.id);
      await refreshUnread(); route();
    };
  } else {
    w.innerHTML = `<span>Hey, <b>Guest</b>. Please <a href="#/login">login</a> or <a href="#/register">register</a>.</span>${quick}`;
  }
  const qs = document.getElementById('qs'), qgo = () => { if (qs.value.trim()) location.hash = '#/search?q=' + encodeURIComponent(qs.value.trim()); };
  document.getElementById('qsgo').onclick = qgo; qs.onkeydown = (e) => { if (e.key === 'Enter') qgo(); };
}

/* ================= views ================= */
async function viewIndex() {
  drawChrome('home'); loading();
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const [cats, boards, members, newest, online, bmods] = await Promise.all([
    sb.from('forum_categories').select('*').order('sort'),
    sb.from('forum_boards').select(`*, lp:forum_profiles!forum_boards_last_post_user_id_fkey(${PROF})`).order('sort'),
    sb.from('forum_profiles').select('id', { count: 'exact', head: true }),
    sb.from('forum_profiles').select(PROF).order('created_at', { ascending: false }).limit(1),
    sb.from('forum_profiles').select(PROF).gte('last_seen', since).order('username'),
    sb.from('forum_board_mods').select(`board_id, category_id, user:forum_profiles!forum_board_mods_user_id_fkey(${PROF})`),
  ]);
  if (cats.error || boards.error) return render(err(cats.error || boards.error));
  const modsFor = (b) => {
    const seen = new Set();
    return (bmods.data || []).filter(m => m.user && (m.board_id === b.id || m.category_id === b.category_id))
      .filter(m => !seen.has(m.user.id) && seen.add(m.user.id)).map(m => uname(m.user));
  };
  const tids = boards.data.map(b => b.last_thread_id).filter(Boolean);
  const titles = {};
  if (tids.length) {
    const { data } = await sb.from('forum_threads').select('id,title,reply_count').in('id', tids);
    (data || []).forEach(t => titles[t.id] = t);
  }
  let html = `<table class="tborder"><tr><th class="icon-col"></th><th>Forum</th><th class="num">Topics</th><th class="num">Posts</th><th class="lastpost">Last Post</th></tr>`;
  for (const c of cats.data) {
    html += `<tr><td colspan="5" class="catbg">${esc(c.name)}</td></tr>`;
    for (const b of boards.data.filter(b => b.category_id === c.id)) {
      const on = state.unreadBoards.has(b.id);
      const lt = titles[b.last_thread_id];
      const last = b.last_post_at
        ? `${lt ? `<a href="#/thread/${lt.id}?page=last"><b>${esc(lt.title.length > 32 ? lt.title.slice(0, 30) + '…' : lt.title)}</b></a> ${img(ICON.misc.lastpost, 'Go to last post')}<br>` : ''}by ${uname(b.lp)}<br>${fmtDate(b.last_post_at)}`
        : '<span class="muted">No posts yet</span>';
      html += `<tr class="hl"><td class="w2 icon-col">${img(on ? ICON.board.on : ICON.board.off, on ? 'New posts' : 'No new posts')}</td>
        <td class="w1"><a class="bname" href="#/board/${b.id}">${esc(b.name)}</a><div class="bdesc">${esc(b.description || '')}</div>${(() => { const ms = modsFor(b); return ms.length ? `<div class="small muted" style="margin-top:3px">Moderator${ms.length > 1 ? 's' : ''}: ${ms.join(', ')}</div>` : ''; })()}</td>
        <td class="w2 num">${b.thread_count}</td><td class="w2 num">${b.post_count}</td><td class="w1 lastpost">${last}</td></tr>`;
    }
  }
  html += '</table>';
  const totalPosts = boards.data.reduce((a, b) => a + b.post_count, 0), totalTopics = boards.data.reduce((a, b) => a + b.thread_count, 0);
  const on = online.data || [];
  html += `<table class="tborder info"><tr><th colspan="2">${esc(SITE.name)} &mdash; Info Center</th></tr>
    <tr><td colspan="2" class="titlebg" style="font-size:10px;padding:3px 6px">Forum Stats</td></tr>
    <tr><td class="ic">${img(ICON.misc.stats)}</td><td class="w1">${totalPosts} posts in ${totalTopics} topics by ${members.count ?? 0} members.
      ${newest.data?.[0] ? `Please welcome our newest member, ${uname(newest.data[0])}.` : ''}</td></tr>
    <tr><td colspan="2" class="titlebg" style="font-size:10px;padding:3px 6px">Users Online</td></tr>
    <tr><td class="ic">${img(ICON.misc.users)}</td><td class="w1">${on.length} member${on.length === 1 ? '' : 's'} active in the past 15 minutes:<br>
      ${on.length ? on.map(uname).join(', ') : '<span class="muted">Nobody... it\'s quiet in here.</span>'}
      <div class="small muted" style="margin-top:4px">Legend: <span class="u u-admin">Administrator</span>, <span class="u u-mod">Global Moderator</span>, <span class="u u-boardmod">Moderator</span>, <span class="u u-member">Member</span></div></td></tr>
  </table>
  <div class="small muted legend ctr">${img(ICON.board.on).replace('<img', '<img width="20" height="20"')} New posts ${img(ICON.board.off).replace('<img', '<img width="20" height="20"')} No new posts</div>`;
  render(html);
}

async function viewBoard(id, q) {
  drawChrome(''); loading();
  const page = Math.max(1, +q.page || 1);
  const [b, t] = await Promise.all([
    sb.from('forum_boards').select('*').eq('id', id).maybeSingle(),
    sb.from('forum_threads').select(`*, starter:forum_profiles!forum_threads_user_id_fkey(${PROF}), lp:forum_profiles!forum_threads_last_post_user_id_fkey(${PROF})`, { count: 'exact' })
      .eq('board_id', id).order('sticky', { ascending: false }).order('last_post_at', { ascending: false })
      .range((page - 1) * TOPICS_PER_PAGE, page * TOPICS_PER_PAGE - 1),
  ]);
  if (b.error || t.error) return render(err(b.error || t.error));
  if (!b.data) return render(err('That board does not exist.'));
  const board = b.data, pages = Math.max(1, Math.ceil((t.count || 0) / TOPICS_PER_PAGE));
  const canNew = canPost() && (!board.mod_only_threads || canModBoard(board.id, board.category_id));
  const bar = `<div class="btnbar"><div>${pager(`#/board/${id}`, page, pages)}</div><div>${canNew ? `<a class="btn" href="#/new/${id}">New Topic</a>` : (!state.me ? '<a class="btn grey" href="#/login">Login to post</a>' : '')}</div></div>`;
  let html = crumb([`<a href="#/board/${id}">${esc(board.name)}</a>`]) + bar;
  html += `<table class="tborder"><tr><th class="icon-col"></th><th class="icon-col"></th><th>Subject</th><th style="width:120px">Started by</th><th class="num">Replies</th><th class="num">Views</th><th class="lastpost">Last Post</th></tr>`;
  if (!t.data.length) html += `<tr><td colspan="7" class="w1 ctr" style="padding:20px">No topics yet. ${canNew ? `Why not <a href="#/new/${id}">start one</a>?` : ''}</td></tr>`;
  for (const th of t.data) {
    const isNew = state.unreadThreads.has(th.id), hot = th.reply_count >= HOT_REPLIES;
    let ic = th.locked ? (isNew ? 'lockednew' : 'locked') : th.sticky ? (board.mod_only_threads ? 'announce' : isNew ? 'stickynew' : 'sticky') : hot ? (isNew ? 'hotnew' : 'hot') : (isNew ? 'isnew' : 'normal');
    const tp = Math.ceil((th.reply_count + 1) / POSTS_PER_PAGE);
    const mini = tp > 1 ? `<span class="tiny-pages">« ${Array.from({ length: Math.min(tp, 5) }, (_, i) => `<a href="#/thread/${th.id}?page=${i + 1}">${i + 1}</a>`).join(' ')}${tp > 5 ? ` ... <a href="#/thread/${th.id}?page=${tp}">${tp}</a>` : ''} »</span>` : '';
    html += `<tr class="hl"><td class="w2 icon-col">${img(ICON.topic[ic], ic)}</td><td class="w2 icon-col">${img(ICON.msg[th.icon] || ICON.msg.default)}</td>
      <td class="w1">${th.sticky ? '<b class="muted">Sticky:</b> ' : ''}<a href="#/thread/${th.id}" style="font-weight:${isNew ? 'bold' : 'normal'}">${esc(th.title)}</a>${isNew ? ` <a href="#/thread/${th.id}?page=last" class="small" style="color:var(--orange)">new</a>` : ''}${mini}</td>
      <td class="w2 small">${uname(th.starter)}</td><td class="w1 num">${th.reply_count}</td><td class="w2 num">${th.view_count}</td>
      <td class="w1 lastpost">${fmtDate(th.last_post_at)}<br>by ${uname(th.lp)} <a href="#/thread/${th.id}?page=last">${img(ICON.misc.lastpost, 'Last post')}</a></td></tr>`;
  }
  html += '</table>' + bar;
  html += `<div class="small muted legend">${img(ICON.topic.isnew)} New posts ${img(ICON.topic.normal)} No new posts ${img(ICON.topic.hot)} Hot topic (${HOT_REPLIES}+ replies) ${img(ICON.topic.locked)} Locked ${img(ICON.topic.sticky)} Sticky ${img(ICON.topic.announce)} Announcement</div>`;
  render(html);
}

async function viewThread(id, q) {
  drawChrome(''); loading();
  const { data: th, error } = await sb.from('forum_threads').select('*, board:forum_boards(id,name,category_id)').eq('id', id).maybeSingle();
  if (error) return render(err(error));
  if (!th) return render(err('That topic does not exist (it may have been deleted).'));
  const total = th.reply_count + 1, pages = Math.max(1, Math.ceil(total / POSTS_PER_PAGE));
  let page = q.page === 'last' ? pages : Math.min(pages, Math.max(1, +q.page || 1));
  const { data: posts, error: pe } = await sb.from('forum_posts')
    .select(`*, author:forum_profiles!forum_posts_user_id_fkey(${PROF},signature,location,created_at), editor:forum_profiles!forum_posts_edited_by_fkey(username)`)
    .eq('thread_id', id).order('id').range((page - 1) * POSTS_PER_PAGE, page * POSTS_PER_PAGE - 1);
  if (pe) return render(err(pe));
  sb.rpc('forum_view_thread', { p_thread: id }).then(() => {});
  if (state.me) {
    sb.from('forum_read').upsert({ user_id: state.me.id, thread_id: id, last_read_at: new Date().toISOString() }).then(() => {});
    state.unreadThreads.delete(+id);
  }
  const firstPostId = page === 1 && posts[0] ? posts[0].id : null;
  const bm = canModBoard(th.board.id, th.board.category_id);
  const canReply = canPost() && (!th.locked || bm);
  const bar = `<div class="btnbar"><div>${pager(`#/thread/${id}`, page, pages)}</div><div>${canReply ? `<a class="btn" href="#" data-act="jump-reply">Reply</a>` : th.locked ? '<span class="btn grey" disabled>Locked</span>' : (!state.me ? '<a class="btn grey" href="#/login">Login to reply</a>' : '')}</div></div>`;
  let html = crumb([`<a href="#/board/${th.board.id}">${esc(th.board.name)}</a>`, `<a href="#/thread/${id}">${esc(th.title)}</a>`]) + bar;
  html += `<table class="tborder"><tr><th colspan="2">${img(ICON.msg[th.icon] || ICON.msg.default)} Topic: ${esc(th.title)} &nbsp;<span style="font-weight:normal">(Read ${th.view_count + 1} times)</span>${th.locked ? ' &nbsp;' + img(ICON.topic.locked, 'Locked') : ''}</th></tr>`;
  posts.forEach((p, i) => {
    const a = p.author, r = a ? rank(a) : { name: 'Deleted user', stars: 0 };
    const mine = state.me && a && a.id === state.me.id;
    const canEdit = (mine && canPost()) || bm;
    const canDel = bm || (mine && canPost() && p.id !== firstPostId && !(page === 1 && i === 0));
    const num = (page - 1) * POSTS_PER_PAGE + i + 1;
    html += `<tr class="post" id="p${p.id}"><td class="ui">
        ${uname(a)}<br><span class="rank">${esc(r.name)}</span><br>${stars(r.stars)}<br>
        ${img(a?.avatar_url ? esc(a.avatar_url) : ICON.avatar, 'avatar', 'avatar')}
        ${a ? `<div class="meta">Posts: <b>${a.post_count}</b><br>Joined: ${fmtDay(a.created_at)}${a.location ? `<br>From: ${esc(a.location)}` : ''}</div>
        <div style="margin-top:6px">${state.me && !mine ? `<a href="#/pm/new?to=${encodeURIComponent(a.username)}">${img(ICON.misc.pm, 'Send PM')}</a>` : ''}</div>` : ''}
      </td><td class="body">
        <div class="phead"><div>${img(ICON.msg[th.icon] || ICON.msg.default)} <span class="ptitle">${i === 0 && page === 1 ? esc(th.title) : 'Re: ' + esc(th.title)}</span>
          <div class="ptime">« Reply #${num - 1 || 'Topic'} on: ${fmtDate(p.created_at)} »</div></div>
          <div>${canReply ? `<a class="btn sm blue" href="#" data-act="quote" data-id="${p.id}">Quote</a> ` : ''}${canEdit ? `<a class="btn sm grey" href="#" data-act="edit" data-id="${p.id}">Edit</a> ` : ''}${canDel ? `<a class="btn sm grey" href="#" data-act="del" data-id="${p.id}">Delete</a>` : ''}</div></div>
        <div class="ptext" data-body="${p.id}">${bbcode(p.body)}</div>
        ${p.edited_at ? `<div class="edited">« Last Edit: ${fmtDate(p.edited_at)}${p.editor ? ' by ' + esc(p.editor.username) : ''} »</div>` : ''}
        ${a?.signature ? `<div class="sig">${bbcode(a.signature)}</div>` : ''}
      </td></tr>`;
  });
  html += '</table>' + bar;
  if (bm) {
    const { data: allBoards } = await sb.from('forum_boards').select('id,name,category_id').order('sort');
    const boards = (allBoards || []).filter(b => canModBoard(b.id, b.category_id));
    html += `<div class="modbar"><b>Moderation:</b>
      <a class="btn sm blue" href="#" data-mod="sticky">${th.sticky ? 'Unsticky' : 'Make Sticky'}</a>
      <a class="btn sm blue" href="#" data-mod="lock">${th.locked ? 'Unlock' : 'Lock'}</a>
      <select id="moveto">${boards.filter(b => b.id !== th.board_id).map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
      <a class="btn sm blue" href="#" data-mod="move">Move</a>
      <a class="btn sm" href="#" data-mod="delete">Delete Topic</a></div>`;
  }
  if (canReply) {
    html += `<a id="reply"></a><table class="tborder form"><tr><th colspan="2">Quick Reply</th></tr>
      <tr><td class="lbl">Message:<div class="muted small" style="margin-top:6px">BBCode is ON<br>Smilies are ON</div></td><td>${editor('reply')}<div id="preview"></div>
      <div style="margin-top:6px"><button class="btn" id="sendreply">Post Reply</button> <button class="btn grey" id="prevreply">Preview</button></div></td></tr></table>`;
  }
  render(html);
  wireEditor();
  const ta = document.getElementById('ta_reply');
  $main.querySelectorAll('[data-act="jump-reply"]').forEach(a => a.onclick = (e) => { e.preventDefault(); ta?.scrollIntoView({ behavior: 'smooth' }); ta?.focus(); });
  if (q.page === 'last' && posts.length) document.getElementById('p' + posts[posts.length - 1].id)?.scrollIntoView();
  if (q.post) { const hit = document.getElementById('p' + q.post); if (hit) { hit.classList.add('hit'); hit.scrollIntoView({ block: 'center' }); } }
  $main.querySelectorAll('[data-act="quote"]').forEach(a => a.onclick = (e) => {
    e.preventDefault(); const p = posts.find(x => x.id == a.dataset.id);
    ta.value += `[quote=${p.author?.username || 'Guest'}]${p.body}[/quote]\n`; ta.scrollIntoView({ behavior: 'smooth' }); ta.focus();
  });
  $main.querySelectorAll('[data-act="edit"]').forEach(a => a.onclick = (e) => {
    e.preventDefault(); const p = posts.find(x => x.id == a.dataset.id);
    const holder = $main.querySelector(`[data-body="${p.id}"]`);
    holder.innerHTML = editor('edit' + p.id, p.body) + `<div style="margin-top:6px"><button class="btn" data-save>Save</button> <button class="btn grey" data-cancel>Cancel</button></div>`;
    wireEditor(holder);
    holder.querySelector('[data-cancel]').onclick = () => route();
    holder.querySelector('[data-save]').onclick = async () => {
      const body = document.getElementById('ta_edit' + p.id).value.trim();
      if (!body) return;
      const { error } = await sb.from('forum_posts').update({ body }).eq('id', p.id);
      if (error) return alertBox(error); route();
    };
  });
  $main.querySelectorAll('[data-act="del"]').forEach(a => a.onclick = async (e) => {
    e.preventDefault();
    const isFirst = page === 1 && posts[0] && posts[0].id == a.dataset.id;
    if (isFirst) { if (!confirm('This is the first post. Deleting it removes the whole topic. Continue?')) return;
      const { error } = await sb.rpc('forum_mod_thread', { p_thread: +id, p_action: 'delete' }); if (error) return alertBox(error);
      location.hash = `#/board/${th.board.id}`; return; }
    if (!confirm('Delete this post?')) return;
    const { error } = await sb.from('forum_posts').delete().eq('id', a.dataset.id);
    if (error) return alertBox(error); route();
  });
  $main.querySelectorAll('[data-mod]').forEach(a => a.onclick = async (e) => {
    e.preventDefault(); const act = a.dataset.mod;
    if (act === 'delete' && !confirm('Delete this entire topic and all its posts?')) return;
    const args = { p_thread: +id, p_action: act };
    if (act === 'move') args.p_board = +document.getElementById('moveto').value;
    const { error } = await sb.rpc('forum_mod_thread', args);
    if (error) return alertBox(error);
    if (act === 'delete') location.hash = `#/board/${th.board.id}`; else route();
  });
  const send = document.getElementById('sendreply');
  if (send) {
    document.getElementById('prevreply').onclick = () => { document.getElementById('preview').innerHTML = `<div class="quote"><div class="qh">Preview</div><div class="qb">${bbcode(ta.value)}</div></div>`; };
    send.onclick = async () => {
      const body = ta.value.trim(); if (!body) return;
      send.disabled = true;
      const { error } = await sb.from('forum_posts').insert({ thread_id: +id, user_id: state.me.id, body });
      send.disabled = false;
      if (error) return alertBox(error);
      state.me.post_count++;
      if (q.page === 'last') route(); else location.hash = `#/thread/${id}?page=last`;
    };
  }
}
function alertBox(e) { alert('Error: ' + (e?.message || e)); }

async function viewNewTopic(boardId) {
  drawChrome('');
  if (!state.me) return (location.hash = '#/login');
  const { data: b } = await sb.from('forum_boards').select('*').eq('id', boardId).maybeSingle();
  if (!b) return render(err('Board not found.'));
  const icons = ['default', 'question', 'idea', 'alert', 'happy', 'sad', 'thumbsup', 'thumbsdown'];
  render(crumb([`<a href="#/board/${b.id}">${esc(b.name)}</a>`, 'Start new topic']) + `<div id="msg"></div>
    <table class="tborder form"><tr><th colspan="2">Start New Topic</th></tr>
    <tr><td class="lbl">Subject:</td><td><input type="text" id="subject" maxlength="120"></td></tr>
    <tr><td class="lbl">Message Icon:</td><td class="iconpick">${icons.map((k, i) => `<label><input type="radio" name="icon" value="${k}"${i ? '' : ' checked'}> ${img(ICON.msg[k], k)}</label>`).join('')}</td></tr>
    <tr><td class="lbl">Message:<div class="muted small" style="margin-top:6px">BBCode is ON<br>Smilies are ON</div></td><td>${editor('body')}<div id="preview"></div></td></tr>
    <tr><td class="lbl"></td><td><button class="btn" id="post">Post Topic</button> <button class="btn grey" id="prev">Preview</button></td></tr></table>`);
  wireEditor();
  document.getElementById('prev').onclick = () => { document.getElementById('preview').innerHTML = `<div class="quote"><div class="qh">Preview</div><div class="qb">${bbcode(document.getElementById('ta_body').value)}</div></div>`; };
  document.getElementById('post').onclick = async (e) => {
    const title = document.getElementById('subject').value.trim(), body = document.getElementById('ta_body').value.trim();
    if (!title || !body) return (document.getElementById('msg').innerHTML = err('Please enter a subject and a message.'));
    e.target.disabled = true;
    const icon = document.querySelector('input[name=icon]:checked').value;
    const { data, error } = await sb.rpc('forum_new_thread', { p_board: +boardId, p_title: title, p_body: body, p_icon: icon });
    e.target.disabled = false;
    if (error) return (document.getElementById('msg').innerHTML = err(error));
    location.hash = `#/thread/${data}`;
  };
}

/* ---------- auth views ---------- */
function viewLogin() {
  drawChrome('login');
  render(`<div id="msg"></div><table class="tborder form" style="max-width:600px;margin:20px auto"><tr><th colspan="2">Login</th></tr>
    <tr><td class="lbl">Email:</td><td><input type="email" id="email" autocomplete="email"></td></tr>
    <tr><td class="lbl">Password:</td><td><input type="password" id="pw" autocomplete="current-password"></td></tr>
    <tr><td class="lbl"></td><td><button class="btn" id="go">Login</button> &nbsp; <a href="#" id="forgot" class="small">Forgot your password?</a></td></tr>
    <tr><td colspan="2" class="w2 small ctr">No account yet? <a href="#/register">Register here</a> &mdash; it's free!</td></tr></table>`);
  const msg = document.getElementById('msg');
  const go = async () => {
    const { error } = await sb.auth.signInWithPassword({ email: document.getElementById('email').value.trim(), password: document.getElementById('pw').value });
    if (error) { msg.innerHTML = err(error); return; } await loadMe(); location.hash = '#/';
  };
  document.getElementById('go').onclick = go;
  document.getElementById('pw').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  document.getElementById('forgot').onclick = async (e) => {
    e.preventDefault(); const email = document.getElementById('email').value.trim();
    if (!email) return (msg.innerHTML = err('Type your email address above first.'));
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] + '#/newpass' });
    msg.innerHTML = error ? err(error) : '<div class="notice">If that email is registered, a reset link is on its way.</div>';
  };
}
function viewRegister() {
  drawChrome('register');
  render(`<div id="msg"></div><table class="tborder form" style="max-width:700px;margin:20px auto"><tr><th colspan="2">Register &mdash; ${esc(SITE.name)}</th></tr>
    <tr><td class="lbl">Username:<div class="muted small">3-20 letters, numbers, _ or -</div></td><td><input type="text" id="uname" maxlength="20"></td></tr>
    <tr><td class="lbl">Email:<div class="muted small">Never shown publicly</div></td><td><input type="email" id="email"></td></tr>
    <tr><td class="lbl">Password:<div class="muted small">At least 8 characters</div></td><td><input type="password" id="pw" autocomplete="new-password"></td></tr>
    <tr><td class="lbl">Confirm Password:</td><td><input type="password" id="pw2" autocomplete="new-password"></td></tr>
    <tr><td class="lbl">Forum Rules:</td><td class="small">Be nice. No spam. Keep it family friendly. The staff's decision is final. :)</td></tr>
    <tr><td class="lbl"></td><td><button class="btn" id="go">Register</button></td></tr></table>`);
  document.getElementById('go').onclick = async (e) => {
    const msg = document.getElementById('msg');
    const username = document.getElementById('uname').value.trim(), email = document.getElementById('email').value.trim();
    const pw = document.getElementById('pw').value, pw2 = document.getElementById('pw2').value;
    if (!/^[A-Za-z0-9_\-]{3,20}$/.test(username)) return (msg.innerHTML = err('Username must be 3-20 letters, numbers, _ or -.'));
    if (pw.length < 8) return (msg.innerHTML = err('Password must be at least 8 characters.'));
    if (pw !== pw2) return (msg.innerHTML = err('Passwords do not match.'));
    const { data: taken } = await sb.from('forum_profiles').select('id').ilike('username', username.replace(/[_%]/g, '\\$&')).maybeSingle();
    if (taken) return (msg.innerHTML = err('That username is already taken.'));
    e.target.disabled = true;
    const { data, error } = await sb.auth.signUp({ email, password: pw, options: { emailRedirectTo: location.href.split('#')[0], data: { forum_username: username } } });
    e.target.disabled = false;
    if (error) return (msg.innerHTML = err(error));
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
      return (msg.innerHTML = '<div class="notice">That email already has an account (it may be from another site that shares these logins). <a href="#/login">Log in</a> with that password and you\'ll be asked to pick your forum username.</div>');
    if (data.session) { await ensureProfile(); location.hash = '#/'; }
    else render(`<div class="notice" style="max-width:600px;margin:30px auto"><b>Almost there!</b><br><br>We sent a confirmation link to <b>${esc(email)}</b>. Click it to activate your account, then come back and log in.</div>`);
  };
}
async function ensureProfile() {
  const { data } = await sb.auth.getSession();
  const s = data.session; if (!s) return;
  const { data: p } = await sb.from('forum_profiles').select('id').eq('id', s.user.id).maybeSingle();
  if (p) return;
  const want = s.user.user_metadata?.forum_username;
  if (want) await sb.from('forum_profiles').insert({ id: s.user.id, username: want });
}
function viewSetup() {
  drawChrome('setup');
  if (!state.session) return (location.hash = '#/login');
  if (state.me) return (location.hash = '#/');
  render(`<div id="msg"></div><table class="tborder form" style="max-width:650px;margin:20px auto"><tr><th colspan="2">Choose your forum username</th></tr>
    <tr><td colspan="2" class="small">You're signed in, but don't have a forum profile yet. Pick a username to finish joining.</td></tr>
    <tr><td class="lbl">Username:</td><td><input type="text" id="uname" maxlength="20"></td></tr>
    <tr><td class="lbl"></td><td><button class="btn" id="go">Join the Forum</button></td></tr></table>`);
  document.getElementById('go').onclick = async () => {
    const u = document.getElementById('uname').value.trim();
    const { error } = await sb.from('forum_profiles').insert({ id: state.session.user.id, username: u });
    if (error) return (document.getElementById('msg').innerHTML = err(/unique|duplicate/i.test(error.message) ? 'That username is taken.' : /check/i.test(error.message) ? 'Username must be 3-20 letters, numbers, _ or -.' : error));
    await loadMe(); location.hash = '#/';
  };
}
function viewNewPass() {
  drawChrome('');
  render(`<div id="msg"></div><table class="tborder form" style="max-width:600px;margin:20px auto"><tr><th colspan="2">Set a New Password</th></tr>
    <tr><td class="lbl">New password:</td><td><input type="password" id="pw" autocomplete="new-password"></td></tr>
    <tr><td class="lbl"></td><td><button class="btn" id="go">Save Password</button></td></tr></table>`);
  document.getElementById('go').onclick = async () => {
    const pw = document.getElementById('pw').value;
    if (pw.length < 8) return (document.getElementById('msg').innerHTML = err('At least 8 characters, please.'));
    const { error } = await sb.auth.updateUser({ password: pw });
    document.getElementById('msg').innerHTML = error ? err(error) : '<div class="notice">Password updated! <a href="#/">Back to the forum</a></div>';
  };
}

/* ---------- profiles & members ---------- */
async function viewProfile(id) {
  drawChrome(''); loading();
  const since = new Date(Date.now() - 15 * 60000);
  const [{ data: p, error }, recent, scopes] = await Promise.all([
    sb.from('forum_profiles').select('*').eq('id', id).maybeSingle(),
    sb.from('forum_posts').select('id,created_at,thread_id,thread:forum_threads(title)').eq('user_id', id).order('id', { ascending: false }).limit(5),
    sb.from('forum_board_mods').select('board:forum_boards(id,name), category:forum_categories(name)').eq('user_id', id),
  ]);
  if (error) return render(err(error));
  if (!p) return render(err('Member not found.'));
  const r = rank(p), online = new Date(p.last_seen) > since;
  render(crumb(['Members', esc(p.username)]) + `<table class="tborder"><tr><th colspan="3">View Profile: ${esc(p.username)}</th></tr>
    <tr><td class="w2 ctr" style="width:180px;vertical-align:top">${img(p.avatar_url ? esc(p.avatar_url) : ICON.avatar, 'avatar', 'avatar').replace('<img', '<img style="width:100px;height:100px;object-fit:cover;border:1px solid #000"')}<br><br>
      ${uname(p)}<br><span class="small muted">${esc(r.name)}</span><br>${stars(r.stars)}<br><br>
      ${img(online ? ICON.misc.online : ICON.misc.offline)} <span class="small">${online ? 'Online' : 'Offline'}</span>
      ${state.me && state.me.id !== p.id ? `<br><br><a class="btn sm blue" href="#/pm/new?to=${encodeURIComponent(p.username)}">Send PM</a>` : ''}</td>
    <td class="w1" style="vertical-align:top"><table style="width:100%" cellpadding="4">
      <tr><td class="muted" style="width:140px">Posts:</td><td><b>${p.post_count}</b></td></tr>
      <tr><td class="muted">Position:</td><td>${esc(r.name)}</td></tr>
      ${(scopes.data || []).length ? `<tr><td class="muted" style="vertical-align:top">Moderates:</td><td>${scopes.data.map(x => x.board ? `<a href="#/board/${x.board.id}">${esc(x.board.name)}</a>` : `${esc(x.category?.name || '')} <span class="small muted">(entire category)</span>`).join('<br>')}</td></tr>` : ''}
      <tr><td class="muted">Date Registered:</td><td>${fmtDay(p.created_at)}</td></tr>
      <tr><td class="muted">Last Active:</td><td>${fmtDate(p.last_seen)}</td></tr>
      <tr><td class="muted">Location:</td><td>${esc(p.location || '—')}</td></tr>
      <tr><td class="muted" style="vertical-align:top">Signature:</td><td><div class="sig" style="border:0;margin:0;padding:0">${p.signature ? bbcode(p.signature) : '—'}</div></td></tr>
      <tr><td class="muted" style="vertical-align:top">Recent posts:</td><td class="small">${(recent.data || []).map(x => `&raquo; <a href="#/thread/${x.thread_id}">${esc(x.thread?.title || 'topic')}</a> <span class="muted">(${fmtDate(x.created_at)})</span>`).join('<br>') || '—'}</td></tr>
    </table></td></tr></table>`);
}
async function viewEditProfile() {
  drawChrome('profile');
  if (!state.me) return (location.hash = '#/login');
  const p = state.me;
  render(`<div id="msg"></div><table class="tborder form"><tr><th colspan="2">Edit Profile: ${esc(p.username)}</th></tr>
    <tr><td class="lbl">Avatar URL:<div class="muted small">Must start with https://. Square images look best.</div></td><td><input type="url" id="av" value="${esc(p.avatar_url || '')}"> ${img(p.avatar_url ? esc(p.avatar_url) : ICON.avatar, '', '').replace('<img', '<img id="avprev" style="width:48px;height:48px;object-fit:cover;border:1px solid #000"')}</td></tr>
    <tr><td class="lbl">Location:</td><td><input type="text" id="loc" maxlength="60" value="${esc(p.location || '')}"></td></tr>
    <tr><td class="lbl">Signature:<div class="muted small">Max 300 characters. BBCode allowed.</div></td><td>${editor('sig', p.signature || '')}</td></tr>
    <tr><td class="lbl"></td><td><button class="btn" id="save">Save Changes</button> <a href="#/profile/${p.id}" class="small">View my profile</a></td></tr>
    <tr><td class="lbl">Password:</td><td><a href="#/newpass">Change my password</a></td></tr></table>`);
  wireEditor();
  document.getElementById('av').oninput = (e) => { if (/^https:\/\//.test(e.target.value)) document.getElementById('avprev').src = e.target.value; };
  document.getElementById('save').onclick = async () => {
    const avatar_url = document.getElementById('av').value.trim() || null;
    if (avatar_url && !/^https:\/\//.test(avatar_url)) return (document.getElementById('msg').innerHTML = err('Avatar URL must start with https://'));
    const upd = { avatar_url, location: document.getElementById('loc').value.trim() || null, signature: document.getElementById('ta_sig').value.trim() || null };
    if (upd.signature && upd.signature.length > 300) return (document.getElementById('msg').innerHTML = err('Signature is too long (300 max).'));
    const { error } = await sb.from('forum_profiles').update(upd).eq('id', p.id);
    if (error) return (document.getElementById('msg').innerHTML = err(error));
    Object.assign(state.me, upd);
    document.getElementById('msg').innerHTML = '<div class="notice">Profile saved!</div>';
    window.scrollTo(0, 0);
  };
}
/* viewMembers: see search.js */

/* ---------- private messages ---------- */
async function viewInbox(q) {
  drawChrome('pm');
  if (!state.me) return (location.hash = '#/login');
  loading();
  const box = q.box === 'sent' ? 'sent' : 'inbox';
  let query = sb.from('forum_messages').select('*, from:forum_profiles!forum_messages_from_user_fkey(' + PROF + '), to:forum_profiles!forum_messages_to_user_fkey(' + PROF + ')').order('created_at', { ascending: false }).limit(100);
  query = box === 'sent' ? query.eq('from_user', state.me.id) : query.eq('to_user', state.me.id);
  const { data, error } = await query;
  if (error) return render(err(error));
  render(crumb(['Personal Messages']) + `<div class="btnbar"><div><a class="btn ${box === 'inbox' ? '' : 'grey'}" href="#/pm">Inbox</a> <a class="btn ${box === 'sent' ? '' : 'grey'}" href="#/pm?box=sent">Sent Items</a></div><a class="btn blue" href="#/pm/new">Compose</a></div>
    <table class="tborder"><tr><th class="icon-col"></th><th>Subject</th><th style="width:150px">${box === 'sent' ? 'To' : 'From'}</th><th style="width:180px">Date</th></tr>
    ${data.length ? data.map((m, i) => { const c = i % 2 ? 'w2' : 'w1'; const unread = box === 'inbox' && !m.is_read; return `<tr class="hl"><td class="${c} icon-col">${img(unread ? ICON.misc.pmnew : ICON.misc.pm)}</td><td class="${c}"><a href="#/pm/${m.id}" style="font-weight:${unread ? 'bold' : 'normal'}">${esc(m.subject)}</a></td><td class="${c}">${uname(box === 'sent' ? m.to : m.from)}</td><td class="${c} small">${fmtDate(m.created_at)}</td></tr>`; }).join('') : `<tr><td colspan="4" class="w1 ctr" style="padding:20px">No messages.</td></tr>`}
    </table>`);
}
async function viewMessage(id) {
  drawChrome('pm');
  if (!state.me) return (location.hash = '#/login');
  const { data: m, error } = await sb.from('forum_messages').select('*, from:forum_profiles!forum_messages_from_user_fkey(' + PROF + ',signature), to:forum_profiles!forum_messages_to_user_fkey(' + PROF + ')').eq('id', id).maybeSingle();
  if (error) return render(err(error));
  if (!m) return render(err('Message not found.'));
  if (m.to_user === state.me.id && !m.is_read) { await sb.from('forum_messages').update({ is_read: true }).eq('id', id); state.pmUnread = Math.max(0, state.pmUnread - 1); drawChrome('pm'); }
  const a = m.from, r = rank(a);
  render(crumb(['<a href="#/pm">Personal Messages</a>', esc(m.subject)]) + `<table class="tborder"><tr><th colspan="2">${esc(m.subject)}</th></tr>
    <tr class="post"><td class="ui">${uname(a)}<br><span class="rank">${esc(r.name)}</span><br>${stars(r.stars)}<br>${img(a.avatar_url ? esc(a.avatar_url) : ICON.avatar, 'avatar', 'avatar')}</td>
    <td class="body"><div class="phead"><div><span class="ptitle">${esc(m.subject)}</span><div class="ptime">Sent to ${uname(m.to)} on ${fmtDate(m.created_at)}</div></div>
      <div>${m.to_user === state.me.id ? `<a class="btn sm blue" href="#/pm/new?reply=${m.id}">Reply</a> ` : ''}<a class="btn sm grey" href="#" id="delpm">Delete</a></div></div>
      <div class="ptext">${bbcode(m.body)}</div>${a.signature ? `<div class="sig">${bbcode(a.signature)}</div>` : ''}</td></tr></table>`);
  document.getElementById('delpm').onclick = async (e) => {
    e.preventDefault(); if (!confirm('Delete this message?')) return;
    await sb.from('forum_messages').delete().eq('id', id); location.hash = '#/pm';
  };
}
async function viewCompose(q) {
  drawChrome('pm');
  if (!state.me) return (location.hash = '#/login');
  let to = q.to || '', subject = '', body = '';
  if (q.reply) {
    const { data: m } = await sb.from('forum_messages').select('*, from:forum_profiles!forum_messages_from_user_fkey(username)').eq('id', q.reply).maybeSingle();
    if (m) { to = m.from.username; subject = m.subject.startsWith('Re: ') ? m.subject : 'Re: ' + m.subject; body = `[quote=${m.from.username}]${m.body}[/quote]\n`; }
  }
  render(crumb(['<a href="#/pm">Personal Messages</a>', 'Compose']) + `<div id="msg"></div><table class="tborder form"><tr><th colspan="2">Send a Personal Message</th></tr>
    <tr><td class="lbl">To (username):</td><td><input type="text" id="to" value="${esc(to)}"></td></tr>
    <tr><td class="lbl">Subject:</td><td><input type="text" id="subj" maxlength="120" value="${esc(subject)}"></td></tr>
    <tr><td class="lbl">Message:</td><td>${editor('pm', body)}</td></tr>
    <tr><td class="lbl"></td><td><button class="btn" id="send">Send Message</button></td></tr></table>`);
  wireEditor();
  document.getElementById('send').onclick = async (e) => {
    const msg = document.getElementById('msg');
    const toName = document.getElementById('to').value.trim(), subj = document.getElementById('subj').value.trim(), b = document.getElementById('ta_pm').value.trim();
    if (!toName || !subj || !b) return (msg.innerHTML = err('Please fill in all fields.'));
    const { data: rcpt } = await sb.from('forum_profiles').select('id').ilike('username', toName.replace(/[_%]/g, '\\$&')).maybeSingle();
    if (!rcpt) return (msg.innerHTML = err('No member with that username.'));
    e.target.disabled = true;
    const { error } = await sb.from('forum_messages').insert({ from_user: state.me.id, to_user: rcpt.id, subject: subj, body: b });
    e.target.disabled = false;
    if (error) return (msg.innerHTML = err(error));
    location.hash = '#/pm?box=sent';
  };
}

/* ---------- admin: see admin.js ---------- */

/* ================= router ================= */
async function route() {
  const raw = location.hash || '#/';
  const [path, qs] = raw.split('?');
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  pingSeen();
  // Re-read my profile on every page so role changes (admin/mod/ban) apply without a reload.
  if (state.session) { const { data: p } = await sb.from('forum_profiles').select('*').eq('id', state.session.user.id).maybeSingle(); state.me = p; await loadMyMods(); }
  if (state.session && !state.me && !['#/setup', '#/newpass'].includes(path)) { await ensureProfile(); await loadMe(); if (!state.me) return viewSetup(); }
  let m;
  if (path === '#/' || path === '#' || path === '') return viewIndex();
  if ((m = path.match(/^#\/board\/(\d+)$/))) return viewBoard(m[1], q);
  if ((m = path.match(/^#\/thread\/(\d+)$/))) return viewThread(m[1], q);
  if ((m = path.match(/^#\/new\/(\d+)$/))) return viewNewTopic(m[1]);
  if ((m = path.match(/^#\/profile\/([0-9a-f-]{36})$/))) return viewProfile(m[1]);
  if (path === '#/login') return viewLogin();
  if (path === '#/register') return viewRegister();
  if (path === '#/setup') return viewSetup();
  if (path === '#/newpass') return viewNewPass();
  if (path === '#/editprofile') return viewEditProfile();
  if (path === '#/members') return viewMembers(q);
  if (path === '#/search') return viewSearch(q);
  if (path === '#/admin') return viewAdmin();
  if (path === '#/pm') return viewInbox(q);
  if (path === '#/pm/new') return viewCompose(q);
  if ((m = path.match(/^#\/pm\/(\d+)$/))) return viewMessage(m[1]);
  drawChrome(''); render(err('Page not found.'));
}

let booted = false;
sb.auth.onAuthStateChange((event, session) => {
  if (!booted) return;
  // Defer: calling Supabase inside this callback can deadlock the auth lock.
  setTimeout(async () => {
    if (event === 'PASSWORD_RECOVERY') { location.hash = '#/newpass'; return; }
    const was = state.session?.user?.id || null, now = session?.user?.id || null;
    if (was !== now) { await loadMe(); route(); }
  }, 0);
});
window.addEventListener('hashchange', route);
(async () => {
  // Supabase puts auth tokens in the URL hash after email links; let the client consume them first.
  if (/access_token|error_description/.test(location.hash)) {
    const recovery = /type=recovery/.test(location.hash);
    await sb.auth.getSession(); history.replaceState(null, '', location.pathname + (recovery ? '#/newpass' : '#/'));
  }
  await Promise.all([loadSite(), loadMe()]);
  booted = true;
  route();
})();
