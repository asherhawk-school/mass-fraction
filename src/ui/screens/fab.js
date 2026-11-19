import { h, clear, n, money, moneyK, paramForm, modal, toast } from '../dom.js';
import { STEP_KINDS } from '../../data/processes.js';
import { DEFECTS, NDI } from '../../data/defects.js';
import { FACILITIES } from '../../data/world.js';
import { MATERIALS } from '../../data/materials.js';
import { stepEstimate, stepContext, windowsFor, executeStep, qualifyProcedure, defaultStepParams, openNCRs, disposition, autoRunAll, autoRunStep, buildStatus, integrate, dateStr } from '../../model/game.js';

export function renderFab(root, app) {
  const g = app.g;
  const b = g.builds.find(x => x.id === g.activeBuildId);
  if (!b) { root.append(h('div', { class: 'panel' }, h('h3', null, 'No hardware in work'), h('p', { class: 'sub' }, 'Release a design for fabrication from the Design office.'), h('button', { class: 'btn primary', onclick: () => app.go('design') }, 'Go to design'))); return; }
  const ui = app.ui;
  const st = buildStatus(b);
  const ncrs = openNCRs(b);
  const parts = b.parts;
  if (!ui.selPart || !parts.some(p => p.uid === ui.selPart)) ui.selPart = (parts.find(p => p.status !== 'complete' && p.status !== 'scrapped' && p.status !== 'consumed') || parts[0]).uid;
  const part = parts.find(p => p.uid === ui.selPart);

  const head = h('div', { class: 'panel' },
    h('div', { class: 'spread' },
      h('div', null, h('h2', null, b.name), h('div', { class: 'sub' }, `${st.done}/${st.total} flight parts complete · ${ncrs.length} open NCR · status: ${b.status}`)),
      h('div', { class: 'row' },
        h('select', { onchange: (e) => { g.activeBuildId = e.target.value; ui.selPart = null; app.render(); } }, g.builds.map(x => h('option', { value: x.id, selected: x.id === b.id }, x.name + (x.status === 'flown' ? ' (flown)' : '')))),
        h('button', { class: 'btn', disabled: b.status !== 'fabrication', title: 'Runs every open traveler with mid-window parameters (qualified windows if you have them, otherwise textbook), interleaving parts so waits overlap. Stops when an inspection finds a defect.', onclick: () => { const k = autoRunAll(g, b); toast(`Shop ran ${k} steps.`); app.render(); } }, 'Shop scheduler: run all travelers'),
        h('button', { class: 'btn primary', disabled: !st.ready || b.integrated, onclick: () => { const r = integrate(g, b); if (r.error) toast(r.error, 'fail'); else if (r.findings) { toast(`Integration found problems: ${r.findings.join('; ')}`, 'warn', 8000); } else { toast('Vehicle integrated and ready to ship!', 'success'); } app.render(); } }, b.integrated ? 'Integrated ✓' : 'Integrate vehicle'),
        b.integrated ? h('button', { class: 'btn primary', onclick: () => app.go('launch') }, 'To launch ops →') : null)),
    h('div', { class: 'progress', style: { marginTop: '8px' } }, h('i', { style: { width: (st.done / Math.max(1, st.total) * 100) + '%' } })));

  // NCR board
  const ncrPanel = ncrs.length ? h('div', { class: 'panel stack' },
    h('h3', null, 'Material Review Board — open nonconformances'),
    h('div', { class: 'sub' }, 'Every detected defect needs a disposition. "Use-as-is" accepts the risk; it stays in the hardware and can fail in flight.'),
    h('table', { class: 't' }, h('tbody', null, ncrs.map(({ part: p, d }) => h('tr', null,
      h('td', null, h('b', null, DEFECTS[d.type]?.name), h('div', { class: 'sub' }, `${p.name} · severity ${(d.severity * 100).toFixed(0)}% · found by ${d.foundBy || 'inspection'}`), h('div', { class: 'sub' }, DEFECTS[d.type]?.desc), d.origin ? h('div', { class: 'sub' }, `Origin: ${d.origin.step}${d.origin.detail ? ' — ' + d.origin.detail : ''}`) : null),
      h('td', { class: 'num' }, h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        ['crack', 'lackOfFusion', 'porosity', 'burnThrough', 'mismatch', 'hazSoftening'].includes(d.type) ? h('button', { class: 'btn small', onclick: () => { const r = disposition(g, b, p, d.id, 'repair'); if (r?.error) toast(r.error, 'warn'); app.render(); } }, 'Weld repair') : null,
        h('button', { class: 'btn small', onclick: () => { disposition(g, b, p, d.id, 'rework'); app.render(); } }, 'Rework'),
        h('button', { class: 'btn small', onclick: () => { disposition(g, b, p, d.id, 'useAsIs'); app.render(); } }, 'Use as is'),
        h('button', { class: 'btn small danger', onclick: () => { disposition(g, b, p, d.id, 'scrap'); app.render(); } }, 'Scrap')))))))) : null;

  // parts list
  const list = h('div', { class: 'partlist' });
  let lastComp = null;
  for (const p of parts) {
    if (p.compId !== lastComp) { lastComp = p.compId; list.append(h('h4', { style: { marginTop: '10px' } }, `Stage ${p.stage + 1} · ${p.compType}`)); }
    const done = p.steps.filter(s => s.status === 'done').length;
    const found = p.defects.filter(d => d.detected && !d.fixed && !d.removed).length;
    const waiting = (p.readyDay || 0) > g.day && p.status !== 'complete';
    list.append(h('div', { class: 'p' + (p.uid === ui.selPart ? ' sel' : ''), onclick: () => { ui.selPart = p.uid; app.render(); } },
      h('div', { class: 'spread' }, h('span', null, p.name), h('span', { class: 'row', style: { gap: '4px' } },
        p.status === 'complete' ? h('span', { class: 'chip good' }, 'done') : p.status === 'scrapped' ? h('span', { class: 'chip bad' }, 'scrapped') : p.status === 'consumed' ? h('span', { class: 'chip' }, 'tested') : waiting ? h('span', { class: 'chip warn', title: 'Waiting for material, cure, or vendor' }, 'until ' + dateStr(g, p.readyDay).slice(5)) : null,
        found ? h('span', { class: 'chip bad' }, found + ' NCR') : null)),
      h('div', { class: 'progress' }, h('i', { style: { width: (done / p.steps.length * 100) + '%' } }))));
  }

  const trav = travelerPanel(app, b, part);
  root.append(h('div', { class: 'stack' }, head, ncrPanel, h('div', { class: 'grid fab-grid' }, h('div', { class: 'panel scroll', style: { maxHeight: 'calc(100vh - 200px)' } }, list), trav)));
}

