// Structural sizing: thin-wall pressure vessels, shell buckling (NASA SP-8007 knockdown), COPV pressurant
// systems, insulation & boil-off. Everything's mass comes from geometry × material.
import { G0, R_HE, R_N2, clamp } from './constants.js';
import { MATERIALS, allowable } from '../data/materials.js';

export const WELD_PROCESSES = {
  tig: { name: 'TIG / GTAW fusion weld', kind: 'fusion' },
  vppa: { name: 'Variable-polarity plasma arc (VPPA)', kind: 'fusion', bonus: 0.05 },
  fsw: { name: 'Friction-stir weld', kind: 'fsw' },
  bolted: { name: 'Bolted/riveted flanges', kind: 'mech' },
  wound: { name: 'Filament-wound composite', kind: 'composite' },
};

export const STIFFENING = {
  monocoque: { name: 'Monocoque (plain skin)', buckle: 1.0, massF: 1.0 },
  orthogrid: { name: 'Orthogrid (machined)', buckle: 2.0, massF: 1.18 },
  isogrid: { name: 'Isogrid (machined)', buckle: 2.4, massF: 1.22 },
  stringer: { name: 'Stringer & frame', buckle: 2.2, massF: 1.25 },
};

export function jointEfficiency(matKey, processKey) {
  const m = MATERIALS[matKey];
  const pr = WELD_PROCESSES[processKey];
  if (!pr) return 1;
  if (pr.kind === 'fusion') return m.weld.fusion === false ? 0.2 : Math.min(0.95, m.weld.fusion + (pr.bonus || 0));
  if (pr.kind === 'fsw') return m.weld.fsw === false ? 0.2 : m.weld.fsw;
  if (pr.kind === 'mech') return 0.6;
  return 1;
}

// SP-8007 knockdown for unstiffened cylinders under axial compression
export function knockdown(R, t) {
  const phi = (1 / 16) * Math.sqrt(R / Math.max(t, 1e-6));
  return 1 - 0.901 * (1 - Math.exp(-phi));
}

export function shellAxialCapacity({ matKey, R, t, stiffening = 'monocoque', pressure = 0 }) {
  const m = MATERIALS[matKey];
  const st = STIFFENING[stiffening] || STIFFENING.monocoque;
  const sigCl = 0.605 * m.E * t / R;
  const kd = knockdown(R, t);
  const sigCr = Math.min(sigCl * kd * st.buckle, allowable(m, 'Fty'));
  return sigCr * 2 * Math.PI * R * t + pressure * Math.PI * R * R; // internal pressure relieves compression
}

export function domeGeometry(R, dome) {
  const h = dome === 'hemi' ? R : R / Math.SQRT2;
  const vol = (2 / 3) * Math.PI * R * R * h;
  let area;
  if (dome === 'hemi') area = 2 * Math.PI * R * R;
  else { const e = Math.sqrt(1 - (h / R) ** 2); area = Math.PI * R * R * (1 + ((1 - e * e) / e) * Math.atanh(e)); }
  return { h, vol, area, stressFactor: dome === 'hemi' ? 0.5 : 1.0 };
}

/**
 * Propellant tank sizing.
 * p: { propMass, rho, ullage, diameter, dome, MEOP, accelG, matKey, process, stiffening, SF, cryo, insulMm, baffles, wallMm, Tprop, hvap, strengthFactor }
 */
