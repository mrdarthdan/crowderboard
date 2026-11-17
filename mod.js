/* CrowderBoard: spam protection + moderation tools.
   Report-a-post, Reports queue, Approval queue, Mod Log, Spam Protection settings, optional human check (Turnstile).
   Copyright (c) 2026 Dan Crowder. MIT License — see LICENSE.  Loaded after app.js. */

/* ---------- spam settings (public, loaded once) ---------- */
const SPAM = { require_captcha: false, turnstile: '', approval: 0, link_block: 3, oauth_google: false, oauth_apple: false, ready: null };
SPAM.ready = (async () => {
  try {
    const { data } = await sb.from('forum_spam_settings').select('*').eq('id', 1).maybeSingle();
    if (data) Object.assign(SPAM, { require_captcha: !!data.require_captcha, turnstile: data.turnstile_site_key || '',
      approval: data.approval_posts, link_block: data.link_block_posts,
      oauth_google: !!data.oauth_google, oauth_apple: !!data.oauth_apple });
  } catch (e) { /* forum not upgraded to v1.3 yet: features stay off */ }
})();

(() => {
  const st = document.createElement('style');
  st.textContent = `.mod-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:1000;display:flex;align-items:center;justify-content:center;padding:12px}
.mod-box{background:var(--bg);border:1px solid #000;outline:1px solid var(--inner);padding:14px;max-width:440px;width:100%;max-height:90vh;overflow:auto}
.mod-box h3{margin:0 0 6px;font-size:13px}.mod-box select,.mod-box textarea{width:100%;margin:6px 0}.mod-box textarea{min-height:80px}
.mod-actions{margin-top:8px}.rep-actions{margin-top:6px}.flag{color:var(--orange);font-weight:bold}`;
  document.head.appendChild(st);
})();

/* ---------- human check (Cloudflare Turnstile) + joining ---------- */
const Captcha = {
  _loading: null,
  load() {
    if (window.turnstile) return Promise.resolve();
    if (!this._loading) this._loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    return this._loading;
  },
  /* Draws the widget into `el` when the check is required. Returns { required, token(), reset() }. */
  async mount(el) {
    await SPAM.ready;
    const ctl = { required: false, token: () => null, reset: () => {} };
    if (!SPAM.require_captcha || !SPAM.turnstile || !el) return ctl;
    ctl.required = true;
    try { await this.load(); }
    catch (e) { el.innerHTML = '<span class="small">Could not load the human check. Turn off ad blockers and reload.</span>'; return ctl; }
    let tok = null;
    const id = window.turnstile.render(el, { sitekey: SPAM.turnstile, theme: 'dark',
      callback: (t) => { tok = t; }, 'expired-callback': () => { tok = null; }, 'error-callback': () => { tok = null; } });
    ctl.token = () => tok;
    ctl.reset = () => { tok = null; try { window.turnstile.reset(id); } catch (e) { /* ignore */ } };
    return ctl;
  },
};
/* Creates the forum profile through the forum-join edge function (checks the Turnstile token server-side). */
async function joinForum(username, token) {
  const { data, error } = await sb.functions.invoke('forum-join', { body: { username, token } });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j?.error || j?.message || msg; } catch (e) { /* keep default */ }
    return { error: { message: msg } };
  }
  return { error: data?.error ? { message: data.error } : null };
}

