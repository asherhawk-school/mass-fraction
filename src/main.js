// App shell: persistence, top bar, routing.
import { h, clear, moneyK, toast, modal } from './ui/dom.js';
import { newGame, dateStr, openNCRs, isSandbox } from './model/game.js';
import { renderHQ } from './ui/screens/hq.js';
import { renderDesign } from './ui/screens/design.js';
import { renderFab } from './ui/screens/fab.js';
import { renderTest } from './ui/screens/test.js';
import { renderLaunch } from './ui/screens/launch.js';
import { renderLibrary } from './ui/screens/library.js';

const KEY = 'massfraction.save.';
const app = {
  g: null, ui: { screen: 'hq' },
  save(slot = app.slot ?? 'auto') {
    if (!app.g) return;
    try { localStorage.setItem(KEY + slot, JSON.stringify(app.g)); localStorage.setItem(KEY + 'last', slot); } catch (e) { /* storage unavailable */ }
  },
  load(slot) {
    try { const s = localStorage.getItem(KEY + slot); if (!s) return false; app.g = JSON.parse(s); app.slot = slot; return true; } catch { return false; }
  },
  go(screen, extra = {}) { if (app.ui.cleanup) { app.ui.cleanup(); app.ui.cleanup = null; } app.ui = { ...app.ui, ...extra, screen }; app.render(); window.scrollTo(0, 0); },
  render() {
    renderTop();
    const main = clear(document.getElementById('main'));
    if (!app.g) return renderTitle(main);
    const s = app.ui.screen;
    try {
      if (s === 'hq') renderHQ(main, app);
      else if (s === 'design') renderDesign(main, app);
      else if (s === 'fab') renderFab(main, app);
      else if (s === 'test') renderTest(main, app);
      else if (s === 'launch') renderLaunch(main, app);
      else if (s === 'library') renderLibrary(main, app);
    } catch (e) { console.error(e); main.append(h('div', { class: 'w error' }, 'Screen error: ' + e.message)); }
    app.save();
  },
  refreshTop() { renderTop(); },
  toast, modal,
};
window.__app = app;

function renderTop() {
  const top = clear(document.getElementById('topbar'));
  top.append(h('div', { class: 'brand' }, 'Mass ', h('b', null, 'Fraction')));
  const g = app.g;
  if (!g) return;
  const b = g.builds.find(x => x.id === g.activeBuildId);
  const ncr = b ? openNCRs(b).length : 0;
  top.append(
    h('div', { class: 'stat' }, h('small', null, 'Date'), h('span', null, dateStr(g))),
    h('div', { class: 'stat' }, h('small', null, isSandbox(g) ? 'Sandbox' : 'Cash'), h('span', { style: { color: g.cash < 0 ? 'var(--bad)' : '' } }, isSandbox(g) ? '∞' : moneyK(g.cash))),
    h('div', { class: 'stat' }, h('small', null, 'Reputation'), h('span', null, g.reputation)),
  );
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' });
  const tabs = [['hq', 'Headquarters'], ['design', 'Design'], ['fab', 'Fabrication', ncr], ['test', 'Test'], ['launch', 'Launch'], ['library', 'Handbook']];
  for (const [k, l, badge] of tabs) nav.append(h('button', { class: app.ui.screen === k ? 'on' : '', onclick: () => app.go(k) }, l, badge ? h('span', { class: 'badge', title: 'Open nonconformance reports' }, badge) : null));
  nav.append(h('button', { onclick: saveMenu, title: 'Save / load' }, '⋯'));
  top.append(nav);
}

function saveMenu() {
  const body = h('div', { class: 'stack' },
    h('p', { class: 'sub' }, 'The game autosaves after every action. You can also keep manual slots or export a file.'),
    h('div', { class: 'row' }, ['slot1', 'slot2', 'slot3'].map(s => h('div', { class: 'panel tight', style: { flex: 1 } },
      h('h4', null, s.toUpperCase()),
      (() => { try { const v = JSON.parse(localStorage.getItem(KEY + s) || 'null'); return h('div', { class: 'sub' }, v ? `${dateStr(v)} · ${moneyK(v.cash)}` : 'empty'); } catch { return h('div', { class: 'sub' }, 'unavailable'); } })(),
      h('div', { class: 'row', style: { marginTop: '6px' } },
        h('button', { class: 'btn small', onclick: () => { app.save(s); toast('Saved to ' + s, 'success'); } }, 'Save'),
        h('button', { class: 'btn small', onclick: () => { if (app.load(s)) { app.go('hq'); toast('Loaded ' + s); } else toast('Empty slot', 'warn'); } }, 'Load'))))),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { const blob = new Blob([JSON.stringify(app.g)], { type: 'application/json' }); const a = h('a', { href: URL.createObjectURL(blob), download: `mass-fraction-${dateStr(app.g)}.json` }); a.click(); } }, 'Export save file'),
      h('label', { class: 'btn' }, 'Import save file', h('input', { type: 'file', accept: '.json', style: { display: 'none' }, onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { app.g = JSON.parse(await f.text()); app.go('hq'); toast('Imported', 'success'); } catch { toast('Invalid file', 'fail'); } } })),
      h('button', { class: 'btn', onclick: () => { const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem(KEY + 'theme', r.dataset.theme); } catch { } app.render(); } }, 'Toggle light/dark'),
      h('button', { class: 'btn danger', onclick: () => { app.g = null; app.go('hq'); } }, 'Quit to title')));
  modal('Game', body);
}

function renderTitle(main) {
  let last = null;
  try { last = localStorage.getItem(KEY + 'last'); } catch { }
  main.append(h('div', { class: 'title-screen stack' },
    h('h1', null, 'Mass ', h('b', null, 'Fraction')),
    h('p', { class: 'sub', style: { fontSize: '15px', maxWidth: '640px' } }, 'Design every component from first principles, fabricate each part through real manufacturing processes, find (or miss) the defects, test, integrate, and launch — from a solid-fuel sounding rocket to orbit. The physics is the textbook physics. So are the failures.'),
    h('div', { class: 'big-choice' },
      h('div', { class: 'panel', role: 'button', tabindex: 0, onclick: () => { app.g = newGame('career'); app.slot = 'auto'; app.go('hq'); } },
        h('h3', null, 'New career'), h('p', { class: 'sub' }, '$3.2M seed funding, four technicians and a small shop. Win contracts, buy facilities, earn your way to orbit. Money and time are real constraints.')),
      h('div', { class: 'panel', role: 'button', tabindex: 0, onclick: () => { app.g = newGame('sandbox'); app.slot = 'auto'; app.go('hq'); } },
        h('h3', null, 'Sandbox'), h('p', { class: 'sub' }, 'Unlimited money and time, every facility owned, all contracts open. Engineering and manufacturing realism unchanged.'))),
    last && localStorage.getItem(KEY + last) ? h('button', { class: 'btn primary', onclick: () => { if (app.load(last)) app.go('hq'); } }, 'Continue saved game') : null,
  ));
}

try { const t = localStorage.getItem(KEY + 'theme'); if (t) document.documentElement.dataset.theme = t; } catch { }
try { const last = localStorage.getItem(KEY + 'last'); if (last) app.load(last); } catch { }
app.render();
