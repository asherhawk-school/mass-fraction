// Solid rocket motor internal ballistics.
// Quasi-steady chamber: Pc = (a·ρp·c*·Kn)^(1/(1−n)), Kn = Ab/At. Grain regression simulated over web.
// Includes temperature sensitivity, erosive burning, throat erosion, defects (voids, cracks, debonds) and CATO.
import { G0, P_SL, DEG } from './constants.js';
import { AP_BLENDS, SOLID_INGREDIENTS, TEMP_SENSITIVITY } from '../data/propellants.js';
import { solidCombustion } from './thermochem.js';
import { machFromAreaRatio, pRatio, cfMomentum, nozzlePerf, expansionGamma } from './nozzle.js';
import { MATERIALS, TPS, allowable } from '../data/materials.js';

export function propellantDensity(alFrac, binderFrac = 0.14) {
  const ap = 1 - alFrac - binderFrac;
  const { AP, Al, HTPB } = SOLID_INGREDIENTS;
  return 0.985 / (ap / AP.rho + alFrac / Al.rho + binderFrac / HTPB.rho);
}

// Burn area and port area as a function of web burned y (all SI)
function grainGeometry(g, y) {
  const D = g.D, d = g.coreDia;
  if (g.type === 'endburner') {
    const len = g.L - y;
    return { Ab: len > 0 ? Math.PI * D * D / 4 : 0, Ap: 1e-6, web: g.L, done: len <= 0 };
  }
  if (g.type === 'bates') {
    const n = g.segments, Ls = (g.L - (n - 1) * 0.005) / n;
    const dc = d + 2 * y, Lc = Ls - 2 * y;
    if (dc >= D || Lc <= 0) return { Ab: 0, Ap: Math.PI * D * D / 4, done: true };
    const per = Math.PI * dc * Lc + 2 * (Math.PI / 4) * (D * D - dc * dc);
    return { Ab: n * per, Ap: Math.PI * dc * dc / 4, done: false };
  }
  // case-bonded, ends inhibited: star / finocyl / tube
  const dc = d + 2 * y;
  if (dc >= D) return { Ab: 0, Ap: Math.PI * D * D / 4, done: true };
  let perim = Math.PI * dc, Ap = Math.PI * dc * dc / 4;
  if (g.type === 'star') {
    const depth = g.starDepth; // radial depth of star points (m)
    const rem = Math.max(0, depth - y);
    // star points add perimeter ~ 2·N·(remaining depth)/sin(half-angle) ; points fill in as they burn
    perim += 2 * g.points * rem / Math.sin(30 * DEG) * 0.55;
    Ap += g.points * rem * (0.25 * dc) * 0.5;
  } else if (g.type === 'finocyl') {
    const rem = Math.max(0, g.finDepth - y);
    perim += 2 * g.fins * rem;
    Ap += g.fins * rem * 0.004;
  }
  return { Ab: perim * g.L, Ap, done: false };
}

export function webThickness(g) {
  if (g.type === 'endburner') return g.L;
  if (g.type === 'bates') {
    const n = g.segments, Ls = (g.L - (n - 1) * 0.005) / n;
    return Math.min((g.D - g.coreDia) / 2, Ls / 2);
  }
  return (g.D - g.coreDia) / 2;
}

export function grainVolume(g) {
  const A = Math.PI * g.D * g.D / 4;
  if (g.type === 'endburner') return A * g.L;
  const g0 = grainGeometry(g, 0);
  if (g.type === 'bates') return (A - g0.Ap) * (g.L - (g.segments - 1) * 0.005);
  return (A - g0.Ap) * g.L;
}

/**
 * p: { D (grain OD m), L (grain length m), type, segments, coreDia, points, starDepth, fins, finDepth,
 *      alFrac, binderFrac, blend, throatDia, exitDia, throatMat, coneDeg, grainTempK, burstPressure,
 *      defects: [{type, severity, webFrac}], rateBias }
 */
