// Game state & rules: money, calendar, staff, facilities, fabrication travelers, NCRs,
// test campaigns, licensing, weather, launch commit criteria, contracts. Pure logic (no DOM).
import { makeRng } from '../physics/rng.js';
import { MATERIALS } from '../data/materials.js';
import { STEP_KINDS, ROUTES, LABOR_RATE, OUTSOURCE_FACTOR, OUTSOURCE_DAYS } from '../data/processes.js';
import { DEFECTS, NDI, podFor } from '../data/defects.js';
import { FACILITIES, START_FACILITIES, SITES, CONTRACTS, TECH_SKILL_FACTOR } from '../data/world.js';
import { computeVehicle, templateDesign, newId } from './vehicle.js';
import { buildHazards, strengthFactor, liveDefects, causeText } from './reliability.js';
import { simulateSolid } from '../physics/solidMotor.js';
import { maxShear } from '../physics/wind.js';
import { G0, clamp } from '../physics/constants.js';

const NAMES = ['A. Okafor', 'M. Lindqvist', 'R. Santos', 'J. Nakamura', 'P. Kowalski', 'D. Haddad', 'S. Mbeki', 'L. Fernández', 'K. Iyer', 'T. Novak', 'E. Brennan', 'Y. Chen', 'F. Rossi', 'O. Adeyemi', 'N. Petrov', 'H. Kim'];
const BUY_TO_FLY = { procure: 1.6 };
const STRUCTURAL_KEYS = ['tank', 'case', 'copv', 'chamber1', 'chamber2', 'chamber3'];

export function newGame(mode = 'career', seed = Date.now() & 0x7fffffff) {
  const sandbox = mode === 'sandbox';
  const g = {
    version: 2, mode, seed, rngState: seed, day: 0, cash: sandbox ? 1e12 : 3200000, reputation: 0,
    facilities: Object.fromEntries(Object.keys(FACILITIES).map(k => [k, sandbox || START_FACILITIES.includes(k)])),
    staff: [mkStaff(seed, 0, 2.6), mkStaff(seed, 1, 2.2), mkStaff(seed, 2, 3.1), mkStaff(seed, 3, 1.8)],
    qualified: [], designQual: [], designs: [], builds: [], activeDesignId: null, activeBuildId: null,
    contracts: { active: [], completed: [], failed: [] }, licenses: {}, ledger: [], history: [], log: [], xp: 0,
  };
  const d = templateDesign('sounding', CONTRACTS[0]);
  d.id = newId('d'); d.rev = 'A';
  g.designs.push(d); g.activeDesignId = d.id;
  note(g, sandbox ? 'Sandbox mode: unlimited money and time, every facility owned.' : 'Company founded with $3.2M seed funding, a small machine shop, welding bay, composites room, NDT bench, electronics lab and hydro-test cell.');
  return g;
}

function mkStaff(seed, i, skill) {
  const r = makeRng(seed + i * 977);
  return { id: 'st' + i + seed, name: NAMES[(seed + i * 5) % NAMES.length], role: 'Technician', skill, salary: 62000 + skill * 14000 + Math.round(r.next() * 5000), xp: 0 };
}

export function note(g, text, kind = 'info') { g.log.unshift({ day: g.day, text, kind }); if (g.log.length > 300) g.log.length = 300; }
export const rngOf = (g) => { const r = makeRng(g.rngState); return { r, save: () => { g.rngState = r.state; } }; };
export const dateStr = (g, day = g.day) => { const d = new Date(Date.UTC(2027, 0, 4) + day * 86400000); return d.toISOString().slice(0, 10); };
export const isSandbox = (g) => g.mode === 'sandbox';

export function spend(g, amount, desc) {
  if (isSandbox(g)) return;
  g.cash -= amount;
  g.ledger.unshift({ day: g.day, amount: -amount, desc });
  if (g.ledger.length > 400) g.ledger.length = 400;
}
export function earn(g, amount, desc) { g.cash += amount; g.ledger.unshift({ day: g.day, amount, desc }); }

export function advanceDays(g, days, why) {
  if (days <= 0) return;
  if (isSandbox(g)) { g.day += Math.ceil(days * 10) / 10; return; }
  const d0 = g.day;
  g.day += Math.ceil(days * 10) / 10;
  const span = g.day - d0;
  const payroll = g.staff.reduce((s, x) => s + x.salary, 0) / 365 * span;
  const upkeep = Object.entries(g.facilities).filter(([, v]) => v).reduce((s, [k]) => s + FACILITIES[k].upkeep, 0) / 30 * span;
  const rent = 4000 / 30 * span;
  g.cash -= payroll + upkeep + rent;
  if (Math.floor(d0 / 30) !== Math.floor(g.day / 30)) g.ledger.unshift({ day: g.day, amount: -(payroll + upkeep + rent), desc: 'Payroll, facility upkeep, rent (accrued)' });
  // contract deadlines
  for (const a of [...g.contracts.active]) if (g.day > a.deadlineDay) {
    const c = CONTRACTS.find(x => x.id === a.id);
    g.contracts.active = g.contracts.active.filter(x => x !== a);
    g.contracts.failed.push(a.id);
    spend(g, c.penalty, `Contract "${c.title}" missed deadline — penalty`);
    g.reputation -= 10;
    note(g, `Deadline missed: "${c.title}". Penalty $${c.penalty.toLocaleString()}.`, 'fail');
  }
}

export const qualityFactor = (g) => {
  const avg = g.staff.length ? g.staff.reduce((s, x) => s + x.skill, 0) / g.staff.length : 1;
  return TECH_SKILL_FACTOR(avg);
};
export const crewFactor = (g) => clamp(g.staff.length / 3, 0.5, 6); // parallel crews (diminishing beyond ~18 techs)

// ---------- designs ----------
export function activeDesign(g) { return g.designs.find(d => d.id === g.activeDesignId); }
export function analysisFor(g, design, extra = {}) { return computeVehicle(design, { qualified: new Set(g.designQual), ...extra }); }

export function releaseDesign(g, design) {
  const an = analysisFor(g, design);
  if (an.errors) return { error: `Design has ${an.errors} unresolved error(s). Fix them before release.` };
  const snap = JSON.parse(JSON.stringify(design));
  const build = { id: newId('b'), designId: design.id, name: `${design.name} Rev ${design.rev}`, rev: design.rev, design: snap, createdDay: g.day, parts: [], integrated: false, tests: [], status: 'fabrication' };
  const { r, save } = rngOf(g);
  for (const fp of an.parts) build.parts.push(makePart(fp, r));
  save();
  g.builds.push(build);
  g.activeBuildId = build.id;
  design.rev = String.fromCharCode(design.rev.charCodeAt(0) + 1);
  note(g, `Released ${build.name} for fabrication: ${build.parts.length} parts.`);
  return { build };
}

