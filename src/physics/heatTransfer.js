// Thrust-chamber geometry + heat transfer.
// Gas side: Bartz (1957) correlation with σ boundary-layer property correction.
// Coolant side: Dittus–Boelter in rectangular milled channels; 1-D counter-flow march from nozzle to injector.
// Wall: 1-D conduction through liner; thermal-strain low-cycle-fatigue estimate (Coffin–Manson style).
import { RU, DEG, SIGMA_SB } from './constants.js';
import { areaRatio, machFromAreaRatio } from './nozzle.js';

// Build the inner contour r(x) from injector face (x=0) to nozzle exit.
export function engineContour({ Rt, Rc, Lcyl, eps, nozzle = 'bell', bellFrac = 0.8, coneDeg = 15, convDeg = 30 }) {
  const pts = [];
  const Re = Rt * Math.sqrt(eps);
  const ca = convDeg * DEG;
  const R1 = 1.5 * Rt, R2 = 0.382 * Rt;
  const rArc = Rt + R1 * (1 - Math.cos(ca));
  const Rcc = Math.max(Rc, rArc * 1.0001);
  const Lline = (Rcc - rArc) / Math.tan(ca);
  const xArc = Lcyl + Lline;
  const xt = xArc + R1 * Math.sin(ca);
  for (let i = 0; i <= 8; i++) pts.push({ x: (Lcyl * i) / 8, r: Rcc });
  for (let i = 1; i <= 6; i++) { const x = Lcyl + (Lline * i) / 6; pts.push({ x, r: Rcc - (x - Lcyl) * Math.tan(ca) }); }
  for (let i = 1; i <= 10; i++) { const a = ca * (1 - i / 10); pts.push({ x: xt - R1 * Math.sin(a), r: Rt + R1 * (1 - Math.cos(a)) }); }
  const throatIdx = pts.length - 1;
  let thN, thE, Ln;
  if (nozzle === 'cone') {
    thN = coneDeg * DEG; thE = thN;
  } else {
    const lg = Math.log10(Math.max(eps, 2));
    thN = (20 + 7 * lg + (0.8 - bellFrac) * 25) * DEG;
    thE = Math.max(3, 14 - 3.5 * lg + (0.8 - bellFrac) * 20) * DEG;
  }
  // downstream throat arc
  for (let i = 1; i <= 6; i++) { const a = thN * i / 6; pts.push({ x: xt + R2 * Math.sin(a), r: Rt + R2 * (1 - Math.cos(a)) }); }
  const N = pts[pts.length - 1];
  if (nozzle === 'cone') {
    Ln = (Re - N.r) / Math.tan(thN);
    for (let i = 1; i <= 24; i++) pts.push({ x: N.x + Ln * i / 24, r: N.r + (Re - N.r) * i / 24 });
  } else {
    const Lcone = (Re - Rt + R2 * (1 / Math.cos(15 * DEG) - 1)) / Math.tan(15 * DEG);
    const xe = xt + bellFrac * Lcone;
    const tn = Math.tan(thN), te = Math.tan(thE);
    let qx = (Re - N.r + tn * N.x - te * xe) / (tn - te);
    if (!(qx > N.x && qx < xe)) qx = 0.5 * (N.x + xe);
    const qr = N.r + tn * (qx - N.x);
    for (let i = 1; i <= 30; i++) {
      const t = i / 30;
      pts.push({ x: (1 - t) * (1 - t) * N.x + 2 * (1 - t) * t * qx + t * t * xe, r: (1 - t) * (1 - t) * N.r + 2 * (1 - t) * t * qr + t * t * Re });
    }
  }
  return { pts, throatIdx, xt, Re, length: pts[pts.length - 1].x, Lconv: xt - Lcyl, thetaExit: thE };
}

// Gas-side heat-transfer coefficient (Bartz), W/m²K
export function bartzH({ Dt, pc, cstar, gamma, M, Tc, Mw, Twg, rcurv, AtOverA }) {
  const cp = (gamma * RU / Mw) / (gamma - 1);
  const mu = 1.184e-7 * Math.pow(Mw, 0.5) * Math.pow(Tc, 0.6);   // Pa·s
  const Pr = 4 * gamma / (9 * gamma - 5);
  const f = 1 + (gamma - 1) / 2 * M * M;
  const sigma = 1 / (Math.pow(0.5 * (Twg / Tc) * f + 0.5, 0.68) * Math.pow(f, 0.12));
  return (0.026 / Math.pow(Dt, 0.2)) * (Math.pow(mu, 0.2) * cp / Math.pow(Pr, 0.6)) * Math.pow(pc / cstar, 0.8)
    * Math.pow(Dt / rcurv, 0.1) * Math.pow(AtOverA, 0.9) * sigma;
}

