/* CrowderBoard: forum search + member search.
   Copyright (c) 2026 Dan Crowder. MIT License — see LICENSE. */
const SEARCH_PER_PAGE = 20, MEMBERS_PER_PAGE = 30;
const likeEsc = (s) => String(s).replace(/[\\%_]/g, (m) => '\\' + m);

/* Turn a search snippet into safe HTML: escape, drop BBCode tags, then add highlight marks. */
function snippetHTML(raw) {
  let s = String(raw || '').replace(/\[\/?(b|i|u|s|center|url|img|quote|code|list|color|size)(=[^\]]*)?\]|\[\*\]/gi, ' ');
  s = esc(s).replace(/\[\[\[hl/g, '<mark>').replace(/hl\]\]\]/g, '</mark>');
  return s.replace(/\s+/g, ' ').trim();
}

/* ---------------- Forum search ---------------- */
async function viewSearch(q) {
  drawChrome('search');
  const page = Math.max(1, +q.page || 1);
  const term = (q.q || '').trim(), by = (q.by || '').trim(), board = q.board ? +q.board : null, titles = q.titles === '1';
  const { data: boards } = await sb.from('forum_boards').select('id,name,category_id,sort').order('sort');
  const { data: cats } = await sb.from('forum_categories').select('id,name').order('sort');
  const boardOpts = (cats || []).map(c => `<optgroup label="${esc(c.name)}">${(boards || []).filter(b => b.category_id === c.id)
    .map(b => `<option value="${b.id}"${board === b.id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}</optgroup>`).join('');
  const form = `<table class="tborder form"><tr><th colspan="2">${img(ICON.msg.question)} Search the Forum</th></tr>
    <tr><td class="lbl">Keywords:<div class="muted small">Use "quotes" for phrases, -word to exclude, OR for either</div></td>
      <td><input type="text" id="sq" value="${esc(term)}" style="width:420px" maxlength="200"> <button class="btn" id="sgo">Search</button></td></tr>
    <tr><td class="lbl">Posted by:<div class="muted small">Exact username (optional)</div></td><td><input type="text" id="sby" value="${esc(by)}" style="width:200px"></td></tr>
    <tr><td class="lbl">Where:</td><td><select id="sboard"><option value="">All boards</option>${boardOpts}</select>
      &nbsp;<label class="small"><input type="checkbox" id="stitles"${titles ? ' checked' : ''}> Search topic titles only</label></td></tr></table>`;
  if (!term && !by) {
    render(crumb(['Search']) + form + `<div class="small muted ctr">Enter some keywords, a username, or both.</div>`);
    return wireSearchForm();
  }
  render(crumb(['Search']) + form + '<div class="loading">Searching...</div>');
  wireSearchForm();
  const { data, error } = await sb.rpc('forum_search', { p_q: term || null, p_board: board, p_author: by || null, p_titles_only: titles,
    p_limit: SEARCH_PER_PAGE, p_offset: (page - 1) * SEARCH_PER_PAGE });
  if (error) { $main.querySelector('.loading').outerHTML = err(error); return; }
  const total = data[0]?.total || 0, pages = Math.max(1, Math.ceil(total / SEARCH_PER_PAGE));
  const qs = new URLSearchParams({ q: term, by, board: board || '', titles: titles ? '1' : '' });
  const base = '#/search?' + [...qs].filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  let html = `<div class="btnbar"><div><b>${total}</b> result${total === 1 ? '' : 's'}${term ? ` for <b>${esc(term)}</b>` : ''}${by ? ` by <b>${esc(by)}</b>` : ''}</div>
    <div>${pager(base, page, pages)}</div></div>`;
  if (!data.length) html += `<table class="tborder"><tr><td class="w1 ctr" style="padding:24px">No posts matched your search. Try fewer or different words.</td></tr></table>`;
  data.forEach((r, i) => {
    html += `<table class="tborder"><tr><td class="titlebg" style="padding:4px 8px">
        <span style="float:right;font-weight:normal" class="small">${fmtDate(r.created_at)}</span>
        ${(page - 1) * SEARCH_PER_PAGE + i + 1}. <a href="#/board/${r.board_id}" style="color:#fff">${esc(r.board_name)}</a> &raquo;
        <a href="#/thread/${r.thread_id}?page=${r.post_page}&post=${r.post_id}" style="color:#fff">${esc(r.thread_title)}</a></td></tr>
      <tr><td class="w1"><div class="small muted" style="margin-bottom:4px">by ${uname(r.author_id ? { id: r.author_id, username: r.author_name, role: r.author_role } : null)}</div>
        <div class="ptext" style="min-height:0">${snippetHTML(r.snippet) || '<i class="muted">(no preview)</i>'}</div>
        <div class="r small"><a href="#/thread/${r.thread_id}?page=${r.post_page}&post=${r.post_id}">View post &raquo;</a></div></td></tr></table>`;
  });
  const results = document.createElement('div');
  results.innerHTML = html;
  $main.querySelector('.loading').replaceWith(results);
}
function wireSearchForm() {
  const go = () => {
    const p = new URLSearchParams();
    const v = (id) => document.getElementById(id).value.trim();
    if (v('sq')) p.set('q', v('sq'));
    if (v('sby')) p.set('by', v('sby'));
    if (v('sboard')) p.set('board', v('sboard'));
    if (document.getElementById('stitles').checked) p.set('titles', '1');
    location.hash = '#/search' + (p.toString() ? '?' + p : '');
  };
  document.getElementById('sgo').onclick = go;
  ['sq', 'sby'].forEach(id => document.getElementById(id).onkeydown = (e) => { if (e.key === 'Enter') go(); });
}

/* ---------------- Member search (Members page) ---------------- */
async function findMembers({ term = '', role = '', sort = 'posts', page = 1, per = MEMBERS_PER_PAGE, cols = 'id,username,role,post_count,title,created_at,location,last_seen' }) {
  let query = sb.from('forum_profiles').select(cols, { count: 'exact' });
  if (term) query = query.ilike('username', '%' + likeEsc(term) + '%');
  if (role) query = query.eq('role', role);
  if (sort === 'name') query = query.order('username');
  else if (sort === 'newest') query = query.order('created_at', { ascending: false });
  else if (sort === 'active') query = query.order('last_seen', { ascending: false });
  else query = query.order('post_count', { ascending: false }).order('created_at');
  return query.range((page - 1) * per, page * per - 1);
}

async function viewMembers(q) {
  drawChrome('members'); loading();
  const page = Math.max(1, +q.page || 1), term = (q.q || '').trim(), role = q.role || '', sort = q.sort || 'posts';
  const { data, count, error } = await findMembers({ term, role, sort, page });
  if (error) return render(err(error));
  const pages = Math.max(1, Math.ceil((count || 0) / MEMBERS_PER_PAGE)), since = new Date(Date.now() - 15 * 60000);
  const p = new URLSearchParams(); if (term) p.set('q', term); if (role) p.set('role', role); if (sort !== 'posts') p.set('sort', sort);
  const base = '#/members' + (p.toString() ? '?' + p : '');
  const sel = (v, cur, label) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
  render(crumb(['Members List']) + `<table class="tborder form"><tr><th colspan="2">Find a Member</th></tr>
    <tr><td class="lbl">Username contains:</td><td><input type="text" id="mq" value="${esc(term)}" style="width:220px">
      <select id="mrole">${sel('', role, 'Any position')}${sel('admin', role, 'Administrators')}${sel('mod', role, 'Global Moderators')}${sel('boardmod', role, 'Moderators')}${sel('member', role, 'Members')}${sel('banned', role, 'Banned')}</select>
      <select id="msort">${sel('posts', sort, 'Most posts')}${sel('name', sort, 'Username A-Z')}${sel('newest', sort, 'Newest members')}${sel('active', sort, 'Recently active')}</select>
      <button class="btn" id="mgo">Search</button>${term || role ? ` <a href="#/members" class="small">Clear</a>` : ''}</td></tr></table>
    <div class="btnbar"><div class="small muted">${count || 0} member${count === 1 ? '' : 's'} found</div><div>${pager(base, page, pages)}</div></div>
    <table class="tborder"><tr><th class="icon-col"></th><th>Username</th><th>Position</th><th>Location</th><th class="num">Posts</th><th style="width:130px">Joined</th><th style="width:150px">Last Active</th></tr>
    ${data.length ? data.map((m, i) => { const r = rank(m), c = i % 2 ? 'w2' : 'w1'; return `<tr class="hl"><td class="${c} icon-col">${img(new Date(m.last_seen) > since ? ICON.misc.online : ICON.misc.offline)}</td><td class="${c}">${uname(m)}</td><td class="${c} small">${esc(r.name)} ${stars(r.stars)}</td><td class="${c} small">${esc(m.location || '')}</td><td class="${c} num">${m.post_count}</td><td class="${c} small">${fmtDay(m.created_at)}</td><td class="${c} small">${fmtDate(m.last_seen)}</td></tr>`; }).join('')
      : `<tr><td colspan="7" class="w1 ctr" style="padding:20px">No members match that search.</td></tr>`}
  </table>`);
  const go = () => {
    const n = new URLSearchParams();
    const t = document.getElementById('mq').value.trim(), r = document.getElementById('mrole').value, s = document.getElementById('msort').value;
    if (t) n.set('q', t); if (r) n.set('role', r); if (s !== 'posts') n.set('sort', s);
    location.hash = '#/members' + (n.toString() ? '?' + n : '');
  };
  document.getElementById('mgo').onclick = go;
  document.getElementById('mq').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  document.getElementById('mrole').onchange = go; document.getElementById('msort').onchange = go;
}