export function makePart(fp, r, testArticle = false) {
  const steps = (ROUTES[fp.route] ? ROUTES[fp.route](fp) : [{ kind: 'assemble', label: 'Assemble', ctx: {} }]).map(s => ({ ...s, status: 'pending', params: null, result: null }));
  const part = { uid: fp.uid + (testArticle ? ':T' + Math.floor(r.next() * 1e6) : ''), key: fp.key, name: fp.name + (testArticle ? ' [TEST ARTICLE]' : ''), compId: fp.compId, compType: fp.compType, stage: fp.stage, route: fp.route, data: fp, steps, cur: 0, defects: [], status: 'pending', lot: { factor: 1 }, testArticle, repairs: 0, cycles: 0 };
  if (fp.hasSoftware) {
    const nb = 1 + Math.floor(r.next() * 3);
    for (let i = 0; i < nb; i++) part.defects.push({ id: newId('df'), type: 'firmware', severity: 0.2 + 0.7 * r.next(), origin: { step: 'Flight software development', detail: 'latent bug' } });
  }
  return part;
}

// ---------- fabrication ----------
export function stepContext(g, part, step) {
  const d = part.data;
  const mat = step.ctx.mat || d.mat;
  const m = MATERIALS[mat];
  const ctx = { ...d, ...step.ctx, mat, hasAutoclave: g.facilities.autoclave };
  const mass = d.mass || 1;
  if (STEP_KINDS[step.kind].kind === 'procure' && step.kind === 'procure') {
    ctx.matCost = part.key === 'grain' ? mass * 14 : mass * (m ? m.cost : 20) * (m && m.cls === 'composite' ? 1.5 : part.route.includes('Machined') || part.route === 'injector' || part.route === 'turbopump' ? 5 : 1.6);
    ctx.lead = m ? m.lead : 14;
  }
  if (step.kind === 'mix') ctx.matCost = mass * 14;
  return ctx;
}

export function procedureKey(step, ctx) {
  const thkB = ctx.thk ? (ctx.thk < 2 ? 'thin' : ctx.thk < 6 ? 'med' : 'thick') : '';
  return `${step.kind}:${ctx.mat || ''}:${thkB}`;
}

export function stepEstimate(g, part, stepIdx, params) {
  const step = part.steps[stepIdx];
  const kd = STEP_KINDS[step.kind];
  const ctx = stepContext(g, part, step);
  const pr = params || defaultStepParams(kd, ctx);
  let fac = kd.facility;
  if (step.kind === 'cure' && pr.mode === 'autoclave') fac = 'autoclave';
  const owned = !fac || g.facilities[fac];
  let hours = kd.hours ? kd.hours(ctx, pr) : 2;
  let cost = kd.cost ? kd.cost(ctx, pr) : 0;
  let wait0 = 0;
  let days = hours / (8 * crewFactor(g));
  let wait = 0;
  if (kd.calendar) wait += kd.calendar(ctx, pr);
  if (kd.lead) wait += kd.lead(ctx, pr);
  if (kd.kind === 'inspect') {
    hours = 0; cost = 0; days = 0; wait = 0;
    for (const mth of Object.keys(NDI)) if (pr[mth]) {
      const n = NDI[mth]; const own = !n.facility || g.facilities[n.facility];
      const h = n.hoursBase * Math.max(1, Math.sqrt(ctx.area || 0.3));
      hours += h; cost += own ? n.cost + h * LABOR_RATE : (n.cost + h * LABOR_RATE) * OUTSOURCE_FACTOR;
      days += h / (8 * crewFactor(g)); wait += own ? 0 : 5;
    }
    return { hours, cost, days, wait, owned: true, fac: null, ctx, pr };
  }
  let labor = hours * LABOR_RATE;
  if (!owned) { cost = (cost + labor) * OUTSOURCE_FACTOR; labor = 0; days = 0.25; wait += OUTSOURCE_DAYS + hours / 8; }
  return { hours, cost: cost + labor, days, wait, owned, fac, ctx, pr };
}

export function defaultStepParams(kd, ctx) {
  const o = {};
  for (const p of kd.params(ctx)) o[p.key] = p.def;
  return o;
}

export function windowsFor(g, part, step) {
  const kd = STEP_KINDS[step.kind];
  const ctx = stepContext(g, part, step);
  const q = g.qualified.includes(procedureKey(step, ctx));
  return { qualified: q, win: q ? (kd.window ? kd.window(ctx) : {}) : (kd.textbook ? kd.textbook(ctx) : {}), key: procedureKey(step, ctx) };
}

export function qualifyProcedure(g, part, stepIdx) {
  const step = part.steps[stepIdx];
  const ctx = stepContext(g, part, step);
  const key = procedureKey(step, ctx);
  if (g.qualified.includes(key)) return;
  const cost = 2500 + 8 * LABOR_RATE + (ctx.thk || 3) * 150;
  spend(g, cost, `Procedure qualification coupons: ${STEP_KINDS[step.kind].name} (${MATERIALS[ctx.mat]?.name || ctx.mat || 'generic'})`);
  advanceDays(g, 2 + 8 / (8 * crewFactor(g)));
  g.qualified.push(key);
  note(g, `Qualified procedure ${STEP_KINDS[step.kind].name} for ${MATERIALS[ctx.mat]?.name || 'this part'}: test coupons sectioned and pull-tested; process window documented.`);
}

function evalParamStep(kd, ctx, pr, r, q, part, env) {
  const out = [];
  const derived = kd.derive ? kd.derive(pr, ctx) : {};
  const vals = { ...pr, ...derived };
  const win = kd.window ? kd.window(ctx) : {};
  const ign = kd.ignore ? kd.ignore(pr) : [];
  const dev = {};
  for (const k of Object.keys(win)) {
    if (ign.includes(k)) continue;
    const v = vals[k];
    if (typeof v === 'boolean') { dev[k] = v ? 0 : -1; continue; }
    if (v === undefined) continue;
    const [lo, hi] = win[k];
    const w = Math.max(hi - lo, Math.abs(hi) * 0.05, 1e-9);
    dev[k] = v < lo ? -(lo - v) / w : v > hi ? (v - hi) / w : 0;
  }
  for (const rule of kd.rules || []) {
    const d = dev[rule.on];
    if (d === undefined) continue;
    let x = 0;
    if (rule.side === 'low' && d < 0) x = -d; else if (rule.side === 'high' && d > 0) x = d; else if (rule.side === 'both') x = Math.abs(d);
    const p = Math.min(0.95, (rule.base + rule.k * Math.min(x, 3)) * q);
    if (r.chance(p)) {
      const detail = Object.entries(vals).filter(([k]) => k === rule.on).map(([k, v]) => `${k} = ${typeof v === 'number' ? +v.toFixed(3) : v}${win[k] ? `, window ${win[k].map(x => +x.toFixed(2)).join('–')}` : ''}`).join('');
      out.push({ type: rule.type, severity: clamp(0.12 + 0.5 * Math.min(x, 1.5) + 0.35 * r.next(), 0.05, 1), detail: x > 0 ? detail : 'within window (random process scatter)' });
    }
  }
  if (kd.special) kd.special(pr, ctx, out, r, q, env, part);
  return { defects: out, dev };
}