function travelerPanel(app, b, part) {
  const g = app.g;
  const box = h('div', { class: 'panel stack' });
  const m = MATERIALS[part.data.mat];
  box.append(h('div', { class: 'spread' },
    h('div', null, h('h2', null, part.name), h('div', { class: 'sub' }, [m ? m.name : null, part.data.mass ? `${n(part.data.mass, part.data.mass > 10 ? 1 : 3)} kg` : null, part.data.thk ? `wall ${n(part.data.thk, 2)} mm` : null, part.lot?.grade ? `lot strength ${(part.lot.factor * 100).toFixed(1)}%` : null, part.proof ? `proof-tested ${part.proof.toFixed(2)}× MEOP` : null].filter(Boolean).join(' · '))),
    part.status !== 'complete' && part.status !== 'scrapped' && part.status !== 'consumed' ? h('button', { class: 'btn small', onclick: () => { let k = 0; while (part.cur < part.steps.length && part.status !== 'scrapped' && k++ < 40) { const r = autoRunStep(g, b, part); if (r.found?.length) break; } app.render(); } }, 'Auto-run this traveler') : null));
  if ((part.readyDay || 0) > g.day && part.status !== 'complete') box.append(h('div', { class: 'w warn' }, `Waiting on material/vendor/cure until ${dateStr(g, part.readyDay)}. Work on other parts meanwhile — executing the next step here will wait.`));
  const found = part.defects.filter(d => d.detected);
  if (found.length) box.append(h('div', { class: 'stack' }, h('h4', null, 'Findings on this part'), found.map(d => h('div', { class: 'w ' + (d.fixed || d.removed ? 'success' : d.disposition === 'useAsIs' ? 'warn' : 'error') }, `${DEFECTS[d.type]?.name} (${(d.severity * 100).toFixed(0)}%) — ${d.fixed || d.removed ? (d.disposition || 'corrected') : d.disposition === 'useAsIs' ? 'accepted use-as-is' : 'OPEN'}${d.foundBy ? ' · found by ' + d.foundBy : ''}${d.note ? ' · ' + d.note : ''}`))));
  const steps = h('div', { class: 'steps' });
  part.steps.forEach((s, i) => {
    const kd = STEP_KINDS[s.kind];
    const isCur = i === part.cur && part.status !== 'scrapped' && part.status !== 'consumed';
    const el = h('div', { class: 'step' + (isCur ? ' cur' : '') + (s.status === 'done' ? ' done' : '') },
      h('div', { class: 'sh' }, h('span', { class: 'sn' }, s.label), s.status === 'done' ? h('span', { class: 'chip good' }, `done ${moneyK(s.result.cost)}`) : h('span', { class: 'chip' }, kd.facility ? (g.facilities[kd.facility] ? FACILITIES[kd.facility].name : 'outsourced: ' + FACILITIES[kd.facility].name) : 'any')));
    if (s.status === 'done' && s.result) {
      el.append(h('div', { class: 'notes' }, s.result.notes.join(' '), s.result.found.length ? h('b', { style: { color: 'var(--bad)' } }, ` ${s.result.found.length} finding(s).`) : null));
      if (s.params && kd.kind === 'param') el.append(h('div', { class: 'notes mono' }, Object.entries(s.params).map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toFixed(3) : v}`).join('  ')));
    }
    if (isCur) el.append(currentStep(app, b, part, i));
    steps.append(el);
  });
  box.append(steps);
  return box;
}

function currentStep(app, b, part, i) {
  const g = app.g;
  const s = part.steps[i];
  const kd = STEP_KINDS[s.kind];
  const ctx = stepContext(g, part, s);
  const pr = (app.ui.stepParams && app.ui.stepParams.uid === part.uid + i) ? app.ui.stepParams.pr : defaultStepParams(kd, ctx);
  app.ui.stepParams = { uid: part.uid + i, pr };
  const wrap = h('div', { class: 'stack', style: { marginTop: '8px' } });
  wrap.append(h('div', { class: 'sub' }, kd.desc || ''));
  const estEl = h('div', { class: 'sub mono' });
  const updEst = () => { const e = stepEstimate(g, part, i, pr); estEl.textContent = `Est. cost ${money(e.cost)} · labor ${n(e.hours, 1)} h · ${n(e.days, 1)} shop-days${e.wait ? ` + ${n(e.wait, 0)} days waiting (lead/cure/vendor)` : ''}${e.owned ? '' : ' · OUTSOURCED'}`; };
  let defs = kd.params(ctx);
  if (kd.kind === 'inspect') {
    defs = (ctx.methods || []).map(mth => ({ key: mth, label: `${NDI[mth].name}${NDI[mth].facility && !g.facilities[NDI[mth].facility] ? ' (outsourced)' : ''}`, type: 'bool', help: 'Finds: ' + Object.keys(NDI[mth].pod).map(t => DEFECTS[t]?.name).join(', ') }));
    for (const d of defs) if (pr[d.key] === undefined) pr[d.key] = d.key === 'visual';
  }
  let windows = null, wq = null;
  if (kd.kind === 'param' && kd.window) {
    wq = windowsFor(g, part, s);
    const tb = kd.textbook ? kd.textbook(ctx) : {};
    const tw = kd.window(ctx);
    windows = {};
    for (const k of Object.keys({ ...tb, ...tw })) windows[k] = { tb: tb[k], q: wq.qualified ? tw[k] : null };
  }
  const derived = kd.derive ? (v) => Object.entries(kd.derive(v, ctx)).map(([k, val]) => { const lbl = kd.derivedLabels?.[k] || [k, '']; const w = windows?.[k]; return [lbl[0], `${n(val, val > 10 ? 0 : 3)} ${lbl[1]}${w ? `  (textbook ${w.tb ? w.tb.map(x => n(x, x > 10 ? 0 : 2)).join('–') : '?'}${w.q ? `; qualified ${w.q.map(x => n(x, x > 10 ? 0 : 2)).join('–')}` : ''})` : ''}`]; }) : null;
  wrap.append(paramForm(defs, pr, () => updEst(), { windows, derived }));
  if (windows && Object.keys(windows).some(k => !defs.some(d => d.key === k) && !(kd.derive && kd.derive(pr, ctx)[k] !== undefined))) {
    const extra = Object.entries(windows).filter(([k]) => !defs.some(d => d.key === k) && !(kd.derive && kd.derive(pr, ctx)[k] !== undefined));
    if (extra.length) wrap.append(h('div', { class: 'sub' }, extra.map(([k, w]) => `${k}: textbook ${w.tb ? w.tb.join('–') : '?'}`).join(' · ')));
  }
  updEst();
  wrap.append(estEl);
  wrap.append(h('div', { class: 'row' },
    h('button', { class: 'btn primary', onclick: () => {
      const r = executeStep(g, b, part, { ...pr });
      app.ui.stepParams = null;
      if (r.error) toast(r.error, 'fail');
      else if (r.destroyed) toast(`${part.name}: ${r.notes.join(' ')}`, 'fail', 9000);
      else if (r.found.length) toast(`${r.found.length} nonconformance(s) found on ${part.name} — see the Material Review Board.`, 'warn', 7000);
      app.render();
    } }, kd.kind === 'inspect' ? 'Inspect' : kd.kind === 'procure' ? 'Place order' : 'Execute step'),
    wq && !wq.qualified ? h('button', { class: 'btn', title: 'Weld/cure/print test coupons with a parameter matrix, then section and pull-test them. Reveals the true process window for this material/thickness.', onclick: () => { qualifyProcedure(g, part, i); app.render(); } }, `Qualify procedure (coupons) ~${moneyK(2500 + 760 + (ctx.thk || 3) * 150)}`) : null,
    wq && wq.qualified ? h('span', { class: 'chip good' }, 'Procedure qualified — green band is the true window') : null,
    h('button', { class: 'btn small', onclick: () => { const r = autoRunStep(g, b, part); if (r.found?.length) toast(`${r.found.length} finding(s)`, 'warn'); app.render(); } }, 'Use defaults')));
  return wrap;
}