export function designTank(p) {
  const W = [];
  const m = MATERIALS[p.matKey];
  const R = p.diameter / 2;
  const V = p.propMass / p.rho * (1 + p.ullage);
  const d = domeGeometry(R, p.dome);
  let Vb = V - 2 * d.vol;
  if (Vb < 0) { W.push({ lvl: 'info', msg: 'Tank volume is smaller than two domes — tank is essentially two domes (consider a smaller diameter).' }); Vb = 0; }
  const Lb = Vb / (Math.PI * R * R);
  const length = Lb + 2 * d.h;
  const head = p.rho * G0 * p.accelG * (Lb + d.h);
  const pDesign = p.MEOP + head;
  const je = jointEfficiency(p.matKey, p.process);
  const cryoF = p.cryo ? m.cryoGain : 1;
  const sAllow = allowable(m, 'Ftu') * cryoF;
  const minGauge = m.cls === 'composite' ? 1.5e-3 : 1.4e-3; // handling / weld-land practical minimum
  const tHoop = p.SF * pDesign * R / (sAllow * je);
  let t = Math.max(tHoop, minGauge);
  if (p.wallMm > 0) {
    if (p.wallMm / 1000 < tHoop) W.push({ lvl: 'error', msg: `Wall ${p.wallMm} mm is below the ${(tHoop * 1000).toFixed(2)} mm required for MEOP ${(p.MEOP / 1e6).toFixed(2)} MPa + ${(head / 1e3).toFixed(0)} kPa head (SF ${p.SF}). Tank will burst.` });
    t = p.wallMm / 1000;
  }
  // axial compression (stack above × acceleration, + bending allowance) — thicken until shell carries it
  if (p.axialLoad > 0 && !(p.wallMm > 0)) {
    for (let i = 0; i < 60 && shellAxialCapacity({ matKey: p.matKey, R, t, stiffening: p.stiffening, pressure: p.MEOP * 0.5 }) < p.axialLoad * p.SF; i++) t *= 1.06;
  }
  const tDome = Math.max(minGauge, t * d.stressFactor * 1.1);
  const st = STIFFENING[p.stiffening] || STIFFENING.monocoque;
  const barrelMass = 2 * Math.PI * R * Lb * t * m.rho * st.massF;
  const domeMass = 2 * d.area * tDome * m.rho;
  const skirt = Math.PI * p.diameter * 0.3 * p.diameter * t * m.rho * st.massF; // skirt / intertank share
  let mass = (barrelMass + domeMass) * 1.08 + skirt + 0.8 + 0.004 * p.propMass; // weld lands, Y-rings, sump, anti-vortex, fill/drain
  if (p.baffles) mass += 0.03 * mass + 0.002 * p.propMass;
  const wetArea = 2 * Math.PI * R * Lb + 2 * d.area;
  let insulMass = 0, boiloff = 0, heatLeak = 0;
  if (p.cryo) {
    const dT = 300 - p.Tprop;
    if (p.insulMm > 0) {
      heatLeak = 0.022 * dT / (p.insulMm / 1000) * wetArea;
      insulMass = 38 * (p.insulMm / 1000) * wetArea;
    } else {
      heatLeak = Math.min(1500, 12 * dT) * wetArea; // frost-limited convection on bare tank
      if (p.Tprop < 60) W.push({ lvl: 'error', msg: 'Uninsulated liquid-hydrogen tank: air liquefies on the wall (cryopumping) and boil-off is enormous. Add foam insulation.' });
    }
    boiloff = heatLeak / p.hvap;
  }
  mass += insulMass;
  if (!m.lox && p.isLox) W.push({ lvl: 'error', msg: `${m.name} is NOT compatible with liquid oxygen (ignition hazard).` });
  if (p.process === 'tig' || p.process === 'vppa') {
    if (m.weld.fusion === false) W.push({ lvl: 'error', msg: `${m.name} cannot be fusion-welded — hot cracking. Use friction-stir welding or a weldable alloy.` });
    else if (m.crackProne) W.push({ lvl: 'warn', msg: `${m.name} fusion welds are crack-prone; expect many weld repairs.` });
  }
  if (p.process === 'fsw' && m.weld.fsw === false) W.push({ lvl: 'error', msg: `${m.name} cannot be friction-stir welded.` });
  if (p.cryo && p.matKey === 'steel4130') W.push({ lvl: 'error', msg: 'Low-alloy steel becomes brittle at cryogenic temperature (ductile-to-brittle transition). Use aluminum or austenitic stainless.' });
  if (p.cryo && m.cls === 'composite') W.push({ lvl: 'warn', msg: 'Composite cryotanks microcrack and leak without a liner; LOX compatibility issues.' });
  const burstCapacity = sAllow * je * t / R * (p.strengthFactor ?? 1); // actual (allowable-based) burst pressure
  const axialCap = shellAxialCapacity({ matKey: p.matKey, R, t, stiffening: p.stiffening, pressure: p.MEOP });
  return { V, R, length, barrelLength: Lb, domeH: d.h, t, tHoop, tDome, mass, insulMass, wetArea, head, pDesign, jointEff: je, burstCapacity, axialCap, boiloff, heatLeak, warnings: W };
}

