// Vehicle assembly: computes every component in context, stacks them to scale, derives masses,
// Δv, T/W, stability, and the full fabrication bill of materials.
import { G0, P_SL } from '../physics/constants.js';
import { COMPONENTS, defaultParams } from './components.js';
import { cpAnalysis } from '../physics/aero.js';

let uid = 1;
export const newId = (p = 'c') => p + Date.now().toString(36) + (uid++).toString(36);

export function makeComponent(type, overrides = {}) {
  return { id: newId(type.slice(0, 3)), type, params: { ...defaultParams(type), ...overrides } };
}

const PRIORITY = { liquidEngine: 0, solidMotor: 0, tank: 1, pressurization: 2, rcs: 2 };

export function computeVehicle(design, env = {}) {
  const n = design.stages.length;
  const qualified = env.qualified || new Set();
  const asBuilt = env.asBuilt || {};
  const mission = design.mission;
  const payloadMass = design.payloadMass, payloadLength = design.payloadLength;
  let maxAccel = new Array(n).fill(design.mission === 'orbit' ? 5 : 15);
  let vehicleLength = 3, recoveredMass = 5, vmaxEst = 0;
  let res = {};
  let stageInfo = [];
  const guided = design.stages.some(s => s.components.some(c => (c.type === 'liquidEngine' && c.params.gimbal > 0) || (c.type === 'solidMotor' && c.params.tvc === 'flex')));
  const needsFTS = mission === 'orbit' || design.stages.some(s => s.components.some(c => c.type === 'liquidEngine'));
  for (let iter = 0; iter < 3; iter++) {
    res = {};
    stageInfo = [];
    let above = 0;
    for (let s = n - 1; s >= 0; s--) {
      const st = design.stages[s];
      const ctxBase = {
        D: st.diameter, stage: st, stageIdx: s, isBottom: s === 0, mission, payloadMass, payloadLength, qualified, maxAccelG: maxAccel[s], aboveMass: above, vehicleLength,
        guided, needsFTS, recoveredMass, vmaxEst, grainTempK: env.grainTempK,
      };
      const upper = design.stages[s + 1];
      if (upper) {
        const ur = stageInfo.find(x => x.idx === s + 1);
        ctxBase.upperEngineLen = ur?.hangLen || 0;
        ctxBase.upperLiquid = upper.components.some(c => c.type === 'liquidEngine');
        ctxBase.upperHasRcs = upper.components.some(c => c.type === 'rcs');
      }
      const order = st.components.map((c, i) => ({ c, i })).sort((a, b) => (PRIORITY[a.c.type] ?? 3) - (PRIORITY[b.c.type] ?? 3) || a.i - b.i);
      let engine = null, motor = null; const tanks = [];
      let dry = 0, prop = 0, gas = 0;
      for (const { c } of order) {
        const def = COMPONENTS[c.type];
        const ctx = { ...ctxBase, engine, stageTanks: tanks, asBuilt: asBuilt[c.id] };
        let r;
        try { r = def.compute(c, ctx); } catch (e) { r = { length: 0.1, dryMass: 0.1, d: st.diameter, warnings: [{ lvl: 'error', msg: 'Compute failed: ' + e.message }], outputs: [], fabParts: [] }; console.error(e); }
        res[c.id] = r;
        if (r.engine) engine = r.engine;
        if (r.motor) motor = r.motor;
        if (r.tank) tanks.push(r.tank);
        dry += r.dryMass || 0; prop += r.propMass || 0; gas += r.gasMass || 0;
      }
      const hangLen = (engine ? res[st.components.find(c => c.type === 'liquidEngine').id].length : 0) || (motor ? res[st.components.find(c => c.type === 'solidMotor').id].nozzleLen : 0);
      stageInfo.push({ idx: s, dry: dry + gas, prop, engine, motor, hangLen, tanks });
      above += dry + prop + gas;
    }
    stageInfo.sort((a, b) => a.idx - b.idx);
    // accel estimates & recovered mass for next iteration
    let massAbove = 0;
    for (let s = n - 1; s >= 0; s--) {
      const si = stageInfo[s];
      si.massAbove = massAbove;
      const burnoutMass = si.dry + massAbove;
      const F = si.engine ? si.engine.FvacTotal * si.engine.count : si.motor ? Math.max(...si.motor.sim.fvac) : 0;
      maxAccel[s] = Math.min(60, Math.max(2, F / Math.max(burnoutMass, 0.1) / G0));
      massAbove += si.dry + si.prop;
    }
    recoveredMass = stageInfo[n - 1].dry;
    // crude max-velocity estimate (ideal Δv × 0.75) for flutter checks
    vmaxEst = 0;
    let m0 = massAbove;
    for (let s = 0; s < n; s++) {
      const si = stageInfo[s];
      const isp = si.engine ? (s === 0 ? (si.engine.ispSL + si.engine.ispVac) / 2 : si.engine.ispVac) : si.motor ? (si.motor.sim.ispSL + si.motor.sim.ispVac) / 2 : 0;
      if (isp > 0 && si.prop > 0) vmaxEst += isp * G0 * Math.log(m0 / (m0 - si.prop)) * (s === 0 ? 0.75 : 0.9);
      m0 -= si.dry + si.prop;
      if (s === 0) break; // flutter matters only through first-stage flight
    }
    vehicleLength = 0;
    for (const s of design.stages) for (const c of s.components) if (COMPONENTS[c.type].stack && res[c.id]) vehicleLength += res[c.id].length || 0;
  }

  // ---- stacking ----
  const placed = [];
  let x = 0;
  const stages = [];
  for (let s = n - 1; s >= 0; s--) {
    const st = design.stages[s];
    const xTop = x;
    const hang = [];
    for (const c of st.components) {
      const r = res[c.id];
      const def = COMPONENTS[c.type];
      if (!def.stack || !r) continue;
      if (c.type === 'liquidEngine' && s !== 0) { hang.push({ c, r }); continue; }
      placed.push({ id: c.id, type: c.type, stage: s, x0: x, len: r.length, d: r.d, r });
      x += r.length;
      if (c.type === 'solidMotor') {
        if (s === 0) { placed.push({ id: c.id + ':noz', type: 'motorNozzle', stage: s, x0: x, len: r.nozzleLen, d: r.exitD, r }); x += r.nozzleLen; }
        else hang.push({ c, r, nozzleOnly: true });
      }
    }
    const xBottom = s === 0 ? placed.filter(p => p.stage === 0 && p.type !== 'liquidEngine' && p.type !== 'motorNozzle').reduce((m, p) => Math.max(m, p.x0 + p.len), xTop) : x;
    for (const h of hang) {
      if (h.nozzleOnly) placed.push({ id: h.c.id + ':noz', type: 'motorNozzle', stage: s, x0: x, len: h.r.nozzleLen, d: h.r.exitD, r: h.r, hanging: true });
      else placed.push({ id: h.c.id, type: 'liquidEngine', stage: s, x0: x, len: h.r.length, d: h.r.d, r: h.r, hanging: true });
    }
    for (const c of st.components) {
      const r = res[c.id];
      if (!r || COMPONENTS[c.type].stack) continue;
      if (c.type === 'fins') placed.push({ id: c.id, type: 'fins', stage: s, x0: xBottom - c.params.root, len: c.params.root, d: r.d, r });
      else placed.push({ id: c.id, type: c.type, stage: s, x0: (xTop + xBottom) / 2, len: 0, d: st.diameter, r });
    }
    stages.push({ idx: s, xTop, xBottom, ...stageInfo[s] });
  }
  stages.sort((a, b) => a.idx - b.idx);
  const length = Math.max(x, ...placed.map(p => p.x0 + p.len));

  // ---- aero / stability for full stack ----
  const elems = aeroElements(placed, 0);
  const dRef = Math.max(...placed.filter(p => p.type !== 'fins').map(p => p.d || 0.01));
  const full = massProps(placed, { fill: 1 });
  const cp = cpAnalysis(elems, dRef, 0.3);
  const empty0 = massProps(placed, { fill: 0, stageEmpty: 0 });
  const cpM2 = cpAnalysis(elems, dRef, 2.0);

  // ---- performance ----
  const perf = [];
  let mTot = placed.reduce((s, p) => s + (p.r.dryMass || 0) + (p.r.propMass || 0) + (p.r.gasMass || 0), 0);
  // count non-stack (fins etc.) once — they are already in placed
  let m0 = mTot, dvTotal = 0;
  for (let s = 0; s < n; s++) {
    const si = stages[s];
    const isp = si.engine ? (s === 0 ? 0.4 * si.engine.ispSL + 0.6 * si.engine.ispVac : si.engine.ispVac) : si.motor ? (s === 0 ? 0.5 * (si.motor.sim.ispSL + si.motor.sim.ispVac) : si.motor.sim.ispVac) : 0;
    const mf = m0 - si.prop;
    const dv = isp > 0 && si.prop > 0 ? isp * G0 * Math.log(m0 / mf) : 0;
    const Fsl = si.engine ? si.engine.FslTotal * si.engine.count : si.motor ? si.motor.sim.avgThrustVac - P_SL * si.motor.Ae : 0;
    const Fvac = si.engine ? si.engine.FvacTotal * si.engine.count : si.motor ? si.motor.sim.avgThrustVac : 0;
    const burn = si.engine ? si.engine.burnTime : si.motor ? si.motor.sim.burnTime : 0;
    perf.push({ stage: s, m0, mf, prop: si.prop, dry: si.dry, isp, dv, twSL: Fsl / (m0 * G0), twVac: Fvac / (m0 * G0), burn });
    dvTotal += dv;
    m0 = mf - si.dry;
    // fairing jettison after stage 0 for orbital
    if (s === 0) { const fr = placed.find(p => p.type === 'fairing'); if (fr && n > 1) m0 -= fr.r.jettisonMass || 0; }
  }

  // ---- warnings ----
  const warnings = [];
  for (const p of placed) if (p.type !== 'motorNozzle') for (const w of p.r.warnings || []) warnings.push({ ...w, comp: p.id.split(':')[0], type: p.type, stage: p.stage });
  const top = design.stages[n - 1];
  if (!top.components.some(c => c.type === 'nosecone' || c.type === 'fairing')) warnings.push({ lvl: 'error', msg: 'The top stage needs a nose cone or fairing.' });
  if (!design.stages.some(s => s.components.some(c => c.type === 'avionics'))) warnings.push({ lvl: 'error', msg: 'No avionics: nothing to sequence staging, recovery or telemetry.' });
  if (perf[0] && perf[0].twSL < 1.15 && perf[0].twSL > 0) warnings.push({ lvl: perf[0].twSL < 1 ? 'error' : 'warn', msg: `Liftoff thrust-to-weight ${perf[0].twSL.toFixed(2)} — ${perf[0].twSL < 1 ? 'the vehicle will not lift off' : 'very slow liftoff: huge gravity losses and poor control in wind'}.` });
  const margin = (cp.xcp - full.cg) / dRef;
  const finned = placed.some(p => p.type === 'fins');
  if (!guided) {
    if (margin < 1) warnings.push({ lvl: margin < 0 ? 'error' : 'warn', msg: `Static stability margin ${margin.toFixed(2)} calibers (CP ${(cp.xcp).toFixed(2)} m, CG ${(full.cg).toFixed(2)} m from nose). Unguided rockets need ≥ 1–2 calibers.` });
    if (margin > 4) warnings.push({ lvl: 'warn', msg: `Over-stable (${margin.toFixed(1)} cal): strong weathercocking into wind.` });
  } else if (margin < -0.5 && !finned) warnings.push({ lvl: 'info', msg: `Aerodynamically unstable (${margin.toFixed(1)} cal) — normal for a guided launcher; TVC must overpower aero moments at max-Q.` });
  for (let s = 1; s < n; s++) if (!design.stages[s - 1].components.some(c => c.type === 'interstage')) warnings.push({ lvl: 'error', msg: `Stage ${s} sits on stage ${s} without an interstage/separation system.` });
  for (let s = 0; s < n; s++) {
    const st = design.stages[s];
    const hasProp = st.components.some(c => c.type === 'liquidEngine' || c.type === 'solidMotor');
    if (!hasProp) warnings.push({ lvl: 'error', msg: `Stage ${s + 1} has no propulsion.` });
    if (st.components.some(c => c.type === 'liquidEngine')) {
      const ox = st.components.filter(c => c.type === 'tank' && c.params.role === 'ox').length, fu = st.components.filter(c => c.type === 'tank' && c.params.role === 'fuel').length;
      if (!ox || !fu) warnings.push({ lvl: 'error', msg: `Stage ${s + 1}: a liquid engine needs both an oxidizer and a fuel tank.` });
      if (!st.components.some(c => c.type === 'pressurization')) warnings.push({ lvl: 'error', msg: `Stage ${s + 1}: tanks need a pressurization system.` });
      if (!(st.propLoad > 0)) warnings.push({ lvl: 'error', msg: `Stage ${s + 1}: set a propellant load.` });
    }
  }
  if (mission !== 'orbit' && !design.stages[n - 1].components.some(c => c.type === 'recovery') && design.requireRecovery) warnings.push({ lvl: 'error', msg: 'Contract requires recovery but there is no recovery system.' });

  const parts = [];
  for (const s of design.stages) for (const c of s.components) {
    const r = res[c.id];
    if (!r) continue;
    for (const fp of r.fabParts || []) parts.push({ ...fp, compId: c.id, compType: c.type, stage: design.stages.indexOf(s), uid: c.id + ':' + fp.key });
  }

  return {
    res, placed, stages, length, dRef, mass: mTot, cg: full.cg, cp: cp.xcp, cpM2: cpM2.xcp, cna: cp.cna, margin, guided, perf, dvTotal, warnings, parts,
    errors: warnings.filter(w => w.lvl === 'error').length, elems,
  };
}