export function executeStep(g, build, part, params) {
  if (part.status === 'scrapped' || part.cur >= part.steps.length) return { error: 'Nothing to do.' };
  const idx = part.cur;
  const step = part.steps[idx];
  const kd = STEP_KINDS[step.kind];
  const est = stepEstimate(g, part, idx, params);
  const pr = est.pr;
  const ctx = est.ctx;
  const { r, save } = rngOf(g);
  const q = qualityFactor(g) * (est.owned ? 1 : 1.15);
  const res = { step: step.label, cost: est.cost, days: est.days, wait: est.wait, created: [], found: [], notes: [], destroyed: false };
  if ((part.readyDay || 0) > g.day) { res.waited = part.readyDay - g.day; advanceDays(g, part.readyDay - g.day); }
  spend(g, est.cost, `${part.name}: ${step.label}`);
  advanceDays(g, est.days);
  part.readyDay = g.day + (est.wait || 0);
  if (kd.kind === 'procure') {
    const m = MATERIALS[ctx.mat];
    if (step.kind === 'procure' && m) {
      const cv = m.cv * (pr.grade === 'premium' ? 0.5 : 1);
      const f = 1 + r.gauss(0, cv);
      part.lot = { factor: Math.min(f, 1.08), grade: pr.grade, cert: { Fty: m.Fty * f, Ftu: m.Ftu * f } };
      res.notes.push(`Mill test report: Fty ${(m.Fty * f / 1e6).toFixed(0)} MPa, Ftu ${(m.Ftu * f / 1e6).toFixed(0)} MPa (${((f - 1) * 100).toFixed(1)}% vs typical; A-basis min ${(m.Ftu * (1 - 2.33 * m.cv) / 1e6).toFixed(0)} MPa).`);
      if (f < 1 - 2.33 * m.cv) { const d = addDefect(part, { type: 'lowLot', severity: clamp((1 - f) * 2, 0.05, 0.6), detected: true }, step, 'material certification below spec'); res.found.push(d); }
    } else if (kd.params) {
      const out = []; kd.special && kd.special(pr, ctx, out, r, q, {}, part);
      for (const o of out) res.created.push(addDefect(part, o, step, `supplier escape (${pr.tier} grade)`));
      res.notes.push(`Received from supplier (${pr.tier || 'standard'} grade).`);
    }
  } else if (kd.kind === 'param') {
    const { defects } = evalParamStep(kd, ctx, pr, r, q, part, { facilities: g.facilities });
    for (const o of defects) {
      if (o.note && !o.type) { res.notes.push(o.note); continue; }
      if (o.hazard) continue;
      const d = addDefect(part, o, step, o.detail || o.note);
      res.created.push(d);
      if (o.detected) res.found.push(d);
    }
    if (step.kind === 'hitl' || step.kind === 'burnin' || step.kind === 'reflow' || step.kind === 'crimp') for (const d of part.defects) if (d.fixed && !d.reported) { d.reported = true; res.notes.push(`${DEFECTS[d.type].name}: ${d.note || 'found and corrected'}`); }
    if (step.kind === 'mix' || step.kind === 'cureGrain') for (const d of part.defects) if (d.type === 'offRatio' && d.sign === undefined) d.sign = r.chance(0.5) ? 1 : -1;
  } else if (kd.kind === 'inspect') {
    const methods = Object.keys(NDI).filter(m => pr[m]);
    for (const d of part.defects) {
      if (d.detected || d.fixed || d.removed) continue;
      for (const m of methods) {
        if (r.chance(podFor(m, d))) { d.detected = true; d.foundBy = NDI[m].name; res.found.push(d); break; }
        (d.inspectedBy ||= []).push(NDI[m].name);
      }
    }
    res.notes.push(`Inspected with ${methods.map(m => NDI[m].name).join(', ') || 'nothing'}.`);
  } else if (kd.kind === 'proof') {
    const pz = part.data.pressure;
    if (pz) {
      const sf = strengthFactor(part).factor;
      const cap = pz.burst * 1.12 * sf;
      const yieldP = cap * 0.82;
      const P = pr.factor * pz.meop;
      res.notes.push(`Proof to ${(P / 1e6).toFixed(2)} MPa (${pr.factor.toFixed(2)} × MEOP ${(pz.meop / 1e6).toFixed(2)} MPa).`);
      if (P > cap) {
        part.status = 'scrapped'; res.destroyed = true;
        const w = strengthFactor(part).worst;
        res.notes.push(`RUPTURED at ${(cap / 1e6).toFixed(2)} MPa. ${w ? 'Fracture origin: ' + causeText(part, w) : 'Wall too thin or weak material lot.'} Part scrapped.`);
        note(g, `${part.name} burst during proof test.`, 'fail');
      } else if (P > yieldP) {
        const d = addDefect(part, { type: 'dimensional', severity: clamp((P - yieldP) / yieldP * 5, 0.2, 0.9), detected: true }, step, 'yielded during proof (permanent set)');
        res.found.push(d); res.notes.push('Permanent deformation measured after proof (pressure exceeded yield).');
      } else {
        part.proof = pr.factor;
        for (const d of part.defects) if (!d.fixed && ['crack', 'lackOfFusion'].includes(d.type)) d.severity = Math.min(1, d.severity * 1.08);
        res.notes.push('PASS — no leaks, no permanent set. Proof establishes that no flaw is critical below this pressure.');
      }
    } else res.notes.push('PASS');
  } else if (kd.kind === 'leak') {
    const pod = { bubble: 0.45, msl: 0.85, chamber: 0.97 }[pr.mode];
    for (const d of part.defects) if (!d.detected && !d.fixed && DEFECTS[d.type]?.leak && r.chance(pod * Math.min(1, DEFECTS[d.type].leak * 1.5 + d.severity * 0.3))) { d.detected = true; d.foundBy = 'Leak test'; res.found.push(d); }
    res.notes.push(res.found.length ? 'LEAK DETECTED.' : 'Leak rate within spec.');
  } else if (kd.kind === 'flow') {
    for (const d of part.defects) if (!d.detected && !d.fixed && ['orifice', 'channelBlock', 'trappedPowder', 'fod'].includes(d.type) && r.chance({ orifice: 0.95, channelBlock: 0.85, trappedPowder: 0.8, fod: 0.4 }[d.type])) { d.detected = true; d.foundBy = 'Water-flow test'; res.found.push(d); }
    res.notes.push(res.found.length ? 'Flow anomaly: discharge coefficients / pattern out of family.' : 'Flow coefficients within ±2% of prediction.');
  } else if (kd.kind === 'spinTest') {
    for (const d of part.defects) if (!d.detected && !d.fixed && ['imbalance', 'bearing', 'sealLeak'].includes(d.type)) {
      if (d.type === 'imbalance' && d.severity > 0.8 && pr.speed > 110 && r.chance(0.5)) { part.status = 'scrapped'; res.destroyed = true; res.notes.push('Rotor rub at overspeed — turbopump destroyed.'); break; }
      if (r.chance({ imbalance: 0.9, bearing: 0.7, sealLeak: 0.5 }[d.type] * Math.min(1, 0.4 + d.severity))) { d.detected = true; d.foundBy = 'Spin test'; res.found.push(d); }
    }
    if (!res.destroyed) res.notes.push(res.found.length ? 'Synchronous vibration / bearing temperature anomaly.' : `Vibration within limits to ${pr.speed}% speed.`);
  } else if (kd.kind === 'functional') {
    for (const d of part.defects) if (!d.detected && !d.fixed && (DEFECTS[d.type]?.elec || ['pinchedSeal', 'infant', 'dimensional'].includes(d.type)) && r.chance(0.45 * (pr.env ? 1.5 : 1))) { d.detected = true; d.foundBy = 'Functional test'; res.found.push(d); }
    res.notes.push(res.found.length ? 'Functional test FAILED.' : 'Functional test passed.');
  }
  step.status = 'done'; step.params = pr; step.result = { found: res.found.map(d => d.id), created: res.created.map(d => d.id), notes: res.notes, cost: est.cost, days: est.days, day: g.day };
  if (!res.destroyed) { part.cur = idx + 1; part.status = part.cur >= part.steps.length ? 'complete' : 'inWork'; }
  for (const s of g.staff) { s.xp++; if (s.xp % 30 === 0 && s.skill < 5) s.skill = Math.min(5, s.skill + 0.1); }
  save();
  return res;
}

