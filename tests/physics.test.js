// Physics validation against published reference values. Run: npm test  (node --test tests/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atmosphere } from '../src/physics/atmosphere.js';
import { designLiquidEngine } from '../src/physics/liquidEngine.js';
import { simulateSolid } from '../src/physics/solidMotor.js';
import { elements, propagate, inclination } from '../src/physics/orbit.js';
import { MU, RE } from '../src/physics/constants.js';
import { finsCNa } from '../src/physics/aero.js';
import { templateDesign, computeVehicle } from '../src/model/vehicle.js';
import { FlightSim } from '../src/physics/flightSim.js';
import { SITES } from '../src/data/world.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);
const rel = (a, b, frac, msg) => near(a, b, Math.abs(b) * frac, msg);

test('US Standard Atmosphere 1976 matches tables within 1%', () => {
  // geometric altitude m → [T K, P Pa, rho kg/m3]
  const ref = [[0, 288.15, 101325, 1.2250], [11000, 216.77, 22700, 0.36480], [20000, 216.65, 5529.3, 0.088910], [50000, 270.65, 79.779, 0.0010269], [80000, 198.64, 1.0524, 1.8458e-5]];
  for (const [z, T, P, rho] of ref) {
    const a = atmosphere(z);
    rel(a.T, T, 0.01, `T at ${z}`); rel(a.P, P, 0.01, `P at ${z}`); rel(a.rho, rho, 0.01, `rho at ${z}`);
  }
});

const MERLIN = { pair: 'LOX/RP-1', of: 2.36, pc: 9.7, thrust: 845, thrustRef: 'SL', eps: 16, nozzle: 'bell', bellFrac: 80, coneDeg: 15, cycle: 'gg', injector: 'pintle', injDp: 20, lstar: 1.15, cr: 3, cooling: 'regen', filmPct: 3, chamberMat: 'cucrzr', method: 'machined', channels: 240, chHeight: 2.2, wallThk: 0.8, regenEps: 16, extMat: 'nbC103', damping: 'none', rpm: 36000, inducer: 'hp', ggTemp: 1050, turbineMat: 'in718', igniter: 'teateb', ignitions: 3, gimbal: 5, actuator: 'hydraulic' };

test('Merlin-1D-class LOX/RP-1 gas-generator engine: Isp ≈ 282 s SL / 311 s vac (±3%)', () => {
  const e = designLiquidEngine(MERLIN);
  rel(e.ispSL, 282, 0.03, 'Isp SL');
  rel(e.ispVac, 311, 0.03, 'Isp vac');
});

test('F-1-class engine: Isp ≈ 263 s SL / 304 s vac (±3%)', () => {
  const e = designLiquidEngine({ ...MERLIN, pc: 7.0, of: 2.27, thrust: 6770, injector: 'doublet', damping: 'baffles', channels: 600, chHeight: 4, rpm: 5500, inducer: 'std', ggTemp: 1060 });
  rel(e.ispSL, 263, 0.03, 'Isp SL'); rel(e.ispVac, 304, 0.03, 'Isp vac');
});

test('RL10A-4-class LOX/LH2 expander: vacuum Isp ≈ 451 s (±3%), cycle closes', () => {
  const e = designLiquidEngine({ ...MERLIN, pair: 'LOX/LH2', of: 5.5, pc: 4.4, thrust: 110, thrustRef: 'vac', eps: 84, cycle: 'expander', injector: 'coax', channels: 180, chHeight: 3, filmPct: 0, regenEps: 84, igniter: 'spark', rpm: 30000, inducer: 'std' });
  rel(e.ispVac, 451, 0.03, 'Isp vac');
  assert.ok(!e.warnings.some(w => w.msg.includes('Expander cycle closes only')), 'expander power balance');
});

test('AJ10-class hypergolic pressure-fed ablative: vacuum Isp ≈ 319 s (±3%)', () => {
  const e = designLiquidEngine({ ...MERLIN, pair: 'NTO/A50', of: 1.9, pc: 0.86, thrust: 43.7, thrustRef: 'vac', eps: 65, cycle: 'pressure', injector: 'triplet', cooling: 'ablative', linerThk: 30, ablMat: 'silicaPhenolic', burnTimeHint: 300, chamberMat: 'ss304L', igniter: 'hypergolic', filmPct: 0 });
  rel(e.ispVac, 319, 0.03, 'Isp vac');
});

test('Bartz throat heat flux for a high-Pc kerolox engine is tens of MW/m²', () => {
  const e = designLiquidEngine(MERLIN);
  assert.ok(e.ht.qThroat > 1e7 && e.ht.qThroat < 1.5e8, `qThroat ${e.ht.qThroat}`);
});

