import { h, clear, n, km, moneyK, paramForm, warnList, modal, toast } from '../dom.js';
import { COMPONENTS } from '../../model/components.js';
import { makeComponent, newId, templateDesign } from '../../model/vehicle.js';
import { analysisFor, releaseDesign, activeDesign, weatherFor } from '../../model/game.js';
import { drawBlueprint } from '../../render/blueprint.js';
import { lineChart } from '../../render/charts.js';
import { FlightSim } from '../../physics/flightSim.js';
import { CONTRACTS, SITES } from '../../data/world.js';
import { inclination, azimuthFor } from '../../physics/orbit.js';

const ICON = { payload: '▣', nosecone: '▲', fairing: '⌂', airframe: '▯', avionics: '⌁', recovery: '☂', solidMotor: '▮', liquidEngine: '⏚', tank: '◫', pressurization: '◎', interstage: '═', fins: '◣', rcs: '✣' };

export function renderDesign(root, app) {
  const g = app.g;
  let d = activeDesign(g);
  if (!d) { root.append(h('div', { class: 'panel' }, 'No design. Create one from Headquarters.')); return; }
  const ui = app.ui;
  if (!ui.selComp || !d.stages.some(s => s.components.some(c => c.id === ui.selComp))) ui.selComp = null;
  let an = analysisFor(g, d);

  const left = h('div', { class: 'stack' });
  const center = h('div', { class: 'stack' });
  const right = h('div', { class: 'stack' });
  const cv = h('canvas', { class: 'bp', 'aria-label': 'Vehicle blueprint' });
  const summaryEl = h('div');
  const outEl = h('div', { class: 'stack' });

  const recompute = () => {
    an = analysisFor(g, d);
    drawBlueprint(cv, an, { selected: ui.selComp, height: 620 });
    clear(summaryEl).append(summary(an, d));
    renderOutputs();
    renderTree();
  };

  // ---- left: design list, contract, tree ----
  const treeEl = h('div', { class: 'tree' });
  const renderTree = () => {
    clear(treeEl);
    for (let s = d.stages.length - 1; s >= 0; s--) {
      const st = d.stages[s];
      const box = h('div', { class: 'stage' },
        h('div', { class: 'hd' }, h('b', null, st.name), h('span', { class: 'row' },
          h('button', { class: 'btn small', title: 'Stage settings', onclick: () => { ui.selComp = 'stage:' + st.id; recompute(); } }, '⚙'),
          d.stages.length > 1 ? h('button', { class: 'btn small', title: 'Delete stage', onclick: () => { if (confirm('Delete ' + st.name + '?')) { d.stages.splice(s, 1); app.render(); } } }, '✕') : null)));
      st.components.forEach((c, i) => {
        const r = an.res[c.id];
        const errs = (r?.warnings || []).filter(w => w.lvl === 'error').length, wrn = (r?.warnings || []).filter(w => w.lvl === 'warn').length;
        box.append(h('div', { class: 'comp' + (ui.selComp === c.id ? ' sel' : ''), onclick: () => { ui.selComp = c.id; recompute(); } },
          h('span', null, h('span', { class: 'ico' }, ICON[c.type] || '·'), ' ', COMPONENTS[c.type].label.replace(' (customer-supplied)', '')),
          h('span', { class: 'row', style: { gap: '4px' } },
            errs ? h('span', { class: 'err', title: errs + ' error(s)' }, '●') : wrn ? h('span', { class: 'wrn', title: wrn + ' warning(s)' }, '●') : null,
            h('span', { class: 'sub mono' }, r ? n(r.dryMass + (r.propMass || 0), r.dryMass > 100 ? 0 : 2) + ' kg' : ''),
            h('button', { class: 'btn small', title: 'Move up', onclick: (e) => { e.stopPropagation(); if (i > 0) { st.components.splice(i - 1, 0, st.components.splice(i, 1)[0]); recompute(); } } }, '↑'),
            h('button', { class: 'btn small', title: 'Move down', onclick: (e) => { e.stopPropagation(); if (i < st.components.length - 1) { st.components.splice(i + 1, 0, st.components.splice(i, 1)[0]); recompute(); } } }, '↓'),
            h('button', { class: 'btn small', title: 'Remove', onclick: (e) => { e.stopPropagation(); st.components.splice(i, 1); recompute(); } }, '✕'))));
      });
      const add = h('select', { 'aria-label': 'Add component', onchange: (e) => { if (!e.target.value) return; const c = makeComponent(e.target.value); if (c.type === 'payload') { c.params.mass = d.payloadMass; c.params.length = d.payloadLength; } st.components.push(c); ui.selComp = c.id; recompute(); } },
        h('option', { value: '' }, '+ add component…'), Object.entries(COMPONENTS).map(([k, v]) => h('option', { value: k }, v.label)));
      box.append(h('div', { class: 'comp' }, add));
      treeEl.append(box);
    }
  };

  const designSel = h('select', { onchange: (e) => { g.activeDesignId = e.target.value; ui.selComp = null; app.render(); } }, g.designs.map(x => h('option', { value: x.id, selected: x.id === d.id }, `${x.name} (next rev ${x.rev})`)));
  const contractSel = h('select', { onchange: (e) => {
    const c = CONTRACTS.find(x => x.id === e.target.value);
    d.contractId = c ? c.id : null;
    if (c && c.kind !== 'test') {
      d.payloadMass = c.payloadMass; d.payloadLength = c.payloadLength; d.mission = c.kind === 'orbit' ? 'orbit' : 'suborbital'; d.requireRecovery = !!c.req.recover;
      for (const s of d.stages) for (const x of s.components) if (x.type === 'payload') { x.params.mass = c.payloadMass; x.params.length = c.payloadLength; }
      if (c.site) d.program.site = c.site;
    }
    app.render();
  } }, h('option', { value: '' }, '— no contract (R&D flight) —'), g.contracts.active.map(a => CONTRACTS.find(c => c.id === a.id)).filter(c => c.kind !== 'test').map(c => h('option', { value: c.id, selected: d.contractId === c.id }, c.title)));
  left.append(h('div', { class: 'panel stack' },
    h('h3', null, 'Design office'),
    h('div', { class: 'pf' }, h('div', { class: 'f wide' }, h('label', null, 'Design'), designSel),
      h('div', { class: 'f wide' }, h('label', null, 'Name'), h('input', { value: d.name, onchange: (e) => { d.name = e.target.value; app.refreshTop(); } })),
      h('div', { class: 'f wide' }, h('label', null, 'Contract'), contractSel)),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => { const c = JSON.parse(JSON.stringify(d)); c.id = newId('d'); c.name += ' copy'; c.rev = 'A'; g.designs.push(c); g.activeDesignId = c.id; app.render(); } }, 'Duplicate'),
      h('button', { class: 'btn small', onclick: () => { d.stages.push({ id: newId('s'), name: 'Stage ' + (d.stages.length + 1), diameter: d.stages[d.stages.length - 1].diameter, propLoad: 0, engineCount: 1, components: [] }); app.render(); } }, '+ Stage on top'),
      h('button', { class: 'btn small', onclick: () => { d.stages.unshift({ id: newId('s'), name: 'Booster', diameter: d.stages[0].diameter, propLoad: 0, engineCount: 1, components: [makeComponent('interstage')] }); d.stages.forEach((s, i) => s.name = s.name.startsWith('Stage') ? 'Stage ' + (i + 1) : s.name); app.render(); } }, '+ Stage below'),
      g.designs.length > 1 ? h('button', { class: 'btn small danger', onclick: () => { if (!confirm('Delete design ' + d.name + '?')) return; g.designs = g.designs.filter(x => x !== d); g.activeDesignId = g.designs[0].id; app.render(); } }, 'Delete') : null),
    h('div', { class: 'sub' }, `Mission: ${d.mission}. Payload ${d.payloadMass} kg × ${d.payloadLength} m.`)));
  left.append(h('div', { class: 'panel' }, h('h3', null, 'Vehicle stack (top → bottom)'), treeEl));

  // ---- center ----
  center.append(h('div', { class: 'panel tight' }, cv), h('div', { class: 'panel' }, summaryEl));
  center.append(programPanel(app, d, () => recompute()));

  // ---- right: component editor ----
  const renderOutputs = () => {
    clear(outEl);
    if (ui.selComp && ui.selComp.startsWith('stage:')) {
      const st = d.stages.find(s => 'stage:' + s.id === ui.selComp);
      if (!st) return;
      const defs = [
        { key: 'diameter', label: 'Stage diameter', unit: 'm', type: 'num', min: 0.03, max: 12, step: 0.005 },
        { key: 'propLoad', label: 'Liquid propellant load', unit: 'kg', type: 'num', min: 0, max: 3000000, step: 1, help: 'Split between oxidizer and fuel tanks by the engine mixture ratio.' },
        { key: 'engineCount', label: 'Number of engines', unit: '', type: 'num', min: 1, max: 40, step: 1 },
      ];
      outEl.append(h('div', { class: 'panel stack' }, h('h3', null, st.name + ' settings'), h('input', { value: st.name, onchange: (e) => { st.name = e.target.value; recompute(); } }), paramForm(defs, st, (k, v, commit) => { if (commit) recompute(); else liveUpdate(); })));
      return;
    }
    const c = d.stages.flatMap(s => s.components).find(x => x.id === ui.selComp);
    if (!c) {
      outEl.append(h('div', { class: 'panel stack' }, h('h3', null, 'Design review'), h('div', { class: 'sub' }, 'Select a component to edit it. All design-rule findings:'), warnList(an.warnings)));
      return;
    }
    const def = COMPONENTS[c.type];
    const r = an.res[c.id];
    const form = paramForm(def.params.filter(p => !(def.fixed && c.type === 'payload')), c.params, (k, v, commit) => { if (commit) recompute(); else liveUpdate(); });
    outEl.append(h('div', { class: 'panel stack' },
      h('h3', null, h('span', { class: 'ico' }, ICON[c.type]), def.label),
      c.type === 'payload' ? h('div', { class: 'sub' }, 'Payload mass and size come from the contract.') : form,
      c.type === 'liquidEngine' ? h('button', { class: 'btn small', onclick: () => optimizeOF(c, recompute) }, 'Find O/F for max vacuum Isp') : null));
    outEl.append(h('div', { class: 'panel stack' }, h('h4', null, 'Computed'), r ? h('div', { class: 'kv' }, (r.outputs || []).flatMap(([a, b]) => [h('span', null, a), h('span', null, b)])) : null));
    outEl.append(h('div', { class: 'panel stack' }, h('h4', null, 'Design rules'), warnList(r?.warnings || [])));
    if (c.type === 'liquidEngine' && r?.engine?.ht) {
      const cv2 = h('canvas');
      outEl.append(h('div', { class: 'panel' }, h('h4', null, 'Wall temperature along chamber'), cv2));
      requestAnimationFrame(() => {
        const st = r.engine.ht.stations;
        lineChart(cv2, [{ name: 'Hot wall', data: st.map(s => [s.x * 1000, s.Twg]) }, { name: 'Coolant-side wall', data: st.map(s => [s.x * 1000, s.Twc]) }, { name: 'Coolant', data: st.map(s => [s.x * 1000, s.Tcool]) }], { height: 170, marks: [{ y: r.engine.wallTmax, label: 'material limit' }] });
      });
    }
    if (c.type === 'solidMotor' && r?.motor) {
      const cv2 = h('canvas');
      outEl.append(h('div', { class: 'panel' }, h('h4', null, 'Predicted thrust & pressure (20 °C)'), cv2));
      requestAnimationFrame(() => { const s = r.motor.sim; lineChart(cv2, [{ name: 'Thrust (kN, vac)', data: s.t.map((t, i) => [t, s.fvac[i] / 1000]) }, { name: 'Pc (MPa)', data: s.t.map((t, i) => [t, s.pc[i] / 1e6]) }], { height: 170, ymin: 0 }); });
    }
  };
  let liveTimer = null;
  const liveUpdate = () => { clearTimeout(liveTimer); liveTimer = setTimeout(() => { an = analysisFor(g, d); drawBlueprint(cv, an, { selected: ui.selComp, height: 620 }); clear(summaryEl).append(summary(an, d)); }, 60); };
  right.append(outEl);

  root.append(h('div', { class: 'grid design-grid' }, left, center, right));
  requestAnimationFrame(recompute);
}

