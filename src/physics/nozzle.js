// Quasi-1D isentropic nozzle theory (Sutton & Biblarz ch.3) with separation (Summerfield criterion).
import { RU, DEG } from './constants.js';

export function areaRatio(M, g) {
  const t = (2 / (g + 1)) * (1 + ((g - 1) / 2) * M * M);
  return Math.pow(t, (g + 1) / (2 * (g - 1))) / M;
}

export function machFromAreaRatio(eps, g, supersonic = true) {
  if (eps <= 1.0000001) return 1;
  let lo, hi;
  if (supersonic) {
    lo = 1; hi = 2;
    while (areaRatio(hi, g) < eps) hi *= 1.5;
    for (let i = 0; i < 80; i++) {
      const m = 0.5 * (lo + hi);
      if (areaRatio(m, g) < eps) lo = m; else hi = m;
    }
  } else {
    lo = 1e-6; hi = 1;
    for (let i = 0; i < 80; i++) {
      const m = 0.5 * (lo + hi);
      if (areaRatio(m, g) > eps) lo = m; else hi = m;
    }
  }
  return 0.5 * (lo + hi);
}

export const pRatio = (M, g) => Math.pow(1 + ((g - 1) / 2) * M * M, -g / (g - 1));
export const tRatio = (M, g) => 1 / (1 + ((g - 1) / 2) * M * M);
export const machFromPressureRatio = (pr, g) => Math.sqrt((2 / (g - 1)) * (Math.pow(pr, -(g - 1) / g) - 1));

// Shifting-equilibrium correction: recombination in the expanding flow releases heat, which behaves like a
// lower effective isentropic exponent at high area ratios. Calibrated vs Merlin-1D, RL10A-4, AJ10, Raptor-Vac.
export const expansionGamma = (g, eps) => Math.max(1.08, g - 0.07 * Math.log10(Math.max(eps, 1.5) / 16));

// Vandenkerckhove function
export const vdk = (g) => Math.sqrt(g) * Math.pow(2 / (g + 1), (g + 1) / (2 * (g - 1)));

export function cstarIdeal(Tc, Mw, g) { return Math.sqrt((RU / Mw) * Tc) / vdk(g); }

// Momentum part of thrust coefficient for exit/chamber pressure ratio
export function cfMomentum(g, peOverPc) {
  return Math.sqrt(((2 * g * g) / (g - 1)) * Math.pow(2 / (g + 1), (g + 1) / (g - 1)) * (1 - Math.pow(peOverPc, (g - 1) / g)));
}

// Divergence correction λ. Cone: (1+cos α)/2. Rao bell: tabulated vs % length of a 15° cone.
export function divergenceFactor(type, coneDeg = 15, bellFrac = 0.8) {
  if (type === 'cone') return (1 + Math.cos(coneDeg * DEG)) / 2;
  const t = [[0.6, 0.977], [0.7, 0.984], [0.8, 0.988], [0.9, 0.991], [1.0, 0.993]];
  if (bellFrac <= 0.6) return 0.977 - (0.6 - bellFrac) * 0.08;
  for (let i = 0; i < t.length - 1; i++) if (bellFrac <= t[i + 1][0]) {
    const u = (bellFrac - t[i][0]) / (t[i + 1][0] - t[i][0]);
    return t[i][1] + (t[i + 1][1] - t[i][1]) * u;
  }
  return 0.993;
}

/**
 * Nozzle performance at ambient pressure pa.
 * etaCf collects divergence × boundary-layer × kinetic × two-phase efficiencies (applied to momentum term).
 * Separation: Summerfield criterion — flow separates where wall pressure falls below ~0.4·pa.
 */
export function nozzlePerf({ g, eps, pc, pa, etaCf = 1, Me = null }) {
  const M = Me ?? machFromAreaRatio(eps, g);
  const pr = pRatio(M, g);
  const pe = pr * pc;
  let separated = false, epsEff = eps, peEff = pe;
  const pSep = 0.4 * pa;
  if (pa > 0 && pe < pSep) {
    separated = true;
    const prSep = Math.min(0.5, pSep / pc);
    const Ms = machFromPressureRatio(prSep, g);
    epsEff = Math.max(1, areaRatio(Ms, g));
    peEff = prSep * pc;
  }
  const cf = cfMomentum(g, peEff / pc) * etaCf + epsEff * (peEff - pa) / pc;
  return {
    cf: Math.max(cf, 0), pe, Me: M, separated, epsEff,
    // side-load severity proxy: fraction of the nozzle running separated
    sideLoad: separated ? 1 - (epsEff - 1) / Math.max(eps - 1, 1e-6) : 0,
  };
}
