/* CrowderBoard: registers the service worker and offers an "Install app" link where the browser supports it. */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); installEvent = e;
  const f = document.getElementById('footer');
  if (!f || document.getElementById('install-app')) return;
  const a = document.createElement('a');
  a.id = 'install-app'; a.href = '#'; a.textContent = 'Install app'; a.style.marginLeft = '8px';
  a.onclick = async (ev) => { ev.preventDefault(); if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; a.remove(); };
  f.appendChild(a);
});
window.addEventListener('appinstalled', () => { document.getElementById('install-app')?.remove(); });
