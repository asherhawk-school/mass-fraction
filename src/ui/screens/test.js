import { h, clear, n, moneyK, toast, modal } from '../dom.js';
import { analysisFor, buildTestArticle, burstTest, staticFireSolid, hotFire, vibeTest, deployTest, dateStr } from '../../model/game.js';
import { lineChart } from '../../render/charts.js';
import { FACILITIES } from '../../data/world.js';

export function renderTest(root, app) {
  const g = app.g;
  const b = g.builds.find(x => x.id === g.activeBuildId);
  if (!b) { root.append(h('div', { class: 'panel' }, 'No active build. Release a design first.')); return; }
  const an = analysisFor(g, b.design);
  const comps = b.design.stages.flatMap((s, si) => s.components.map(c => ({ c, si })));
  const cards = [];
  for (const { c, si } of comps) {
    const r = an.res[c.id];
    if (!r) continue;
    const parts = b.parts.filter(p => p.compId === c.id);
    const tas = parts.filter(p => p.testArticle);
    const groups = [...new Set(tas.map(p => p.group))];
    if (c.type === 'tank' || (c.type === 'solidMotor')) {
      const key = c.type === 'tank' ? 'tank' : 'case';
      const ta = tas.filter(p => p.key === key);
      const qualKey = c.type === 'tank' ? `tank:${c.params.mat}:${c.params.process}` : `case:${c.params.caseMat}`;
      cards.push(h('div', { class: 'panel stack' },
        h('h3', null, `${c.type === 'tank' ? (c.params.role === 'ox' ? 'Oxidizer tank' : 'Fuel tank') : 'Motor case'} — burst qualification`),
        h('div', { class: 'sub' }, 'Build one extra unit and pressurize it to failure. If it meets design burst, the design is qualified and future revisions may use a 1.25 safety factor instead of 1.4 (lighter).'),
        g.designQual.includes(qualKey) ? h('span', { class: 'chip good' }, 'Design qualified (SF 1.25)') : h('span', { class: 'chip' }, 'Not qualified (SF 1.4)'),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: () => { buildTestArticle(g, b, c.id, [key]); toast('Test-article traveler opened in Fabrication.'); app.render(); } }, 'Build test article'),
          ...ta.map(p => h('button', { class: 'btn small primary', disabled: p.status !== 'complete', onclick: () => { const res = burstTest(g, b, p); showResult(res); app.render(); } }, p.status === 'complete' ? 'Burst test now' : p.status === 'consumed' ? 'tested' : `article in work (${p.steps.filter(s => s.status === 'done').length}/${p.steps.length})`)))));
    }
    if (c.type === 'solidMotor') {
      const ready = groups.filter(gp => tas.filter(p => p.group === gp).every(p => p.status === 'complete'));
      const tempIn = h('input', { type: 'number', value: 20, min: -20, max: 50, step: 1, style: { width: '70px' }, 'aria-label': 'Grain temperature °C' });
      cards.push(h('div', { class: 'panel stack' },
        h('h3', null, `Static fire — ${r.motor.sim.motorClass} motor`),
        h('div', { class: 'sub' }, 'Solid motors are single-use: you fire a test motor made by the same process. Condition the grain to a temperature — burn rate (and pressure) rise with temperature.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: () => { buildTestArticle(g, b, c.id, ['case', 'grain', 'noz', 'ign']); toast('Test-motor travelers opened in Fabrication.'); app.render(); } }, 'Build test motor'),
          h('span', { class: 'sub' }, 'Grain temp °C'), tempIn,
          ...groups.map(gp => { const ok = ready.includes(gp); const ps = tas.filter(p => p.group === gp); return h('button', { class: 'btn small primary', disabled: !ok || ps.some(p => p.status === 'consumed'), onclick: () => { const res = staticFireSolid(g, b, c.id, gp, +tempIn.value); if (res.error) toast(res.error, 'warn'); else showResult(res); app.render(); } }, ps.some(p => p.status === 'consumed') ? 'fired' : ok ? 'Fire test motor' : 'test motor in work'); }))));
    }
    if (c.type === 'liquidEngine') {
      const e = r.engine;
      const fac = e.FvacTotal <= 50000 ? 'testSmall' : 'testLarge';
      const dur = h('input', { type: 'number', value: Math.min(30, Math.round(e.burnTime || 20)), min: 1, max: 600, step: 1, style: { width: '70px' }, 'aria-label': 'Duration s' });
      const rows = [];
      for (let k = 0; k < e.count; k++) {
        const eps = parts.filter(p => p.data.engine === k + 1 && !p.testArticle && p.status !== 'scrapped');
        const ready = eps.length && eps.every(p => p.status === 'complete');
        const fired = eps.some(p => p.hotfired);
        rows.push(h('button', { class: 'btn small ' + (ready ? 'primary' : ''), disabled: !ready, onclick: () => { const res = hotFire(g, b, c.id, k, +dur.value); if (res.error) toast(res.error, 'warn'); else showResult(res); app.render(); } }, `Engine ${k + 1}${fired ? ' ✓' : ''}${ready ? '' : ' (parts in work)'}`));
      }
      cards.push(h('div', { class: 'panel stack' },
        h('h3', null, `Hot-fire — ${e.pairKey} ${e.cycle} engine, ${n(e.FslTotal / 1000, 1)} kN`),
        h('div', { class: 'sub' }, `Acceptance-fire flight engines on the stand (${FACILITIES[fac].name}${g.facilities[fac] ? '' : ' — outsourced'}). Thermocouples, accelerometers and flow meters can reveal hidden defects; redlines shut the engine down before it destroys itself (if the sensor happens to be near the problem). Each firing uses one of ~${e.fatigueLife > 1000 ? '∞' : e.fatigueLife} thermal-fatigue cycles.`),
        h('div', { class: 'row' }, h('span', { class: 'sub' }, 'Duration (s)'), dur, ...rows)));
    }
    if (c.type === 'avionics') cards.push(h('div', { class: 'panel stack' }, h('h3', null, 'Avionics environmental test'), h('div', { class: 'sub' }, 'Random vibration + thermal vacuum screens workmanship defects (cold solder, crimps, weak parts).'), h('button', { class: 'btn small primary', disabled: !parts.filter(p => !p.testArticle).every(p => p.status === 'complete'), onclick: () => { const res = vibeTest(g, b, c.id); showResult(res); app.render(); } }, `Run test (${g.facilities.vibe ? 'in-house' : 'outsourced'})`)));
    if (c.type === 'recovery') cards.push(h('div', { class: 'panel stack' }, h('h3', null, 'Recovery ground ejection test'), h('div', { class: 'sub' }, 'Fire the ejection charge on the ground: proves charge sizing and that the chutes come out and unfurl.'), h('button', { class: 'btn small primary', disabled: !parts.filter(p => !p.testArticle).every(p => p.status === 'complete'), onclick: () => { const res = deployTest(g, b, c.id); showResult(res); app.render(); } }, 'Run ground test')));
  }
  const log = h('div', { class: 'panel stack' }, h('h3', null, 'Test log — ' + b.name),
    b.tests.length ? h('table', { class: 't' }, h('tbody', null, b.tests.slice().reverse().map(t => h('tr', { style: { cursor: 'pointer' }, onclick: () => showResult(t) }, h('td', { class: 'mono' }, dateStr(g, t.day)), h('td', null, t.type), h('td', null, summaryOf(t)))))) : h('div', { class: 'sub' }, 'No tests yet.'));
  root.append(h('div', { class: 'grid cols-2' }, h('div', { class: 'stack' }, cards.length ? cards : h('div', { class: 'panel' }, 'Nothing testable in this design.')), log));
}