// Aerodynamic elements for the configuration with stages >= firstStage active (positions in that stack's frame)
export function aeroElements(placed, firstStage, opts = {}) {
  const act = placed.filter(p => p.stage >= firstStage && !(opts.noFairing && p.type === 'fairing'));
  const elems = [];
  const structural = act.filter(p => p.len > 0 && !['fins', 'liquidEngine', 'motorNozzle', 'pressurization', 'rcs'].includes(p.type)).sort((a, b) => a.x0 - b.x0);
  const top = structural[0];
  if (top) {
    if (top.r.aero && top.r.aero.type === 'nose') elems.push({ type: 'nose', x: top.x0, L: top.r.aero.L, d: top.r.aero.d, shape: top.r.aero.shape });
    else elems.push({ type: 'nose', x: top.x0, L: top.d * 0.5, d: top.d, shape: 'elliptical' }); // blunt
  }
  for (let i = 1; i < structural.length; i++) {
    const a = structural[i - 1], b = structural[i];
    if (Math.abs(a.d - b.d) > 0.01 * Math.max(a.d, b.d)) elems.push({ type: 'shoulder', x: b.x0, L: Math.abs(b.d - a.d), d1: a.d, d2: b.d });
  }
  const bodyStart = top ? top.x0 : 0, bodyEnd = structural.length ? structural[structural.length - 1].x0 + structural[structural.length - 1].len : 0;
  elems.push({ type: 'body', x: bodyStart, L: bodyEnd - bodyStart, d: top ? top.d : 0.1 });
  for (const p of act) if (p.type === 'fins') elems.push({ type: 'fins', x: p.x0, ...p.r.aero, lost: opts.finsLost });
  return elems;
}