function addDefect(part, o, step, detail) {
  const d = { id: newId('df'), type: o.type, severity: o.severity, detected: !!o.detected, fixed: !!o.fixed, note: o.note, origin: { step: step.label, detail } };
  if (o.type === 'void' || o.type === 'debond') d.webFrac = Math.random() * 0.85;
  part.defects.push(d);
  return d;
}

export function openNCRs(build) {
  const list = [];
  for (const p of build.parts) for (const d of p.defects) if (d.detected && !d.fixed && !d.removed && !d.disposition && p.status !== 'scrapped') list.push({ part: p, d });
  return list;
}

export function disposition(g, build, part, defectId, action) {
  const d = part.defects.find(x => x.id === defectId);
  if (!d) return;
  const { r, save } = rngOf(g);
  const def = DEFECTS[d.type];
  if (action === 'useAsIs') { d.disposition = 'useAsIs'; note(g, `MRB: ${def.name} on ${part.name} accepted use-as-is.`, 'warn'); }
  else if (action === 'repair') {
    if (part.repairs >= 2) return { error: 'Repair limit (2) reached for this part — further weld repairs degrade the metal. Scrap or use-as-is.' };
    part.repairs++;
    const cost = 1500 + 3 * LABOR_RATE * (1 + (part.data.thk || 2) / 3);
    spend(g, cost, `${part.name}: repair ${def.name}`); advanceDays(g, 1.5 / crewFactor(g));
    if (r.chance(0.82 / qualityFactor(g))) { d.removed = true; d.disposition = 'repaired'; }
    else { d.disposition = null; d.severity = Math.min(1, d.severity * 0.7); }
    if (r.chance(0.25 * qualityFactor(g))) part.defects.push({ id: newId('df'), type: 'hazSoftening', severity: 0.1 + 0.3 * r.next(), detected: false, origin: { step: 'Repair', detail: 'additional heat input from re-weld' } });
    note(g, `MRB repair on ${part.name}: ${d.removed ? 'successful (re-inspected)' : 'indication remains, smaller'}.`);
  } else if (action === 'rework') {
    const cost = 800 + 4 * LABOR_RATE;
    spend(g, cost, `${part.name}: rework for ${def.name}`); advanceDays(g, 2 / crewFactor(g));
    if (r.chance(0.88)) { d.removed = true; d.disposition = 'reworked'; } else d.disposition = null;
    note(g, `Rework on ${part.name}: ${d.removed ? 'cleared' : 'failed, still nonconforming'}.`);
  } else if (action === 'scrap') {
    part.status = 'scrapped'; d.disposition = 'scrapped';
    const fresh = makePart({ ...part.data, uid: part.uid.split(':R')[0] }, r);
    fresh.uid = part.uid.split(':R')[0] + ':R' + Math.floor(r.next() * 1e5);
    fresh.name = part.data.name + (part.testArticle ? ' [TEST ARTICLE]' : '');
    fresh.testArticle = part.testArticle;
    build.parts.splice(build.parts.indexOf(part) + 1, 0, fresh);
    note(g, `${part.name} scrapped; a replacement traveler was opened.`, 'warn');
  }
  save();
  return { ok: true };
}

export function autoRun(g, build, part, useWindows = true) {
  const out = [];
  while (part.cur < part.steps.length && part.status !== 'scrapped') {
    const step = part.steps[part.cur];
    const kd = STEP_KINDS[step.kind];
    const ctx = stepContext(g, part, step);
    const pr = defaultStepParams(kd, ctx);
    if (useWindows && kd.kind === 'param') {
      const w = windowsFor(g, part, step).win;
      for (const p of kd.params(ctx)) if (w[p.key] && p.type === 'num') pr[p.key] = +(((w[p.key][0] + w[p.key][1]) / 2)).toFixed(3);
      for (const p of kd.params(ctx)) if (p.type === 'bool' && w[p.key]) pr[p.key] = true;
    }
    if (kd.kind === 'inspect') for (const m of ctx.methods || []) pr[m] = m === 'visual' || (NDI[m].facility && g.facilities[NDI[m].facility] && m !== 'ct');
    out.push(executeStep(g, build, part, pr));
    if (out[out.length - 1].found.length) break; // stop for MRB
  }
  return out;
}

export function buildStatus(build) {
  const live = build.parts.filter(p => p.status !== 'scrapped' && !p.testArticle);
  const done = live.filter(p => p.status === 'complete').length;
  return { total: live.length, done, ncr: openNCRs(build).length, ready: done === live.length && openNCRs(build).length === 0 };
}

