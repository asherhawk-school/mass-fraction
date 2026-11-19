import { h, clear, n, km, money, moneyK, toast, modal } from '../dom.js';
import { SITES, CONTRACTS } from '../../data/world.js';
import { analysisFor, flightModel, weatherFor, launchCommitCriteria, applyLicense, licenseStatus, advanceDays, spend, dateStr, evaluateContract, completeContract, note, rngOf, isSandbox } from '../../model/game.js';
import { FlightSim } from '../../physics/flightSim.js';
import { FlightView } from '../../render/flightView.js';
import { lineChart } from '../../render/charts.js';
import { makeRng } from '../../physics/rng.js';
import { maxShear } from '../../physics/wind.js';
import { inclination } from '../../physics/orbit.js';
import { DEG } from '../../physics/constants.js';

export function renderLaunch(root, app) {
  const g = app.g;
  const L = (app.ui.launch ||= { phase: 'prep' });
  const b = g.builds.find(x => x.id === (L.buildId || g.activeBuildId));
  if (L.phase === 'flight' && L.sim) return renderFlight(root, app, L);
  if (L.phase === 'post') return renderPost(root, app, L);
  if (!b || b.status !== 'ready') {
    root.append(h('div', { class: 'panel stack' }, h('h3', null, 'Launch operations'), h('p', { class: 'sub' }, b ? `${b.name} is not ready (status: ${b.status}). Finish fabrication, clear all NCRs and integrate the vehicle.` : 'No vehicle selected.'),
      h('div', { class: 'row' }, g.builds.filter(x => x.status === 'ready').map(x => h('button', { class: 'btn', onclick: () => { g.activeBuildId = x.id; app.render(); } }, 'Select ' + x.name)), h('button', { class: 'btn', onclick: () => app.go('fab') }, 'Go to fabrication'))));
    return;
  }
  L.buildId = b.id;
  if (L.phase === 'countdown') return renderCountdown(root, app, L, b);
  renderPrep(root, app, L, b);
}

