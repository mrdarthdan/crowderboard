/* CrowderBoard site settings: banner, theme colors, custom CSS/HTML.
   Loaded before app.js. Settings live in public.forum_settings (one row, admin-editable). */
const THEME_PRESETS = {
  'Midnight Classic (default)': {
    page_bg: '#151618', bg: '#1e1f21', row1: '#33363a', row2: '#2d3033', row3: '#3b3f44', border: '#0d0e10',
    text: '#d9dcdf', muted: '#9aa1a9', link: '#8fbaf0', hover: '#ffae4f', input_bg: '#17181a',
    head1: '#4f7fbf', head2: '#1b3c69', cat1: '#ffa64a', cat2: '#b85600', btn1: '#ffb357', btn2: '#bf5600', accent: '#ff9a2e',
    nav1: '#41464d', nav2: '#1c1e21', banner1: '#2f3338', banner2: '#1b1d20', glow1: '#508ce6', glow2: '#ff8c1e', logo: '#ffffff',
  },
  'Ocean Depths': {
    page_bg: '#0b1620', bg: '#102030', row1: '#1a3045', row2: '#152a3d', row3: '#21394f', border: '#050c12',
    text: '#d6e6f2', muted: '#8fa9bf', link: '#7fd3ff', hover: '#ffe27a', input_bg: '#0a1520',
    head1: '#2a8fc0', head2: '#0d3f63', cat1: '#2fc4b2', cat2: '#0b6d63', btn1: '#4fd1c5', btn2: '#127a70', accent: '#3fe0cf',
    nav1: '#1c3a52', nav2: '#0b1a26', banner1: '#123049', banner2: '#081420', glow1: '#2aa7ff', glow2: '#2fe0c6', logo: '#ffffff',
  },
  'Forest Ranger': {
    page_bg: '#121610', bg: '#1a2016', row1: '#2a3324', row2: '#242c1f', row3: '#323d2b', border: '#080a06',
    text: '#dfe6d6', muted: '#9ba98e', link: '#a8d98a', hover: '#ffcf5a', input_bg: '#11150e',
    head1: '#5d8a3a', head2: '#2a4518', cat1: '#c8a24a', cat2: '#7a5a12', btn1: '#d8b65a', btn2: '#7f5d10', accent: '#e8c25a',
    nav1: '#3a4532', nav2: '#151a11', banner1: '#28331f', banner2: '#12170e', glow1: '#7fc24a', glow2: '#e8b84a', logo: '#ffffff',
  },
  'Crimson Night': {
    page_bg: '#140f10', bg: '#1d1617', row1: '#352628', row2: '#2d2022', row3: '#3e2c2f', border: '#0a0606',
    text: '#ecdcdc', muted: '#b09a9a', link: '#ff9c9c', hover: '#ffd27a', input_bg: '#160f10',
    head1: '#b8323a', head2: '#5a0f14', cat1: '#5a5f68', cat2: '#25282d', btn1: '#e05058', btn2: '#7a141a', accent: '#ff5560',
    nav1: '#3e3335', nav2: '#191213', banner1: '#3a1c1f', banner2: '#160b0c', glow1: '#ff3a46', glow2: '#ffb04a', logo: '#ffffff',
  },
  'Silver Classic (light)': {
    page_bg: '#e5e5e5', bg: '#ffffff', row1: '#eff2f6', row2: '#dee3e7', row3: '#d1d7dc', border: '#98aab1',
    text: '#222222', muted: '#5a6470', link: '#0b4f8a', hover: '#d4582a', input_bg: '#ffffff',
    head1: '#5c7fa8', head2: '#2c4a72', cat1: '#f0a050', cat2: '#c06818', btn1: '#f5b060', btn2: '#c86a10', accent: '#d4692a',
    nav1: '#6f87a6', nav2: '#3d5677', banner1: '#4a6a94', banner2: '#1e3556', glow1: '#9cc3f5', glow2: '#ffb46a', logo: '#ffffff',
  },
};
const SITE_DEFAULTS = {
  name: 'My Forum',
  tagline: '» Pull up a chair and stay a while.',
  logo1: 'My', logo2: 'Forum',
  banner_mode: 'classic',            // classic | image | html
  banner_height: 96, banner_orbs: true,
  banner_image: '', banner_fit: 'cover', banner_text_on_image: false,
  banner_html: '',
  font: 'Verdana, Tahoma, Arial, sans-serif', font_size: 11,
  colors: { ...THEME_PRESETS['Midnight Classic (default)'], name_admin: '#ff9a2e', name_mod: '#7ec3ff', name_boardmod: '#7fe08a', name_member: '#8fbaf0' },
  custom_css: '', header_html: '', footer_html: '',
};
const SITE = { ...structuredClone(SITE_DEFAULTS), ready: null };