function summary(an, d) {
  const errs = an.warnings.filter(w => w.lvl === 'error').length, wr = an.warnings.filter(w => w.lvl === 'warn').length;
  return h('div', { class: 'stack' },
    h('div', { class: 'spread' }, h('h3', null, 'Vehicle summary'), h('span', { class: 'row' }, h('span', { class: 'chip ' + (errs ? 'bad' : 'good') }, `${errs} errors`), h('span', { class: 'chip ' + (wr ? 'warn' : '') }, `${wr} warnings`))),
    h('div', { class: 'kv', style: { gridTemplateColumns: 'repeat(4, minmax(0,1fr) auto)' } },
      h('span', null, 'Liftoff mass'), h('span', null, n(an.mass, an.mass > 100 ? 0 : 2) + ' kg'),
      h('span', null, 'Length'), h('span', null, n(an.length, 2) + ' m'),
      h('span', null, 'Ideal Δv (total)'), h('span', null, n(an.dvTotal, 0) + ' m/s'),
      h('span', null, 'Static margin'), h('span', null, n(an.margin, 2) + ' cal')),
    h('table', { class: 't' }, h('thead', null, h('tr', null, ['Stage', 'Mass', 'Propellant', 'Dry', 'Isp (avg)', 'Burn', 'T/W', 'Δv'].map(x => h('th', null, x)))),
      h('tbody', null, an.perf.map(p => h('tr', null, h('td', null, d.stages[p.stage].name), h('td', { class: 'num' }, n(p.m0, 0)), h('td', { class: 'num' }, n(p.prop, 1)), h('td', { class: 'num' }, n(p.dry, 1)), h('td', { class: 'num' }, n(p.isp, 0) + ' s'), h('td', { class: 'num' }, n(p.burn, 1) + ' s'), h('td', { class: 'num' }, n(p.stage === 0 ? p.twSL : p.twVac, 2)), h('td', { class: 'num' }, n(p.dv, 0)))))),
    h('div', { class: 'sub' }, d.mission === 'orbit' ? 'LEO needs ≈ 9.3–9.8 km/s of Δv including ≈ 1.5–2 km/s gravity & drag losses (less ~0.4 km/s with an eastward launch).' : 'Ideal Δv ignores gravity and drag losses — use the trajectory simulation for real apogee.'),
  );
}