export function simulateSolid(p) {
  const g = { type: p.type, D: p.D, L: p.L, coreDia: p.coreDia, segments: p.segments || 1, points: p.points || 6, starDepth: p.starDepth || 0, fins: p.fins || 6, finDepth: p.finDepth || 0 };
  const rhoP = propellantDensity(p.alFrac, p.binderFrac ?? 0.14);
  const blend = AP_BLENDS[p.blend] || AP_BLENDS.bimodal;
  const n = blend.n;
  const tempK = p.grainTempK ?? 294;
  const aMm = blend.a * (1 + 0.5 * p.alFrac) * Math.exp(TEMP_SENSITIVITY * (tempK - 294)) * (p.rateBias ?? 1);
  const aSI = (aMm * 1e-3) / Math.pow(1e6, n);           // r[m/s] = aSI · Pc[Pa]^n
  const comb = solidCombustion(p.alFrac, 6e6);
  const etaC = 0.965 + 0.02 * Math.min(1, p.throatDia / 0.1);
  const cstar = comb.cstar * etaC;
  const gam = comb.gamma;
  const tps = TPS[p.throatMat] || TPS.graphite;
  let Dt = p.throatDia;
  const De = p.exitDia;
  const Ae = Math.PI * De * De / 4;
  const lam = (1 + Math.cos((p.coneDeg ?? 15) * DEG)) / 2;
  const twoPhase = 1 - 0.15 * p.alFrac * (0.6 + 0.4 * Math.min(1, 0.05 / Math.max(p.throatDia, 0.005)));
  const etaCf = lam * 0.985 * twoPhase;
  const web = webThickness(g);
  const defects = (p.defects || []).map(d => ({ ...d, active: false, spent: false }));
  let crackArea = 0;
  for (const d of defects) if (d.type === 'grainCrack') crackArea += d.severity * 0.35;

  const out = { t: [], pc: [], fvac: [], mdot: [], cato: null, rhoP, web, cstar, gamma: gam };
  let t = 0, y = 0, impulseVac = 0, mass = 0, maxPc = 0;
  const dy = web / 500;
  const Ab0 = grainGeometry(g, 0).Ab;
  // ignition transient: 0.12 s ramp
  const tRamp = 0.05 + 0.05 * Math.min(2, p.D / 0.15);
  let last = null;
  let prevPc = 0;
  for (let it = 0; it < 20000 && y < web; it++) {
    const geo = grainGeometry(g, y);
    if (geo.done || geo.Ab <= 0) break;
    let Ab = geo.Ab * (1 + crackArea);
    const wf = y / web;
    for (const d of defects) {
      if (d.type === 'void' && !d.spent && wf >= d.webFrac) { d.active = true; if (wf > d.webFrac + 0.05) { d.active = false; d.spent = true; } }
      if (d.type === 'debond' && wf >= Math.min(d.webFrac, 0.85)) d.active = true;
      if (d.active) Ab += (d.type === 'void' ? 0.25 : 0.9) * d.severity * Ab0;
    }
    const At = Math.PI * Dt * Dt / 4;
    const Kn = Ab / At;
    let pc = Math.pow(aSI * rhoP * cstar * Kn, 1 / (1 - n));
    // erosive burning: when port area approaches throat area, high gas velocity augments burn rate
    const J = At / Math.max(geo.Ap, 1e-9);
    const erosive = 1 + 0.6 * Math.max(0, J - 0.45);
    pc *= Math.pow(erosive, 1 / (1 - n));
    const r = aSI * Math.pow(pc, n) * erosive;
    const dt = dy / r;
    const mdot = rhoP * Ab * r;
    const gx = expansionGamma(gam, Ae / At);
    const Me = machFromAreaRatio(Ae / At, gx);
    const pr = pRatio(Me, gx);
    const cfv = cfMomentum(gx, pr) * etaCf + (Ae / At) * pr;
    const fvac = cfv * pc * At;
    if (t === 0) {
      // ramp
      const steps = 6;
      for (let k = 0; k < steps; k++) {
        const f = (k + 1) / (steps + 1);
        out.t.push(tRamp * k / steps); out.pc.push(pc * f * f); out.fvac.push(fvac * f * f); out.mdot.push(mdot * f * f);
      }
      t = tRamp;
    }
    out.t.push(t); out.pc.push(pc); out.fvac.push(fvac); out.mdot.push(mdot);
    maxPc = Math.max(maxPc, pc);
    if (p.burstPressure && pc > p.burstPressure && !out.cato) {
      out.cato = { time: t, pc, cause: defects.some(d => d.active) ? 'defect' : 'overpressure' };
      break;
    }
    impulseVac += fvac * dt; mass += mdot * dt;
    // throat erosion (mm/s scaled with Pc^0.8)
    Dt += 2 * (tps.erosion * 1e-3) * Math.pow(pc / 7e6, 0.8) * dt;
    t += dt; y += dy; prevPc = pc;
    last = { pc, fvac, mdot, At, cfv };
  }
  // tail-off (sliver + chamber blowdown)
  if (last && !out.cato) {
    const tau = 0.08 + 0.1 * Math.min(2, p.D / 0.2);
    for (let k = 1; k <= 10; k++) {
      const f = Math.exp(-k * 0.5);
      out.t.push(t + k * tau * 0.5); out.pc.push(last.pc * f); out.fvac.push(last.fvac * f); out.mdot.push(last.mdot * f);
      impulseVac += last.fvac * f * tau * 0.5; mass += last.mdot * f * tau * 0.5;
    }
    t += 5 * tau;
  }
  const propMass = grainVolume(g) * rhoP;
  out.burnTime = t;
  out.impulseVac = impulseVac;
  out.propMass = propMass;
  out.ispVac = impulseVac / Math.max(mass, 1e-9) / G0;
  out.ispSL = (impulseVac - P_SL * Ae * t) / Math.max(mass, 1e-9) / G0;
  out.maxPc = maxPc;
  out.avgThrustVac = impulseVac / Math.max(t, 1e-6);
  out.Ae = Ae;
  out.At0 = Math.PI * p.throatDia * p.throatDia / 4;
  out.atEnd = Math.PI * Dt * Dt / 4;
  out.kn0 = Ab0 / out.At0;
  out.motorClass = motorClass(impulseVac, out.avgThrustVac);
  out.aMm = aMm; out.n = n;
  // sea-level separation check at peak Pc
  const sl = nozzlePerf({ g: expansionGamma(gam, Ae / out.At0), eps: Ae / out.At0, pc: maxPc, pa: P_SL, etaCf });
  out.gammaExp = expansionGamma(gam, Ae / out.At0);
  out.slSeparated = sl.separated;
  out.etaCf = etaCf;
  return out;
}

// Hobby/industry motor designation: impulse class letter + average thrust (N)
export function motorClass(I, Favg) {
  if (I <= 2.5) return 'A' + Math.round(Favg);
  const k = Math.ceil(Math.log2(I / 2.5));
  const letter = k < 26 ? String.fromCharCode(65 + k) : 'Z+';
  return letter + Math.round(Favg);
}

// Case design: thin-wall hoop stress with joint efficiency and safety factor
export function caseBurstPressure(matKey, od, wall, jointEff = 1, strengthFactor = 1) {
  const m = MATERIALS[matKey];
  const r = od / 2 - wall / 2;
  return allowable(m, 'Ftu') * jointEff * strengthFactor * wall / r;
}

// Hot-day MEOP: Pc rises with grain temperature via σp/(1−n)
export function hotDayPc(nominalPc, n, fromK = 294, toK = 322) {
  return nominalPc * Math.exp(TEMP_SENSITIVITY * (toK - fromK) / (1 - n));
}