/* ---- HTML sanitizer: allows normal markup + <style>, strips scripts, event handlers, javascript: links ---- */
function cleanHTML(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  doc.body.querySelectorAll('script,iframe,frame,frameset,object,embed,applet,base,meta,link,form,noscript,portal').forEach(n => n.remove());
  doc.body.querySelectorAll('*').forEach(el => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = a.value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
      const urlAttr = ['href', 'src', 'xlink:href', 'action', 'formaction', 'background', 'poster', 'srcset'].includes(n);
      if (n.startsWith('on') || n === 'srcdoc' ||
          (urlAttr && /^(javascript|vbscript):/.test(v)) ||
          (urlAttr && v.startsWith('data:') && !v.startsWith('data:image/'))) el.removeAttribute(a.name);
    }
    if (el.tagName === 'A' && el.getAttribute('target') === '_blank') el.setAttribute('rel', 'noopener noreferrer');
  });
  return doc.body.innerHTML;
}
const cssColor = (v, d) => {
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v || '')) return d;
  return v.length === 4 ? '#' + [...v.slice(1)].map(x => x + x).join('') : v.slice(0, 7);
};
const cssEsc = (s) => String(s || '').replace(/[<>"\\]/g, '');

/* ---- build the theme stylesheet from settings ---- */
function themeCSS(s) {
  const d = THEME_PRESETS['Midnight Classic (default)'], c = {};
  for (const k of Object.keys(d)) c[k] = cssColor(s.colors?.[k], d[k]);
  const G = 'linear-gradient(rgba(255,255,255,.22),rgba(255,255,255,.06) 50%,rgba(0,0,0,0) 51%,rgba(0,0,0,.10))';
  const fs = Math.min(16, Math.max(9, +s.font_size || 11));
  return `:root{--bg:${c.bg};--row1:${c.row1};--row2:${c.row2};--row3:${c.row3};--border:${c.border};--text:${c.text};--muted:${c.muted};
  --link:${c.link};--hover:${c.hover};--orange:${c.accent};--inner:${c.row3}}
html,body{background-color:${c.page_bg}}
body{background-image:repeating-linear-gradient(45deg,rgba(255,255,255,.02) 0 2px,transparent 2px 4px);font-family:${cssEsc(s.font)};font-size:${fs}px}
#wrap{background:${c.bg}}
.titlebg,.tborder th{background:${G},linear-gradient(${c.head1},${c.head2});border-top-color:${c.head1}}
.catbg{background:${G},linear-gradient(${c.cat1},${c.cat2});border-top-color:${c.cat1}}
.btn{background:${G},linear-gradient(${c.btn1},${c.btn2})}
.btn.blue{background:${G},linear-gradient(${c.head1},${c.head2})}
.btn.grey{background:${G},linear-gradient(${c.row3},${c.border})}
#nav{background:${G},linear-gradient(${c.nav1},${c.nav2})}
#nav a{color:#fff;text-shadow:1px 1px 0 rgba(0,0,0,.6)}
#nav a:hover{background:linear-gradient(${c.btn1},${c.btn2})}
#nav a.on{background:linear-gradient(${c.head1},${c.head2})}
#welcome,#footer{background:${c.row2};color:${c.muted}}
.pages b{background:${c.btn2}}
.quote .qh{background:linear-gradient(${c.head1},${c.head2})}
.quote{background:${c.row2}} .code .qh{background:${c.row3};color:${c.text}}
input[type=text],input[type=email],input[type=password],input[type=url],textarea,select{background:${c.input_bg};color:${c.text};outline-color:${c.row3}}
input:focus,textarea:focus,select:focus{outline-color:${c.accent}}
.post .ptext,.post .ptime,.post .edited{color:inherit}
${(() => { const nm = (k, fb) => cssColor(s.colors?.[k], fb); return `.u-admin{color:${nm('name_admin', c.accent)}!important}
.u-mod{color:${nm('name_mod', '#7ec3ff')}!important}
.u-boardmod{color:${nm('name_boardmod', '#7fe08a')}!important}
.u-member{color:${nm('name_member', c.link)}!important}`; })()}
#footer .badge span:first-child{background:${c.accent}}
#footer .badge span:last-child{background:${c.head2}}
.loading:before{background:${c.accent}}
.modbar b{color:${c.accent}}
.toolbar button:hover{background:linear-gradient(${c.btn1},${c.btn2})}
tr.hl:hover td{background:${c.row3}}
.notice{background:${c.row3};color:${c.text}}
#banner{height:${Math.min(400, Math.max(40, +s.banner_height || 96))}px;
  background:radial-gradient(ellipse at 85% 120%,${c.glow2}73,transparent 55%),radial-gradient(ellipse at 10% -40%,${c.glow1}8c,transparent 60%),linear-gradient(${c.banner1},${c.banner2})}
#logo{color:${c.logo};text-shadow:0 0 8px ${c.glow1},2px 2px 0 #000}
#logo span{color:${c.accent};text-shadow:0 0 8px ${c.glow2},2px 2px 0 #000}
#banner .orb{background:radial-gradient(circle at 35% 30%,#fff 0,${c.btn1} 15%,${c.glow2} 45%,${c.cat2} 85%);box-shadow:0 0 25px ${c.glow2},inset -6px -8px 14px rgba(0,0,0,.5)}
#banner .orb2{background:radial-gradient(circle at 35% 30%,#fff 0,${c.link} 15%,${c.glow1} 50%,${c.head2} 90%);box-shadow:0 0 14px ${c.glow1}}
#banner.img-banner{background-color:${c.banner2}}
#custom-header,#custom-footer{padding:0 10px}
.post .sig{color:${c.muted};border-top-color:${c.row3}}
.post .phead{border-bottom-color:${c.row3}}`;
}

function bannerHTML(s) {
  const e = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const text = `<div id="logo">${e(s.logo1)}<span>${e(s.logo2)}</span></div><div id="tagline">${e(s.tagline)}</div>`;
  if (s.banner_mode === 'html' && s.banner_html) return { cls: 'html-banner', html: cleanHTML(s.banner_html) };
  if (s.banner_mode === 'image' && /^https:\/\//.test(s.banner_image || '')) {
    const fit = ['cover', 'contain', 'fill'].includes(s.banner_fit) ? s.banner_fit : 'cover';
    return { cls: 'img-banner', html: `<a href="#/" style="display:block;height:100%"><img src="${e(s.banner_image)}" alt="${e(s.name)}" style="width:100%;height:100%;object-fit:${fit};display:block"></a>${s.banner_text_on_image ? text : ''}` };
  }
  return { cls: 'classic-banner', html: `<a href="#/" style="text-decoration:none">${text}</a>${s.banner_orbs ? '<div class="orb"></div><div class="orb2"></div>' : ''}` };
}

/* Apply settings to the page (used on load and for live preview in the admin). */
function applySite(s = SITE) {
  const style = (id) => { let el = document.getElementById(id); if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); } return el; };
  style('theme-vars').textContent = themeCSS(s);
  style('custom-css').textContent = s.custom_css || '';
  const b = document.getElementById('banner'), bh = bannerHTML(s);
  b.className = bh.cls; b.innerHTML = bh.html;
  if (bh.cls === 'html-banner') b.style.background = 'none'; else b.style.background = '';
  document.getElementById('custom-header').innerHTML = cleanHTML(s.header_html);
  document.getElementById('custom-footer').innerHTML = cleanHTML(s.footer_html);
  document.getElementById('footer-name').textContent = s.name;
  document.title = s.name + ' Forums';
}

async function loadSite() {
  try {
    const { data } = await sb.from('forum_settings').select('data').eq('id', 1).maybeSingle();
    const d = data?.data || {};
    Object.assign(SITE, structuredClone(SITE_DEFAULTS), d, { colors: { ...SITE_DEFAULTS.colors, ...(d.colors || {}) } });
  } catch (e) { /* fall back to defaults */ }
  applySite();
}
