// Liquid rocket engine preliminary design: performance, chamber sizing, cooling, feed cycle,
// turbomachinery, combustion stability and mass. Methods per Huzel & Huang (NASA SP-125), Sutton & Biblarz.
import { G0, P_SL, DEG, clamp } from './constants.js';
import { PAIRS, LIQUIDS } from '../data/propellants.js';
import { MATERIALS, TPS, allowable } from '../data/materials.js';
import { combustion } from './thermochem.js';
import { nozzlePerf, divergenceFactor, expansionGamma, machFromAreaRatio, pRatio, cfMomentum } from './nozzle.js';
import { engineContour, regenAnalysis, radiativeWall, ablativeAnalysis, bartzH } from './heatTransfer.js';

export const INJECTORS = {
  showerhead: { name: 'Showerhead (non-impinging)', etaC: 0.93, hf: 0.6, cost: 1.0, note: 'Crude mixing, low efficiency, gentle on walls.' },
  doublet: { name: 'Like-on-like doublet', etaC: 0.965, hf: 1.4, cost: 1.2, note: 'Simple to drill; prone to high-frequency instability in large chambers (F-1 needed baffles).' },
  triplet: { name: 'Unlike triplet (O-F-O)', etaC: 0.975, hf: 1.2, cost: 1.3, note: 'Good mixing; hot streaks near walls if mis-drilled.' },
  coax: { name: 'Coaxial swirl', etaC: 0.99, hf: 0.5, cost: 2.2, note: 'Best mixing and stability; many precision elements.' },
  pintle: { name: 'Pintle', etaC: 0.985, hf: 0.3, cost: 1.5, deepThrottle: true, note: 'Inherently stable, deep-throttleable (variable-area pintle).' },
};

export const CYCLES = {
  pressure: { name: 'Pressure-fed', start: 0.4, note: 'No pumps — tanks must hold more than chamber pressure. Simple but heavy tanks.' },
  electric: { name: 'Electric pump-fed', start: 0.8, note: 'Battery-driven motors spin the pumps. Battery mass grows with burn time.' },
  gg: { name: 'Gas generator', start: 1.6, note: 'A small burner drives the turbine; its exhaust is dumped overboard (Isp penalty).' },
  expander: { name: 'Expander', start: 3.0, note: 'Coolant heat drives the turbine. Clean & reliable but power-limited (LH2/CH4 only).' },
  stagedFuel: { name: 'Fuel-rich staged combustion', start: 3.0, note: 'All turbine gas goes into the chamber — no dump losses, very high pressures.' },
  stagedOx: { name: 'Ox-rich staged combustion', start: 3.0, note: 'Hot oxygen-rich turbine gas: needs burn-resistant alloys.' },
};

export const IGNITERS = {
  pyro: { name: 'Pyrotechnic cartridge', starts: 1, mass: 0.2, reliability: 0.995 },
  teateb: { name: 'TEA-TEB hypergolic slug', starts: 3, mass: 1.5, reliability: 0.997 },
  spark: { name: 'Spark-torch igniter', starts: 50, mass: 0.6, reliability: 0.993 },
  hypergolic: { name: 'Hypergolic (none needed)', starts: 99, mass: 0, reliability: 0.9995 },
};

const INDUCERS = { none: { S: 4, name: 'No inducer' }, std: { S: 10, name: 'Standard inducer' }, hp: { S: 16, name: 'High-performance inducer' } };