// Mass properties. fill: propellant fraction (0..1) for all stages, or per-stage via fills[stageIdx]
export function massProps(placed, { fill = 1, fills = null, firstStage = 0, solidFill = null, extra = [] } = {}) {
  let m = 0, mx = 0;
  const items = [];
  for (const p of placed) {
    if (p.stage < firstStage) continue;
    const r = p.r;
    if (p.type === 'motorNozzle') continue;
    const f = fills ? (fills[p.stage] ?? fill) : fill;
    const dry = (r.dryMass || 0) + (r.gasMass || 0);
    const xc = p.len > 0 ? p.x0 + p.len * (p.type === 'nosecone' || p.type === 'fairing' ? 0.66 : 0.5) : p.x0;
    if (dry > 0) items.push({ m: dry, x: xc, L: p.len });
    if (r.propMass) {
      const pm = r.propMass * f;
      if (pm > 0) {
        let xp = xc;
        if (r.tank) { const h = p.len * f; xp = p.x0 + p.len - h / 2; }
        items.push({ m: pm, x: xp, L: r.tank ? p.len * f : p.len });
      }
    }
  }
  for (const e of extra) items.push(e);
  for (const it of items) { m += it.m; mx += it.m * it.x; }
  const cg = m > 0 ? mx / m : 0;
  let I = 0;
  for (const it of items) I += it.m * ((it.x - cg) ** 2 + (it.L * it.L) / 12);
  return { mass: m, cg, I };
}