export function buildTestArticle(g, build, compId, keys) {
  const { r, save } = rngOf(g);
  const src = build.parts.filter(p => p.compId === compId && !p.testArticle && p.status !== 'scrapped' && (!keys || keys.includes(p.key)));
  const group = newId('ta');
  for (const p of src) { const np = makePart({ ...p.data, uid: p.uid.split(':')[0] + ':' + p.key }, r, true); np.group = group; build.parts.push(np); }
  save();
  note(g, `Opened test-article travelers for ${src.map(p => p.data.name).join(', ')}.`);
  return group;
}

// ---------- tests ----------
export function testFacility(g, thrustN) { return thrustN <= 50000 ? 'testSmall' : 'testLarge'; }

export function burstTest(g, build, part) {
  const pz = part.data.pressure;
  const sf = strengthFactor(part).factor;
  const cap = pz.burst * 1.12 * sf;
  const fac = 'hydro', owned = g.facilities[fac];
  spend(g, owned ? 3000 : 12000, `Burst test: ${part.name}`); advanceDays(g, owned ? 2 : 10);
  part.status = 'consumed';
  const ok = cap >= pz.burst;
  const comp = build.design.stages.flatMap(s => s.components).find(c => c.id === part.compId);
  let key = null;
  if (comp?.type === 'tank') key = `tank:${comp.params.mat}:${comp.params.process}`;
  if (comp?.type === 'solidMotor') key = `case:${comp.params.caseMat}`;
  if (ok && key && !g.designQual.includes(key)) g.designQual.push(key);
  const w = strengthFactor(part).worst;
  const res = { type: 'burst', part: part.name, burst: cap, design: pz.burst, meop: pz.meop, ok, qualified: ok && key, origin: w ? causeText(part, w) : null, day: g.day };
  build.tests.push(res);
  note(g, `Burst test ${part.name}: ${(cap / 1e6).toFixed(2)} MPa (${(cap / pz.meop).toFixed(2)}× MEOP). ${ok ? 'Design QUALIFIED — safety factor 1.25 now allowed.' : 'Below design burst — not qualified.'}`, ok ? 'success' : 'fail');
  return res;
}

export function staticFireSolid(g, build, compId, group, grainTempC = 20) {
  const parts = build.parts.filter(p => p.group === group);
  if (parts.some(p => p.status !== 'complete')) return { error: 'Test motor parts are not complete.' };
  const comp = build.design.stages.flatMap(s => s.components).find(c => c.id === compId);
  const an = analysisFor(g, build.design);
  const pl = an.placed.find(p => p.id === compId);
  const fakeBuild = { parts };
  const hz = buildHazards(build.design, an, { parts: parts.map(p => ({ ...p, compId })) });
  const ab = hz.asBuilt[compId] || {};
  const r2 = computeVehicle(build.design, { asBuilt: { [compId]: ab }, grainTempK: 273 + grainTempC, qualified: new Set(g.designQual) }).res[compId];
  const sim = r2.motor.sim;
  const fac = testFacility(g, sim.avgThrustVac);
  const owned = g.facilities[fac];
  spend(g, owned ? 6000 + sim.propMass * 20 : 30000 + sim.propMass * 60, `Static fire: ${comp ? 'motor' : ''}`);
  advanceDays(g, owned ? 2 : 14);
  for (const p of parts) p.status = 'consumed';
  const res = { type: 'staticFire', compId, curve: { t: sim.t, pc: sim.pc, f: sim.fvac }, cato: sim.cato, impulse: sim.impulseVac, isp: sim.ispVac, maxPc: sim.maxPc, burnTime: sim.burnTime, causes: hz.hazards.filter(h => h.kind === 'grain' || h.kind === 'strength').map(h => h.cause), day: g.day, grainTempC };
  build.tests.push(res);
  if (!sim.cato) { const k = `motor:${compId}`; if (!g.designQual.includes(k)) g.designQual.push(k); }
  note(g, sim.cato ? `STATIC FIRE: motor case burst at t=${sim.cato.time.toFixed(2)} s.` : `Static fire complete: ${sim.motorClass}, ${(sim.impulseVac / 1000).toFixed(1)} kN·s, Isp ${sim.ispVac.toFixed(0)} s (vac-equivalent).`, sim.cato ? 'fail' : 'success');
  return res;
}