function optimizeOF(c, done) {
  const def = COMPONENTS.liquidEngine;
  let best = c.params.of, bestIsp = 0;
  const pairRange = { 'LOX/RP-1': [1.6, 3.4], 'LOX/LH2': [3, 8], 'LOX/CH4': [2.4, 4], 'LOX/Ethanol': [0.9, 2.1], 'NTO/MMH': [1.2, 2.5], 'NTO/A50': [1.4, 2.6] }[c.params.pair];
  for (let of = pairRange[0]; of <= pairRange[1]; of += 0.05) {
    const r = def.compute({ ...c, params: { ...c.params, of } }, { D: 1, stage: { engineCount: 1, propLoad: 0, components: [] }, isBottom: false });
    if (r.engine.ispVac > bestIsp) { bestIsp = r.engine.ispVac; best = of; }
  }
  c.params.of = +best.toFixed(2);
  toast(`Max vacuum Isp ${bestIsp.toFixed(1)} s at O/F ${best.toFixed(2)}. (Denser, more oxidizer-rich mixtures often win on total vehicle performance.)`);
  done();
}

function programPanel(app, d, onChange) {
  const g = app.g;
  const P = d.program;
  const site = SITES[P.site] || SITES.desert;
  const defs = d.mission === 'orbit' ? [
    { key: 'site', label: 'Launch site', type: 'sel', options: Object.entries(SITES).filter(([, s]) => !s.suborbitalOnly).map(([k, s]) => [k, `${s.name} (${s.lat}°)`]) },
    { key: 'azimuth', label: 'Launch azimuth', unit: '° from north', type: 'num', min: 0, max: 360, step: 0.5 },
    { key: 'targetAlt', label: 'Target orbit altitude', unit: 'm', type: 'num', min: 150000, max: 2000000, step: 1000 },
    { key: 'insertion', label: 'Insertion', type: 'sel', options: [['direct', 'Direct (single burn)'], ['parking', 'Parking orbit + Hohmann (needs restarts + ullage)']] },
    { key: 'parkingAlt', label: 'Parking orbit altitude', unit: 'm', type: 'num', min: 150000, max: 400000, step: 1000, show: (p) => p.insertion === 'parking' },
    { key: 'kickSpeed', label: 'Pitch-over begins at', unit: 'm/s', type: 'num', min: 20, max: 200, step: 1 },
    { key: 'kickAngle', label: 'Pitch kick angle', unit: '°', type: 'num', min: 0.2, max: 10, step: 0.1 },
    { key: 'maxQ', label: 'Max-Q throttle limit', unit: 'Pa', type: 'num', min: 15000, max: 100000, step: 1000 },
    { key: 'maxG', label: 'Acceleration limit (throttle / engine-out)', unit: 'g', type: 'num', min: 2, max: 10, step: 0.1 },
    { key: 'stagingCoast', label: 'Coast between MECO and separation', unit: 's', type: 'num', min: 0, max: 30, step: 0.5 },
    { key: 'ignitionDelay', label: 'Separation → upper ignition', unit: 's', type: 'num', min: 0, max: 30, step: 0.5 },
  ] : [
    { key: 'site', label: 'Launch site', type: 'sel', options: Object.entries(SITES).map(([k, s]) => [k, `${s.name} (${s.lat}°)`]) },
    { key: 'railLength', label: 'Launch rail length', unit: 'm', type: 'num', min: 1, max: 30, step: 0.5, help: 'Longer rails give more speed (fin authority) before free flight.' },
    { key: 'elevation', label: 'Rail elevation', unit: '°', type: 'num', min: 80, max: 90, step: 0.5, help: 'Range safety usually requires a few degrees away from vertical, away from the pad.' },
    { key: 'azimuth', label: 'Launch azimuth', unit: '°', type: 'num', min: 0, max: 360, step: 1 },
    { key: 'stagingCoast', label: 'Staging coast', unit: 's', type: 'num', min: 0, max: 30, step: 0.5 },
  ];
  const incl = inclination(site.lat, P.azimuth ?? 90);
  const info = h('div', { class: 'sub' });
  const upd = () => {
    const s = SITES[P.site];
    const inc = inclination(s.lat, P.azimuth ?? 90);
    const ok = (P.azimuth >= s.azRange[0] && P.azimuth <= s.azRange[1]) || s.azRange[1] - s.azRange[0] >= 360;
    info.textContent = `Inclination ${inc.toFixed(2)}° · Earth-rotation boost ${(465 * Math.cos(s.lat * Math.PI / 180) * Math.sin((P.azimuth ?? 90) * Math.PI / 180)).toFixed(0)} m/s · allowed azimuths ${s.azRange.join('–')}° ${ok ? '' : '⚠ OUTSIDE RANGE SAFETY LIMITS'}`;
  };
  upd();
  return h('div', { class: 'panel stack' },
    h('div', { class: 'spread' }, h('h3', null, 'Flight program'), h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => runTrajectory(app, d) }, 'Run trajectory simulation (ideal hardware)'),
      h('button', { class: 'btn primary', onclick: () => { const r = releaseDesign(g, d); if (r.error) { toast(r.error, 'fail'); return; } toast(`${r.build.name} released to the shop: ${r.build.parts.length} parts`, 'success'); app.go('fab'); } }, `Release Rev ${d.rev} for fabrication`))),
    paramForm(defs, P, () => { upd(); }),
    info,
    d.mission === 'orbit' ? h('div', { class: 'row' }, h('span', { class: 'sub' }, 'Target inclination helper:'), h('input', { type: 'number', step: 0.1, placeholder: 'incl °', style: { width: '90px' }, onchange: (e) => { const az = azimuthFor(SITES[P.site].lat, +e.target.value); if (az === null) toast('That inclination is lower than the site latitude — impossible without a dogleg/plane change.', 'warn'); else { const s = SITES[P.site]; P.azimuth = +(s.azRange[0] > 120 ? 180 - az : az).toFixed(2); app.render(); } } })) : null,
  );
}