function stationGas(st, ctx) {
  const { At, gamma, Tc } = ctx;
  const A = Math.PI * st.r * st.r;
  const ar = A / At;
  const M = ar <= 1.0001 ? 1 : machFromAreaRatio(ar, gamma, st.x > ctx.xt);
  const Pr = 4 * gamma / (9 * gamma - 5);
  const rf = Math.pow(Pr, 0.33);
  const f = 1 + (gamma - 1) / 2 * M * M;
  const Taw = Tc * (1 + rf * (gamma - 1) / 2 * M * M) / f;
  return { M, ar, Taw };
}

/**
 * Regenerative cooling analysis.
 * ctx: { contour, Rt, pc, cstar, gamma, Tc, Mw, coolant:{cp,rho,mu,k,Tmax,wallCoke}, Tin, mdotC, pIn,
 *        wall:{k, t, Tmax, E, alpha, nu, Fty}, channels, chH, rib, roughness, filmFrac, regenEndIdx,
 *        hotspot: {x, factor} (defect) }
 */
export function regenAnalysis(c) {
  const pts = c.contour.pts;
  const At = Math.PI * c.Rt * c.Rt;
  const Dt = 2 * c.Rt;
  const ctx = { At, gamma: c.gamma, Tc: c.Tc, xt: c.contour.xt };
  const end = Math.min(c.regenEndIdx ?? pts.length - 1, pts.length - 1);
  let Tcool = c.Tin, p = c.pIn;
  const cool = c.coolant;
  const st = [];
  let TwgMax = 0, TwgMaxX = 0, qThroat = 0, Qtot = 0, cokeViolation = false, TwcMax = 0, maxThermalStress = 0;
  const filmCut = Math.max(0.35, 1 - 6 * c.filmFrac);
  for (let i = end; i > 0; i--) {
    const a = pts[i], b = pts[i - 1];
    const dx = Math.hypot(a.x - b.x, a.r - b.r);
    const mid = { x: 0.5 * (a.x + b.x), r: 0.5 * (a.r + b.r) };
    const g = stationGas(mid, ctx);
    const TawEff = c.Tin + (g.Taw - c.Tin) * filmCut; // fuel film shields the wall
    const perim = 2 * Math.PI * (mid.r + c.wall.t);
    const N = c.channels;
    const w = Math.max(0.4e-3, (perim - N * c.rib) / N);
    const h = c.chH;
    const Aflow = N * w * h;
    const Dh = 4 * w * h / (2 * (w + h));
    // coolant viscosity falls with temperature (Arrhenius-like)
    const mu = cool.mu * Math.exp(-(Tcool - c.Tin) / 150);
    const v = c.mdotC / (cool.rho * Aflow);
    const Re = cool.rho * v * Dh / mu;
    const Prc = mu * cool.cp / cool.k;
    const finBoost = 1 + Math.min(1.2, 0.9 * h / w);
    const hc = 0.023 * Math.pow(Re, 0.8) * Math.pow(Prc, 0.4) * cool.k / Dh * finBoost;
    const rcurv = Math.abs(mid.x - c.contour.xt) < 2 * c.Rt ? 1.0 * c.Rt : 3 * c.Rt;
    // solve wall temperature: hg(Twg)(Taw−Twg) = (Twg−Tcool)/(t/k + 1/hc)
    const Rw = c.wall.t / c.wall.k + 1 / hc;
    let Twg = Math.min(TawEff - 10, 700), q = 0, hg = 0;
    let hotFactor = 1;
    if (c.hotspot && Math.abs(mid.x - c.hotspot.x) < c.Rt * 0.8) hotFactor = c.hotspot.factor;
    for (let k = 0; k < 30; k++) {
      hg = bartzH({ Dt, pc: c.pc, cstar: c.cstar, gamma: c.gamma, M: g.M, Tc: c.Tc, Mw: c.Mw, Twg, rcurv, AtOverA: 1 / g.ar }) * hotFactor * (c.soot ?? 1);
      const TwgNew = (hg * TawEff * Rw + Tcool) / (hg * Rw + 1);
      if (Math.abs(TwgNew - Twg) < 0.2) { Twg = TwgNew; break; }
      Twg = 0.5 * (Twg + TwgNew);
    }
    q = hg * (TawEff - Twg);
    const Twc = Twg - q * c.wall.t / c.wall.k;
    const dT = q * perim * dx / (c.mdotC * cool.cp);
    const f = 0.316 * Math.pow(Math.max(Re, 2300), -0.25) * (c.roughness || 1);
    const dp = f * (dx / Dh) * 0.5 * cool.rho * v * v;
    Tcool += dT; p -= dp; Qtot += q * perim * dx;
    if (Twg > TwgMax) { TwgMax = Twg; TwgMaxX = mid.x; }
    if (Twc > TwcMax) TwcMax = Twc;
    if (Twc > cool.wallCoke) cokeViolation = true;
    if (Math.abs(mid.x - c.contour.xt) < c.Rt * 0.3) qThroat = Math.max(qThroat, q);
    const thermalStress = c.wall.E * c.wall.alpha * (Twg - Twc) / (2 * (1 - c.wall.nu));
    maxThermalStress = Math.max(maxThermalStress, thermalStress);
    st.push({ x: mid.x, r: mid.r, q, Twg, Twc, Tcool, v, M: g.M });
  }
  st.reverse();
  // Low-cycle fatigue: plastic strain range per start/stop cycle → Coffin–Manson life
  const strainEl = c.wall.Fty / c.wall.E;
  const strainTh = c.wall.alpha * (TwgMax - 300) * 0.6;
  const plastic = Math.max(1e-5, strainTh - strainEl * 0.9);
  const life = Math.max(1, Math.round(0.5 * Math.pow(0.25 / plastic, 1 / 0.6) / 40));
  const dpTotal = c.pIn - p;
  return {
    stations: st, TwgMax, TwgMaxX, TwcMax, qThroat, Qtotal: Qtot, TcoolOut: Tcool, dp: dpTotal, cokeViolation,
    coolantOverTemp: Tcool > cool.Tmax, maxThermalStress, fatigueLife: Math.min(life, 5000),
  };
}