// Liquid engine hot-fire on a test stand: time-series with redlines.
export function hotFire(g, build, compId, engineIdx, duration, opts = {}) {
  const an = analysisFor(g, build.design);
  const pl = an.placed.find(p => p.id === compId);
  const e = pl.r.engine;
  const parts = build.parts.filter(p => p.compId === compId && p.status !== 'scrapped' && (p.data.engine === engineIdx + 1) && !p.testArticle);
  if (parts.some(p => p.status !== 'complete')) return { error: 'Engine parts not complete.' };
  const { r, save } = rngOf(g);
  const fac = testFacility(g, e.FvacTotal);
  const owned = g.facilities[fac];
  const propCost = e.mdotTotal * duration * 2;
  spend(g, (owned ? 8000 : (fac === 'testSmall' ? 40000 : 450000)) + propCost, `Hot-fire test: engine ${engineIdx + 1} (${duration} s)`);
  advanceDays(g, owned ? 1.5 : 12);
  const hz = buildHazards(build.design, an, { parts: parts }).hazards.filter(h => h.engine === undefined || h.engine === engineIdx);
  const t = [], pc = [], F = [], Tw = [], vib = [];
  const ev = [];
  let outcome = 'pass';
  const hfP = e.stability.hfRisk * 0.35 * (hz.some(h => h.kind === 'hfInstab') ? 2 : 1);
  const lox = hz.find(h => h.kind === 'loxIgnite');
  const hot = hz.find(h => h.kind === 'hotspot');
  const rate = hz.filter(h => h.kind === 'engineRate');
  const ofs = hz.find(h => h.kind === 'ofShift');
  const imb = parts.flatMap(p => liveDefects(p)).find(d => d.type === 'imbalance' || d.type === 'bearing');
  // thermocouple model by cooling type: regen hot-wall; ablative housing behind a charring liner; radiative shell
  const ablative = !!e.abl, radiative = !e.ht && !e.abl;
  const Tw0 = e.ht ? e.ht.TwgMax : radiative ? (e.TwRad || 1200) : 330;
  const Tlim = e.wallTmax || 1000;
  const redT = opts.redlineT ?? Tlim - 40;
  const vibRed = opts.redlineVib ?? 25;
  let stopT = duration;
  let hfAt = r.chance(hfP) ? 0.2 + r.next() * 0.5 : null;
  if (lox && r.chance(lox.prob)) { outcome = 'destroyed'; stopT = 0.3; ev.push({ t: 0.3, text: 'Explosion at ignition — LOX-system contamination ignited.', cause: lox.cause }); }
  const tcNear = r.chance(0.55);
  let failT = hot ? Math.min(duration + 5, hot.tFail) : null;
  for (let k = 0; k <= 400; k++) {
    const tt = k / 400 * duration;
    if (tt > stopT) break;
    const ramp = clamp(tt / e.startTime, 0, 1);
    let p = e.pc * ramp * (1 + 0.01 * r.gauss());
    let tw = 300 + (Tw0 - 300) * ramp;
    if (ablative) tw = 300 + (Tlim + 150 - 300) * Math.pow(Math.min(1.2, tt / Math.max(e.maxBurn, 1)), 3); // housing heats as the char front approaches
    if (hot && failT) tw += (Tlim + 150 - Tw0) * clamp((tt - 1) / Math.max(1, failT - 1), 0, 1);
    let v = 2 + (imb ? 40 * imb.severity * imb.severity * ramp : 0) + Math.abs(r.gauss()) * 1.5;
    if (hfAt !== null && tt >= hfAt) { v = 300; p *= 1 + 0.4 * Math.sin(tt * 2000); }
    t.push(tt); pc.push(p); F.push(e.FvacTotal * (p / e.pc)); Tw.push(tw); vib.push(v);
    if (hfAt !== null && tt >= hfAt + 0.05) { outcome = 'destroyed'; stopT = tt; ev.push({ t: tt, text: `High-frequency combustion instability (${(e.stability.f1T / 1000).toFixed(1)} kHz) destroyed the chamber in ${((tt - hfAt) * 1000).toFixed(0)} ms.`, cause: hz.find(h => h.kind === 'hfInstab')?.cause || 'Design: acoustic damping / injector type' }); break; }
    if (tw > redT && tcNear && outcome === 'pass') { outcome = 'redline'; stopT = tt; ev.push({ t: tt, text: `Redline cut-off: wall thermocouple ${tw.toFixed(0)} K > ${redT.toFixed(0)} K. Engine safed.`, cause: hot?.cause }); break; }
    if (tw > Tlim + 100) { outcome = 'destroyed'; stopT = tt; ev.push({ t: tt, text: 'Chamber burn-through — engine destroyed on the stand.', cause: hot?.cause || 'Wall over temperature' }); break; }
    if (v > vibRed && tt > e.startTime && outcome === 'pass') { outcome = 'redline'; stopT = tt; ev.push({ t: tt, text: `Redline cut-off: turbopump vibration ${v.toFixed(0)} g > ${vibRed} g.`, cause: imb ? causeText(parts.find(p => p.defects.includes(imb)), imb) : null }); break; }
    for (const h of rate) if (r.chance(h.rate * duration / 400 * 0.6)) { outcome = r.chance(h.uncontained) ? 'destroyed' : 'redline'; stopT = tt; ev.push({ t: tt, text: h.text, cause: h.cause }); break; }
    if (outcome !== 'pass') break;
  }
  // findings: anything that showed up during the test becomes a detected defect
  for (const p of parts) {
    p.cycles++;
    for (const d of liveDefects(p)) {
      const shown = (d.type === 'orifice' && ofs) || (outcome !== 'pass' && ev.some(x => x.cause && x.cause.includes(DEFECTS[d.type]?.name)));
      if (shown || (DEFECTS[d.type]?.hotspot && tcNear && r.chance(0.5)) || (d.type === 'orifice' && r.chance(0.8))) { d.detected = true; d.foundBy = 'Hot-fire test data / post-test borescope'; }
    }
    if (outcome === 'destroyed') p.status = 'scrapped';
    if (e.ht && p.key.startsWith('chamber') && p.cycles > e.fatigueLife) p.defects.push({ id: newId('df'), type: 'crack', severity: 0.6, detected: r.chance(0.6), origin: { step: 'Hot-fire cycling', detail: `exceeded low-cycle-fatigue life (${e.fatigueLife} firings)` } });
  }
  const measuredIsp = e.ispVac * (1 + r.gauss(0, 0.008)) * (1 - 0.8 * Math.abs(ofs?.shift || 0));
  const res = { type: 'hotFire', compId, engine: engineIdx, duration, ran: stopT, outcome, events: ev, series: { t, pc, F, Tw, vib }, ispVac: measuredIsp, thrust: e.FvacTotal, ofMeasured: e.of * (1 + (ofs?.shift || 0)), day: g.day };
  build.tests.push(res);
  if (outcome === 'pass') for (const p of parts) p.hotfired = true;
  // contract check
  for (const a of g.contracts.active) {
    const c = CONTRACTS.find(x => x.id === a.id);
    if (c.kind === 'test' && outcome === 'pass' && e.FslTotal >= c.req.hotfire.thrust * 0.98 && duration >= c.req.hotfire.duration) completeContract(g, c, `Hot-fire ${duration} s at ${(e.FslTotal / 1000).toFixed(1)} kN`);
  }
  save();
  note(g, `Hot-fire engine ${engineIdx + 1}: ${outcome.toUpperCase()} (${stopT.toFixed(1)} s of ${duration} s).`, outcome === 'pass' ? 'success' : 'fail');
  return res;
}

export function vibeTest(g, build, compId) {
  const parts = build.parts.filter(p => p.compId === compId && p.status === 'complete' && !p.testArticle);
  const owned = g.facilities.vibe;
  spend(g, owned ? 4000 : 25000, 'Vibration + thermal-vacuum test: avionics'); advanceDays(g, owned ? 3 : 15);
  const { r, save } = rngOf(g);
  const found = [];
  for (const p of parts) for (const d of liveDefects(p)) if ((DEFECTS[d.type]?.elec || d.type === 'infant') && r.chance(0.72)) { d.detected = true; d.foundBy = 'Random-vibration test'; found.push({ part: p.name, d: DEFECTS[d.type].name }); }
  save();
  const res = { type: 'vibe', compId, found, day: g.day };
  build.tests.push(res);
  note(g, `Avionics environmental test: ${found.length ? found.length + ' failure(s) found' : 'passed'}.`, found.length ? 'warn' : 'success');
  return res;
}

export function deployTest(g, build, compId) {
  const parts = build.parts.filter(p => p.compId === compId && p.status === 'complete' && !p.testArticle);
  spend(g, 1500, 'Recovery ground ejection test'); advanceDays(g, 1);
  const { r, save } = rngOf(g);
  const found = [];
  for (const p of parts) for (const d of liveDefects(p)) if (d.type === 'packing' && r.chance(0.65)) { d.detected = true; d.foundBy = 'Ground ejection test'; found.push({ part: p.name, d: DEFECTS[d.type].name }); }
  save();
  const res = { type: 'deploy', compId, found, day: g.day };
  build.tests.push(res);
  note(g, `Recovery ground test: ${found.length ? 'deployment problem found' : 'clean separation and deployment'}.`, found.length ? 'warn' : 'success');
  return res;
}