// ---------- starter designs ----------
export function templateDesign(kind, contract) {
  const mk = makeComponent;
  const pm = contract?.payloadMass ?? 1, pl = contract?.payloadLength ?? 0.2;
  if (kind === 'sounding') {
    return {
      name: 'Sounding rocket', mission: 'suborbital', payloadMass: pm, payloadLength: pl, requireRecovery: true,
      stages: [{
        id: newId('s'), name: 'Stage 1', diameter: 0.075, propLoad: 0, engineCount: 1, components: [
          mk('nosecone', { shape: 'ogive', fineness: 4, mat: 'g10', wall: 1.8 }),
          mk('payload', { mass: pm, length: pl }),
          mk('recovery', { drogue: 0.3, main: 1.1, mainAlt: 350 }),
          mk('avionics', { computer: 'hobby', imu: 'mems', gps: 'none', tlm: 0.25 }),
          mk('solidMotor', { length: 0.25, caseMat: 'al6061', wall: 2.0, grain: 'bates', segments: 1, core: 22, al: 16, blend: 'bimodal', throat: 14, exit: 32, throatMat: 'graphite', cone: 15, liner: 1.5 }),
          mk('fins', { count: 3, root: 0.13, tip: 0.05, span: 0.075, sweep: 0.08, thk: 3.2, mat: 'g10' }),
        ],
      }],
      program: defaultProgram('suborbital'),
    };
  }
  if (kind === 'liquidSounding') {
    return {
      name: 'Liquid sounding rocket', mission: 'suborbital', payloadMass: pm, payloadLength: pl, requireRecovery: true,
      stages: [{
        id: newId('s'), name: 'Stage 1', diameter: 0.40, propLoad: 300, engineCount: 1, components: [
          mk('nosecone', { shape: 'vonKarman', fineness: 4, mat: 'cfrp', wall: 2.5, tip: 'steel', tipR: 8 }),
          mk('payload', { mass: pm, length: pl }),
          mk('recovery', { drogue: 1.2, main: 4.5, mainAlt: 900, mat: 'kevlar', sepApogee: true }),
          mk('avionics', { computer: 'industrial', imu: 'mems', gps: 'space', tlm: 2, antenna: 'patch', fts: true }),
          mk('tank', { role: 'ox', mat: 'al6061', process: 'tig', dome: 'ellip2', insul: 0 }),
          mk('tank', { role: 'fuel', mat: 'al6061', process: 'tig', dome: 'ellip2' }),
          mk('pressurization', { gas: 'helium', copv: 'cfAl', mpa: 30 }),
          mk('liquidEngine', { pair: 'LOX/Ethanol', of: 1.4, pc: 2.2, thrust: 18, thrustRef: 'SL', eps: 4.5, nozzle: 'cone', coneDeg: 15, cycle: 'pressure', injector: 'triplet', injDp: 20, lstar: 1.3, cr: 4, cooling: 'ablative', linerThk: 14, ablMat: 'silicaPhenolic', filmPct: 4, chamberMat: 'steel4130', igniter: 'pyro', gimbal: 0 }),
          mk('fins', { count: 4, root: 0.8, tip: 0.3, span: 0.55, sweep: 0.55, thk: 13, mat: 'al6061' }),
        ],
      }],
      program: defaultProgram('suborbital'),
    };
  }
  // two-stage orbital kerolox
  return {
    name: 'Two-stage orbital launcher', mission: 'orbit', payloadMass: pm, payloadLength: pl,
    stages: [
      {
        id: newId('s'), name: 'Stage 1', diameter: 1.2, propLoad: 10500, engineCount: 7, components: [
          mk('interstage', { length: 1.3, mat: 'cfrp', sep: 'pneumatic', ullage: 'rcs' }),
          mk('tank', { role: 'ox', mat: 'al2219', process: 'tig', dome: 'ellip2', stiff: 'orthogrid', insul: 0 }),
          mk('tank', { role: 'fuel', mat: 'al2219', process: 'tig', dome: 'ellip2', stiff: 'orthogrid' }),
          mk('pressurization', { gas: 'helium', copv: 'cfTi', mpa: 40, cold: true }),
          mk('avionics', { computer: 'industrial', imu: 'fog', gps: 'space', tlm: 5, antenna: 'patch', fts: true }),
          mk('liquidEngine', { pair: 'LOX/RP-1', of: 2.3, pc: 7.0, thrust: 26, thrustRef: 'SL', eps: 10, nozzle: 'bell', bellFrac: 80, cycle: 'gg', injector: 'pintle', injDp: 20, lstar: 1.15, cr: 3.5, cooling: 'regen', filmPct: 8, chamberMat: 'grcop42', method: 'lpbf', channels: 50, chHeight: 0.8, wallThk: 0.6, regenEps: 10, damping: 'none', rpm: 42000, inducer: 'hp', ggTemp: 950, turbineMat: 'in718', igniter: 'teateb', ignitions: 2, gimbal: 5, actuator: 'electromech' }),
        ],
      },
      {
        id: newId('s'), name: 'Stage 2', diameter: 1.2, propLoad: 2100, engineCount: 1, components: [
          mk('fairing', { dia: 1.2, cyl: 1.0, fineness: 1.5, mat: 'cfrp', sep: 'pneumatic' }),
          mk('payload', { mass: pm, length: pl }),
          mk('avionics', { computer: 'industrial', imu: 'fog', gps: 'space', tlm: 5, antenna: 'patch', fts: true }),
          mk('tank', { role: 'ox', mat: 'al2219', process: 'tig', dome: 'ellip2', insul: 0 }),
          mk('tank', { role: 'fuel', mat: 'al2219', process: 'tig', dome: 'ellip2' }),
          mk('pressurization', { gas: 'helium', copv: 'cfTi', mpa: 40, cold: true }),
          mk('rcs', { gas: 6, thrust: 40 }),
          mk('liquidEngine', { pair: 'LOX/RP-1', of: 2.3, pc: 5.0, thrust: 26, thrustRef: 'vac', eps: 80, nozzle: 'bell', bellFrac: 80, cycle: 'gg', injector: 'pintle', injDp: 20, lstar: 1.15, cr: 3, cooling: 'regen', filmPct: 8, chamberMat: 'grcop42', method: 'lpbf', channels: 50, chHeight: 1.0, wallThk: 0.6, regenEps: 70, extMat: 'nbC103', damping: 'none', rpm: 42000, inducer: 'hp', ggTemp: 950, turbineMat: 'in718', igniter: 'teateb', ignitions: 3, gimbal: 4, actuator: 'electromech' }),
        ],
      },
    ],
    program: defaultProgram('orbit'),
  };
}

export function defaultProgram(mission) {
  if (mission === 'orbit') return { mode: 'orbit', targetAlt: 250000, insertion: 'direct', parkingAlt: 200000, kickTime: 8, kickSpeed: 60, kickAngle: 1.0, stagingCoast: 3, ignitionDelay: 2, maxG: 5.5, maxQ: 45000, fairingAuto: true, azimuth: 90, site: 'coastal' };
  return { mode: 'suborbital', railLength: 6, elevation: 87, kickTime: 0, kickAngle: 0, stagingCoast: 1, ignitionDelay: 0.5, maxG: 60, maxQ: 1e9, azimuth: 0, site: 'desert' };
}