// Pressurant system (helium / nitrogen stored in COPVs, or autogenous)
export const COPV_TYPES = {
  cfTi: { name: 'Carbon overwrap / titanium liner', pvw: 2.4e5, cost: 4000 },
  cfAl: { name: 'Carbon overwrap / aluminum liner', pvw: 1.9e5, cost: 2500 },
  ti: { name: 'All-titanium sphere', pvw: 0.9e5, cost: 3000 },
  steel: { name: 'Steel bottle', pvw: 0.45e5, cost: 400 },
};

export function designPressurant({ tanks, gas, copvType, copvMPa, coldStorage }) {
  // tanks: [{V, p, cryo}] — pressurant must fill the tank volume at operating pressure by end of burn
  if (gas === 'autogenous') {
    const m = tanks.reduce((s, t) => s + t.V * 0.6, 0);
    return { gasMass: 0, copvMass: 0, systemMass: 2 + 0.01 * m, copvVolume: 0, nCopv: 0 };
  }
  const R = gas === 'nitrogen' ? R_N2 : R_HE;
  let need = 0;
  for (const t of tanks) {
    const Tull = t.cryo ? 160 : 280;
    const collapse = t.cryo ? 1.6 : 1.1;
    need += t.p * t.V / (R * Tull) * collapse;
  }
  const pC = copvMPa * 1e6;
  const pMax = Math.max(...tanks.map(t => t.p));
  const pFinal = Math.min(pC * 0.9, pMax * 1.4 + 0.5e6);
  const Tstore = coldStorage ? 90 : 290;
  const store = need / Math.max(0.05, 1 - pFinal / pC);
  const Vc = store * R * Tstore / pC;
  const ct = COPV_TYPES[copvType] || COPV_TYPES.cfAl;
  const copvMass = pC * Vc * 1.5 / ct.pvw;
  const W = [];
  if (pFinal >= pC * 0.9) W.push({ lvl: 'error', msg: `Pressurant storage pressure ${copvMPa} MPa is too low to pressurize tanks at ${(pMax / 1e6).toFixed(1)} MPa.` });
  const nCopv = Math.max(1, Math.ceil(Vc / 0.25));
  return { gasMass: store, copvMass, systemMass: copvMass + store + 3 + 0.05 * copvMass, copvVolume: Vc, nCopv, warnings: W };
}

// Unpressurized shell (interstage, skirts, airframe, fairing) sized for a given axial design load.
export function designShell({ matKey, R, length, loadN, SF, stiffening = 'monocoque', minMm = 1.0, sandwich = false, wallMm = 0 }) {
  const m = MATERIALS[matKey];
  let t = Math.max(minMm / 1000, wallMm / 1000);
  if (wallMm <= 0) {
    for (let i = 0; i < 80 && shellAxialCapacity({ matKey, R, t, stiffening }) < loadN * SF; i++) t *= 1.08;
  }
  const st = STIFFENING[stiffening] || STIFFENING.monocoque;
  let mass = 2 * Math.PI * R * length * t * m.rho * st.massF;
  if (sandwich) mass = 2 * Math.PI * R * length * (2 * t * m.rho * 0.5 + 0.02 * 50); // thin skins + honeycomb core
  const cap = shellAxialCapacity({ matKey, R, t: sandwich ? t * 2.5 : t, stiffening });
  return { t, mass: mass * 1.12, capacity: cap };
}

export const clampV = clamp;