// ---------- integration ----------
export function integrate(g, build) {
  const st = buildStatus(build);
  if (!st.ready) return { error: 'All flight parts must be complete with no open nonconformances.' };
  const { r, save } = rngOf(g);
  const findings = [];
  const flight = build.parts.filter(p => !p.testArticle && p.status === 'complete');
  for (const p of flight) for (const d of liveDefects(p)) {
    if (d.type === 'dimensional' && r.chance(0.8)) { d.detected = true; d.foundBy = 'Fit check'; findings.push(`${p.name}: ${DEFECTS[d.type].name}`); }
    if ((d.type === 'crimp' || d.type === 'solder') && r.chance(0.3)) { d.detected = true; d.foundBy = 'Integrated continuity / end-to-end test'; findings.push(`${p.name}: ${DEFECTS[d.type].name}`); }
    if (d.type === 'pinchedSeal' && r.chance(0.5)) { d.detected = true; d.foundBy = 'Stage leak check'; findings.push(`${p.name}: ${DEFECTS[d.type].name}`); }
  }
  const days = 3 + flight.length * 0.25;
  spend(g, 4000 + flight.length * 300, `Vehicle integration: ${build.name}`); advanceDays(g, days / crewFactor(g));
  // as-built masses
  build.massScatter = {};
  for (const p of flight) build.massScatter[p.uid] = 1 + r.gauss(0, 0.02);
  save();
  if (findings.length) { note(g, `Integration found ${findings.length} issue(s) — open NCRs.`, 'warn'); return { findings }; }
  build.integrated = true; build.status = 'ready';
  note(g, `${build.name} integrated: mass properties measured, end-to-end tests complete. Ready to ship.`, 'success');
  return { ok: true };
}

// ---------- weather, license, launch ----------
export function weatherFor(g, siteKey, day) {
  const s = SITES[siteKey];
  const r = makeRng((g.seed ^ (Math.floor(day) * 2654435761) ^ siteKey.length * 7919) >>> 0);
  const c = s.climate;
  const season = Math.sin((day % 365) / 365 * 2 * Math.PI - 1.2);
  const wx = {
    surface: Math.max(0, r.gauss(c.wind[0], c.wind[1])), gust: Math.max(0, r.gauss(c.gust[0], c.gust[1])), jet: Math.max(3, r.gauss(c.jet[0] - 8 * season, c.jet[1])), jetAlt: 10500 + r.next() * 2500,
    strato: Math.max(0, r.gauss(10, 6)), meso: Math.max(0, r.gauss(30, 15)), surfaceDirTo: r.next() * 360, jetDirTo: 60 + r.next() * 60, turbScale: 0.6 + 0.8 * r.next(),
    tempC: r.gauss(c.temp[0] + 8 * season, c.temp[1] * 0.6), lightning: r.chance(c.lightning * (1 + season * 0.6)), precip: r.chance(c.precip), ceiling: Math.max(150, r.gauss(c.ceiling[0], c.ceiling[1])),
  };
  return wx;
}

export function launchCommitCriteria(design, analysis, wx, siteKey, azimuth = 90) {
  const guided = analysis.guided;
  const solid = design.stages.some(s => s.components.some(c => c.type === 'solidMotor'));
  const sh = maxShear(wx, azimuth);
  const peak = wx.surface + wx.gust;
  const rules = [
    { rule: 'Peak surface wind', value: `${peak.toFixed(1)} m/s`, limit: guided ? '≤ 15 m/s' : '≤ 9 m/s (rail launch)', ok: peak <= (guided ? 15 : 9) },
    { rule: 'Upper-level wind shear', value: `${sh.shear.toFixed(1)} m/s per km at ${(sh.alt / 1000).toFixed(1)} km`, limit: '≤ 25 m/s/km', ok: sh.shear <= 25 },
    { rule: 'Lightning (field mills, 10 nmi rule)', value: wx.lightning ? 'Activity within 10 nmi' : 'None', limit: 'None in 30 min', ok: !wx.lightning },
    { rule: 'Precipitation on flight path', value: wx.precip ? 'Rain showers' : 'None', limit: 'None', ok: !wx.precip },
    { rule: 'Temperature', value: `${wx.tempC.toFixed(1)} °C`, limit: solid ? '4 to 35 °C (motor grain / seals)' : '−10 to 40 °C', ok: solid ? wx.tempC >= 4 && wx.tempC <= 35 : wx.tempC >= -10 && wx.tempC <= 40 },
  ];
  if (!guided) rules.push({ rule: 'Cloud ceiling (optical tracking / airspace)', value: `${wx.ceiling.toFixed(0)} m`, limit: '≥ 1,500 m', ok: wx.ceiling >= 1500 });
  return { rules, go: rules.every(x => x.ok) };
}

export function licenseStatus(g, siteKey) { return g.licenses[siteKey] || null; }
export function applyLicense(g, siteKey, analysis) {
  const s = SITES[siteKey];
  const mass = analysis.mass;
  const fts = analysis.placed.some(p => p.type === 'avionics' && p.r.avionics.fts);
  const Ec = (siteKey === 'desert' ? 2e-7 : 4e-7) * Math.pow(mass / 10, 0.6) * (fts ? 0.15 : 1);
  const ok = Ec < 1e-4;
  spend(g, s.licenseCost, `Launch license application: ${s.name}`);
  g.licenses[siteKey] = { applied: g.day, grantDay: g.day + s.licenseDays, Ec, ok, mass };
  note(g, ok ? `License application filed for ${s.name}. Flight safety analysis Ec = ${Ec.toExponential(1)} (limit 1e-4). Expected grant on ${dateStr(g, g.day + s.licenseDays)}.` : `License DENIED: expected casualty Ec = ${Ec.toExponential(1)} exceeds 1e-4. Add a flight termination system or reduce vehicle size.`, ok ? 'info' : 'fail');
  return g.licenses[siteKey];
}

export function flightModel(g, build, extra = {}) {
  const base = analysisFor(g, build.design, extra);
  const { hazards, asBuilt } = buildHazards(build.design, base, build);
  // as-built: grain defects / burn-rate shifts / case strength feed the ballistics; as-built mass scatter
  const an = analysisFor(g, build.design, { asBuilt, ...extra });
  if (build.massScatter) {
    for (const p of an.placed) {
      const parts = build.parts.filter(x => x.compId === p.id.split(':')[0] && !x.testArticle && x.status === 'complete');
      if (!parts.length || !p.r.dryMass) continue;
      const f = parts.reduce((s, x) => s + (build.massScatter[x.uid] || 1), 0) / parts.length;
      p.r = { ...p.r, dryMass: p.r.dryMass * f };
    }
  }
  return { an, hazards, asBuilt };
}

