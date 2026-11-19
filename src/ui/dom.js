// Tiny DOM toolkit: hyperscript, formatting, parameter forms with process-window bands, modals, toasts.
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export const money = (v) => (v < 0 ? '−' : '') + '$' + Math.abs(v) .toLocaleString('en-US', { maximumFractionDigits: 0 });
export const moneyK = (v) => { const a = Math.abs(v); const s = a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'k' : a.toFixed(0); return (v < 0 ? '−$' : '$') + s; };
export const n = (v, d = 1) => (v === undefined || v === null || !isFinite(v) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const km = (m) => (Math.abs(m) >= 1e5 ? n(m / 1000, 0) : n(m / 1000, 2)) + ' km';

export function warnList(ws) {
  if (!ws.length) return h('div', { class: 'w success' }, 'No design-rule violations.');
  const order = { error: 0, warn: 1, info: 2 };
  return h('div', { class: 'warnings' }, [...ws].sort((a, b) => order[a.lvl] - order[b.lvl]).map(w => h('div', { class: 'w ' + w.lvl }, w.msg)));
}

/**
 * Parameter form. defs: [{key,label,unit,type,min,max,step,options,help,show}]
 * windows: {key: {tb:[lo,hi], q:[lo,hi]}} drawn as bands; derived(values) → [[label, text]]
 */
export function paramForm(defs, values, onInput, opts = {}) {
  const root = h('div', { class: 'pf' });
  const derivedEl = h('div', { class: 'derived' });
  const fields = [];
  const render = () => {
    for (const f of fields) f.el.style.display = (!f.def.show || f.def.show(values)) ? '' : 'none';
    if (opts.derived) { const d = opts.derived(values); derivedEl.textContent = d.map(([a, b]) => `${a}: ${b}`).join('   '); derivedEl.style.display = d.length ? '' : 'none'; }
    for (const f of fields) f.updBand && f.updBand();
  };
  for (const def of defs) {
    const id = 'p_' + def.key + Math.random().toString(36).slice(2, 6);
    let el;
    if (def.type === 'sel') {
      const s = h('select', { id }, def.options.map(([v, l]) => h('option', { value: v, selected: values[def.key] === v }, l)));
      s.addEventListener('change', () => { values[def.key] = s.value; render(); onInput(def.key, s.value, true); });
      el = h('div', { class: 'f wide' }, h('label', { for: id }, def.label), s, def.help ? h('div', { class: 'help' }, def.help) : null);
    } else if (def.type === 'bool') {
      const c = h('input', { type: 'checkbox', id, checked: !!values[def.key] });
      c.addEventListener('change', () => { values[def.key] = c.checked; render(); onInput(def.key, c.checked, true); });
      el = h('div', { class: 'f' }, h('label', { for: id }, def.label), h('div', { style: { textAlign: 'right' } }, c), def.help ? h('div', { class: 'help' }, def.help) : null);
    } else {
      const num = h('input', { type: 'number', id, min: def.min, max: def.max, step: def.step, value: values[def.key] });
      const rng = h('input', { type: 'range', min: def.min, max: def.max, step: def.step, value: values[def.key], 'aria-label': def.label });
      const set = (v, commit) => { v = Math.max(def.min, Math.min(def.max, +v)); if (!isFinite(v)) return; values[def.key] = v; num.value = v; rng.value = v; render(); onInput(def.key, v, commit); };
      num.addEventListener('change', () => set(num.value, true));
      rng.addEventListener('input', () => set(rng.value, false));
      rng.addEventListener('change', () => set(rng.value, true));
      const kids = [h('label', { for: id }, def.label, def.unit ? h('span', { class: 'u' }, ` (${def.unit})`) : ''), num, rng];
      const w = opts.windows && opts.windows[def.key];
      let band = null;
      if (w) {
        band = h('div', { class: 'band', title: w.q ? 'Green: qualified process window. Grey: textbook guidance.' : 'Grey: textbook guidance (qualify the procedure to learn the true window)' });
        kids.push(band);
      }
      if (def.help) kids.push(h('div', { class: 'help' }, def.help));
      el = h('div', { class: 'f' }, kids);
      fields.push({ def, el, updBand: band ? () => {
        clear(band);
        const span = def.max - def.min;
        const pos = (v) => Math.max(0, Math.min(100, (v - def.min) / span * 100));
        if (w.tb) band.append(h('i', { class: 'tb', style: { left: pos(w.tb[0]) + '%', width: (pos(w.tb[1]) - pos(w.tb[0])) + '%' } }));
        if (w.q) band.append(h('i', { class: 'q', style: { left: pos(w.q[0]) + '%', width: (pos(w.q[1]) - pos(w.q[0])) + '%' } }));
        band.append(h('b', { style: { left: pos(values[def.key]) + '%' } }));
      } : null });
      root.append(el);
      continue;
    }
    fields.push({ def, el });
    root.append(el);
  }
  if (opts.derived) root.append(derivedEl);
  render();
  return root;
}

export function modal(title, body, buttons = [{ label: 'Close' }]) {
  const root = document.getElementById('modal-root');
  const close = () => clear(root);
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-label': title },
    h('div', { class: 'spread' }, h('h2', null, title), h('button', { class: 'btn small', onclick: close, 'aria-label': 'Close' }, '✕')),
    body,
    h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '14px' } }, buttons.map(b => h('button', { class: 'btn ' + (b.cls || ''), onclick: () => { const r = b.onclick && b.onclick(); if (r !== false) close(); } }, b.label))));
  clear(root).append(h('div', { class: 'modal-bg', onclick: (e) => { if (e.target.classList.contains('modal-bg')) close(); } }, box));
  return close;
}

export function toast(msg, kind = 'info', ms = 4500) {
  const t = h('div', { class: 'toast ' + kind }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), ms);
}
