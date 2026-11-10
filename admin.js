/* CrowderBoard Admin Center — loaded after app.js and replaces its viewAdmin().
   Adds rename/edit and up/down reordering for categories and boards. */
function adminTabs(active) {
  const t = (key, label) => `<a class="btn ${active === key ? '' : 'grey'}" href="#/admin${key === 'boards' ? '' : '?tab=' + key}">${label}</a>`;
  return `<div class="btnbar"><div>${t('boards', 'Boards &amp; Members')} ${t('look', 'Look &amp; Feel')}</div></div>`;
}
async function viewAdmin() {
  drawChrome('admin');
  if (!isAdmin()) return render(err('Administrators only.'));
  if (/[?&]tab=look/.test(location.hash)) return viewAdminLook();
  loading();
  const [cats, boards, staff] = await Promise.all([
    sb.from('forum_categories').select('*').order('sort').order('id'),
    sb.from('forum_boards').select('*').order('sort').order('id'),
    sb.from('forum_profiles').select(PROF).in('role', ['admin', 'mod', 'banned']).order('role'),
  ]);
  if (cats.error || boards.error) return render(err(cats.error || boards.error));
  const C = cats.data, B = boards.data;
  const arrows = (kind, id, i, n) =>
    `<a class="btn sm blue" href="#" data-move="${kind}:${id}:-1" title="Move up"${i === 0 ? ' style="visibility:hidden"' : ''}>&#9650;</a>
     <a class="btn sm blue" href="#" data-move="${kind}:${id}:1" title="Move down"${i === n - 1 ? ' style="visibility:hidden"' : ''}>&#9660;</a>`;

  let rows = '';
  C.forEach((c, ci) => {
    const kids = B.filter(b => b.category_id === c.id);
    rows += `<tr data-row="cat:${c.id}"><td colspan="3" class="catbg">${esc(c.name)} <span class="small" style="font-weight:normal">(${kids.length} board${kids.length === 1 ? '' : 's'})</span></td>
      <td class="catbg r" style="white-space:nowrap">${arrows('cat', c.id, ci, C.length)}
        <a class="btn sm grey" href="#" data-editcat="${c.id}">Rename</a>
        <a class="btn sm grey" href="#" data-delcat="${c.id}">Delete</a></td></tr>`;
    if (!kids.length) rows += `<tr><td colspan="4" class="w2 small muted ctr">No boards in this category yet.</td></tr>`;
    kids.forEach((b, bi) => {
      rows += `<tr data-row="board:${b.id}"><td class="w1"><b>${esc(b.name)}</b><div class="small muted">${esc(b.description || '')}</div></td>
        <td class="w2 small">${b.mod_only_threads ? 'Staff-only topics' : 'Open'}</td>
        <td class="w2 small">${b.thread_count} topics / ${b.post_count} posts</td>
        <td class="w2 r" style="white-space:nowrap">${arrows('board', b.id, bi, kids.length)}
          <a class="btn sm grey" href="#" data-editboard="${b.id}">Edit</a>
          <a class="btn sm grey" href="#" data-delboard="${b.id}">Delete</a></td></tr>`;
    });
  });

  render(crumb(['Admin Center']) + adminTabs('boards') + `<div id="msg"></div>
  <table class="tborder"><tr><th>Categories &amp; Boards</th><th style="width:130px">Who can post topics</th><th style="width:150px">Activity</th><th style="width:250px" class="r">Order / Actions</th></tr>${rows}</table>
  <table class="tborder form"><tr><th colspan="2">Add Category</th></tr>
    <tr><td class="lbl">Name:</td><td><input type="text" id="cname" style="width:260px"> <button class="btn sm" id="addcat">Add Category</button> <span class="small muted">Added to the bottom; use the arrows to move it.</span></td></tr></table>
  <table class="tborder form"><tr><th colspan="2">Add Board</th></tr>
    <tr><td class="lbl">Category:</td><td><select id="bcat">${C.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></td></tr>
    <tr><td class="lbl">Name:</td><td><input type="text" id="bname"></td></tr>
    <tr><td class="lbl">Description:</td><td><input type="text" id="bdesc" style="width:500px"></td></tr>
    <tr><td class="lbl">Options:</td><td><label><input type="checkbox" id="bmod"> Only staff can start topics</label></td></tr>
    <tr><td class="lbl"></td><td><button class="btn sm" id="addboard">Add Board</button></td></tr></table>
  <table class="tborder form"><tr><th colspan="2">Member Roles</th></tr>
    <tr><td class="lbl">Current staff &amp; bans:</td><td>${(staff.data || []).map(p => `${uname(p)} <span class="small muted">(${p.role}${p.title ? ', "' + esc(p.title) + '"' : ''})</span>`).join('<br>') || '—'}</td></tr>
    <tr><td class="lbl">Set role:</td><td><input type="text" id="ruser" placeholder="username" style="width:160px">
      <select id="rrole"><option value="member">Member</option><option value="mod">Global Moderator</option><option value="admin">Administrator</option><option value="banned">Banned</option></select>
      <input type="text" id="rtitle" placeholder="custom title (optional)" style="width:180px"> <button class="btn sm" id="setrole">Apply</button></td></tr></table>`);

  const msg = (h) => { document.getElementById('msg').innerHTML = h; window.scrollTo(0, 0); };
  const done = (error) => (error ? msg(err(error)) : viewAdmin());
  const nextSort = (list) => list.reduce((m, x) => Math.max(m, x.sort || 0), 0) + 1;

  // ---- reorder: renumber the sibling list 1..n in its new order ----
  $main.querySelectorAll('[data-move]').forEach(a => a.onclick = async (e) => {
    e.preventDefault();
    const [kind, id, dir] = a.dataset.move.split(':');
    const table = kind === 'cat' ? 'forum_categories' : 'forum_boards';
    const list = kind === 'cat' ? [...C] : B.filter(b => b.category_id === B.find(x => x.id == id).category_id);
    const i = list.findIndex(x => x.id == id), j = i + +dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const results = await Promise.all(list.map((x, k) => x.sort === k + 1 ? { error: null } : sb.from(table).update({ sort: k + 1 }).eq('id', x.id)));
    done(results.find(r => r.error)?.error);
  });

  // ---- rename category inline ----
  $main.querySelectorAll('[data-editcat]').forEach(a => a.onclick = (e) => {
    e.preventDefault();
    const c = C.find(x => x.id == a.dataset.editcat);
    const tr = $main.querySelector(`[data-row="cat:${c.id}"]`);
    tr.innerHTML = `<td colspan="4" class="w3"><b>Rename category:</b> <input type="text" id="ec_name" value="${esc(c.name)}" style="width:280px">
      <button class="btn sm" id="ec_save">Save</button> <button class="btn sm grey" id="ec_cancel">Cancel</button></td>`;
    document.getElementById('ec_cancel').onclick = () => viewAdmin();
    document.getElementById('ec_save').onclick = async () => {
      const name = document.getElementById('ec_name').value.trim();
      if (!name) return msg(err('Category name cannot be empty.'));
      const { error } = await sb.from('forum_categories').update({ name }).eq('id', c.id); done(error);
    };
    document.getElementById('ec_name').focus();
  });

  // ---- edit board inline (name, description, category, staff-only) ----
  $main.querySelectorAll('[data-editboard]').forEach(a => a.onclick = (e) => {
    e.preventDefault();
    const b = B.find(x => x.id == a.dataset.editboard);
    const tr = $main.querySelector(`[data-row="board:${b.id}"]`);
    tr.innerHTML = `<td colspan="4" class="w3"><table cellpadding="3">
      <tr><td class="small"><b>Name:</b></td><td><input type="text" id="eb_name" value="${esc(b.name)}" style="width:280px"></td></tr>
      <tr><td class="small"><b>Description:</b></td><td><input type="text" id="eb_desc" value="${esc(b.description || '')}" style="width:500px"></td></tr>
      <tr><td class="small"><b>Category:</b></td><td><select id="eb_cat">${C.map(c => `<option value="${c.id}"${c.id === b.category_id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        &nbsp;<label class="small"><input type="checkbox" id="eb_mod"${b.mod_only_threads ? ' checked' : ''}> Only staff can start topics</label></td></tr>
      <tr><td></td><td><button class="btn sm" id="eb_save">Save</button> <button class="btn sm grey" id="eb_cancel">Cancel</button></td></tr></table></td>`;
    document.getElementById('eb_cancel').onclick = () => viewAdmin();
    document.getElementById('eb_save').onclick = async () => {
      const name = document.getElementById('eb_name').value.trim();
      if (!name) return msg(err('Board name cannot be empty.'));
      const category_id = +document.getElementById('eb_cat').value;
      const upd = { name, description: document.getElementById('eb_desc').value.trim() || null, mod_only_threads: document.getElementById('eb_mod').checked };
      if (category_id !== b.category_id) { upd.category_id = category_id; upd.sort = nextSort(B.filter(x => x.category_id === category_id)); }
      const { error } = await sb.from('forum_boards').update(upd).eq('id', b.id); done(error);
    };
    document.getElementById('eb_name').focus();
  });

  // ---- add / delete ----
  document.getElementById('addcat').onclick = async () => {
    const name = document.getElementById('cname').value.trim();
    if (!name) return msg(err('Enter a category name.'));
    const { error } = await sb.from('forum_categories').insert({ name, sort: nextSort(C) }); done(error);
  };
  document.getElementById('addboard').onclick = async () => {
    const name = document.getElementById('bname').value.trim();
    if (!name) return msg(err('Enter a board name.'));
    const category_id = +document.getElementById('bcat').value;
    if (!category_id) return msg(err('Create a category first.'));
    const { error } = await sb.from('forum_boards').insert({ category_id, name, description: document.getElementById('bdesc').value.trim() || null,
      sort: nextSort(B.filter(x => x.category_id === category_id)), mod_only_threads: document.getElementById('bmod').checked });
    done(error);
  };
  $main.querySelectorAll('[data-delboard]').forEach(a => a.onclick = async (e) => {
    e.preventDefault(); if (!confirm('Delete this board and ALL its topics and posts?')) return;
    const { error } = await sb.from('forum_boards').delete().eq('id', a.dataset.delboard); done(error);
  });
  $main.querySelectorAll('[data-delcat]').forEach(a => a.onclick = async (e) => {
    e.preventDefault(); if (!confirm('Delete this category, its boards, and ALL their posts?')) return;
    const { error } = await sb.from('forum_categories').delete().eq('id', a.dataset.delcat); done(error);
  });
  document.getElementById('setrole').onclick = async () => {
    const name = document.getElementById('ruser').value.trim();
    const { data: u } = await sb.from('forum_profiles').select('id').ilike('username', name.replace(/[_%]/g, '\\$&')).maybeSingle();
    if (!u) return msg(err('No member with that username.'));
    const { error } = await sb.rpc('forum_set_role', { p_user: u.id, p_role: document.getElementById('rrole').value, p_title: document.getElementById('rtitle').value.trim() || null });
    done(error);
  };
}

/* ================= Look & Feel ================= */
const COLOR_FIELDS = [
  ['Page & panels', [['page_bg', 'Page background'], ['bg', 'Forum background'], ['row1', 'Row (light)'], ['row2', 'Row (dark)'], ['row3', 'Row highlight'], ['border', 'Borders'], ['input_bg', 'Text boxes']]],
  ['Text & links', [['text', 'Text'], ['muted', 'Faded text'], ['link', 'Links'], ['hover', 'Link hover'], ['accent', 'Accent (admin names, stars)']]],
  ['Bars & buttons', [['head1', 'Header bar top'], ['head2', 'Header bar bottom'], ['cat1', 'Category bar top'], ['cat2', 'Category bar bottom'],
    ['btn1', 'Button top'], ['btn2', 'Button bottom'], ['nav1', 'Nav bar top'], ['nav2', 'Nav bar bottom']]],
  ['Banner (classic style)', [['banner1', 'Banner top'], ['banner2', 'Banner bottom'], ['glow1', 'Glow 1'], ['glow2', 'Glow 2'], ['logo', 'Logo text']]],
];
const FONTS = ['Verdana, Tahoma, Arial, sans-serif', 'Tahoma, Verdana, sans-serif', '"Trebuchet MS", Verdana, sans-serif', 'Arial, Helvetica, sans-serif',
  'Georgia, "Times New Roman", serif', '"Lucida Grande", "Lucida Sans Unicode", sans-serif', '"Courier New", monospace'];

async function viewAdminLook() {
  loading();
  const { data, error } = await sb.from('forum_settings').select('data').eq('id', 1).maybeSingle();
  if (error) return render(err(error));
  const d = data?.data || {};
  const S = Object.assign(structuredClone(SITE_DEFAULTS), d, { colors: { ...SITE_DEFAULTS.colors, ...(d.colors || {}) } });
  const e = esc, val = (k) => e(S[k] ?? '');
  const area = (id, v, rows = 8, ph = '') => `<textarea id="${id}" spellcheck="false" placeholder="${e(ph)}" style="min-height:${rows * 16}px;font:12px 'Courier New',monospace">${e(v || '')}</textarea>`;

  render(crumb(['<a href="#/admin">Admin Center</a>', 'Look &amp; Feel']) + adminTabs('look') + `<div id="lookroot"><div id="msg"></div>
  <div class="notice">Changes preview live as you edit. Nothing is saved until you click <b>Save Changes</b> &mdash; reload the page to discard a preview.</div>

  <table class="tborder form"><tr><th colspan="2">Forum Identity</th></tr>
    <tr><td class="lbl">Forum name:<div class="muted small">Breadcrumbs, browser tab, footer</div></td><td><input type="text" id="s_name" maxlength="60" value="${val('name')}"></td></tr>
    <tr><td class="lbl">Tagline:</td><td><input type="text" id="s_tagline" maxlength="120" value="${val('tagline')}" style="width:500px"></td></tr></table>

  <table class="tborder form"><tr><th colspan="2">Banner</th></tr>
    <tr><td class="lbl">Banner style:</td><td>
      <label><input type="radio" name="bmode" value="classic"${S.banner_mode === 'classic' ? ' checked' : ''}> Classic text logo</label> &nbsp;
      <label><input type="radio" name="bmode" value="image"${S.banner_mode === 'image' ? ' checked' : ''}> Image</label> &nbsp;
      <label><input type="radio" name="bmode" value="html"${S.banner_mode === 'html' ? ' checked' : ''}> Custom HTML</label></td></tr>
    <tr><td class="lbl">Banner height:</td><td><input type="text" id="s_bh" value="${val('banner_height')}" style="width:60px"> px <span class="small muted">(40&ndash;400)</span></td></tr>
    <tr class="bm bm-classic"><td class="lbl">Logo text:<div class="muted small">Second part uses the accent color</div></td><td><input type="text" id="s_logo1" value="${val('logo1')}" style="width:180px"> + <input type="text" id="s_logo2" value="${val('logo2')}" style="width:180px">
      &nbsp;<label class="small"><input type="checkbox" id="s_orbs"${S.banner_orbs ? ' checked' : ''}> Show glowing orbs</label></td></tr>
    <tr class="bm bm-image"><td class="lbl">Image URL:<div class="muted small">Must start with https://</div></td><td><input type="url" id="s_bimg" value="${val('banner_image')}" style="width:500px"></td></tr>
    <tr class="bm bm-image"><td class="lbl">Image fit:</td><td><select id="s_bfit">${['cover', 'contain', 'fill'].map(f => `<option${S.banner_fit === f ? ' selected' : ''}>${f}</option>`).join('')}</select>
      &nbsp;<label class="small"><input type="checkbox" id="s_btext"${S.banner_text_on_image ? ' checked' : ''}> Show logo text on top of the image</label></td></tr>
    <tr class="bm bm-html"><td class="lbl">Banner HTML:<div class="muted small">Replaces the whole banner. &lt;style&gt; blocks are allowed.</div></td><td>${area('s_bhtml', S.banner_html, 8, '<div style="...">My banner</div>')}</td></tr></table>

  <table class="tborder form"><tr><th colspan="2">Theme Colors &amp; Fonts</th></tr>
    <tr><td class="lbl">Start from a preset:</td><td><select id="s_preset"><option value="">&mdash; choose a preset &mdash;</option>${Object.keys(THEME_PRESETS).map(k => `<option>${e(k)}</option>`).join('')}</select>
      <span class="small muted">Fills in all colors below; you can tweak them after.</span></td></tr>
    ${COLOR_FIELDS.map(([group, fields]) => `<tr><td class="lbl">${group}:</td><td><div style="display:flex;flex-wrap:wrap;gap:6px 18px">${fields.map(([k, label]) =>
      `<label class="small" style="display:inline-flex;align-items:center;gap:5px;min-width:190px"><input type="color" data-color="${k}" value="${e(S.colors[k])}" style="width:34px;height:22px;padding:0;border:1px solid #000;background:none;cursor:pointer"> ${label}</label>`).join('')}</div></td></tr>`).join('')}
    <tr><td class="lbl">Font:</td><td><select id="s_font">${FONTS.map(f => `<option value="${e(f)}"${S.font === f ? ' selected' : ''} style="font-family:${e(f)}">${e(f.split(',')[0].replace(/"/g, ''))}</option>`).join('')}</select>
      &nbsp; Size: <input type="text" id="s_fs" value="${val('font_size')}" style="width:40px"> px</td></tr></table>

  <table class="tborder form"><tr><th colspan="2">Custom CSS &amp; HTML</th></tr>
    <tr><td class="lbl">Custom CSS:<div class="muted small">Added after the theme, so it overrides anything. Example: <code>.bname{font-size:14px}</code></div></td><td>${area('s_css', S.custom_css, 10, '/* your CSS here */')}</td></tr>
    <tr><td class="lbl">Header HTML:<div class="muted small">Shown on every page, under the welcome bar. Great for announcements or ads.</div></td><td>${area('s_head', S.header_html, 5)}</td></tr>
    <tr><td class="lbl">Footer HTML:<div class="muted small">Shown on every page, above the copyright line.</div></td><td>${area('s_foot', S.footer_html, 5)}</td></tr>
    <tr><td class="lbl"></td><td class="small muted">HTML fields allow regular tags, images, links and &lt;style&gt; blocks. For safety, scripts, event handlers (onclick, etc.), iframes and forms are stripped &mdash; they would run with your members' logged-in sessions.</td></tr></table>

  <div class="btnbar"><div><button class="btn" id="s_save">Save Changes</button> <button class="btn grey" id="s_revert">Discard Preview</button></div>
    <div><button class="btn grey" id="s_reset">Reset Everything to Defaults</button></div></div></div>`);

  const $ = (id) => document.getElementById(id);
  const root = $('lookroot');
  // Leaving this page without saving drops the preview.
  window.addEventListener('hashchange', () => applySite(), { once: true });
  const collect = () => {
    const colors = {};
    root.querySelectorAll('[data-color]').forEach(i => colors[i.dataset.color] = i.value);
    return {
      name: $('s_name').value.trim() || SITE_DEFAULTS.name, tagline: $('s_tagline').value,
      banner_mode: (root.querySelector('input[name=bmode]:checked') || {}).value || 'classic',
      banner_height: Math.min(400, Math.max(40, parseInt($('s_bh').value, 10) || 96)),
      logo1: $('s_logo1').value, logo2: $('s_logo2').value, banner_orbs: $('s_orbs').checked,
      banner_image: $('s_bimg').value.trim(), banner_fit: $('s_bfit').value, banner_text_on_image: $('s_btext').checked,
      banner_html: $('s_bhtml').value,
      font: $('s_font').value, font_size: Math.min(16, Math.max(9, parseInt($('s_fs').value, 10) || 11)),
      colors, custom_css: $('s_css').value, header_html: $('s_head').value, footer_html: $('s_foot').value,
    };
  };
  const showMode = () => {
    const m = (root.querySelector('input[name=bmode]:checked') || {}).value || 'classic';
    root.querySelectorAll('.bm').forEach(r => r.style.display = r.classList.contains('bm-' + m) ? '' : 'none');
  };
  let t; const preview = () => { clearTimeout(t); t = setTimeout(() => applySite(collect()), 150); };
  root.addEventListener('input', preview); root.addEventListener('change', () => { showMode(); preview(); });
  showMode();

  $('s_preset').onchange = (ev) => {
    const p = THEME_PRESETS[ev.target.value]; if (!p) return;
    root.querySelectorAll('[data-color]').forEach(i => { if (p[i.dataset.color]) i.value = p[i.dataset.color]; });
    ev.target.value = ''; preview();
  };
  const msg = (h) => { $('msg').innerHTML = h; window.scrollTo(0, 0); };
  $('s_save').onclick = async (ev) => {
    const next = collect();
    if (next.banner_mode === 'image' && !/^https:\/\//.test(next.banner_image)) return msg(err('Banner image URL must start with https://'));
    ev.target.disabled = true;
    const { error } = await sb.from('forum_settings').update({ data: next, updated_at: new Date().toISOString(), updated_by: state.me.id }).eq('id', 1);
    ev.target.disabled = false;
    if (error) return msg(err(error));
    Object.assign(SITE, next); applySite();
    msg('<div class="notice"><b>Saved!</b> Everyone will see the new look on their next page load.</div>');
  };
  $('s_revert').onclick = () => { applySite(); viewAdminLook(); };
  $('s_reset').onclick = async () => {
    if (!confirm('Reset the banner, colors, fonts and ALL custom CSS/HTML back to the defaults?')) return;
    const { error } = await sb.from('forum_settings').update({ data: {}, updated_at: new Date().toISOString(), updated_by: state.me.id }).eq('id', 1);
    if (error) return msg(err(error));
    Object.assign(SITE, structuredClone(SITE_DEFAULTS)); applySite(); viewAdminLook();
  };
}