export function evaluateContract(design, summary, c, an) {
  if (!c) return { ok: false, reasons: ['No contract'] };
  const R = c.req, why = [];
  let ok = true;
  if (c.kind === 'suborbital') {
    if (summary.apogee < R.apogee) { ok = false; why.push(`Apogee ${(summary.apogee / 1000).toFixed(2)} km < required ${(R.apogee / 1000).toFixed(1)} km`); }
    if (R.recover && summary.result !== 'recovered') { ok = false; why.push('Payload not recovered intact'); }
    if (R.mach && summary.maxMach < R.mach) { ok = false; why.push(`Max Mach ${summary.maxMach.toFixed(2)} < ${R.mach}`); }
    if (R.liquid && !design.stages.some(s => s.components.some(x => x.type === 'liquidEngine'))) { ok = false; why.push('Contract requires liquid propulsion'); }
  } else if (c.kind === 'orbit') {
    const o = summary.orbit;
    if (!o || summary.result !== 'orbit') { ok = false; why.push('Payload not delivered to orbit'); }
    else {
      if (R.peri && o.periAlt < R.peri) { ok = false; why.push(`Perigee ${(o.periAlt / 1000).toFixed(0)} km < ${(R.peri / 1000).toFixed(0)} km`); }
      if (R.apoMax && o.apoAlt > R.apoMax) { ok = false; why.push(`Apogee ${(o.apoAlt / 1000).toFixed(0)} km > ${(R.apoMax / 1000).toFixed(0)} km`); }
      if (R.apo && o.apoAlt < R.apo) { ok = false; why.push(`Apogee ${(o.apoAlt / 1000).toFixed(0)} km < ${(R.apo / 1000).toFixed(0)} km`); }
      if (R.incMin && o.incl < R.incMin) { ok = false; why.push(`Inclination ${o.incl.toFixed(1)}° < ${R.incMin}°`); }
      if (R.inc && (o.incl < R.inc[0] || o.incl > R.inc[1])) { ok = false; why.push(`Inclination ${o.incl.toFixed(2)}° outside ${R.inc.join('–')}°`); }
    }
    if (design.payloadMass < c.payloadMass) { ok = false; why.push('Payload mass below contract'); }
  }
  return { ok, reasons: why };
}

export function acceptContract(g, c) {
  if (g.contracts.active.some(a => a.id === c.id)) return;
  g.contracts.active.push({ id: c.id, acceptedDay: g.day, deadlineDay: g.day + c.deadline });
  earn(g, c.advance, `Contract advance: ${c.title}`);
  note(g, `Signed contract "${c.title}" with ${c.client}. Deadline ${dateStr(g, g.day + c.deadline)}.`);
}

export function completeContract(g, c, how) {
  g.contracts.active = g.contracts.active.filter(a => a.id !== c.id);
  if (!g.contracts.completed.includes(c.id)) g.contracts.completed.push(c.id);
  earn(g, c.reward - c.advance, `Contract completed: ${c.title}`);
  g.reputation += 15;
  note(g, `CONTRACT COMPLETE: "${c.title}" — ${how}. Final payment $${(c.reward - c.advance).toLocaleString()}.`, 'success');
}

export function availableContracts(g) {
  return CONTRACTS.filter(c => !g.contracts.completed.includes(c.id) && !g.contracts.active.some(a => a.id === c.id) && (!c.after || g.contracts.completed.includes(c.after) || isSandbox(g)));
}

export function buyFacility(g, key) {
  if (g.facilities[key]) return;
  if (g.cash < FACILITIES[key].cost && !isSandbox(g)) return { error: 'Not enough cash.' };
  spend(g, FACILITIES[key].cost, `Facility: ${FACILITIES[key].name}`);
  advanceDays(g, 14);
  g.facilities[key] = true;
  note(g, `Commissioned ${FACILITIES[key].name}.`, 'success');
}

export function hireStaff(g, skill) {
  const s = mkStaff(g.seed + g.staff.length * 31 + g.day, g.staff.length + 7, skill);
  s.id = newId('st');
  g.staff.push(s);
  spend(g, 8000, `Recruiting: ${s.name}`);
  note(g, `Hired ${s.name}, technician (skill ${skill.toFixed(1)}/5), $${s.salary.toLocaleString()}/yr.`);
}
export function trainStaff(g) {
  const cost = 6000 * g.staff.length;
  spend(g, cost, 'Certification training (AWS welding, IPC J-STD-001 soldering, NAS 410 NDT)');
  advanceDays(g, 10);
  for (const s of g.staff) s.skill = Math.min(5, s.skill + 0.35);
  note(g, 'Crew completed certification training (+0.35 skill).', 'success');
}

// Run every open traveler with sensible parameters, interleaving parts so procurement / cure waits overlap
// (the way a real shop schedules work). Stops at the first nonconformance so the MRB can disposition it.
export function autoRunAll(g, build, useWindows = true) {
  let n = 0;
  for (let guard = 0; guard < 2000; guard++) {
    const open = build.parts.filter(p => p.status !== 'complete' && p.status !== 'scrapped' && p.status !== 'consumed' && p.cur < p.steps.length && !p.testArticle);
    if (!open.length || openNCRs(build).length) break;
    open.sort((a, b) => (a.readyDay || 0) - (b.readyDay || 0));
    const p = open[0];
    const before = p.defects.filter(d => d.detected).length;
    autoRunStep(g, build, p, useWindows);
    n++;
    if (p.defects.filter(d => d.detected && !d.fixed).length > before) break;
  }
  return n;
}

export function autoRunStep(g, build, part, useWindows = true) {
  const step = part.steps[part.cur];
  const kd = STEP_KINDS[step.kind];
  const ctx = stepContext(g, part, step);
  const pr = defaultStepParams(kd, ctx);
  if (useWindows && kd.kind === 'param') {
    const w = windowsFor(g, part, step).win;
    for (const p of kd.params(ctx)) if (w[p.key] && p.type === 'num') pr[p.key] = +(((w[p.key][0] + w[p.key][1]) / 2)).toFixed(3);
    for (const p of kd.params(ctx)) if (p.type === 'bool' && w[p.key]) pr[p.key] = true;
  }
  if (kd.kind === 'inspect') for (const m of ctx.methods || []) pr[m] = m === 'visual' || (NDI[m].facility && g.facilities[NDI[m].facility] && m !== 'ct');
  return executeStep(g, build, part, pr);
}