function summaryOf(t) {
  if (t.type === 'burst') return `${n(t.burst / 1e6, 2)} MPa (${n(t.burst / t.meop, 2)}× MEOP) — ${t.ok ? 'qualified' : 'below design'}`;
  if (t.type === 'staticFire') return t.cato ? `CATO at ${n(t.cato.time, 2)} s` : `${n(t.impulse / 1000, 1)} kN·s, Isp ${n(t.isp, 0)} s, max Pc ${n(t.maxPc / 1e6, 2)} MPa`;
  if (t.type === 'hotFire') return `Engine ${t.engine + 1}: ${t.outcome.toUpperCase()} ${n(t.ran, 1)}/${t.duration} s, Isp ${n(t.ispVac, 1)} s (vac-corrected)`;
  if (t.type === 'vibe' || t.type === 'deploy') return t.found.length ? `${t.found.length} failure(s)` : 'pass';
  return '';
}

function showResult(t) {
  const body = h('div', { class: 'stack' });
  body.append(h('div', { class: 'w ' + ((t.ok || t.outcome === 'pass' || (t.type === 'staticFire' && !t.cato) || ((t.type === 'vibe' || t.type === 'deploy') && !t.found.length)) ? 'success' : 'error') }, summaryOf(t)));
  if (t.type === 'hotFire') {
    const c1 = h('canvas'), c2 = h('canvas');
    body.append(c1, c2);
    for (const e of t.events) body.append(h('div', { class: 'w error' }, `T+${n(e.t, 2)} s: ${e.text}`, e.cause ? h('div', { class: 'sub' }, 'Root cause: ' + e.cause) : null));
    if (Math.abs(t.ofMeasured - 0) > 0) body.append(h('div', { class: 'sub' }, `Measured mixture ratio ${n(t.ofMeasured, 3)}.`));
    requestAnimationFrame(() => {
      const s = t.series;
      lineChart(c1, [{ name: 'Pc (MPa)', data: s.t.map((x, i) => [x, s.pc[i] / 1e6]) }, { name: 'Thrust (kN/10)', data: s.t.map((x, i) => [x, s.F[i] / 1e4]) }], { height: 170, title: 'Chamber pressure & thrust', ymin: 0 });
      lineChart(c2, [{ name: 'Wall TC (K)', data: s.t.map((x, i) => [x, s.Tw[i]]) }, { name: 'Vibration (g×10)', data: s.t.map((x, i) => [x, s.vib[i] * 10]) }], { height: 170, title: 'Thermocouple & accelerometer' });
    });
  }
  if (t.type === 'staticFire') {
    const c1 = h('canvas'); body.append(c1);
    if (t.cato) body.append(h('div', { class: 'w error' }, 'Case burst (CATO). ', t.causes.length ? 'Root cause: ' + t.causes.join('; ') : 'Chamber pressure exceeded case strength.'));
    body.append(h('div', { class: 'sub' }, `Grain conditioned to ${t.grainTempC} °C.`));
    requestAnimationFrame(() => lineChart(c1, [{ name: 'Thrust (kN)', data: t.curve.t.map((x, i) => [x, t.curve.f[i] / 1000]) }, { name: 'Pc (MPa)', data: t.curve.t.map((x, i) => [x, t.curve.pc[i] / 1e6]) }], { height: 200, title: 'Static fire', ymin: 0 }));
  }
  if (t.type === 'burst' && t.origin) body.append(h('div', { class: 'sub' }, 'Fracture origin: ' + t.origin));
  if ((t.type === 'vibe' || t.type === 'deploy') && t.found.length) for (const f of t.found) body.append(h('div', { class: 'w warn' }, `${f.part}: ${f.d} — opened NCR`));
  modal('Test result', body);
}