function runTrajectory(app, d) {
  const g = app.g;
  const an = analysisFor(g, d);
  if (an.errors) { toast('Fix design errors first.', 'warn'); }
  const site = SITES[d.program.site];
  const wx = { surface: 3, gust: 2, jet: 25, jetAlt: 11500, strato: 8, meso: 25, surfaceDirTo: d.program.azimuth + 180, jetDirTo: 90, turbScale: 0.5, tempC: 20 };
  const sim = new FlightSim({ design: d, analysis: an, hazards: [], site, weather: wx, program: d.program, seed: 11 });
  const t0 = performance.now();
  while (!sim.finished && sim.t < 20000 && performance.now() - t0 < 4000) sim.advance(10);
  const s = sim.summary();
  const tl = sim.tlm;
  const c1 = h('canvas'), c2 = h('canvas'), c3 = h('canvas');
  modal('Trajectory simulation — ideal hardware, light wind', h('div', { class: 'stack' },
    h('div', { class: 'kv', style: { gridTemplateColumns: 'repeat(3, minmax(0,1fr) auto)' } },
      h('span', null, 'Outcome'), h('span', null, s.result),
      h('span', null, 'Apogee'), h('span', null, km(s.apogee)),
      h('span', null, 'Max Mach'), h('span', null, n(s.maxMach, 2)),
      h('span', null, 'Max-Q'), h('span', null, n(s.maxQ / 1000, 1) + ' kPa'),
      h('span', null, 'Max accel'), h('span', null, n(s.maxG, 1) + ' g'),
      h('span', null, 'Min static margin'), h('span', null, s.minMargin !== undefined ? n(s.minMargin, 2) + ' cal @M' + n(s.minMarginMach, 1) : '—'),
      h('span', null, 'Flutter margin'), h('span', null, s.flutterMargin ? n(s.flutterMargin, 2) + '×' : '—'),
      h('span', null, 'Max nose temp'), h('span', null, s.maxTipT ? n(s.maxTipT, 0) + ' K' : '—'),
      h('span', null, 'Orbit'), h('span', null, s.orbit ? `${n(s.orbit.periAlt / 1000, 0)} × ${n(s.orbit.apoAlt / 1000, 0)} km` : '—')),
    h('div', { class: 'warnings' }, s.events.filter(e => e.kind !== 'info').slice(0, 10).map(e => h('div', { class: 'w ' + e.kind }, `T+${n(e.t - (sim.t0 || 0), 1)} s — ${e.text}`))),
    c1, c2, c3));
  requestAnimationFrame(() => {
    lineChart(c1, [{ name: 'Altitude (km)', data: tl.map(r => [r.t, r.alt / 1000]) }], { height: 160, title: 'Altitude (km) vs time (s)' });
    lineChart(c2, [{ name: 'Velocity (m/s)', data: tl.map(r => [r.t, r.vrel]) }, { name: 'Dyn. pressure (kPa×10)', data: tl.map(r => [r.t, r.q / 100]) }], { height: 160, title: 'Air-relative velocity & dynamic pressure' });
    lineChart(c3, [{ name: 'Accel (g)', data: tl.map(r => [r.t, r.acc]) }, { name: 'Pitch (°/10)', data: tl.map(r => [r.t, r.pitch / 10]) }], { height: 160, title: 'Acceleration and pitch' });
  });
}