function renderPrep(root, app, L, b) {
  const g = app.g;
  const d = b.design;
  const P = d.program;
  if (!L.site) L.site = P.site;
  const site = SITES[L.site];
  const an = analysisFor(g, d);
  const lic = licenseStatus(g, L.site);
  const transport = L.site === 'desert' ? 3 : 12;
  const earliest = Math.ceil(Math.max(g.day + transport, lic?.ok ? lic.grantDay : g.day + 9999));
  const contract = d.contractId ? CONTRACTS.find(c => c.id === d.contractId) : null;
  const siteOK = !(d.mission === 'orbit' && site.suborbitalOnly);
  const left = h('div', { class: 'panel stack' },
    h('h2', null, 'Launch campaign — ' + b.name),
    contract ? h('div', { class: 'sub' }, `Contract: ${contract.title} — ${contract.desc}`) : h('div', { class: 'sub' }, 'R&D flight (no contract).'),
    h('div', { class: 'pf' }, h('div', { class: 'f wide' }, h('label', null, 'Launch site'), h('select', { onchange: (e) => { L.site = e.target.value; app.render(); } }, Object.entries(SITES).map(([k, s]) => h('option', { value: k, selected: k === L.site }, `${s.name} — ${s.lat}°N`))))),
    h('div', { class: 'sub' }, site.desc),
    siteOK ? null : h('div', { class: 'w error' }, 'This range does not support orbital launches.'),
    h('div', { class: 'kv' }, h('span', null, 'Launch azimuth'), h('span', null, n(P.azimuth, 1) + '°'), h('span', null, 'Resulting inclination'), h('span', null, n(inclination(site.lat, P.azimuth), 2) + '°'), h('span', null, 'Pad / range fee'), h('span', null, moneyK(site.padFee)), h('span', null, 'Transport to site'), h('span', null, transport + ' days')),
    (P.azimuth < site.azRange[0] || P.azimuth > site.azRange[1]) && site.azRange[1] - site.azRange[0] < 360 ? h('div', { class: 'w error' }, `Azimuth ${P.azimuth}° is outside this range's safety corridor (${site.azRange.join('–')}°). Change it in the design's flight program.`) : null,
    h('h4', null, 'Launch license'),
    !lic ? h('div', { class: 'stack' }, h('div', { class: 'sub' }, `Requires a flight-safety analysis showing expected casualties Ec < 1×10⁻⁴. Processing ~${site.licenseDays} days, fee ${moneyK(site.licenseCost)}.`), h('button', { class: 'btn', onclick: () => { applyLicense(g, L.site, an); app.render(); } }, 'File license application'))
      : lic.ok ? h('div', { class: 'w ' + (lic.grantDay <= g.day ? 'success' : 'info') }, lic.grantDay <= g.day ? `Licensed (Ec ${lic.Ec.toExponential(1)}).` : `Pending — expected ${dateStr(g, lic.grantDay)}. Ec ${lic.Ec.toExponential(1)}.`)
        : h('div', { class: 'stack' }, h('div', { class: 'w error' }, `Denied — Ec ${lic.Ec.toExponential(1)} ≥ 1e-4.`), h('button', { class: 'btn small', onclick: () => { delete g.licenses[L.site]; app.render(); } }, 'Re-apply after design change')),
  );
  // forecast
  const rows = [];
  if (lic?.ok && siteOK) {
    for (let k = 0; k < 10; k++) {
      const day = earliest + k;
      const wx = weatherFor(g, L.site, day);
      // forecast error grows with lead time
      const r = makeRng((g.seed + day * 31 + 7) >>> 0);
      const lead = day - g.day;
      const f = { ...wx, surface: Math.max(0, wx.surface + r.gauss(0, 0.06 * lead)), gust: Math.max(0, wx.gust + r.gauss(0, 0.05 * lead)), jet: Math.max(0, wx.jet + r.gauss(0, 0.4 * lead)), tempC: wx.tempC + r.gauss(0, 0.15 * lead), lightning: r.chance(0.12 * Math.min(1, lead / 10)) ? !wx.lightning : wx.lightning, precip: r.chance(0.1 * Math.min(1, lead / 10)) ? !wx.precip : wx.precip };
      const lcc = launchCommitCriteria(d, an, f, L.site, P.azimuth);
      const pov = Math.min(95, Math.round(lcc.rules.filter(x => !x.ok).length * 40 + 5 + lead * 0.9));
      rows.push(h('tr', null, h('td', { class: 'mono' }, dateStr(g, day)), h('td', { class: 'num' }, n(f.surface + f.gust, 1)), h('td', { class: 'num' }, n(maxShear(f, P.azimuth).shear, 1)), h('td', { class: 'num' }, n(f.tempC, 0)), h('td', null, f.lightning ? '⚡' : ''), h('td', null, f.precip ? '☔' : ''), h('td', { class: 'num' }, `${pov}%`),
        h('td', null, h('button', { class: 'btn small ' + (lcc.go ? 'primary' : ''), onclick: () => startCampaign(app, L, b, day) }, 'Launch this day'))));
    }
  }
  const right = h('div', { class: 'panel stack' },
    h('h3', null, '45th-Weather-Squadron-style forecast'),
    h('div', { class: 'sub' }, 'Probability of violating launch commit criteria. Forecasts degrade with lead time — the real weather on launch day decides.'),
    rows.length ? h('table', { class: 't' }, h('thead', null, h('tr', null, ['Date', 'Peak wind m/s', 'Shear m/s/km', '°C', 'Ltg', 'Rain', 'P(violate)', ''].map(x => h('th', null, x)))), h('tbody', null, rows)) : h('div', { class: 'sub' }, 'Get a license for this site first.'));
  root.append(h('div', { class: 'grid cols-2' }, left, right));
}