/* ---------- report a post ---------- */
const Mod = {};
function modal(html) {
  const ov = document.createElement('div');
  ov.className = 'mod-overlay'; ov.innerHTML = `<div class="mod-box">${html}</div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
  return ov;
}
Mod.report = (postId) => {
  const ov = modal(`<h3>Report this post</h3><div class="small muted">A moderator will take a look. The author is not told who reported.</div>
    <select id="rp_reason"><option value="spam">Spam or advertising</option><option value="abuse">Abuse or harassment</option>
      <option value="offtopic">Off topic</option><option value="other">Something else</option></select>
    <textarea id="rp_note" maxlength="500" placeholder="Anything else the moderators should know? (optional)"></textarea>
    <div id="rp_msg"></div>
    <div class="mod-actions"><button class="btn" id="rp_send">Send report</button> <button class="btn grey" id="rp_cancel">Cancel</button></div>`);
  ov.querySelector('#rp_cancel').onclick = () => ov.remove();
  const send = ov.querySelector('#rp_send');
  send.onclick = async () => {
    send.disabled = true;
    const { error } = await sb.rpc('forum_report_post', { p_post: postId, p_reason: ov.querySelector('#rp_reason').value, p_note: ov.querySelector('#rp_note').value.trim() || null });
    if (error) { send.disabled = false; ov.querySelector('#rp_msg').innerHTML = err(error); return; }
    ov.querySelector('.mod-box').innerHTML = '<div class="notice">Thanks! A moderator will review this post.</div><div class="mod-actions"><button class="btn" id="rp_ok">Close</button></div>';
    ov.querySelector('#rp_ok').onclick = () => ov.remove();
  };
};

/* ---------- staff pages (Reports / Approval Queue / Mod Log) ---------- */
const REASONS = { spam: 'Spam', abuse: 'Abuse', offtopic: 'Off topic', other: 'Other' };
const LOG_LABELS = {
  'thread.sticky': 'Sticky', 'thread.lock': 'Lock', 'thread.move': 'Move topic', 'thread.delete': 'Delete topic',
  'post.edit': 'Edit post', 'post.delete': 'Delete post', 'report.delete': 'Report: deleted post', 'report.dismiss': 'Report: dismissed',
  'report.resolve': 'Report: resolved', 'pending.approve': 'Approved held post', 'pending.reject': 'Rejected held post',
  'role.set': 'Position change', ban: 'Ban', unban: 'Unban', 'boardmod.add': 'Moderator added', 'boardmod.remove': 'Moderator removed',
  'settings.spam': 'Spam settings',
};
function staffHead(tab) { return crumb([isAdmin() ? '<a href="#/admin">Admin Center</a>' : 'Moderator Control Panel']) + adminTabs(tab); }

async function viewStaffTab(tab) {
  loading();
  await refreshUnread();
  drawChrome('admin');
  if (tab === 'reports') return viewReports();
  if (tab === 'queue') return viewQueue();
  return viewModLog();
}
const hashQ = () => Object.fromEntries(new URLSearchParams((location.hash.split('?')[1] || '')));

async function viewReports() {
  const closed = hashQ().show === 'closed';
  const cols = `id,reason,note,excerpt,thread_title,status,resolution,created_at,resolved_at,post_id,thread_id,board:forum_boards(id,name),
    reporter:forum_profiles!forum_reports_reporter_id_fkey(${PROF}),author:forum_profiles!forum_reports_author_id_fkey(${PROF}),resolver:forum_profiles!forum_reports_resolved_by_fkey(username)`;
  let q = sb.from('forum_reports').select(cols);
  q = closed ? q.neq('status', 'open').order('resolved_at', { ascending: false }).limit(40) : q.eq('status', 'open').order('created_at', { ascending: true }).limit(100);
  const { data, error } = await q;
  if (error) return render(staffHead('reports') + err(error));
  // group open reports about the same post
  const groups = [];
  for (const r of data) {
    const g = !closed && r.post_id ? groups.find(x => x.r.post_id === r.post_id) : null;
    if (g) g.all.push(r); else groups.push({ r, all: [r] });
  }
  const pages = await Promise.all(groups.map(async ({ r }) => {
    if (!r.post_id || !r.thread_id) return null;
    const { count } = await sb.from('forum_posts').select('id', { count: 'exact', head: true }).eq('thread_id', r.thread_id).lte('id', r.post_id);
    return Math.max(1, Math.ceil((count || 1) / POSTS_PER_PAGE));
  }));
  const rows = groups.map(({ r, all }, i) => {
    const link = r.thread_id ? `<a href="#/thread/${r.thread_id}?page=${pages[i] || 1}${r.post_id ? '&post=' + r.post_id : ''}">${esc(r.thread_title || 'topic')}</a>` : esc(r.thread_title || '(deleted)');
    const who = all.map(x => x.reporter ? esc(x.reporter.username) : 'a member').join(', ');
    const notes = all.filter(x => x.note).map(x => `<div class="small">&ldquo;${esc(x.note)}&rdquo; <span class="muted">&mdash; ${x.reporter ? esc(x.reporter.username) : 'member'}</span></div>`).join('');
    const cls = 'w1';
    return `<tr><td class="${cls}">
      <div><span class="flag">${all.map(x => REASONS[x.reason]).filter((v, k, a) => a.indexOf(v) === k).join(', ')}</span>
        ${all.length > 1 ? `<b>(${all.length} reports)</b>` : ''} in ${link}${r.board ? ` <span class="muted">/ ${esc(r.board.name)}</span>` : ''} &middot; <span class="small muted">${fmtDate(r.created_at)}</span></div>
      <div class="small muted">Reported by ${who}</div>${notes}
      <div class="quote"><div class="qh">Post by ${r.author ? esc(r.author.username) : 'deleted member'}</div><div class="qb">${esc(r.excerpt || '')}${(r.excerpt || '').length >= 300 ? '&hellip;' : ''}</div></div>
      ${closed ? `<div class="small muted">${r.status === 'dismissed' ? 'Dismissed' : r.resolution === 'delete' ? 'Post deleted' : 'Resolved'} by ${r.resolver ? esc(r.resolver.username) : 'staff'} ${fmtDate(r.resolved_at)}</div>`
        : `<div class="rep-actions">${r.post_id ? `<button class="btn sm" data-rep="${r.id}:delete">Delete post</button> ` : ''}
           <button class="btn sm blue" data-rep="${r.id}:resolve">Mark resolved</button> <button class="btn sm grey" data-rep="${r.id}:dismiss">Dismiss</button>
           ${r.author ? ` <a class="small" href="#/profile/${r.author.id}">View author</a>` : ''}</div>`}</td></tr>`;
  }).join('');
  render(staffHead('reports') + `<div class="btnbar"><div class="small muted">${closed ? 'Recently closed reports' : `${groups.length} open report${groups.length === 1 ? '' : 's'}`}</div>
    <a class="btn sm grey" href="#/admin?tab=reports${closed ? '' : '&show=closed'}">${closed ? 'Show open' : 'Show closed'}</a></div>
    <div id="msg"></div><table class="tborder"><tr><th>${closed ? 'Closed reports' : 'Reported posts'}</th></tr>
    ${rows || `<tr><td class="w1 ctr" style="padding:20px">${closed ? 'Nothing closed yet.' : 'No open reports. Nice and quiet.'}</td></tr>`}</table>`);
  $main.querySelectorAll('[data-rep]').forEach(b => b.onclick = async () => {
    const [id, action] = b.dataset.rep.split(':');
    if (action === 'delete' && !confirm('Delete this post? If it is the first post, the whole topic is removed.')) return;
    b.disabled = true;
    const { error } = await sb.rpc('forum_resolve_report', { p_report: +id, p_action: action });
    if (error) { b.disabled = false; document.getElementById('msg').innerHTML = err(error); return; }
    viewStaffTab('reports');
  });
}

async function viewQueue() {
  const { data, error } = await sb.from('forum_pending')
    .select(`id,kind,title,body,created_at,board:forum_boards(id,name),thread:forum_threads(id,title),author:forum_profiles!forum_pending_user_id_fkey(${PROF})`)
    .order('created_at', { ascending: true }).limit(100);
  if (error) return render(staffHead('queue') + err(error));
  const rows = data.map(p => `<tr><td class="w1">
    <div><b>${p.kind === 'thread' ? 'New topic: ' + esc(p.title) : 'Reply in: ' + (p.thread ? `<a href="#/thread/${p.thread.id}">${esc(p.thread.title)}</a>` : '(topic removed)')}</b>
      <span class="muted"> / ${esc(p.board?.name || '')}</span> &middot; <span class="small muted">${fmtDate(p.created_at)}</span></div>
    <div class="small">By ${uname(p.author)} <span class="muted">(${p.author ? p.author.post_count : 0} posts so far)</span>${/(https?:\/\/|www\.|\[url|\[img)/i.test(p.body) ? ' <span class="flag">&bull; contains a link</span>' : ''}</div>
    <div class="quote"><div class="qb">${bbcode(p.body)}</div></div>
    <div class="rep-actions"><button class="btn sm" data-pend="${p.id}:approve">Approve</button> <button class="btn sm grey" data-pend="${p.id}:reject">Reject</button></div></td></tr>`).join('');
  render(staffHead('queue') + `<div class="small muted" style="margin-bottom:6px">Posts from new members wait here until a moderator approves them. Rejected posts are discarded.</div>
    <div id="msg"></div><table class="tborder"><tr><th>${data.length} post${data.length === 1 ? '' : 's'} waiting</th></tr>
    ${rows || '<tr><td class="w1 ctr" style="padding:20px">Nothing is waiting for approval.</td></tr>'}</table>`);
  $main.querySelectorAll('[data-pend]').forEach(b => b.onclick = async () => {
    const [id, action] = b.dataset.pend.split(':');
    b.disabled = true;
    const { error } = await sb.rpc('forum_review_pending', { p_id: +id, p_action: action });
    if (error) { b.disabled = false; document.getElementById('msg').innerHTML = err(error); return; }
    viewStaffTab('queue');
  });
}

async function viewModLog() {
  const per = 40, page = Math.max(1, +hashQ().page || 1);
  const { data, error, count } = await sb.from('forum_modlog').select('*', { count: 'exact' })
    .order('id', { ascending: false }).range((page - 1) * per, page * per - 1);
  if (error) return render(staffHead('log') + err(error));
  const pages = Math.max(1, Math.ceil((count || 0) / per));
  const rows = data.map((l, i) => { const c = i % 2 ? 'w2' : 'w1';
    return `<tr><td class="${c} small" style="white-space:nowrap">${fmtDate(l.created_at)}</td><td class="${c}">${esc(l.actor_name || 'system')}</td>
      <td class="${c}">${esc(LOG_LABELS[l.action] || l.action)}</td><td class="${c}">${esc(l.target_name || '')}</td><td class="${c} small">${esc(l.detail || '')}</td></tr>`; }).join('');
  render(staffHead('log') + `<div class="btnbar"><div class="small muted">${count || 0} entries</div><div>${pager('#/admin?tab=log', page, pages)}</div></div>
    <table class="tborder"><tr><th>When</th><th>Staff</th><th>Action</th><th>Member</th><th>Details</th></tr>
    ${rows || '<tr><td colspan="5" class="w1 ctr" style="padding:20px">Nothing logged yet.</td></tr>'}</table>`);
}

/* ---------- Admin: Spam Protection settings ---------- */
async function viewAdminSpam() {
  loading();
  await SPAM.ready;
  const { data: s, error } = await sb.from('forum_spam_settings').select('*').eq('id', 1).maybeSingle();
  if (error || !s) return render(staffHead('spam') + err(error || 'Spam settings are missing. Run sql/migrations/v1.3_spam_moderation.sql first.'));
  render(staffHead('spam') + `<div id="msg"></div>
    <table class="tborder form"><tr><th colspan="2">Spam Protection</th></tr>
    <tr><td class="lbl">Block links for new members:<div class="muted small">Members with fewer posts than this can't post links or images (in posts or messages). 0 = off.</div></td>
      <td><input type="number" id="sp_links" min="0" max="50" value="${s.link_block_posts}" style="width:80px"> posts</td></tr>
    <tr><td class="lbl">Hold new members' posts for approval:<div class="muted small">A member's first N posts wait in the Approval Queue until a moderator approves them. 0 = off.</div></td>
      <td><input type="number" id="sp_hold" min="0" max="50" value="${s.approval_posts}" style="width:80px"> posts</td></tr>
    <tr><td class="lbl">Require a human check to join:<div class="muted small">New members must pass a Cloudflare Turnstile check before their forum profile is created.</div></td>
      <td><label><input type="checkbox" id="sp_cap"${s.require_captcha ? ' checked' : ''}> Require it</label></td></tr>
    <tr><td class="lbl">Turnstile site key:<div class="muted small">The public key from your Cloudflare Turnstile widget.</div></td>
      <td><input type="text" id="sp_key" maxlength="100" value="${esc(s.turnstile_site_key || '')}" placeholder="0x4AAAAAAA..."></td></tr>
    <tr><td class="lbl">Social sign-in buttons:<div class="muted small">Show &ldquo;Continue with Google / Apple&rdquo; on the Login and Register pages. Leave OFF until the provider is set up (see README).</div></td>
      <td><label><input type="checkbox" id="sp_goog"${s.oauth_google ? ' checked' : ''}> Google</label> &nbsp; <label><input type="checkbox" id="sp_apple"${s.oauth_apple ? ' checked' : ''}> Apple</label>
        <div class="muted small">New members who sign in this way still pick a forum username and pass the human check above if it is on.</div></td></tr>
    <tr><td class="lbl"></td><td><button class="btn" id="sp_save">Save</button> <button class="btn grey" id="sp_check">Check human-check setup</button> <span id="sp_status" class="small"></span></td></tr>
    <tr><td colspan="2" class="w2 small">To use the human check: (1) create a free Turnstile widget at dash.cloudflare.com for your forum's domain, (2) deploy the <b>forum-join</b> edge function and add the secret key as <b>TURNSTILE_SECRET_KEY</b> (see the README), (3) paste the site key above, use <b>Check setup</b>, then tick &ldquo;Require it&rdquo; and Save. Leave it off if you share this Supabase project with other apps and haven't set that up &mdash; link blocking, the approval queue and reports work without it.</td></tr></table>`);
  const $ = (id) => document.getElementById(id);
  const num = (id) => Math.min(50, Math.max(0, parseInt($(id).value, 10) || 0));
  $('sp_save').onclick = async (ev) => {
    const row = { link_block_posts: num('sp_links'), approval_posts: num('sp_hold'), require_captcha: $('sp_cap').checked, oauth_google: $('sp_goog').checked, oauth_apple: $('sp_apple').checked,
      turnstile_site_key: $('sp_key').value.trim() || null, updated_at: new Date().toISOString(), updated_by: state.me.id };
    if (row.require_captcha && !row.turnstile_site_key) return ($('msg').innerHTML = err('Enter your Turnstile site key before requiring the human check.'));
    ev.target.disabled = true;
    const { error } = await sb.from('forum_spam_settings').update(row).eq('id', 1);
    ev.target.disabled = false;
    if (error) return ($('msg').innerHTML = err(error));
    Object.assign(SPAM, { link_block: row.link_block_posts, approval: row.approval_posts, require_captcha: row.require_captcha, turnstile: row.turnstile_site_key || '', oauth_google: row.oauth_google, oauth_apple: row.oauth_apple });
    $('msg').innerHTML = '<div class="notice"><b>Saved.</b></div>'; window.scrollTo(0, 0);
  };
  $('sp_check').onclick = async () => {
    $('sp_status').textContent = 'Checking...';
    const { data, error } = await sb.functions.invoke('forum-join', { body: { username: '!' } });
    let msg = error ? error.message : (data?.error || '');
    if (error) { try { const j = await error.context.json(); msg = j.error || j.message || msg; } catch (e) { /* keep */ } }
    $('sp_status').textContent = /Username must be/.test(msg) ? 'The forum-join function is deployed. (The secret key can only be confirmed by a real sign-up.)'
      : /not found|404|Failed to send|relay/i.test(msg) ? 'The forum-join function was not found. Deploy it first.' : `Unexpected reply: ${msg}`;
  };
}
