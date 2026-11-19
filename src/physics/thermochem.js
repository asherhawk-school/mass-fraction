// Combustion property lookup: interpolates CEA-style tables over O/F, corrects for chamber pressure
// (higher Pc suppresses dissociation → slightly higher Tc, strongest near stoichiometric).
import { PAIRS, APCP_TABLE } from '../data/propellants.js';
import { interpRows } from './constants.js';
import { cstarIdeal } from './nozzle.js';

export function combustion(pairId, of, pc) {
  const pair = PAIRS[pairId];
  if (!pair) throw new Error('Unknown propellant pair ' + pairId);
  let [Tc, M, g] = interpRows(pair.table, of);
  const nearStoich = Math.max(0, 1 - Math.abs(of - pair.stoich) / pair.stoich);
  Tc *= Math.pow(Math.max(pc, 2e5) / 7e6, 0.006 + 0.02 * nearStoich);
  const offRange = of < pair.ofRange[0] ? pair.ofRange[0] - of : of > pair.ofRange[1] ? of - pair.ofRange[1] : 0;
  return { Tc, M, gamma: g, cstar: cstarIdeal(Tc, M, g), offRange };
}

export function solidCombustion(alFrac, pc) {
  let [Tc, M, g] = interpRows(APCP_TABLE, alFrac);
  Tc *= Math.pow(Math.max(pc, 2e5) / 7e6, 0.008);
  return { Tc, M, gamma: g, cstar: cstarIdeal(Tc, M, g) };
}

// Optimum-Isp O/F search (vacuum, given area ratio) — used by the designer's "find optimum" helper.
export function optimumOF(pairId, pc, ispFn) {
  const p = PAIRS[pairId];
  let best = p.ofRange[0], bestIsp = -1;
  for (let of = p.ofRange[0]; of <= p.ofRange[1] + 1e-9; of += 0.05) {
    const isp = ispFn(of);
    if (isp > bestIsp) { bestIsp = isp; best = of; }
  }
  return { of: best, isp: bestIsp };
}