function startCampaign(app, L, b, day) {
  const g = app.g;
  const site = SITES[L.site];
  spend(g, site.padFee, `Range services: ${site.name}`);
  advanceDays(g, Math.max(0, day - g.day));
  L.phase = 'countdown'; L.day = day; L.scrubs = 0;
  note(g, `${b.name} arrived at ${site.name}. Launch campaign begins.`);
  app.render();
}

function renderCountdown(root, app, L, b) {
  const g = app.g;
  const d = b.design;
  const site = SITES[L.site];
  const wx = weatherFor(g, L.site, Math.floor(g.day) + (L.scrubs || 0) * 0.37);
  L.wx = wx;
  const { an } = flightModel(g, b);
  const lcc = launchCommitCriteria(d, an, wx, L.site, d.program.azimuth);
  const timeline = h('div', { class: 'events' });
  const clock = h('div', { class: 'countdown' }, 'T− 02:00:00');
  const cryo = an.placed.some(p => p.r.tank?.cryo);
  const steps = [
    [7200, 'Range and vehicle power-up; telemetry link check'],
    ...(cryo ? [[5400, 'Begin LOX slow-fill (tank chill-down)'], [4800, 'LOX fast-fill; boil-off venting'], [2400, 'Propellant topping & replenish']] : [[5400, 'Load storable propellants / install igniter']]),
    [1800, 'Pressurant bottles to flight pressure'],
    [900, 'Weather & range poll: GO'],
    [600, 'Flight termination system armed'],
    [240, 'Vehicle on internal power'],
    [60, 'Terminal count — autosequence start'],
    [10, cryo ? 'Engine chill-down complete' : 'Final arming'],
    [0, d.stages[0].components.some(c => c.type === 'liquidEngine') ? 'Ignition sequence start — hold-down' : 'Ignition'],
  ];
  const left = h('div', { class: 'panel stack' },
    h('h2', null, `${site.name} — ${dateStr(g)}`),
    h('h4', null, 'Launch commit criteria'),
    h('table', { class: 't' }, h('tbody', null, lcc.rules.map(r => h('tr', null, h('td', null, r.rule), h('td', { class: 'mono' }, r.value), h('td', { class: 'sub' }, r.limit), h('td', null, h('span', { class: 'chip ' + (r.ok ? 'good' : 'bad') }, r.ok ? 'GO' : 'NO-GO')))))),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', disabled: !lcc.go, onclick: () => runCount() }, lcc.go ? 'Begin terminal count' : 'Weather NO-GO'),
      h('button', { class: 'btn', onclick: () => { L.scrubs = (L.scrubs || 0) + 1; spend(g, site.padFee * 0.08 + (cryo ? an.mass * 0.15 : 0), 'Scrub: range & propellant costs'); advanceDays(g, 1); note(g, 'Launch scrubbed, 24-hour recycle.', 'warn'); app.render(); } }, 'Scrub — 24 h recycle'),
      h('button', { class: 'btn', onclick: () => { L.phase = 'prep'; app.render(); } }, 'Stand down')));
  const right = h('div', { class: 'panel stack' }, clock, timeline);
  root.append(h('div', { class: 'grid cols-2' }, left, right));

  function runCount() {
    const { hazards } = flightModel(g, b);
    const { r, save } = rngOf(g);
    let i = 0;
    const tick = () => {
      if (i >= steps.length) { save(); startFlight(app, L, b); return; }
      const [t, text] = steps[i++];
      const hh = Math.floor(t / 3600), mm = Math.floor(t % 3600 / 60), ss = t % 60;
      clock.textContent = `T− ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
      timeline.append(h('div', null, h('span', { class: 't' }, clock.textContent), text));
      if (text.startsWith('Pressurant')) {
        const cp = hazards.find(x => x.kind === 'copv');
        if (cp && r.chance(cp.prob)) {
          timeline.append(h('div', { class: 'fail' }, 'ANOMALY: pressurant bottle ruptured during pressurization — vehicle lost on the pad.'));
          save();
          finishFlight(app, L, b, { result: 'padExplosion', apogee: 0, maxMach: 0, maxQ: 0, maxG: 0, failures: [{ t: 0, text: 'COPV rupture during pad pressurization', cause: cp.cause }], events: [{ t: 0, text: 'COPV rupture on pad', kind: 'fail' }] }, []);
          return;
        }
      }
      setTimeout(tick, t > 60 ? 450 : 700);
    };
    tick();
  }
}

function startFlight(app, L, b) {
  const g = app.g;
  const d = b.design;
  const grainTempK = 273.15 + (L.wx?.tempC ?? 20);
  const base = flightModel(g, b, { grainTempK }); // grain temperature on the day drives solid-motor ballistics
  const an = base.an;
  const sim = new FlightSim({ design: d, analysis: an, hazards: base.hazards, site: SITES[L.site], weather: L.wx, program: { ...d.program, site: L.site }, seed: (g.seed + Math.floor(g.day * 13)) >>> 0, grainTempK });
  L.sim = sim; L.phase = 'flight'; L.warp = 1; L.view = null;
  app.render();
}

function renderFlight(root, app, L) {
  const sim = L.sim;
  const cv = h('canvas', { 'aria-label': 'Flight view' });
  const hud = h('div', { class: 'hud' });
  const events = h('div', { class: 'events' });
  const c1 = h('canvas'), c2 = h('canvas');
  const view = L.view || (L.view = new FlightView(cv));
  view.cv = cv;
  const warpBtns = h('div', { class: 'row' }, [1, 2, 5, 10, 50, 200, 1000].map(w => h('button', { class: 'btn small' + (L.warp === w ? ' primary' : ''), onclick: () => { L.warp = w; for (const b of warpBtns.children) b.classList.toggle('primary', b.textContent === w + '×'); } }, w + '×')));
  const endBtn = h('button', { class: 'btn primary', style: { display: 'none' }, onclick: () => finishFlight(app, L, app.g.builds.find(x => x.id === L.buildId), sim.summary(), sim.tlm) }, 'Post-flight report →');
  const controls = h('div', { class: 'panel stack' },
    h('div', { class: 'spread' }, h('h3', null, 'Flight control'), h('span', { class: 'chip acc' }, sim.site.name)),
    h('div', null, h('div', { class: 'sub' }, 'Time warp'), warpBtns),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => { view.mode = view.mode === 'map' ? 'track' : 'map'; } }, 'Toggle map / tracking view'),
      sim.av.fts ? h('button', { class: 'btn small danger', onclick: () => { if (confirm('Send flight termination command?')) sim.fail('Flight terminated by range safety command (manual)', 'Operator decision', true); } }, 'FTS destruct') : null),
    endBtn,
    h('h4', null, 'Events'), events, c1, c2);
  root.append(h('div', { class: 'flight' }, h('div', { class: 'fview' }, cv, hud), controls));
  let last = performance.now(), lastChart = 0, evCount = 0, done = false;
  const loop = (now) => {
    if (app.ui.screen !== 'launch' || L.phase !== 'flight') return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!sim.finished) sim.advance(dt * L.warp, 6000);
    try { view.draw(sim); } catch (e) { console.error(e); }
    const T = sim.tlm[sim.tlm.length - 1];
    if (T) {
      const met = Math.max(0, T.t);
      const S = sim.stages[sim.stageIdx];
      clear(hud).append(...[
        ['MET', `T+${Math.floor(met / 60)}:${String(Math.floor(met % 60)).padStart(2, '0')}.${Math.floor(met * 10 % 10)}`], ['Phase', sim.phase + (sim.guid?.mode && sim.guided ? ' / ' + sim.guid.mode : '')],
        ['Altitude', km(T.alt)], ['Velocity', n(T.v, 0) + ' m/s inertial'], ['Airspeed', n(T.vrel, 0) + ' m/s · M' + n(T.mach, 2)], ['Dyn. pressure', n(T.q / 1000, 1) + ' kPa'],
        ['Acceleration', n(T.acc, 2) + ' g'], ['Pitch / AoA', n(T.pitch, 1) + '° / ' + n(T.alpha, 1) + '°'], ['Thrust', n(T.F / 1000, 1) + ' kN'], ['Mass', n(T.mass, T.mass > 100 ? 0 : 2) + ' kg'],
        ['Stage', `${sim.stageIdx + 1}/${sim.n}${S?.lit ? ' (burning)' : ''}`], ['Downrange', km(T.down)],
        ...(T.alt > 60000 || sim.prog.mode === 'orbit' ? [['Apogee / perigee', `${n(T.apo / 1000, 0)} / ${T.peri > -500000 ? n(T.peri / 1000, 0) + ' km' : 'sub-orbital'}`]] : []),
        ...(T.dropout ? [['TELEMETRY', 'LOS — data dropout']] : []),
      ].flatMap(([k, v]) => [h('span', { class: 'k' }, k), h('span', null, v)]));
    }
    if (sim.events.length !== evCount) {
      evCount = sim.events.length;
      clear(events).append(...sim.events.slice().reverse().map(e => h('div', null, h('span', { class: 't' }, 'T+' + n(e.t - (sim.t0 || 0), 1)), h('span', { class: e.kind }, e.text))));
    }
    if (now - lastChart > 600 && sim.tlm.length > 2) {
      lastChart = now;
      const tl = sim.tlm.filter(r => r.t >= 0);
      lineChart(c1, [{ name: 'Alt (km)', data: tl.map(r => [r.t, r.alt / 1000]) }, { name: 'Vel (km/s)', data: tl.map(r => [r.t, r.vrel / 1000]) }], { height: 140 });
      lineChart(c2, [{ name: 'q (kPa)', data: tl.map(r => [r.t, r.q / 1000]) }, { name: 'Accel (g)', data: tl.map(r => [r.t, r.acc]) }], { height: 140 });
    }
    if (sim.finished && !done) { done = true; endBtn.style.display = ''; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function finishFlight(app, L, b, summary, tlm) {
  const g = app.g;
  const d = b.design;
  const contract = d.contractId ? CONTRACTS.find(c => c.id === d.contractId) : null;
  const active = contract && g.contracts.active.some(a => a.id === contract.id);
  const { an } = flightModel(g, b);
  const ev = contract ? evaluateContract(d, summary, contract, an) : null;
  if (summary.result === 'padAbort') {
    b.status = 'ready';
    note(g, `${b.name}: pad abort. Vehicle safed; investigate before re-attempting.`, 'warn');
  } else {
    b.status = 'flown';
    if (ev?.ok && active) completeContract(g, contract, `${b.name}: ${summary.result}`);
    else if (contract && active) { g.reputation -= 4; note(g, `Flight did not meet "${contract.title}": ${ev.reasons.join('; ')}. Contract remains open until deadline.`, 'fail'); }
    if (summary.rangeViolation) { spend(g, 250000, 'Range-safety violation fine'); g.reputation -= 15; delete g.licenses[L.site]; note(g, 'Regulator fined the company and suspended the launch license after a range-safety violation.', 'fail'); }
  }
  const down = (tlm || []).filter((r, i) => i % Math.max(1, Math.floor((tlm || []).length / 300)) === 0);
  const rec = { day: g.day, name: b.name, result: summary.result, apogee: summary.apogee, orbit: summary.orbit, maxMach: summary.maxMach, contract: contract?.title, ok: ev?.ok, reasons: ev?.reasons, failures: summary.failures, events: summary.events, tlm: down };
  g.history.push(rec);
  app.ui.launch = { phase: 'post', rec };
  app.render();
}

function renderPost(root, app, L) {
  const g = app.g;
  const rec = L.rec;
  const good = ['orbit', 'recovered'].includes(rec.result);
  const c1 = h('canvas'), c2 = h('canvas'), c3 = h('canvas');
  root.append(h('div', { class: 'grid cols-2' },
    h('div', { class: 'panel stack' },
      h('h2', null, 'Post-flight report — ' + rec.name),
      h('div', { class: 'w ' + (good ? 'success' : rec.result === 'damaged' || rec.result === 'padAbort' ? 'warn' : 'error') }, `Outcome: ${({ orbit: 'ORBIT ACHIEVED', recovered: 'Payload recovered', damaged: 'Hard landing — payload damaged', impact: 'Ground impact', destroyed: 'Vehicle destroyed', padExplosion: 'Lost on the pad', padAbort: 'Pad abort — vehicle safed' })[rec.result] || rec.result}`),
      rec.contract ? h('div', { class: 'w ' + (rec.ok ? 'success' : 'error') }, `Contract "${rec.contract}": ${rec.ok ? 'requirements MET' : 'NOT met — ' + (rec.reasons || []).join('; ')}`) : null,
      h('div', { class: 'kv' }, h('span', null, 'Apogee (AGL)'), h('span', null, km(rec.apogee || 0)), h('span', null, 'Max Mach'), h('span', null, n(rec.maxMach || 0, 2)),
        ...(rec.orbit ? [h('span', null, 'Orbit'), h('span', null, `${n(rec.orbit.periAlt / 1000, 1)} × ${n(rec.orbit.apoAlt / 1000, 1)} km`), h('span', null, 'Inclination'), h('span', null, n(rec.orbit.incl, 2) + '°'), h('span', null, 'Period'), h('span', null, n(rec.orbit.period / 60, 1) + ' min')] : [])),
      h('h3', null, 'Failure investigation'),
      rec.failures?.length ? h('div', { class: 'warnings' }, rec.failures.map(f => h('div', { class: 'w error' }, h('b', null, `T+${n(f.t, 1)} s — ${f.text}`), f.cause ? h('div', null, 'Most probable root cause: ' + f.cause) : null))) : h('div', { class: 'w success' }, 'No anomalies.'),
      h('h3', null, 'Event log'),
      h('div', { class: 'events scroll' }, (rec.events || []).map(e => h('div', null, h('span', { class: 't' }, n(e.t, 1)), h('span', { class: e.kind }, e.text)))),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => { app.ui.launch = { phase: 'prep' }; app.go('hq'); } }, 'Back to headquarters'), h('button', { class: 'btn', onclick: () => { app.ui.launch = { phase: 'prep' }; app.go('design'); } }, 'Iterate the design'))),
    h('div', { class: 'panel stack' }, h('h3', null, 'Telemetry'), c1, c2, c3)));
  requestAnimationFrame(() => {
    const tl = (rec.tlm || []).filter(r => r.t >= 0);
    if (!tl.length) return;
    lineChart(c1, [{ name: 'Altitude (km)', data: tl.map(r => [r.t, r.alt / 1000]) }], { height: 180, title: 'Altitude' });
    lineChart(c2, [{ name: 'Airspeed (m/s)', data: tl.map(r => [r.t, r.vrel]) }, { name: 'Inertial (m/s)', data: tl.map(r => [r.t, r.v]) }], { height: 180, title: 'Velocity' });
    lineChart(c3, [{ name: 'q (kPa)', data: tl.map(r => [r.t, r.q / 1000]) }, { name: 'Accel (g)', data: tl.map(r => [r.t, r.acc]) }, { name: 'AoA (°)', data: tl.map(r => [r.t, r.alpha]) }], { height: 180, title: 'Loads' });
  });
}