export function designLiquidEngine(p, opts = {}) {
  const W = [];
  const warn = (lvl, msg) => W.push({ lvl, msg });
  const pair = PAIRS[p.pair];
  const ox = LIQUIDS[pair.ox], fu = LIQUIDS[pair.fuel];
  const pc = p.pc * 1e6;
  const comb = combustion(p.pair, p.of, pc);
  if (comb.offRange > 0) warn('warn', `O/F ${p.of.toFixed(2)} is outside the practical range ${pair.ofRange.join('–')} — combustion data extrapolated.`);
  const inj = INJECTORS[p.injector];
  const cyc = CYCLES[p.cycle];
  const filmFrac = (p.filmPct || 0) / 100;
  const lstarRatio = p.lstar / pair.lstar;
  const etaLstar = 1 - 0.08 * Math.exp(-2.5 * lstarRatio);
  const ofErr = opts.ofShift ?? 0; // manufacturing defect: orifice tolerance
  let etaC = inj.etaC * etaLstar * (1 - 0.3 * filmFrac) * (1 - 0.8 * Math.abs(ofErr));
  if (lstarRatio < 0.6) warn('warn', `L* = ${p.lstar.toFixed(2)} m is short for ${p.pair} (recommended ≈${pair.lstar} m): incomplete combustion, c* efficiency ${(etaLstar * 100).toFixed(1)}%.`);
  const cstar = comb.cstar * etaC;
  const gx = expansionGamma(comb.gamma, p.eps);
  const lam = divergenceFactor(p.nozzle, p.coneDeg, p.bellFrac / 100);
  const etaCf = lam * 0.99 * 0.995;
  const Me = machFromAreaRatio(p.eps, gx);
  const prE = pRatio(Me, gx);
  const cfVac = cfMomentum(gx, prE) * etaCf + p.eps * prE;
  const slPerf = nozzlePerf({ g: gx, eps: p.eps, pc, pa: P_SL, etaCf, Me });
  const refCf = p.thrustRef === 'SL' ? slPerf.cf : cfVac;
  const Fref = p.thrust * 1000;
  const At = Fref / (refCf * pc);
  const Dt = 2 * Math.sqrt(At / Math.PI);
  const Ae = At * p.eps, De = Dt * Math.sqrt(p.eps);
  const mdot = pc * At / cstar;
  const mdotOx = mdot * p.of / (1 + p.of), mdotFuel = mdot / (1 + p.of);
  const FvacMain = cfVac * pc * At;
  const FslMain = slPerf.cf * pc * At;
  if (slPerf.separated) warn(p.thrustRef === 'SL' ? 'error' : 'info', `Nozzle flow separates at sea level (exit pressure ${(prE * pc / 1000).toFixed(1)} kPa < 0.4 × ambient). Side loads can break a sea-level nozzle — vacuum use only.`);
  else if (prE * pc < 0.6 * P_SL && p.thrustRef === 'SL') warn('warn', `Highly over-expanded at sea level (pe = ${(prE * pc / 1000).toFixed(0)} kPa). Near separation — side-load risk during start.`);

  // ---- chamber geometry ----
  const Ac = At * p.cr, Dc = 2 * Math.sqrt(Ac / Math.PI);
  const Rt = Dt / 2, Rc = Dc / 2;
  const Vc = p.lstar * At;
  const convA = 30 * DEG;
  const Lconv = (Rc - Rt) / Math.tan(convA);
  const Vconv = Math.PI / 3 * Lconv * (Rc * Rc + Rc * Rt + Rt * Rt);
  let Lcyl = (Vc - Vconv) / Ac;
  if (Lcyl < 0.2 * Dc) { if (Lcyl < 0) warn('warn', 'Contraction ratio too high for this L*: the converging section alone exceeds the chamber volume.'); Lcyl = Math.max(Lcyl, 0.2 * Dc); }
  const contour = engineContour({ Rt, Rc, Lcyl, eps: p.eps, nozzle: p.nozzle, bellFrac: p.bellFrac / 100, coneDeg: p.coneDeg });
  const length = contour.length;
  // regen extent (area ratio limit)
  let regenEndIdx = contour.pts.length - 1;
  const regenEps = p.cooling === 'regen' ? Math.min(p.regenEps, p.eps) : 1;
  if (p.cooling === 'regen' && p.regenEps < p.eps) {
    for (let i = contour.throatIdx; i < contour.pts.length; i++) {
      if ((contour.pts[i].r / Rt) ** 2 >= regenEps) { regenEndIdx = i; break; }
    }
  }

  // ---- feed system & cycle ----
  const injDp = p.injDp / 100 * pc;
  const lineDp = 0.04 * pc + 0.15e6;
  const pInjOx = pc + injDp + lineDp;
  let dpRegen = p.cooling === 'regen' ? 0.15 * pc : 0;
  const chMat = MATERIALS[p.chamberMat];
  const wall = { k: chMat.k, t: p.wallThk / 1000, Tmax: chMat.Tmax, E: chMat.E, alpha: chMat.alpha, nu: chMat.nu, Fty: chMat.Fty };
  let ht = null, pInjFuel = 0, pTankOx = 0, pTankFuel = 0, pumpOx = 0, pumpFuel = 0, turbineP = 0, mdotGG = 0, npshOx = 0, npshFuel = 0, dn = 0, pDisOx = 0, pDisFuel = 0, elecPower = 0, turbinePR = 0;
  const isPump = p.cycle !== 'pressure';
  const ind = INDUCERS[p.inducer] || INDUCERS.std;
  const omega = (p.rpm || 30000) * 2 * Math.PI / 60;
  const etaP = 0.62 + 0.08 * Math.min(1, mdot / 200);
  for (let iter = 0; iter < 4; iter++) {
    pInjFuel = pc + injDp + lineDp + dpRegen;
    if (!isPump) {
      pTankOx = pInjOx; pTankFuel = pInjFuel;
    } else {
      const npsh = (rho, mdotX) => Math.pow(omega * Math.sqrt(mdotX / rho) / ind.S, 4 / 3) / G0;
      npshOx = npsh(ox.rho, mdotOx); npshFuel = npsh(fu.rho, mdotFuel);
      pTankOx = Math.max(0.15e6, ox.pv + 1.3 * ox.rho * G0 * npshOx + 0.04e6);
      pTankFuel = Math.max(0.15e6, fu.pv + 1.3 * fu.rho * G0 * npshFuel + 0.04e6);
      let PR = 1;
      if (p.cycle === 'stagedFuel' || p.cycle === 'stagedOx') PR = Math.min(turbinePR || 1.6, 4);
      pDisOx = (p.cycle === 'stagedOx' ? pInjOx * PR : pInjOx);
      pDisFuel = (p.cycle === 'stagedFuel' ? pInjFuel * PR : pInjFuel);
      if (p.cycle === 'stagedOx') pDisFuel = Math.max(pDisFuel, pDisOx * 1.05); // fuel to preburner too
      if (p.cycle === 'stagedFuel') pDisOx = Math.max(pDisOx, pDisFuel * 1.05);
      pumpOx = mdotOx * (pDisOx - pTankOx) / (ox.rho * etaP);
      pumpFuel = mdotFuel * (pDisFuel - pTankFuel) / (fu.rho * (etaP - 0.04));
      turbineP = (pumpOx + pumpFuel) / 0.97;
      if (p.cycle === 'stagedFuel' || p.cycle === 'stagedOx') {
        const oxRich = p.cycle === 'stagedOx';
        const Tpb = oxRich ? 750 : 1000, cpT = oxRich ? 1150 : (pair.ggCp), gT = oxRich ? 1.33 : pair.ggGamma;
        const mdotT = oxRich ? mdotOx * 1.03 : mdotFuel * 1.15;
        const wNeed = turbineP / mdotT;
        const frac = wNeed / (cpT * Tpb * 0.7);
        turbinePR = frac >= 0.95 ? 99 : Math.pow(1 - frac, -gT / (gT - 1));
      }
    }
    if (p.cooling === 'regen') {
      const coolant = fu.coolant;
      if (!coolant) { warn('error', `${fu.name} cannot be used as a regenerative coolant.`); break; }
      ht = regenAnalysis({
        contour, Rt, pc, cstar, gamma: comb.gamma, Tc: comb.Tc, Mw: comb.M, coolant, Tin: fu.Tstore, mdotC: mdotFuel * (1 - filmFrac),
        pIn: isPump ? pDisFuel : pTankFuel, wall, channels: p.channels, chH: p.chHeight / 1000, rib: Math.max(0.6e-3, p.wallThk / 1000),
        roughness: p.method === 'lpbf' ? 2.2 : 1.0, filmFrac, regenEndIdx, hotspot: opts.hotspot, soot: pair.soot ?? 1,
      });
      dpRegen = Math.min(ht.dp, 3 * pc);
    } else break;
  }
  if (isPump) {
    // shaft & bearings
    const torque = turbineP / omega;
    const tau = 280e6 / 1.5;
    const d = Math.cbrt(16 * torque / (Math.PI * tau));
    const bore = d * 1000 + 6;
    dn = bore * (p.rpm || 30000);
    if (dn > 2.2e6) warn('error', `Bearing DN ${(dn / 1e6).toFixed(2)}M exceeds ~2.2M limit for cryogenic ball bearings — bearings will fail. Lower RPM.`);
    else if (dn > 1.7e6) warn('warn', `Bearing DN ${(dn / 1e6).toFixed(2)}M is aggressive (wear and cage instability risk).`);
    if (p.cycle === 'gg') {
      const Tgg = p.ggTemp, PR = 25, gg = pair.ggGamma;
      const w = pair.ggCp * Tgg * 0.68 * (1 - Math.pow(PR, -(gg - 1) / gg));
      mdotGG = turbineP / w;
      if (Tgg > 1100) warn('warn', `Gas-generator temperature ${Tgg} K exceeds ~1100 K turbine-blade limit — creep/erosion risk.`);
    }
    if (p.cycle === 'expander') {
      if (!(pair.fuel === 'LH2' || pair.fuel === 'LCH4')) warn('error', 'Expander cycle needs a fuel that stays gaseous and energetic after cooling (LH2 or methane).');
      if (p.cooling !== 'regen') warn('error', 'Expander cycle requires regenerative cooling to heat the turbine drive gas.');
      if (ht) {
        const cpC = fu.coolant.cp, gC = fu.coolant.gamma;
        const avail = mdotFuel * cpC * ht.TcoolOut * 0.6 * (1 - Math.pow(1.7, -(gC - 1) / gC));
        if (avail < turbineP) warn('error', `Expander cycle closes only to ${(avail / 1e3).toFixed(0)} kW of turbine power but pumps need ${(turbineP / 1e3).toFixed(0)} kW. Reduce thrust/Pc or lengthen the chamber for more heat pickup.`);
      }
    }
    if (p.cycle === 'stagedOx' || p.cycle === 'stagedFuel') {
      if (turbinePR > 4) warn('error', `Staged-combustion power balance does not close (turbine pressure ratio ${turbinePR > 50 ? '∞' : turbinePR.toFixed(1)}). Lower Pc or improve pump efficiency.`);
      if (p.cycle === 'stagedOx' && !MATERIALS[p.turbineMat]?.oxRich) warn('error', `Hot oxygen-rich turbine gas will burn ${MATERIALS[p.turbineMat]?.name}. Ox-rich staged combustion needs a burn-resistant superalloy.`);
      if (Math.max(pDisOx, pDisFuel) > 60e6) warn('warn', `Pump discharge ${(Math.max(pDisOx, pDisFuel) / 1e6).toFixed(0)} MPa — extreme; heavy lines and seals.`);
    }
    if (p.cycle === 'electric') {
      elecPower = turbineP / (0.93 * 0.97);
      if (elecPower > 2e6) warn('warn', `Electric pumps need ${(elecPower / 1e6).toFixed(1)} MW — battery mass will be prohibitive.`);
    }
  } else if (pc > 3.5e6) warn('warn', `Pressure-fed at ${p.pc.toFixed(1)} MPa: tanks must hold ${(pTankOx / 1e6).toFixed(1)} MPa — very heavy. Typical pressure-fed engines run 0.7–2.5 MPa.`);
  if (p.cycle === 'stagedOx' && !(pair.ox === 'LOX')) warn('error', 'Ox-rich staged combustion requires LOX.');

  // ---- cooling verdicts ----
  let maxBurn = Infinity, fatigueLife = 9999, abl = null, TwRad = null, TwExt = null;
  const hotFlux = ht ? ht.qThroat : 0;
  if (p.cooling === 'regen' && ht) {
    if (ht.TwgMax > wall.Tmax) warn('error', `Hot-wall temperature ${ht.TwgMax.toFixed(0)} K exceeds ${chMat.name} limit (${wall.Tmax} K) at x=${(ht.TwgMaxX * 1000).toFixed(0)} mm — burn-through. Add channels/height, film cooling, thinner wall, or lower Pc.`);
    else if (ht.TwgMax > wall.Tmax - 60) warn('warn', `Hot-wall ${ht.TwgMax.toFixed(0)} K is within 60 K of the ${chMat.name} limit — thin margin.`);
    if (ht.cokeViolation) warn('warn', `Coolant-side wall exceeds ${fu.coolant.wallCoke} K: ${fu.name} will coke/deposit, degrading cooling each firing.`);
    if (ht.coolantOverTemp) warn('error', `Coolant exits at ${ht.TcoolOut.toFixed(0)} K, above ${fu.name}'s ${fu.coolant.Tmax} K limit (boiling/decomposition).`);
    if (ht.dp > 0.5 * pc) warn('warn', `Cooling-jacket pressure drop ${(ht.dp / 1e6).toFixed(1)} MPa is large — increases pump power.`);
    fatigueLife = ht.fatigueLife;
    if (chMat.amOnly && p.method !== 'lpbf') warn('error', `${chMat.name} is a powder alloy — it must be 3D-printed (L-PBF).`);
  }
  if (p.cooling === 'ablative') {
    // throat heat flux for char-rate estimate (ablating surface at ~1500 K)
    const hgT = bartzH({ Dt, pc, cstar, gamma: comb.gamma, M: 1, Tc: comb.Tc, Mw: comb.M, Twg: 1500, rcurv: Rt, AtOverA: 1 });
    abl = ablativeAnalysis({ qThroat: hgT * (comb.Tc * 0.92 - 1500), pc, burnTime: p.burnTimeHint || 60, linerThk: p.linerThk / 1000, tps: TPS[p.ablMat] || TPS.silicaPhenolic });
    maxBurn = abl.maxBurn;
    if (!abl.ok) warn('error', `Ablative liner (${p.linerThk} mm) chars through in ${maxBurn.toFixed(0)} s, less than 1.2× the planned ${p.burnTimeHint || 60} s burn.`);
    if (p.cycle !== 'pressure' && p.cycle !== 'electric') warn('info', 'Ablative chambers are usually paired with simple pressure-fed or electric cycles.');
  }
  if (p.cooling === 'radiative') {
    TwRad = radiativeWall({ Dt, pc, cstar, gamma: comb.gamma, Tc: comb.Tc, Mw: comb.M, r: Rt, x: contour.xt, xt: contour.xt, Rt, emiss: chMat.emiss || 0.8 });
    if (TwRad > chMat.Tmax) warn('error', `Radiatively-cooled throat reaches ${TwRad.toFixed(0)} K, above ${chMat.name}'s ${chMat.Tmax} K. Radiative chambers only work at low Pc / small size (or add film cooling).`);
  }
  if (p.cooling === 'regen' && regenEps < p.eps) {
    const st = contour.pts[regenEndIdx];
    const extMat = MATERIALS[p.extMat];
    TwExt = radiativeWall({ Dt, pc, cstar, gamma: comb.gamma, Tc: comb.Tc, Mw: comb.M, r: st.r, x: st.x, xt: contour.xt, Rt, emiss: extMat.emiss || 0.75 });
    if (TwExt > extMat.Tmax) warn('error', `Radiative nozzle extension starts at ${TwExt.toFixed(0)} K — above ${extMat.name} limit ${extMat.Tmax} K. Extend regen cooling further (higher regen ε).`);
  }

  // ---- combustion stability ----
  const chugMargin = p.injDp / 100;
  if (chugMargin < 0.10) warn('error', `Injector ΔP/Pc = ${(chugMargin * 100).toFixed(0)}% — far too soft; low-frequency "chugging" instability is likely. Use ≥15–20%.`);
  else if (chugMargin < 0.15) warn('warn', `Injector ΔP/Pc = ${(chugMargin * 100).toFixed(0)}% — marginal against chugging (feed-system coupled instability).`);
  const aC = Math.sqrt(comb.gamma * 8314.46 / comb.M * comb.Tc);
  const f1T = 1.8412 * aC / (Math.PI * Dc);
  const f1L = aC / (2 * (Lcyl + contour.Lconv));
  const damp = { none: 1, baffles: 3, cavities: 2.5, both: 6 }[p.damping || 'none'];
  const hfIndex = inj.hf * Math.pow(Dc / 0.25, 0.8) * Math.pow(pc / 7e6, 0.3) / damp;
  const hfRisk = clamp(1 - Math.exp(-0.15 * hfIndex * hfIndex), 0.002, 0.95);
  if (hfRisk > 0.15) warn('warn', `High-frequency instability risk ≈${(hfRisk * 100).toFixed(0)}% per start (1T mode ≈${(f1T / 1000).toFixed(1)} kHz). Add baffles/acoustic cavities or use coax/pintle injection.`);
  const throttleMin = inj.deepThrottle ? 0.15 : clamp(0.15 / Math.max(chugMargin, 0.01), 0.4, 1);

  // ---- igniter ----
  const ign = IGNITERS[p.igniter];
  if (!pair.igniters.includes(p.igniter)) warn('error', `${ign.name} is not compatible with ${p.pair} (use: ${pair.igniters.map(i => IGNITERS[i].name).join(', ')}).`);
  const ignitions = p.igniter === 'teateb' ? Math.max(1, p.ignitions || 3) : ign.starts;

  // ---- LOX compatibility ----
  for (const mk of [p.chamberMat, p.turbineMat]) {
    const m = MATERIALS[mk];
    if (m && !m.lox && pair.ox === 'LOX' && mk === p.turbineMat && isPump) warn('error', `${m.name} in the LOX pump is an ignition hazard (not oxygen-compatible).`);
  }

  // ---- mass estimate ----
  const SF = 1.4;
  const pts = contour.pts;
  let areaChamber = 0, areaNozzleRegen = 0, areaExt = 0;
  for (let i = 1; i < pts.length; i++) {
    const ds = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].r - pts[i - 1].r);
    const dA = 2 * Math.PI * 0.5 * (pts[i].r + pts[i - 1].r) * ds;
    if (i <= contour.throatIdx) areaChamber += dA;
    else if (i <= regenEndIdx || p.cooling !== 'regen') areaNozzleRegen += dA;
    else areaExt += dA;
  }
  // structural jacket: printed monolithic (same alloy) or ED-nickel closeout + Inconel 718 structural jacket
  const jacketMat = p.method === 'lpbf' ? chMat : MATERIALS.in718;
  const pCool = ht ? (isPump ? pDisFuel : pTankFuel) : pc;
  let mChamber = 0, mNozzle = 0, mExt = 0;
  const minGauge = 1.2e-3;
  if (p.cooling === 'regen') {
    const tj = Math.max(1.0e-3, SF * pCool * Rc / allowable(jacketMat, 'Fty'));
    const areal = chMat.rho * (wall.t + 0.5 * p.chHeight / 1000) + jacketMat.rho * tj;
    mChamber = areaChamber * areal;
    // nozzle: brazed channel-wall with hoop bands (hatbands) carrying the coolant-pressure hoop load
    mNozzle = areaNozzleRegen * (chMat.rho * (wall.t + 0.5 * p.chHeight / 1000) + jacketMat.rho * Math.max(0.8e-3, tj * 0.25));
    if (areaExt > 0) mExt = areaExt * MATERIALS[p.extMat].rho * 0.9e-3;
  } else if (p.cooling === 'ablative') {
    const tps = TPS[p.ablMat] || TPS.silicaPhenolic;
    const ts = Math.max(minGauge, SF * pc * Rc / allowable(chMat, 'Fty'));
    mChamber = areaChamber * (tps.rho * p.linerThk / 1000 + chMat.rho * ts);
    mNozzle = areaNozzleRegen * (tps.rho * p.linerThk / 1000 * 0.5 + chMat.rho * ts * 0.6);
  } else {
    const ts = Math.max(0.8e-3, SF * pc * Rc / allowable(chMat, 'Fty') * 1.5);
    mChamber = areaChamber * chMat.rho * ts;
    mNozzle = areaNozzleRegen * chMat.rho * 0.8e-3;
  }
  const injMat = MATERIALS.ss304L;
  const pInjMax = Math.max(pInjOx, pInjFuel);
  const tInj = Math.max(3e-3, 0.5 * Rc * Math.sqrt(3 * pInjMax * SF / (4 * allowable(injMat, 'Fty'))));
  const mInj = Math.PI * Rc * Rc * tInj * injMat.rho * 1.3; // post-supported faceplate + manifolds
  const mValves = 2 * (0.4 + 0.05 * Math.pow(Math.max(mdotOx, mdotFuel), 0.85));
  const mIgn = p.igniter === 'teateb' ? 1.0 + 0.002 * Math.sqrt(Fref) : ign.mass;
  let mTP = 0, mGG = 0, mMotor = 0;
  if (isPump) {
    if (p.cycle === 'electric') {
      mMotor = elecPower / 6000 + elecPower / 25000;
      mTP = 0.5 + 0.004 * (turbineP / 1000) * Math.pow(30000 / p.rpm, 0.7);
    } else {
      mTP = 1.0 + 0.0095 * (turbineP / 1000) * Math.pow(30000 / p.rpm, 0.7);
      if (p.cycle === 'gg') mGG = 0.5 + 0.08 * Math.pow(mdotGG, 0.9);
      if (p.cycle.startsWith('staged')) mGG = 0.35 * mChamber + 0.002 * (turbineP / 1000);
    }
  }
  const mGimbal = p.gimbal > 0 ? 2 * (0.3 + 0.00035 * Math.pow(Fref, 0.7)) * (p.actuator === 'hydraulic' ? 1.35 : 1.0) : 0;
  const sub = mChamber + mNozzle + mExt + mInj + mValves + mIgn + mTP + mGG + mMotor + mGimbal;
  const mass = sub * 1.10;

  // ---- overall performance incl. GG dump ----
  const mdotTotal = mdot + mdotGG;
  const FvacTotal = FvacMain + mdotGG * pair.ggVe;
  const FslTotal = FslMain + mdotGG * pair.ggVe * 0.8;
  const ispVac = FvacTotal / (mdotTotal * G0);
  const ispSL = FslTotal / (mdotTotal * G0);
  const tw = FslTotal / (mass * G0);
  if (p.gimbal > 10) warn('warn', 'Gimbal range above ±10° is unusual: heavy actuators and large flex lines.');

  return {
    ok: !W.some(w => w.lvl === 'error'), warnings: W,
    pair: p.pair, comb, cstar, etaC, gammaExp: gx, etaCf, cfVac, peFull: prE * pc, pc,
    At, Dt, Ae, De, Dc, Lcyl, contour, length, regenEndIdx, regenEps,
    mdot, mdotOx, mdotFuel, mdotGG, mdotTotal, of: p.of,
    FvacMain, FslMain, FvacTotal, FslTotal, ispVac, ispSL, sepSL: slPerf.separated,
    ht, abl, TwRad, TwExt, maxBurn, fatigueLife, wallTmax: chMat.Tmax,
    feed: { pTankOx, pTankFuel, pInjOx, pInjFuel, pDisOx, pDisFuel, pumpOx, pumpFuel, turbineP, npshOx, npshFuel, dn, dpRegen, turbinePR, elecPower },
    stability: { chugMargin, f1T, f1L, hfRisk, hfIndex },
    throttleMin, ignitions, igniterReliability: ign.reliability,
    startTime: cyc.start, cycle: p.cycle,
    mass, massBreakdown: { chamber: mChamber, nozzle: mNozzle, extension: mExt, injector: mInj, valves: mValves, igniter: mIgn, turbopump: mTP, gasGenerator: mGG, motors: mMotor, gimbal: mGimbal },
    tw,
  };
}
