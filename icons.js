// Original early-2000s style icons, drawn as SVG and served as <img> data URIs (like the old .gif sets).
const ICON = (() => {
  const uri = (svg) => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  const S = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="geometricPrecision">${body}</svg>`;

  // ---------- Topic folders (24x24) ----------
  function folder(opts = {}) {
    const front = opts.grey ? ['#c9ccd1', '#8b9097'] : ['#ffe08a', '#e0a72e'];
    const back = opts.grey ? '#a5a9af' : '#d39a26';
    let extra = '';
    if (opts.hot) extra += `<path d="M16 22c-3 0-5-2-5-4.6 0-2.4 1.6-3.4 2.3-5.4.6 1.3 1.4 1.8 2 1.8-.4-1.8.4-3.6 2.2-4.8-.3 1.9.7 3 1.6 4.1.9 1.1 1.9 2.2 1.9 4.2C21 20 19 22 16 22z" fill="#ff5a00" stroke="#7a1d00" stroke-width=".8"/><path d="M16.2 21c-1.4 0-2.3-.9-2.3-2.1 0-1.3 1-1.8 1.3-3 .5.8 1.2 1 1.6.9 0 1 .9 1.4 1.3 2 .3.5.4.8.4 1.1 0 .6-.9 1.1-2.3 1.1z" fill="#ffd23a"/>`;
    if (opts.isnew) extra += `<g transform="translate(18.5 5.5)"><path d="M0-5.2 1.4-1.9 5-1.6 2.3.8 3.1 4.3 0 2.5-3.1 4.3-2.3.8-5-1.6-1.4-1.9z" fill="#ff7b00" stroke="#7a2e00" stroke-width=".7"/><circle r="1.2" fill="#fff6c8"/></g>`;
    if (opts.locked) extra += `<g transform="translate(13 12)"><path d="M2 5V3a3 3 0 0 1 6 0v2" fill="none" stroke="#3b3b3b" stroke-width="1.6"/><rect x=".5" y="5" width="9" height="7" rx="1" fill="#b8bcc2" stroke="#2a2a2a" stroke-width=".8"/><rect x="4.4" y="7.3" width="1.2" height="2.6" fill="#2a2a2a"/></g>`;
    if (opts.sticky) extra += `<g transform="translate(14 1) rotate(25 4 6)"><circle cx="4" cy="3.5" r="3.3" fill="#e0261b" stroke="#6d0c06" stroke-width=".7"/><circle cx="3" cy="2.5" r="1" fill="#ff9a8f"/><rect x="3.4" y="6.5" width="1.2" height="6" fill="#777"/></g>`;
    if (opts.announce) extra += `<g transform="translate(12 10)"><path d="M6 0 12 11H0z" fill="#ffcc00" stroke="#6b4a00" stroke-width=".9" stroke-linejoin="round"/><rect x="5.3" y="3.3" width="1.4" height="4.3" fill="#222"/><rect x="5.3" y="8.5" width="1.4" height="1.4" fill="#222"/></g>`;
    const g = 'f' + Math.random().toString(36).slice(2, 7);
    return uri(S(24, 24, `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${front[0]}"/><stop offset="1" stop-color="${front[1]}"/></linearGradient></defs>
      <path d="M2 5.5h7l2 2h10.5v13H2z" fill="${back}" stroke="#4d3405" stroke-width="1"/>
      <path d="M1.5 9.5h20l-1.3 11H2.8z" fill="url(#${g})" stroke="#4d3405" stroke-width="1" stroke-linejoin="round"/>
      <path d="M2.6 10.6h18" stroke="#fff6cf" stroke-opacity=".8" stroke-width="1"/>${extra}`));
  }

  // ---------- Board index (32x32) ----------
  function boardIcon(on) {
    const g = 'b' + Math.random().toString(36).slice(2, 7);
    const c = on ? ['#ffb347', '#ff7a00', '#7a3300', '#fff1c2'] : ['#8aa3c2', '#4b6788', '#1c2b3d', '#c9d6e6'];
    return uri(S(32, 32, `<defs><radialGradient id="${g}" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="${c[3]}"/><stop offset=".45" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/></radialGradient></defs>
      ${on ? `<circle cx="16" cy="16" r="15" fill="#ff8a00" opacity=".25"/>` : ''}
      <path d="M4 8h9l2.5 2.5H28V26H4z" fill="${c[1]}" stroke="${c[2]}" stroke-width="1.2"/>
      <path d="M3 13h26l-1.6 13H4.6z" fill="url(#${g})" stroke="${c[2]}" stroke-width="1.2" stroke-linejoin="round"/>
      <path d="M8 17h16M8 20.5h12" stroke="${c[2]}" stroke-opacity=".55" stroke-width="1.4" stroke-linecap="round"/>`));
  }

  // ---------- Message icons (16x16) ----------
  const msg = {
    default: S(16, 16, `<path d="M3 1.5h7l3 3v10H3z" fill="#fff" stroke="#3a4d66" stroke-width="1"/><path d="M10 1.5v3h3" fill="#dbe4f0" stroke="#3a4d66" stroke-width="1"/><path d="M5 7h6M5 9.3h6M5 11.6h4" stroke="#7d93b2" stroke-width="1"/>`),
    question: S(16, 16, `<circle cx="8" cy="8" r="6.8" fill="#3d7fd6" stroke="#0f2f5c"/><path d="M5.8 6.2a2.3 2.3 0 1 1 3.4 2c-.8.5-1.2.9-1.2 1.8" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="12.2" r="1" fill="#fff"/>`),
    idea: S(16, 16, `<path d="M8 1.5a4.5 4.5 0 0 0-2.6 8.2c.5.4.8 1 .8 1.6v.7h3.6v-.7c0-.6.3-1.2.8-1.6A4.5 4.5 0 0 0 8 1.5z" fill="#ffe25c" stroke="#7a5d00"/><rect x="6.1" y="12.2" width="3.8" height="2.3" rx=".6" fill="#9aa0a8" stroke="#444" stroke-width=".7"/><path d="M6.2 4.5a2.4 2.4 0 0 1 2-1.3" stroke="#fff" stroke-width="1.1" fill="none" stroke-linecap="round"/>`),
    alert: S(16, 16, `<path d="M8 1.2 15.2 14H.8z" fill="#ffcc00" stroke="#6b4a00" stroke-linejoin="round"/><rect x="7.2" y="5" width="1.6" height="5" fill="#222"/><rect x="7.2" y="11" width="1.6" height="1.6" fill="#222"/>`),
    happy: null, sad: null,
    thumbsup: S(16, 16, `<circle cx="8" cy="8" r="6.8" fill="#38a63a" stroke="#0e4a10"/><path d="M8 3.8 11.6 8H9.3v4H6.7V8H4.4z" fill="#fff"/>`),
    thumbsdown: S(16, 16, `<circle cx="8" cy="8" r="6.8" fill="#d23a2a" stroke="#5a0e06"/><path d="M8 12.2 4.4 8h2.3V4h2.6v4h2.3z" fill="#fff"/>`),
  };

  // ---------- Smilies (17x17) ----------
  function face(kind) {
    const g = 's' + kind.replace(/\W/g, '');
    const base = kind === 'angry' ? ['#ffb08a', '#e0461b'] : ['#fff6a8', '#f0b400'];
    const eyes = {
      norm: `<ellipse cx="6" cy="6.8" rx="1.1" ry="1.6" fill="#222"/><ellipse cx="11" cy="6.8" rx="1.1" ry="1.6" fill="#222"/>`,
      wink: `<ellipse cx="6" cy="6.8" rx="1.1" ry="1.6" fill="#222"/><path d="M9.7 7.2q1.3-1 2.6 0" stroke="#222" stroke-width="1.1" fill="none" stroke-linecap="round"/>`,
      cool: `<path d="M3.2 5.6h10.6v1.3l-1 2.1H10L8.9 7H8.1L7 9H4.2l-1-2.1z" fill="#111"/><path d="M4.4 6.3h1.8" stroke="#888" stroke-width=".7"/>`,
      wide: `<circle cx="6" cy="6.6" r="1.7" fill="#fff" stroke="#222" stroke-width=".7"/><circle cx="11" cy="6.6" r="1.7" fill="#fff" stroke="#222" stroke-width=".7"/><circle cx="6" cy="6.8" r=".8" fill="#222"/><circle cx="11" cy="6.8" r=".8" fill="#222"/>`,
      roll: `<circle cx="6" cy="7" r="1.7" fill="#fff" stroke="#222" stroke-width=".7"/><circle cx="11" cy="7" r="1.7" fill="#fff" stroke="#222" stroke-width=".7"/><circle cx="6.5" cy="5.9" r=".8" fill="#222"/><circle cx="11.5" cy="5.9" r=".8" fill="#222"/>`,
      angry: `<path d="M4.3 4.6 7.3 6.2M12.7 4.6 9.7 6.2" stroke="#222" stroke-width="1.2" stroke-linecap="round"/><circle cx="6.2" cy="7.6" r="1" fill="#222"/><circle cx="10.8" cy="7.6" r="1" fill="#222"/>`,
      cry: `<path d="M4.8 7.2q1.2-.9 2.4 0M9.8 7.2q1.2-.9 2.4 0" stroke="#222" stroke-width="1.1" fill="none" stroke-linecap="round"/><path d="M5 8.4q-.9 1.6 0 2.3.9-.7 0-2.3z" fill="#4aa3ff"/>`,
    };
    const mouths = {
      smile: `<path d="M5 10.4q3.5 3.4 7 0" stroke="#222" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
      sad: `<path d="M5.2 12.6q3.3-2.8 6.6 0" stroke="#222" stroke-width="1.2" fill="none" stroke-linecap="round"/>`,
      grin: `<path d="M4.4 9.6h8.2q-.4 3.9-4.1 3.9T4.4 9.6z" fill="#fff" stroke="#222" stroke-width=".9" stroke-linejoin="round"/><path d="M4.8 10.7h7.4" stroke="#222" stroke-width=".5"/>`,
      tongue: `<path d="M5 10.4q3.5 2.4 7 0" stroke="#222" stroke-width="1.2" fill="none" stroke-linecap="round"/><path d="M8.6 11.2h2.4v1.4a1.2 1.2 0 0 1-2.4 0z" fill="#ff5f7a" stroke="#7a1022" stroke-width=".6"/>`,
      o: `<ellipse cx="8.5" cy="11.4" rx="1.6" ry="2" fill="#5a1a00" stroke="#222" stroke-width=".7"/>`,
      flat: `<path d="M5.4 11.6 11.8 10.4" stroke="#222" stroke-width="1.2" stroke-linecap="round"/>`,
      grr: `<path d="M5.2 12.2h6.6" stroke="#222" stroke-width="1.3" stroke-linecap="round"/>`,
    };
    const map = {
      smile: ['norm', 'smile'], sad: ['norm', 'sad'], wink: ['wink', 'smile'], grin: ['norm', 'grin'],
      tongue: ['norm', 'tongue'], shocked: ['wide', 'o'], cool: ['cool', 'smile'], undecided: ['norm', 'flat'],
      angry: ['angry', 'grr'], cry: ['cry', 'sad'], rolleyes: ['roll', 'flat'],
    }[kind];
    return uri(S(17, 17, `<defs><radialGradient id="${g}" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="${base[0]}"/><stop offset="1" stop-color="${base[1]}"/></radialGradient></defs>
      <circle cx="8.5" cy="8.5" r="7.6" fill="url(#${g})" stroke="#5e4100" stroke-width=".9"/>${eyes[map[0]]}${mouths[map[1]]}`));
  }

  const smilies = [
    ['>:(', 'angry'], [":'(", 'cry'], ['::)', 'rolleyes'], [':-/', 'undecided'],
    [':D', 'grin'], [':)', 'smile'], [':(', 'sad'], [';)', 'wink'], [':P', 'tongue'], [':o', 'shocked'], ['8)', 'cool'],
  ].map(([code, name]) => ({ code, name, src: face(name) }));

  const msgIcons = {};
  for (const k of Object.keys(msg)) msgIcons[k] = msg[k] ? uri(msg[k]) : null;
  msgIcons.happy = smilies.find(s => s.name === 'smile').src;
  msgIcons.sad = smilies.find(s => s.name === 'sad').src;

  const star = (filled = true) => uri(S(12, 12, `<path d="M6 .8 7.5 4.2l3.7.3-2.8 2.4.9 3.6L6 8.6 2.7 10.5l.9-3.6L.8 4.5l3.7-.3z" fill="${filled ? '#ff9a1f' : '#555'}" stroke="${filled ? '#7a3e00' : '#333'}" stroke-width=".7" stroke-linejoin="round"/>`));

  const avatar = uri(S(80, 80, `<defs><linearGradient id="av" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a6f8c"/><stop offset="1" stop-color="#2b3647"/></linearGradient></defs><rect width="80" height="80" fill="url(#av)"/><circle cx="40" cy="31" r="14" fill="#b7c3d4"/><path d="M14 80c2-18 13-27 26-27s24 9 26 27z" fill="#b7c3d4"/>`));

  const misc = {
    online: uri(S(14, 14, `<circle cx="7" cy="7" r="5.5" fill="#3ccf3c" stroke="#0b4d0b"/><circle cx="5.4" cy="5.3" r="1.6" fill="#c8ffc8"/>`)),
    offline: uri(S(14, 14, `<circle cx="7" cy="7" r="5.5" fill="#777" stroke="#2a2a2a"/>`)),
    stats: uri(S(20, 20, `<rect x="2" y="11" width="4" height="7" fill="#ff8a1f" stroke="#5a2a00" stroke-width=".8"/><rect x="8" y="6" width="4" height="12" fill="#4f8ee8" stroke="#0f2f5c" stroke-width=".8"/><rect x="14" y="2" width="4" height="16" fill="#ffcc33" stroke="#6b4a00" stroke-width=".8"/>`)),
    users: uri(S(20, 20, `<circle cx="7" cy="6" r="3.2" fill="#9fc3ff" stroke="#0f2f5c" stroke-width=".8"/><path d="M1.5 17c.4-4 2.6-6 5.5-6s5.1 2 5.5 6z" fill="#4f8ee8" stroke="#0f2f5c" stroke-width=".8"/><circle cx="13.5" cy="7" r="2.8" fill="#ffd08a" stroke="#5a2a00" stroke-width=".8"/><path d="M10 17c.4-3.5 1.6-5 3.5-5s4.5 1.5 5 5z" fill="#ff8a1f" stroke="#5a2a00" stroke-width=".8"/>`)),
    pm: uri(S(18, 14, `<rect x="1" y="1.5" width="16" height="11" fill="#fff" stroke="#30445e"/><path d="M1 1.5 9 8l8-6.5" fill="none" stroke="#30445e"/>`)),
    pmnew: uri(S(18, 14, `<rect x="1" y="1.5" width="16" height="11" fill="#ffd27a" stroke="#6b3a00"/><path d="M1 1.5 9 8l8-6.5" fill="none" stroke="#6b3a00"/><circle cx="15" cy="3" r="2.6" fill="#ff3b1f" stroke="#600"/>`)),
    lastpost: uri(S(12, 12, `<path d="M1.5 1.5h9v9h-9z" fill="#2c4f80" stroke="#9fc3ff" stroke-width=".8"/><path d="M4 4.5 6 6.8l2-2.3" stroke="#fff" stroke-width="1.3" fill="none"/>`)),
  };

  return {
    topic: {
      normal: folder(), isnew: folder({ isnew: true }), hot: folder({ hot: true }), hotnew: folder({ hot: true, isnew: true }),
      locked: folder({ locked: true, grey: true }), lockednew: folder({ locked: true, isnew: true }),
      sticky: folder({ sticky: true }), stickynew: folder({ sticky: true, isnew: true }),
      announce: folder({ announce: true }),
    },
    board: { on: boardIcon(true), off: boardIcon(false) },
    msg: msgIcons, smilies, star, avatar, misc,
  };
})();