// Radiation-equilibrium wall temperature at a station (radiatively cooled chamber or nozzle extension)
export function radiativeWall({ Dt, pc, cstar, gamma, Tc, Mw, r, x, xt, Rt, emiss }) {
  const At = Math.PI * Rt * Rt;
  const ar = (Math.PI * r * r) / At;
  const M = ar <= 1.0001 ? 1 : machFromAreaRatio(ar, gamma, x > xt);
  const f = 1 + (gamma - 1) / 2 * M * M;
  const Pr = 4 * gamma / (9 * gamma - 5);
  const Taw = Tc * (1 + Math.pow(Pr, 0.33) * (gamma - 1) / 2 * M * M) / f;
  let Tw = 1200;
  for (let k = 0; k < 40; k++) {
    const hg = bartzH({ Dt, pc, cstar, gamma, M, Tc, Mw, Twg: Tw, rcurv: 3 * Rt, AtOverA: 1 / ar });
    // radiate from outer surface: εσTw⁴ = hg(Taw − Tw)
    let lo = 200, hi = Taw;
    for (let j = 0; j < 50; j++) { const m = 0.5 * (lo + hi); if (emiss * SIGMA_SB * m ** 4 > hg * (Taw - m)) hi = m; else lo = m; }
    const n = 0.5 * (lo + hi);
    if (Math.abs(n - Tw) < 1) { Tw = n; break; }
    Tw = n;
  }
  return Tw;
}

// Ablative liner: char-rate and throat-erosion model (silica/carbon phenolic)
export function ablativeAnalysis({ qThroat, pc, burnTime, linerThk, tps }) {
  const charRate = (tps.char ?? 0.12) * 1e-3 * Math.pow(Math.max(qThroat, 1e6) / 2e7, 0.6); // m/s
  const erosionRate = tps.erosion * 1e-3 * Math.pow(pc / 7e6, 0.8);                      // m/s (radius)
  const maxBurn = linerThk / Math.max(charRate + erosionRate, 1e-9);
  return { charRate, erosionRate, maxBurn, ok: maxBurn > burnTime * 1.2 };
}
