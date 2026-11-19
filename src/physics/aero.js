// Rocket aerodynamics: drag vs Mach, Barrowman normal-force/centre-of-pressure, body lift at high α,
// fin flutter (NACA TN-4197), stagnation heating (Sutton–Graves).

export const NOSE_SHAPES = {
  vonKarman: { name: 'Von Kármán (LD-Haack)', cpFrac: 0.500, wave: 0.70, volFrac: 0.50 },
  ogive: { name: 'Tangent ogive', cpFrac: 0.466, wave: 0.85, volFrac: 0.53 },
  conical: { name: 'Conical', cpFrac: 0.667, wave: 1.00, volFrac: 0.333 },
  elliptical: { name: 'Elliptical', cpFrac: 0.333, wave: 1.35, volFrac: 0.667 },
};

// Zero-lift drag coefficient referenced to max frontal area.
// cfg: { nose, fineness (nose L/D), bodyLD (total L/D), finRatio (fin planform area×n / Aref), finThick (t/c), powerOn, boattail }
export function cdMach(M, cfg) {
  const shape = NOSE_SHAPES[cfg.nose] || NOSE_SHAPES.ogive;
  const fric = 0.012 * cfg.bodyLD * Math.pow(1 + 0.15 * M * M, -0.58);
  let base;
  if (cfg.powerOn) base = M < 1 ? 0.06 : 0.06 / M;
  else base = M < 0.9 ? 0.12 + 0.05 * M : M < 1.1 ? 0.165 + 0.3 * (M - 0.9) : 0.225 * 1.1 / M + 0.02;
  let f;
  if (M < 0.8) f = 0;
  else if (M < 1.15) f = Math.pow((M - 0.8) / 0.35, 2);
  else f = 1 / (1 + 0.55 * (M - 1.15));
  const wave = 1.5 * shape.wave / Math.pow(Math.max(cfg.fineness, 0.5), 1.4) * f;
  let fins = 0;
  if (cfg.finRatio > 0) {
    const tc = cfg.finThick || 0.05;
    fins = cfg.finRatio * (0.016 * Math.pow(1 + 0.15 * M * M, -0.58) + (M > 1 ? 4 * tc * tc / Math.sqrt(M * M - 1 + 0.2) : M > 0.8 ? 10 * tc * tc * (M - 0.8) : 0));
    if (cfg.finBevel === false) fins += cfg.finRatio * tc * 0.6; // blunt leading edges
  }
  return fric + base + wave + fins;
}

// Barrowman fin set normal-force slope (per rad, ref = π d²/4) and CP location from fin root leading edge.
export function finsCNa({ n, Cr, Ct, span, sweep, d, M }) {
  const R = d / 2;
  const lm = Math.sqrt(span * span + Math.pow(sweep + Ct / 2 - Cr / 2, 2)); // mid-chord line length
  const beta = Math.max(0.3, Math.sqrt(Math.abs(1 - M * M)));
  const KTB = 1 + R / (span + R);
  const cna = KTB * (4 * n * Math.pow(span / d, 2)) / (1 + Math.sqrt(1 + Math.pow(2 * beta * lm / (Cr + Ct), 2)));
  const xf = sweep * (Cr + 2 * Ct) / (3 * (Cr + Ct)) + (1 / 6) * ((Cr + Ct) - Cr * Ct / (Cr + Ct));
  return { cna, xf };
}

/**
 * Stability analysis for a stack.
 * elems: [{type:'nose', x, L, shape}, {type:'fins', x (root LE station from nose tip), n, Cr, Ct, span, sweep, d},
 *         {type:'body', x, L, d}]  — dRef is the reference diameter.
 */
export function cpAnalysis(elems, dRef, M = 0.3, alpha = 0) {
  let cna = 0, mom = 0;
  for (const e of elems) {
    if (e.type === 'nose') {
      const s = NOSE_SHAPES[e.shape] || NOSE_SHAPES.ogive;
      const c = 2 * Math.pow(e.d / dRef, 2);
      cna += c; mom += c * (e.x + s.cpFrac * e.L);
    } else if (e.type === 'fins') {
      const f = finsCNa({ ...e, M });
      const c = f.cna * Math.pow(e.d / dRef, 2) * (e.lost ? 0 : 1);
      cna += c; mom += c * (e.x + f.xf);
    } else if (e.type === 'body' && alpha !== 0) {
      // Galejs body lift: CN = K (Aplan/Aref) α² → effective slope K (Aplan/Aref) |α|
      const Aref = Math.PI * dRef * dRef / 4;
      const c = 1.1 * (e.L * e.d / Aref) * Math.abs(alpha);
      cna += c; mom += c * (e.x + e.L / 2);
    } else if (e.type === 'shoulder') {
      // diameter change (flare + / boattail −): CNα = 2[(d2/dref)² − (d1/dref)²]
      const c = 2 * (Math.pow(e.d2 / dRef, 2) - Math.pow(e.d1 / dRef, 2));
      cna += c; mom += c * (e.x + e.L / 3);
    }
  }
  return { cna, xcp: cna > 0 ? mom / cna : 0 };
}

// Fin flutter boundary velocity (NACA TN-4197 simplified, as used by amateur & professional sounding rocket teams)
export function finFlutterSpeed({ G, Cr, Ct, span, t }, atm) {
  const S = 0.5 * (Cr + Ct) * span;
  const AR = span * span / S;
  const lam = Ct / Cr;
  const tc = t / Cr;
  const denom = (1.337 * Math.pow(AR, 3) * atm.P * (lam + 1)) / (2 * (AR + 2) * Math.pow(tc, 3));
  return atm.a * Math.sqrt(G / Math.max(denom, 1e-9));
}

// Stagnation-point convective heating (Sutton–Graves, Earth air), W/m²
export const suttonGraves = (rho, v, Rn) => 1.7415e-4 * Math.sqrt(rho / Math.max(Rn, 1e-3)) * v * v * v;

// Free-molecular heating rate used for fairing-jettison constraint: q = ½ ρ v³
export const fmHeating = (rho, v) => 0.5 * rho * v * v * v;