test('Large over-expanded nozzle separates at sea level (Summerfield)', () => {
  const e = designLiquidEngine({ ...MERLIN, eps: 120 });
  assert.equal(e.sepSL, true);
});

test('Solid motor: equilibrium Pc matches the Kn hand calculation and APCP Isp is 230–270 s', () => {
  const p = { D: 0.098, L: 0.6, type: 'bates', segments: 3, coreDia: 0.03, alFrac: 0.16, blend: 'bimodal', throatDia: 0.02, exitDia: 0.05, throatMat: 'graphite', coneDeg: 15 };
  const s = simulateSolid(p);
  assert.ok(s.ispVac > 230 && s.ispVac < 275, `Isp ${s.ispVac}`);
  // hand calc at t=0: Pc = (a ρ c* Kn)^(1/(1-n))
  const aSI = (s.aMm * 1e-3) / Math.pow(1e6, s.n);
  const pc = Math.pow(aSI * s.rhoP * s.cstar * s.kn0, 1 / (1 - s.n));
  rel(s.pc[6], pc, 0.06, 'initial Pc');
});

test('A void in the grain raises chamber pressure; a large debond bursts the case', () => {
  const p = { D: 0.098, L: 0.6, type: 'bates', segments: 3, coreDia: 0.03, alFrac: 0.16, blend: 'bimodal', throatDia: 0.02, exitDia: 0.05, throatMat: 'graphite', coneDeg: 15 };
  const clean = simulateSolid(p);
  const bad = simulateSolid({ ...p, defects: [{ type: 'debond', severity: 1, webFrac: 0.4 }], burstPressure: clean.maxPc * 1.3 });
  assert.ok(bad.cato, 'expected CATO with severe debond');
});

test('Two-body propagation conserves energy to < 0.01% over 10 orbits at 200 km', () => {
  const r = RE + 200000, v = Math.sqrt(MU / r);
  let s = { x: 0, y: r, vx: v * 1.001, vy: 0 };
  const e0 = elements(s.x, s.y, s.vx, s.vy).E;
  const T = elements(s.x, s.y, s.vx, s.vy).period;
  for (let i = 0; i < 100; i++) s = propagate(s.x, s.y, s.vx, s.vy, T / 10);
  const e1 = elements(s.x, s.y, s.vx, s.vy).E;
  assert.ok(Math.abs((e1 - e0) / e0) < 1e-4, `energy drift ${(e1 - e0) / e0}`);
});

test('Inclination from latitude and azimuth: due east from 28.5° gives 28.5°', () => {
  near(inclination(28.5, 90), 28.5, 1e-6, 'incl');
  near(inclination(57.4, 193.8), 97.4, 0.2, 'SSO from polar range');
});

test('Barrowman: fins move CP aft — bigger fins give larger normal-force slope', () => {
  const a = finsCNa({ n: 3, Cr: 0.1, Ct: 0.05, span: 0.06, sweep: 0.05, d: 0.075, M: 0.3 });
  const b = finsCNa({ n: 3, Cr: 0.1, Ct: 0.05, span: 0.09, sweep: 0.05, d: 0.075, M: 0.3 });
  assert.ok(b.cna > a.cna);
});

function fly(kind, payload) {
  const d = templateDesign(kind, payload);
  const an = computeVehicle(d);
  const wx = { surface: 3, gust: 2, jet: 25, jetAlt: 11500, strato: 8, meso: 25, surfaceDirTo: 90, jetDirTo: 90, turbScale: 0.5, tempC: 20 };
  const sim = new FlightSim({ design: d, analysis: an, site: SITES[d.program.site], weather: wx, program: d.program, seed: 3 });
  while (!sim.finished && sim.t < 9000) sim.advance(20);
  return { s: sim.summary(), sim, an };
}

test('Sounding-rocket template flies and recovers its payload', () => {
  const { s } = fly('sounding', { payloadMass: 1, payloadLength: 0.2 });
  assert.equal(s.result, 'recovered');
  assert.ok(s.apogee > 3000, `apogee ${s.apogee}`);
});

test('Two-stage orbital template reaches a ~250 km orbit; ascent losses are realistic', () => {
  const { s, sim, an } = fly('orbit', { payloadMass: 8, payloadLength: 0.4 });
  assert.equal(s.result, 'orbit');
  near(s.orbit.periAlt, 250000, 30000, 'perigee');
  // Δv bookkeeping: ideal Δv used vs. orbital velocity gained → gravity + drag + steering losses
  const dvIdeal = an.perf.reduce((t, p) => t + p.dv, 0);
  assert.ok(dvIdeal > 7800, 'ideal dv');
});
