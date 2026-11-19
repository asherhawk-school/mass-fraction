// Manufacturing process library: every fabrication step has a facility, labor, cost, operator-set
// parameters, a hidden "true" process window (revealed by qualifying the procedure with test coupons),
// a published "textbook" window (approximate), and defect rules.
import { MATERIALS } from './materials.js';

const sel = (key, label, options, def, help) => ({ key, label, type: 'sel', options, def, help });
const num = (key, label, unit, min, max, step, def, help) => ({ key, label, unit, type: 'num', min, max, step, def, help });
const bool = (key, label, def, help) => ({ key, label, type: 'bool', def, help });

const kWeld = (mat) => ({ al6061: 175, al2219: 185, al2195: 165, al7075: 170, ss304L: 130, steel4130: 140, d6ac: 140, ti64: 115, in718: 120, cucrzr: 260, nbC103: 150, oxAlloy: 120 }[mat] || 150);
const springback = (mat) => { const m = MATERIALS[mat]; return m ? (m.Fty / m.E) * 100 * 1.4 : 0.6; };

// heat-treatment specifications by material: [temp °C window], [time h window], note
const HT_SPEC = {
  steel4130: { label: 'Quench & temper', temp: [480, 540], time: [1.5, 3], quench: true },
  d6ac: { label: 'Quench & temper', temp: [540, 600], time: [2, 4], quench: true },
  ti64: { label: 'Stress relief', temp: [580, 610], time: [1.5, 3] },
  in718: { label: 'Solution + double age', temp: [710, 730], time: [8, 10] },
  al2219: { label: 'Artificial age (T87)', temp: [170, 180], time: [16, 20] },
  al6061: { label: 'Solution + age (T6)', temp: [170, 180], time: [7, 9] },
  al2195: { label: 'Age (T8)', temp: [140, 150], time: [28, 34] },
  al7075: { label: 'Age (T6)', temp: [115, 125], time: [22, 26] },
  cucrzr: { label: 'Precipitation age', temp: [460, 490], time: [2, 4] },
  oxAlloy: { label: 'Solution + age', temp: [700, 730], time: [8, 10] },
};
export function htSpec(mat) { return HT_SPEC[mat] || { label: 'Stress relief', temp: [300, 340], time: [1, 2] }; }

/*
 * Step kind spec:
 *  facility: facility key needed (null = none). If missing the step is outsourced (cost ×2.4, +vendor queue days)
 *  params(ctx): parameter definitions; defaults are the textbook centre
 *  derive(pr, ctx): derived quantities shown live (e.g. weld heat input)
 *  window(ctx): true acceptable windows {quantity: [lo, hi]}
 *  textbook(ctx): published guidance (wider / slightly off)
 *  rules: [{on, side:'low'|'high'|'both', type, base, k}] → P(defect) = (base + k·deviation)·qualityFactor
 *  special(pr, ctx, out, rng, q): custom effects
 *  hours(ctx, pr), cost(ctx, pr) ($ of consumables/material), calendar(ctx, pr) extra days (cure/plating time)
 */
export const STEP_KINDS = {
  procure: {
    name: 'Procure material', facility: null, kind: 'procure',
    params: (c) => [sel('grade', 'Supplier grade', [['standard', 'Standard mill (cert to spec)'], ['premium', 'Aerospace premium (tighter control, +35%)']], 'standard'),
      bool('expedite', 'Expedite (×2 cost, ⅓ lead time)', false)],
    hours: () => 1,
    cost: (c, pr) => c.matCost * (pr.grade === 'premium' ? 1.35 : 1) * (pr.expedite ? 2 : 1),
    lead: (c, pr) => Math.max(1, Math.round(c.lead * (pr.expedite ? 0.33 : 1))),
    desc: 'Order raw stock with a mill test report (certified chemistry & tensile results for this lot).',
  },
  form: {
    name: 'Roll / brake form', facility: 'forming', kind: 'param',
    params: (c) => [num('spring', 'Springback compensation', '%', 0, 2.5, 0.05, +(springback(c.mat) * 1.15).toFixed(2), 'Over-bend to account for elastic recovery'),
      num('passes', 'Forming passes', '', 1, 12, 1, 4)],
    window: (c) => ({ spring: [springback(c.mat) - 0.12, springback(c.mat) + 0.12], passes: [3, 8] }),
    textbook: (c) => ({ spring: [springback(c.mat) * 0.8, springback(c.mat) * 1.5], passes: [2, 10] }),
    rules: [{ on: 'spring', side: 'both', type: 'dimensional', base: 0.03, k: 1.5 }, { on: 'spring', side: 'both', type: 'mismatch', base: 0.02, k: 1.0 },
      { on: 'passes', side: 'low', type: 'crack', base: 0, k: 0.6 }],
    hours: (c) => 2 + 4 * Math.pow(c.area || 0.2, 0.7),
    desc: 'Roll sheet into barrel segments / brake-form panels.',
  },
  spin: {
    name: 'Spin-form domes', facility: 'forming', kind: 'param',
    params: (c) => [num('feed', 'Roller feed', 'mm/rev', 0.2, 4, 0.1, 1.2), num('passes', 'Spinning passes', '', 1, 15, 1, 6), bool('warm', 'Warm spinning (heated blank)', c.mat === 'al2195' || c.mat === 'ti64')],
    window: (c) => ({ feed: [0.6, 1.6], passes: [5, 10], ...(c.mat === 'al2195' || c.mat === 'ti64' || c.mat === 'nbC103' ? { warm: [1, 1] } : {}) }),
    textbook: () => ({ feed: [0.5, 2.0], passes: [4, 12] }),
    rules: [{ on: 'feed', side: 'high', type: 'crack', base: 0.01, k: 0.8 }, { on: 'feed', side: 'both', type: 'thinWall', base: 0.02, k: 0.8 }, { on: 'passes', side: 'low', type: 'crack', base: 0, k: 0.5 }, { on: 'warm', side: 'low', type: 'crack', base: 0, k: 0.8 }],
    hours: (c) => 3 + 3 * Math.pow(c.area || 0.2, 0.6),
    desc: 'Spin sheet over a mandrel into domes/nose cones. Thinning and cracking are the risks.',
  },
  machine: {
    name: 'CNC machining', facility: 'machine', kind: 'param',
    params: (c) => [num('feed', 'Feed rate', '% of tool rec.', 40, 160, 5, 100), num('finish', 'Finishing passes', '', 0, 4, 1, 1), bool('probe', 'In-process probing', false, 'Touch-probe the part to correct for tool deflection')],
    window: () => ({ feed: [70, 110], finish: [1, 4], probe: [1, 1] }),
    textbook: () => ({ feed: [60, 120], finish: [1, 3] }),
    rules: [{ on: 'feed', side: 'high', type: 'thinWall', base: 0.02, k: 1.0 }, { on: 'feed', side: 'both', type: 'dimensional', base: 0.03, k: 0.8 }, { on: 'finish', side: 'low', type: 'dimensional', base: 0, k: 0.4 }, { on: 'probe', side: 'low', type: 'thinWall', base: 0, k: 0.05 }],
    hours: (c) => 3 + 0.6 * Math.pow(c.mass || 1, 0.7) + (c.pocketArea || 0) * 10,
    desc: 'Mill/turn to drawing. For isogrid tanks this pockets the skin — over-cutting leaves thin wall.',
  },
  weldFusion: {
    name: 'Fusion weld (TIG / VPPA)', facility: 'weld', kind: 'param',
    params: (c) => {
      const hc = kWeld(c.mat) * Math.pow(c.thk || 3, 0.8);
      const speed = 3;
      return [num('current', 'Weld current', 'A', 20, 500, 5, Math.round(hc * 1.08 * speed / (0.7 * 12) / 5) * 5), num('speed', 'Travel speed', 'mm/s', 0.5, 12, 0.1, speed),
        num('gas', 'Argon shield flow', 'L/min', 2, 40, 1, 15), bool('purge', 'Back-purge root side', true), bool('preclean', 'Pre-weld solvent clean + oxide removal', true)];
    },
    derive: (pr) => ({ heat: 0.7 * 12 * pr.current / pr.speed }),
    derivedLabels: { heat: ['Heat input', 'J/mm'] },
    window: (c) => { const hc = kWeld(c.mat) * Math.pow(c.thk || 3, 0.8); return { heat: [hc * 0.8, hc * 1.18], gas: [12, 22], purge: [1, 1], preclean: [1, 1] }; },
    textbook: (c) => { const hc = kWeld(c.mat) * Math.pow(c.thk || 3, 0.8); return { heat: [hc * 0.75, hc * 1.4], gas: [10, 25] }; },
    rules: [
      { on: 'heat', side: 'low', type: 'lackOfFusion', base: 0.04, k: 1.8 },
      { on: 'heat', side: 'high', type: 'hazSoftening', base: 0.02, k: 1.5 },
      { on: 'heat', side: 'high', type: 'burnThrough', base: 0, k: 0.5 },
      { on: 'gas', side: 'both', type: 'porosity', base: 0.05, k: 1.0 },
      { on: 'preclean', side: 'low', type: 'porosity', base: 0, k: 0.5 },
      { on: 'purge', side: 'low', type: 'crack', base: 0, k: 0.15 },
    ],
    special: (pr, c, out, rng, q) => {
      const m = MATERIALS[c.mat];
      if (m && m.weld.fusion === false) out.push({ type: 'crack', severity: 0.6 + 0.4 * rng.next(), note: 'Alloy is not fusion-weldable (hot cracking)' });
      else if (m && m.crackProne && rng.chance(0.22 * q)) out.push({ type: 'crack', severity: 0.3 + 0.5 * rng.next(), note: 'Solidification crack in Al-Li weld' });
    },
    hours: (c) => 1.5 + 2.2 * (c.weldLen || 1) * Math.sqrt((c.thk || 3) / 3),
    cost: (c) => 30 + 15 * (c.weldLen || 1),
    desc: 'Heat input = arc efficiency × voltage × current ÷ travel speed. Too low: lack of fusion; too high: softened heat-affected zone, burn-through.',
  },
  weldFSW: {
    name: 'Friction-stir weld', facility: 'fsw', kind: 'param',
    params: (c) => [num('rpm', 'Spindle speed', 'rpm', 100, 2000, 10, 400), num('trav', 'Traverse speed', 'mm/s', 0.5, 15, 0.1, 2.5), num('force', 'Plunge force', 'kN', 1, 120, 0.5, +(2.6 * (c.thk || 3)).toFixed(1))],
    derive: (pr) => ({ pitch: pr.trav * 60 / pr.rpm }),
    derivedLabels: { pitch: ['Advance per rev', 'mm/rev'] },
    window: (c) => ({ pitch: [0.22, 0.48], force: [2.0 * (c.thk || 3), 3.1 * (c.thk || 3)] }),
    textbook: (c) => ({ pitch: [0.15, 0.6], force: [1.6 * (c.thk || 3), 3.6 * (c.thk || 3)] }),
    rules: [{ on: 'pitch', side: 'high', type: 'lackOfFusion', base: 0.01, k: 1.6 }, { on: 'force', side: 'low', type: 'lackOfFusion', base: 0, k: 1.4 }, { on: 'pitch', side: 'low', type: 'hazSoftening', base: 0.01, k: 0.7 }, { on: 'force', side: 'high', type: 'thinWall', base: 0, k: 0.6 }],
    hours: (c) => 1 + 1.0 * (c.weldLen || 1),
    cost: (c) => 20 + 5 * (c.weldLen || 1),
    desc: 'Solid-state weld — no melting, so no porosity or hot cracking. Too fast / too little force leaves "wormhole" tunnel voids.',
  },
  heatTreat: {
    name: 'Heat treatment', facility: 'heatTreat', kind: 'param',
    params: (c) => { const s = htSpec(c.mat); return [num('temp', `${s.label} temperature`, '°C', 50, 1100, 5, Math.round((s.temp[0] + s.temp[1]) / 2 / 5) * 5 + 10), num('time', 'Soak time', 'h', 0.25, 48, 0.25, (s.time[0] + s.time[1]) / 2), ...(s.quench ? [sel('quench', 'Quench medium', [['oil', 'Oil'], ['polymer', 'Polymer'], ['water', 'Water (severe)']], 'oil')] : [])]; },
    window: (c) => { const s = htSpec(c.mat); return { temp: s.temp, time: s.time }; },
    textbook: (c) => { const s = htSpec(c.mat); return { temp: [s.temp[0] - 15, s.temp[1] + 25], time: [s.time[0] * 0.8, s.time[1] * 1.2] }; },
    rules: [{ on: 'temp', side: 'low', type: 'underaged', base: 0.01, k: 1.6 }, { on: 'time', side: 'low', type: 'underaged', base: 0, k: 1.2 }, { on: 'temp', side: 'high', type: 'overaged', base: 0.01, k: 1.6 }, { on: 'time', side: 'high', type: 'overaged', base: 0, k: 0.6 }],
    special: (pr, c, out, rng, q) => { if (pr.quench === 'water' && rng.chance(0.35)) out.push({ type: 'quenchCrack', severity: 0.3 + 0.6 * rng.next() }); },
    hours: () => 3, calendar: (c, pr) => Math.ceil((pr.time + 6) / 24),
    cost: (c) => 200 + 30 * (c.mass || 1),
    desc: 'Restores/sets temper. Furnace temperature and soak time windows are narrow for precipitation-hardened alloys.',
  },
  o2clean: {
    name: 'Clean for oxygen service', facility: 'cleanRoom', kind: 'param',
    params: () => [sel('method', 'Cleaning method', [['wipe', 'Solvent wipe'], ['vapor', 'Vapor degrease + rinse'], ['precision', 'Ultrasonic precision clean']], 'vapor'), bool('verify', 'Verify: NVR residue & particle count', false)],
    special: (pr, c, out, rng, q) => {
      const p = { wipe: 0.30, vapor: 0.10, precision: 0.02 }[pr.method] * q;
      if (rng.chance(p)) {
        const d = { type: 'contamination', severity: 0.2 + 0.7 * rng.next() };
        if (pr.verify && rng.chance(0.9)) { d.detected = true; d.note = 'NVR test failed: re-clean required'; }
        out.push(d);
      }
    },
    hours: (c, pr) => (pr.method === 'precision' ? 4 : 2) + (c.area || 0.2) * 2 + (pr.verify ? 2 : 0),
    cost: (c, pr) => 80 + (pr.method === 'precision' ? 400 : 100) + (pr.verify ? 300 : 0),
    desc: 'Hydrocarbon films and particles in LOX-wetted hardware can ignite (adiabatic compression / particle impact).',
  },
  layup: {
    name: 'Ply layup', facility: 'composites', kind: 'param',
    params: (c) => [num('debulk', 'Debulk every N plies', 'plies', 1, 12, 1, 4), bool('cleanroom', 'Controlled contamination area', true), bool('laser', 'Laser-projected ply placement', false)],
    window: () => ({ debulk: [2, 5], cleanroom: [1, 1], laser: [1, 1] }),
    textbook: () => ({ debulk: [2, 6] }),
    rules: [{ on: 'debulk', side: 'high', type: 'wrinkle', base: 0.03, k: 0.8 }, { on: 'cleanroom', side: 'low', type: 'delamination', base: 0, k: 0.08 }, { on: 'laser', side: 'low', type: 'fiberAngle', base: 0, k: 0.06 }],
    hours: (c) => 2 + 7 * (c.area || 0.3) * ((c.plies || 8) / 8),
    cost: (c) => c.matCost ? 0 : 50,
    desc: 'Lay prepreg plies on the tool in the specified orientation.',
  },
  bag: {
    name: 'Vacuum bag', facility: 'composites', kind: 'param',
    params: () => [num('vac', 'Bag vacuum', '% of full', 50, 100, 1, 90), bool('leak', 'Bag leak-down check', false)],
    window: () => ({ vac: [94, 100], leak: [1, 1] }),
    textbook: () => ({ vac: [85, 100] }),
    rules: [{ on: 'vac', side: 'low', type: 'compPorosity', base: 0.03, k: 1.5 }, { on: 'leak', side: 'low', type: 'compPorosity', base: 0, k: 0.12 }],
    hours: (c) => 1 + 1.5 * (c.area || 0.3),
    cost: (c) => 40 + 60 * (c.area || 0.3),
    desc: 'Consolidation pressure removes trapped air. A leaking bag silently loses pressure during cure.',
  },
  cure: {
    name: 'Composite cure', facility: 'composites', kind: 'param',
    params: (c) => [sel('mode', 'Cure method', [['autoclave', 'Autoclave (needs autoclave)'], ['oven', 'Oven, out-of-autoclave resin']], c.hasAutoclave ? 'autoclave' : 'oven'),
      num('ramp', 'Heat-up ramp', '°C/min', 0.5, 8, 0.5, 2.5), num('temp', 'Hold temperature', '°C', 90, 220, 1, 177), num('time', 'Hold time', 'h', 0.5, 8, 0.25, 2), num('pres', 'Autoclave pressure', 'bar', 0, 10, 0.1, 6.0)],
    window: (c) => ({ ramp: [1, 3], temp: [172, 182], time: [2, 3.5], pres: [5.5, 7.5] }),
    textbook: () => ({ ramp: [0.5, 3], temp: [170, 185], time: [1.75, 4], pres: [5, 7.5] }),
    rules: [{ on: 'temp', side: 'low', type: 'undercure', base: 0.01, k: 1.8 }, { on: 'time', side: 'low', type: 'undercure', base: 0, k: 1.5 }, { on: 'temp', side: 'high', type: 'delamination', base: 0, k: 0.7 },
      { on: 'ramp', side: 'high', type: 'delamination', base: 0, k: 0.4 }, { on: 'pres', side: 'low', type: 'compPorosity', base: 0, k: 1.0 }],
    special: (pr, c, out, rng, q) => {
      // oven/OOA: pressure is atmospheric — use OOA prepreg (slightly weaker, more porosity-sensitive)
      if (pr.mode === 'oven') { const i = out.findIndex(d => d.type === 'compPorosity'); if (i >= 0) out.splice(i, 1); if (rng.chance(0.08 * q)) out.push({ type: 'compPorosity', severity: 0.2 + 0.4 * rng.next() }); }
      if (pr.mode === 'autoclave' && !c.hasAutoclave) out.push({ note: 'Outsourced autoclave cure.' });
    },
    ignore: (pr) => (pr.mode === 'oven' ? ['pres'] : []),
    hours: () => 2, calendar: (c, pr) => Math.ceil((pr.time + (pr.temp - 20) / pr.ramp / 60 + 3) / 24),
    cost: (c, pr) => (pr.mode === 'autoclave' ? 1500 : 300),
    desc: 'Epoxy cross-links during the hold. Too cold/short = undercured; too fast a ramp in thick laminates = exotherm/delam.',
  },
  wind: {
    name: 'Filament winding', facility: 'composites', kind: 'param',
    params: () => [num('angle', 'Helical winding angle', '°', 10, 89, 0.5, 50, 'Netting analysis: pure pressure vessel optimum is 54.7°'), num('tension', 'Fiber tension', 'N/tow', 5, 150, 1, 40), bool('wet', 'Wet-out roller check', true)],
    window: () => ({ angle: [53, 56.5], tension: [35, 80], wet: [1, 1] }),
    textbook: () => ({ angle: [45, 60], tension: [20, 90] }),
    rules: [{ on: 'angle', side: 'both', type: 'fiberAngle', base: 0.01, k: 1.6 }, { on: 'tension', side: 'low', type: 'dryFiber', base: 0.02, k: 0.8 }, { on: 'tension', side: 'high', type: 'dryFiber', base: 0, k: 0.5 }, { on: 'wet', side: 'low', type: 'dryFiber', base: 0, k: 0.2 }],
    hours: (c) => 3 + 5 * (c.area || 0.3),
    desc: 'Wind resin-wet carbon tows over a mandrel. Hoop + helical layers carry pressure loads.',
  },
  liner: {
    name: 'Insulate & line case', facility: 'propellant', kind: 'param',
    params: () => [bool('grit', 'Grit-blast case interior', true), bool('primer', 'Bond primer', true), num('cure', 'Liner cure', 'h', 2, 48, 1, 12)],
    window: () => ({ grit: [1, 1], primer: [1, 1], cure: [16, 30] }),
    textbook: () => ({ cure: [8, 36] }),
    rules: [{ on: 'grit', side: 'low', type: 'debond', base: 0, k: 0.35 }, { on: 'primer', side: 'low', type: 'debond', base: 0, k: 0.3 }, { on: 'cure', side: 'low', type: 'debond', base: 0.02, k: 0.6 }],
    hours: (c) => 5 + 2 * (c.area || 0.3), calendar: (c, pr) => Math.ceil(pr.cure / 24),
    desc: 'EPDM insulation + HTPB liner bond the grain to the case and protect it from flame.',
  },
  mix: {
    name: 'Mix propellant (vertical planetary mixer)', facility: 'propellant', kind: 'param',
    params: () => [num('time', 'Mix time', 'min', 15, 240, 5, 75), num('vac', 'Mixer vacuum', 'kPa abs', 0.5, 101, 0.5, 10), num('temp', 'Mix temperature', '°C', 20, 90, 1, 60), num('nco', 'Curative ratio NCO/OH', '', 0.6, 1.2, 0.01, 0.85)],
    window: () => ({ time: [60, 140], vac: [0.5, 5], temp: [52, 66], nco: [0.80, 0.90] }),
    textbook: () => ({ time: [45, 150], vac: [0.5, 15], temp: [50, 70], nco: [0.75, 0.95] }),
    rules: [{ on: 'vac', side: 'high', type: 'void', base: 0.03, k: 1.3 }, { on: 'time', side: 'low', type: 'offRatio', base: 0.02, k: 1.4 }, { on: 'time', side: 'low', type: 'void', base: 0, k: 0.6 },
      { on: 'nco', side: 'both', type: 'offRatio', base: 0, k: 1.5 }, { on: 'nco', side: 'high', type: 'grainCrack', base: 0, k: 1.0 }, { on: 'temp', side: 'high', type: 'void', base: 0, k: 0.8 }],
    special: (pr, c, out, rng, q, env) => { if (!env.facilities.propellant && rng.chance(0.0)) out.push({ hazard: 'fire' }); },
    hours: (c) => 4 + (c.mass || 5) / 15,
    cost: (c) => c.matCost,
    desc: 'Ammonium perchlorate + aluminum + HTPB. Vacuum removes air bubbles; NCO/OH sets cure hardness and burn rate.',
  },
  cast: {
    name: 'Cast grain', facility: 'propellant', kind: 'param',
    params: () => [bool('vacuum', 'Vacuum casting', true), num('rate', 'Pour rate', 'kg/min', 0.1, 20, 0.1, 2), bool('mandrel', 'Release-coated core mandrel', true)],
    window: (c) => ({ vacuum: [1, 1], rate: [0.5, Math.max(1, (c.mass || 5) / 8)], mandrel: [1, 1] }),
    textbook: (c) => ({ rate: [0.3, Math.max(1.5, (c.mass || 5) / 5)] }),
    rules: [{ on: 'vacuum', side: 'low', type: 'void', base: 0, k: 0.45 }, { on: 'rate', side: 'high', type: 'void', base: 0.02, k: 0.8 }, { on: 'mandrel', side: 'low', type: 'grainCrack', base: 0, k: 0.3 }],
    hours: (c) => 3 + (c.mass || 5) / 25,
    desc: 'Pour viscous propellant into the lined case around the core mandrel.',
  },
  cureGrain: {
    name: 'Cure propellant', facility: 'propellant', kind: 'param',
    params: () => [num('temp', 'Oven temperature', '°C', 20, 100, 1, 60), num('days', 'Cure time', 'days', 1, 14, 0.5, 5)],
    window: () => ({ temp: [55, 65], days: [5, 9] }),
    textbook: () => ({ temp: [50, 70], days: [4, 10] }),
    rules: [{ on: 'temp', side: 'low', type: 'offRatio', base: 0, k: 0.8 }, { on: 'days', side: 'low', type: 'offRatio', base: 0.02, k: 1.0 }, { on: 'temp', side: 'high', type: 'grainCrack', base: 0.01, k: 1.2 }],
    hours: () => 2, calendar: (c, pr) => Math.ceil(pr.days),
    desc: 'Cross-link the binder. Hot cures lock in thermal stress (cracks when cold); short cures leave soft, mushy grain.',
  },
  lpbf: {
    name: 'Metal 3D print (L-PBF)', facility: 'metalAM', kind: 'param',
    params: () => [num('power', 'Laser power', 'W', 100, 500, 5, 300), num('speed', 'Scan speed', 'mm/s', 200, 2000, 10, 900), num('layer', 'Layer thickness', 'µm', 20, 90, 5, 40)],
    derive: (pr) => ({ energy: pr.power / (pr.speed * 0.1 * pr.layer / 1000) }),
    derivedLabels: { energy: ['Volumetric energy density', 'J/mm³'] },
    window: (c) => ({ energy: c.mat === 'grcop42' ? [92, 128] : [55, 85] }),
    textbook: (c) => ({ energy: c.mat === 'grcop42' ? [80, 140] : [45, 95] }),
    rules: [{ on: 'energy', side: 'low', type: 'amPorosity', base: 0.04, k: 1.8 }, { on: 'energy', side: 'high', type: 'amPorosity', base: 0, k: 1.0 }, { on: 'energy', side: 'high', type: 'crack', base: 0, k: 0.6 }],
    hours: (c, pr) => 4 + (c.mass || 1) * 9 * (40 / pr.layer), cost: (c) => 150 + 30 * (c.mass || 1),
    desc: 'Laser melts powder layer by layer. Energy density too low = lack-of-fusion pores; too high = keyhole pores and cracks.',
  },
  depowder: {
    name: 'Depowder internal channels', facility: 'metalAM', kind: 'param',
    params: () => [sel('method', 'Method', [['shake', 'Shake & compressed air'], ['flush', 'Solvent flush + vibration'], ['ultra', 'Ultrasonic flush, CT-verified']], 'flush')],
    special: (pr, c, out, rng, q) => { const p = { shake: 0.45, flush: 0.18, ultra: 0.04 }[pr.method] * q; if (rng.chance(p)) out.push({ type: 'trappedPowder', severity: 0.25 + 0.7 * rng.next() }); },
    hours: (c, pr) => ({ shake: 2, flush: 5, ultra: 10 })[pr.method], cost: (c, pr) => ({ shake: 20, flush: 200, ultra: 2500 })[pr.method],
    desc: 'Unfused powder must be removed from every coolant channel.',
  },
  hip: {
    name: 'Hot isostatic press (HIP)', facility: 'hip', kind: 'param',
    params: () => [bool('do', 'Perform HIP cycle', true)],
    special: (pr, c, out, rng, q, env, part) => { if (pr.do && part) for (const d of part.defects) if (d.type === 'amPorosity' || d.type === 'porosity') d.severity *= 0.2; },
    hours: (c, pr) => (pr.do ? 2 : 0), calendar: (c, pr) => (pr.do ? 3 : 0), cost: (c, pr) => (pr.do ? 6000 : 0),
    desc: 'High pressure + temperature closes internal porosity (not surface-connected pores or channels).',
  },
  edni: {
    name: 'Electrodeposit nickel closeout', facility: 'plating', kind: 'param',
    params: () => [num('cd', 'Current density', 'A/dm²', 0.5, 8, 0.1, 3), num('bath', 'Bath temperature', '°C', 25, 70, 1, 50), bool('act', 'Surface activation (wax fill + Ag strike)', true)],
    window: () => ({ cd: [2, 3.8], bath: [45, 55], act: [1, 1] }),
    textbook: () => ({ cd: [1.5, 5], bath: [40, 60] }),
    rules: [{ on: 'act', side: 'low', type: 'closeoutDebond', base: 0, k: 0.5 }, { on: 'cd', side: 'high', type: 'closeoutDebond', base: 0.02, k: 1.0 }, { on: 'bath', side: 'both', type: 'porosity', base: 0.02, k: 0.6 }],
    hours: () => 6, calendar: (c, pr) => Math.ceil(2.5 / (0.025 * pr.cd / 3) / 24), cost: (c) => 800 + 200 * (c.area || 0.1),
    desc: 'Channels are filled with wax and a nickel jacket is electroformed over them (slow: ~25 µm/h).',
  },
  braze: {
    name: 'Vacuum braze', facility: 'heatTreat', kind: 'param',
    params: () => [num('temp', 'Braze temperature', '°C', 900, 1100, 1, 1030), num('time', 'Time at temperature', 'min', 1, 40, 1, 10), bool('stopoff', 'Apply braze stop-off at channel entries', true)],
    window: () => ({ temp: [1010, 1040], time: [5, 15], stopoff: [1, 1] }),
    textbook: () => ({ temp: [1000, 1050], time: [3, 20] }),
    rules: [{ on: 'temp', side: 'low', type: 'closeoutDebond', base: 0.02, k: 1.4 }, { on: 'temp', side: 'high', type: 'channelBlock', base: 0, k: 1.2 }, { on: 'time', side: 'high', type: 'channelBlock', base: 0, k: 0.8 }, { on: 'stopoff', side: 'low', type: 'channelBlock', base: 0, k: 0.3 }],
    hours: () => 4, calendar: () => 1, cost: (c) => 900 + 100 * (c.mass || 1),
    desc: 'Bond jacket or tubes with a filler alloy in a vacuum furnace. Overheating floods channels with braze.',
  },
  drill: {
    name: 'Make injector orifices', facility: 'machine', kind: 'param',
    params: () => [sel('method', 'Process', [['drill', 'Twist drill (±25 µm)'], ['edm', 'Wire/sinker EDM (±5 µm)'], ['laser', 'Laser drill (±12 µm, recast)']], 'drill'), bool('deburr', 'Abrasive-flow deburr', true)],
    special: (pr, c, out, rng, q) => {
      const p = { drill: 0.3, edm: 0.07, laser: 0.14 }[pr.method] * q;
      if (rng.chance(p)) out.push({ type: 'orifice', severity: 0.15 + 0.7 * rng.next() });
      if (!pr.deburr && rng.chance(0.4)) out.push({ type: 'fod', severity: 0.2 + 0.5 * rng.next(), note: 'Burrs break loose' });
    },
    hours: (c, pr) => 3 + (c.elements || 50) * ({ drill: 0.05, edm: 0.15, laser: 0.03 })[pr.method], cost: (c, pr) => ({ drill: 50, edm: 600, laser: 300 })[pr.method],
    desc: 'Orifice diameter sets flow: Δ(flow) ∝ Δ(area). A few % error shifts mixture ratio and causes hot streaks.',
  },
  balance: {
    name: 'Rotor balancing', facility: 'machine', kind: 'param',
    params: () => [sel('grade', 'Balance quality grade (ISO 21940)', [['G16', 'G16 (crude)'], ['G6.3', 'G6.3 (general machinery)'], ['G2.5', 'G2.5 (turbomachinery)'], ['G1', 'G1 (precision)']], 'G6.3'), num('iter', 'Correction iterations', '', 1, 8, 1, 2)],
    special: (pr, c, out, rng, q) => {
      const base = { G16: 0.9, 'G6.3': 0.45, 'G2.5': 0.15, G1: 0.05 }[pr.grade] * Math.pow(0.75, pr.iter - 1);
      if (rng.chance(Math.min(0.95, base * 1.4 * q))) out.push({ type: 'imbalance', severity: Math.min(1, base * (0.6 + 0.8 * rng.next())) });
    },
    hours: (c, pr) => 2 + 2 * pr.iter + ({ G16: 0, 'G6.3': 1, 'G2.5': 3, G1: 6 })[pr.grade],
    desc: 'Residual imbalance force ∝ ω². A rotor at 30,000 rpm needs G2.5 or better.',
  },
  bearings: {
    name: 'Install bearings & seals', facility: 'cleanRoom', kind: 'param',
    params: (c) => [num('preload', 'Bearing preload', 'N', 50, 3000, 10, Math.round(c.preload || 600)), num('gap', 'Seal clearance', 'µm', 5, 120, 1, 40), bool('purge', 'Helium purge for inter-propellant seal', true)],
    window: (c) => ({ preload: [(c.preload || 600) * 0.85, (c.preload || 600) * 1.15], gap: [18, 35], purge: [1, 1] }),
    textbook: (c) => ({ preload: [(c.preload || 600) * 0.7, (c.preload || 600) * 1.3], gap: [15, 50] }),
    rules: [{ on: 'preload', side: 'both', type: 'bearing', base: 0.02, k: 1.4 }, { on: 'gap', side: 'high', type: 'sealLeak', base: 0.01, k: 1.2 }, { on: 'gap', side: 'low', type: 'bearing', base: 0, k: 0.6 }, { on: 'purge', side: 'low', type: 'sealLeak', base: 0, k: 0.35 }],
    hours: () => 6,
    desc: 'Preload too low = ball skidding; too high = overheating. Seal gap too wide lets fuel meet oxidizer.',
  },
  reflow: {
    name: 'PCB assembly (SMT reflow)', facility: 'electronics', kind: 'param',
    params: () => [num('peak', 'Reflow peak temperature', '°C', 200, 280, 1, 245), num('tal', 'Time above liquidus', 's', 10, 180, 5, 60), bool('aoi', 'Automated optical + X-ray inspection', false)],
    window: () => ({ peak: [236, 250], tal: [45, 90] }),
    textbook: () => ({ peak: [230, 255], tal: [30, 120] }),
    rules: [{ on: 'peak', side: 'low', type: 'solder', base: 0.03, k: 1.6 }, { on: 'tal', side: 'low', type: 'solder', base: 0, k: 1.2 }, { on: 'peak', side: 'high', type: 'infant', base: 0, k: 1.0 }, { on: 'tal', side: 'high', type: 'solder', base: 0, k: 0.4 }],
    special: (pr, c, out, rng) => { if (pr.aoi) for (const d of out) if (d.type === 'solder' && rng.chance(0.75)) { d.detected = true; d.note = 'Caught by AOI/X-ray; reworked'; d.reworked = true; } },
    hours: (c, pr) => 3 + (pr.aoi ? 2 : 0), cost: (c, pr) => 400 + (pr.aoi ? 600 : 0),
    desc: 'SAC305 lead-free solder profile. Cold joints open under vibration.',
  },
  coat: {
    name: 'Conformal coat & stake', facility: 'electronics', kind: 'param',
    params: () => [bool('coat', 'Conformal coating', true), bool('stake', 'Stake heavy components (RTV)', true)],
    special: (pr, c, out, rng, q, env, part) => { if (part) { part.vibHard = (pr.coat ? 0.7 : 1) * (pr.stake ? 0.6 : 1); } },
    hours: () => 3, cost: () => 120,
    desc: 'Coating and staking reduce vibration-induced solder fatigue.',
  },
  hitl: {
    name: 'Flight software: hardware-in-the-loop test', facility: 'electronics', kind: 'param',
    params: () => [num('hours', 'Simulated-flight test hours', 'h', 0, 400, 5, 20), bool('mc', 'Monte-Carlo dispersions', false)],
    special: (pr, c, out, rng, q, env, part) => {
      if (!part) return;
      for (const d of part.defects) if (d.type === 'firmware' && !d.detected) {
        const p = 1 - Math.exp(-pr.hours / (pr.mc ? 30 : 60));
        if (rng.chance(p)) { d.detected = true; d.fixed = true; d.note = 'Bug found in HITL and fixed'; }
      }
    },
    hours: (c, pr) => 2 + pr.hours * 0.3, calendar: (c, pr) => Math.ceil(pr.hours / 16),
    desc: 'Run the flight computer against a real-time 6-DOF simulation. Every flight program has bugs; testing finds them.',
  },
  burnin: {
    name: 'Burn-in / acceptance test', facility: 'electronics', kind: 'param',
    params: () => [num('hours', 'Powered burn-in', 'h', 0, 336, 4, 24), bool('thermal', 'Thermal cycling (−20…+60 °C)', false)],
    special: (pr, c, out, rng, q, env, part) => {
      if (!part) return;
      for (const d of part.defects) if ((d.type === 'infant' || d.type === 'solder') && !d.detected) {
        const k = d.type === 'infant' ? 48 : 150;
        const p = 1 - Math.exp(-pr.hours / k * (pr.thermal ? 2.2 : 1));
        if (rng.chance(p)) { d.detected = true; d.note = 'Failed in burn-in; replaced'; d.fixed = true; }
      }
    },
    hours: () => 2, calendar: (c, pr) => Math.ceil(pr.hours / 24),
    desc: 'Screens infant-mortality parts and weak joints before flight.',
  },
  crimp: {
    name: 'Harness fabrication', facility: 'electronics', kind: 'param',
    params: () => [num('crimp', 'Crimp height (vs spec)', '%', 80, 120, 1, 100), bool('pull', 'Pull-test sample crimps', true), bool('hipot', 'Continuity + hi-pot test', true)],
    window: () => ({ crimp: [96, 104], pull: [1, 1] }),
    textbook: () => ({ crimp: [93, 107] }),
    rules: [{ on: 'crimp', side: 'both', type: 'crimp', base: 0.03, k: 1.6 }, { on: 'pull', side: 'low', type: 'crimp', base: 0, k: 0.1 }],
    special: (pr, c, out, rng) => { if (pr.hipot) for (const d of out) if (d.type === 'crimp' && rng.chance(0.45)) { d.detected = true; d.fixed = true; d.note = 'Open circuit found at continuity test'; } },
    hours: (c) => 4 + (c.mass || 1) * 3,
    desc: 'Cut, strip, crimp and lace the wiring harness.',
  },
  sew: {
    name: 'Fabricate parachute', facility: null, kind: 'param',
    params: () => [num('spi', 'Stitch density', 'stitches/in', 4, 16, 1, 8), sel('fabric', 'Canopy fabric', [['ripstop', '1.1 oz ripstop nylon'], ['zp', 'Zero-porosity nylon']], 'ripstop')],
    window: () => ({ spi: [7, 11] }),
    textbook: () => ({ spi: [6, 12] }),
    rules: [{ on: 'spi', side: 'low', type: 'packing', base: 0.01, k: 0.8 }],
    hours: (c) => 4 + 6 * (c.area || 1),
    desc: 'Gores, reinforcing tapes and shroud lines.',
  },
  pack: {
    name: 'Pack recovery system', facility: null, kind: 'param',
    params: () => [bool('rigger', 'Certified parachute rigger packs', false), bool('swivel', 'Install swivel on riser', true), num('charge', 'Ejection charge', 'g BP', 0.2, 20, 0.1, 2)],
    window: (c) => ({ rigger: [1, 1], swivel: [1, 1], charge: [c.charge * 0.85, c.charge * 1.5] }),
    textbook: (c) => ({ charge: [c.charge * 0.7, c.charge * 2] }),
    rules: [{ on: 'rigger', side: 'low', type: 'packing', base: 0, k: 0.15 }, { on: 'swivel', side: 'low', type: 'packing', base: 0, k: 0.06 }, { on: 'charge', side: 'low', type: 'packing', base: 0, k: 1.6 }],
    hours: () => 2,
    desc: 'Fold & pack canopies; size the black-powder ejection charge for the bay volume.',
  },
  assemble: {
    name: 'Mechanical assembly', facility: null, kind: 'param',
    params: () => [bool('torque', 'Calibrated torque tools + torque stripe', true), bool('fod', 'FOD walk-down & closeout photos', false), bool('oring', 'O-ring lube & inspection', true)],
    window: () => ({ torque: [1, 1], fod: [1, 1], oring: [1, 1] }),
    textbook: () => ({}),
    rules: [{ on: 'fod', side: 'low', type: 'fod', base: 0.01, k: 0.12 }, { on: 'oring', side: 'low', type: 'pinchedSeal', base: 0.01, k: 0.25 }, { on: 'torque', side: 'low', type: 'pinchedSeal', base: 0, k: 0.1 }],
    hours: (c) => 2 + 2 * Math.pow(c.mass || 1, 0.5),
    desc: 'Assemble with controlled torque; closeout photos document that nothing was left inside.',
  },
  align: {
    name: 'Fin alignment & bonding', facility: null, kind: 'param',
    params: () => [sel('jig', 'Alignment method', [['eye', 'By eye'], ['jig', 'Printed alignment jig'], ['fixture', 'Machined fixture + laser check']], 'jig'), num('fillet', 'Epoxy fillet radius', 'mm', 0, 20, 0.5, 6)],
    window: (c) => ({ fillet: [4, 12] }),
    textbook: () => ({ fillet: [3, 15] }),
    rules: [{ on: 'fillet', side: 'low', type: 'delamination', base: 0, k: 0.6 }],
    special: (pr, c, out, rng, q) => { const p = { eye: 0.7, jig: 0.25, fixture: 0.05 }[pr.jig] * q; if (rng.chance(p)) out.push({ type: 'finMisalign', severity: (pr.jig === 'eye' ? 0.4 : 0.15) + 0.5 * rng.next() }); },
    hours: (c, pr) => 3 + ({ eye: 0, jig: 1, fixture: 3 })[pr.jig],
    desc: 'Fins must be parallel to the body axis within ~0.1°; misalignment creates roll and pitch moments.',
  },
  buy: {
    name: 'Buy component', facility: null, kind: 'procure',
    params: (c) => [sel('tier', 'Component grade', [['commercial', 'Commercial (COTS)'], ['industrial', 'Industrial / automotive'], ['space', 'Space-grade (screened)']], c.defTier || 'industrial'), bool('expedite', 'Expedite', false)],
    special: (pr, c, out, rng, q) => { const p = { commercial: 0.14, industrial: 0.06, space: 0.012 }[pr.tier]; if (rng.chance(p)) out.push({ type: c.buyDefect || 'infant', severity: 0.3 + 0.6 * rng.next() }); },
    hours: () => 0.5, cost: (c, pr) => (c.buyCost || 500) * ({ commercial: 1, industrial: 3, space: 15 })[pr.tier] * (pr.expedite ? 1.6 : 1),
    lead: (c, pr) => Math.max(1, Math.round((c.lead || 14) * ({ commercial: 0.5, industrial: 1, space: 3 })[pr.tier] * (pr.expedite ? 0.4 : 1))),
    desc: 'Purchase from a supplier. Higher grades are screened (burn-in, lot acceptance) and fail far less.',
  },
  coatSilicide: {
    name: 'Silicide oxidation coating', facility: 'heatTreat', kind: 'param',
    params: () => [num('thk', 'Coating thickness', 'µm', 20, 200, 5, 80), num('passes', 'Slurry passes', '', 1, 5, 1, 2)],
    window: () => ({ thk: [75, 110], passes: [2, 4] }),
    textbook: () => ({ thk: [60, 130] }),
    rules: [{ on: 'thk', side: 'low', type: 'coating', base: 0.02, k: 1.5 }, { on: 'thk', side: 'high', type: 'coating', base: 0, k: 0.6 }, { on: 'passes', side: 'low', type: 'coating', base: 0, k: 0.4 }],
    hours: () => 6, calendar: () => 2, cost: (c) => 1500 + 1000 * (c.area || 0.2),
    desc: 'R512E-type fused silicide protects niobium from oxidizing at 1400+ °C.',
  },
  tapewrap: {
    name: 'Tape-wrap ablative & cure', facility: 'composites', kind: 'param',
    params: () => [num('tension', 'Tape tension', 'N', 5, 200, 5, 60), num('angle', 'Wrap angle to centerline', '°', 0, 90, 1, 45), num('pres', 'Cure pressure', 'bar', 0, 70, 1, 7)],
    window: () => ({ tension: [45, 100], angle: [35, 60], pres: [6, 70] }),
    textbook: () => ({ tension: [30, 120], angle: [30, 70] }),
    rules: [{ on: 'tension', side: 'low', type: 'delamination', base: 0.02, k: 1.0 }, { on: 'angle', side: 'both', type: 'delamination', base: 0, k: 0.8 }, { on: 'pres', side: 'low', type: 'compPorosity', base: 0.01, k: 1.0 }],
    hours: (c) => 6 + 4 * (c.mass || 1) ** 0.5, calendar: () => 1, cost: (c) => c.matCost ? 0 : 200,
    desc: 'Phenolic-impregnated tape wrapped at an angle so char layers do not peel off in the flow.',
  },
  graphite: {
    name: 'Machine graphite throat', facility: 'machine', kind: 'param',
    params: () => [bool('bake', 'Vacuum bake-out before machining', true), num('fit', 'Interference fit', 'µm', 0, 200, 5, 50)],
    window: () => ({ bake: [1, 1], fit: [25, 75] }),
    textbook: () => ({ fit: [10, 120] }),
    rules: [{ on: 'bake', side: 'low', type: 'thermalShock', base: 0, k: 0.15 }, { on: 'fit', side: 'high', type: 'thermalShock', base: 0.01, k: 1.2 }, { on: 'fit', side: 'low', type: 'dimensional', base: 0, k: 0.8 }],
    hours: () => 5,
    desc: 'Graphite resists erosion but is brittle; too tight a fit cracks it when it heats and expands.',
  },
  // ---- inspections & acceptance tests (in-traveler) ----
  inspect: {
    name: 'Inspection (NDI)', facility: null, kind: 'inspect',
    params: (c) => (c.methods || ['visual']).map(m => bool(m, m, m === 'visual')),
    hours: () => 0, desc: 'Choose inspection methods. Each method finds different defect types with different probability of detection.',
  },
  proof: {
    name: 'Hydrostatic proof test', facility: 'hydro', kind: 'proof',
    params: () => [num('factor', 'Proof factor', '× MEOP', 1.0, 2.0, 0.01, 1.25, 'NASA-STD-5001 metallic tanks: 1.05–1.5× MEOP')],
    hours: () => 4, cost: () => 400,
    desc: 'Pressurize with water to proof factor × MEOP. A pass demonstrates no flaw is critical at that pressure. Pressure above yield permanently deforms the part.',
  },
  leak: {
    name: 'Helium mass-spectrometer leak test', facility: 'hydro', kind: 'leak',
    params: () => [sel('mode', 'Mode', [['bubble', 'Bubble / snoop (cheap, ~1e-4 sccs)'], ['msl', 'Mass-spec sniffer (~1e-7)'], ['chamber', 'Vacuum chamber hard-vac (~1e-9)']], 'msl')],
    hours: (c, pr) => ({ bubble: 1, msl: 3, chamber: 8 })[pr.mode], cost: (c, pr) => ({ bubble: 20, msl: 400, chamber: 3000 })[pr.mode],
    desc: 'Finds leak paths (through-porosity, cracks, bad seals).',
  },
  flow: {
    name: 'Water-flow calibration', facility: 'hydro', kind: 'flow',
    params: () => [bool('pattern', 'Spray-pattern photography', true)],
    hours: () => 6, cost: () => 600,
    desc: 'Flow water at rated ΔP; measure discharge coefficients and look for blocked passages and streaks.',
  },
  spinTest: {
    name: 'Turbopump spin / vibration test', facility: 'testSmall', kind: 'spinTest',
    params: () => [num('speed', 'Overspeed test', '% rated', 80, 130, 1, 110)],
    hours: () => 8, cost: () => 3000,
    desc: 'Spin on gas to rated (and over) speed while measuring vibration.',
  },
  functional: {
    name: 'Functional test', facility: null, kind: 'functional',
    params: () => [bool('env', 'Include thermal cycling', false)],
    hours: () => 3, cost: () => 100,
    desc: 'Power up / actuate and check performance against spec.',
  },
};

// ---------- ROUTES: ordered step lists per part kind ----------
const S = (kind, label, ctx = {}) => ({ kind, label: label || STEP_KINDS[kind].name, ctx });
const NDI_METAL = ['visual', 'pt', 'rt', 'ut', 'ct', 'cmm'];
const NDI_COMP = ['visual', 'tap', 'ut', 'ct'];

export const ROUTES = {
  tankWelded: (p) => [
    S('procure', `Procure ${MATERIALS[p.mat].name} plate`),
    S('form', 'Roll barrel segments'),
    S('spin', 'Spin-form domes'),
    ...(p.stiffening && p.stiffening !== 'monocoque' ? [S('machine', `Mill ${p.stiffening} pockets`, { pocketArea: p.area })] : []),
    p.process === 'fsw' ? S('weldFSW', 'Friction-stir weld seams') : S('weldFusion', `${p.process === 'vppa' ? 'VPPA' : 'TIG'} weld seams`),
    ...(MATERIALS[p.mat].needsHT ? [S('heatTreat', 'Post-weld heat treatment')] : []),
    S('inspect', 'Weld inspection', { methods: NDI_METAL }),
    ...(p.lox ? [S('o2clean')] : []),
    S('proof'),
    S('leak'),
  ],
  tankComposite: (p) => [
    S('procure', 'Procure carbon tow + resin'),
    S('buy', 'Buy metallic liner', { buyCost: 800 + 300 * p.mass, lead: 30 }),
    S('wind'), S('cure', 'Oven cure'),
    S('inspect', 'Laminate inspection', { methods: NDI_COMP }),
    S('proof'), S('leak'),
  ],
  shellComposite: (p) => [
    S('procure', p.mat === 'g10' ? 'Procure glass prepreg' : 'Procure carbon prepreg'),
    S('layup', null, { plies: p.plies || 8 }), S('bag'), S('cure'),
    S('machine', 'Trim & drill'),
    S('inspect', 'Laminate inspection', { methods: NDI_COMP }),
  ],
  shellMetal: (p) => [
    S('procure', `Procure ${MATERIALS[p.mat].name}`),
    p.spun ? S('spin', 'Spin-form') : S('form', 'Roll / form'),
    ...(p.welded ? [S('weldFusion', 'Weld seam')] : []),
    S('machine', 'Machine rings & interfaces'),
    S('inspect', null, { methods: NDI_METAL }),
  ],
  nose: (p) => [
    ...(MATERIALS[p.mat].cls === 'composite' ? [S('procure', 'Procure prepreg'), S('layup', null, { plies: p.plies || 6 }), S('bag'), S('cure')] : [S('procure', `Procure ${MATERIALS[p.mat].name}`), S('spin', 'Spin-form nose')]),
    S('machine', 'Machine tip & shoulder'),
    S('inspect', null, { methods: MATERIALS[p.mat].cls === 'composite' ? NDI_COMP : NDI_METAL }),
  ],
  fins: (p) => [
    S('procure', `Procure ${MATERIALS[p.mat].name} sheet`),
    S('machine', 'Cut fins & bevel edges'),
    S('align'),
    S('inspect', 'Alignment & bond inspection', { methods: ['visual', 'cmm', 'tap'] }),
  ],
  motorCaseMetal: (p) => [
    S('procure', `Procure ${MATERIALS[p.mat].name} tube`),
    S('machine', 'Machine closures & threads'),
    ...(p.welded ? [S('weldFusion', 'Weld forward closure')] : []),
    ...(MATERIALS[p.mat].needsHT ? [S('heatTreat')] : []),
    S('inspect', null, { methods: NDI_METAL }),
    S('proof', 'Hydro-proof case'),
  ],
  motorCaseComposite: (p) => [S('procure', 'Procure carbon tow'), S('wind'), S('cure'), S('machine', 'Machine end rings'), S('inspect', null, { methods: NDI_COMP }), S('proof', 'Hydro-proof case')],
  grain: (p) => [
    S('procure', 'Procure AP / Al / HTPB / curative'),
    S('liner'), S('mix'), S('cast'), S('cureGrain'),
    S('inspect', 'Radiograph / CT grain', { methods: ['visual', 'rt', 'ct'] }),
  ],
  solidNozzle: (p) => [S('procure', 'Procure graphite billet + phenolic tape'), S('graphite'), S('tapewrap', 'Tape-wrap exit cone'), S('machine', 'Machine housing'), S('inspect', null, { methods: ['visual', 'rt', 'ct', 'cmm'] })],
  igniterPyro: (p) => [S('buy', 'Buy initiators (e-matches/squibs)', { buyCost: 60, lead: 7 }), S('assemble', 'Assemble pyrogen / cartridge'), S('functional', 'Bridgewire resistance & no-fire test')],
  chamberMachined: (p) => [
    S('procure', `Procure ${MATERIALS[p.mat].name} forging`),
    S('machine', 'Turn liner & mill coolant channels'),
    S('heatTreat', 'Age liner'),
    S('edni', 'Electroform nickel closeout'),
    S('weldFusion', 'Weld Inconel structural jacket & manifolds', { mat: 'in718' }),
    S('inspect', 'Inspect chamber', { methods: NDI_METAL }),
    S('flow', 'Coolant-circuit flow test'),
    S('proof', 'Proof coolant jacket'),
    S('o2clean'),
  ],
  chamberAM: (p) => [
    S('procure', `Procure ${MATERIALS[p.mat].name} powder`),
    S('lpbf', 'Print chamber (integral channels)'),
    S('depowder'), S('hip'),
    S('heatTreat', 'Age / stress relieve'),
    S('machine', 'Machine interfaces'),
    S('inspect', 'CT the channels', { methods: NDI_METAL }),
    S('flow', 'Coolant-circuit flow test'),
    S('proof', 'Proof coolant jacket'),
    S('o2clean'),
  ],
  chamberAblative: (p) => [S('procure', 'Procure phenolic tape + housing stock'), S('tapewrap', 'Tape-wrap ablative liner'), S('machine', 'Machine housing & liner bore'), S('assemble', 'Bond liner into housing'), S('inspect', null, { methods: ['visual', 'rt', 'ct', 'cmm'] })],
  chamberRadiative: (p) => [S('procure', `Procure ${MATERIALS[p.mat].name} sheet`), S('spin', 'Spin-form chamber'), S('weldFusion', 'Weld injector flange'), S('coatSilicide'), S('inspect', null, { methods: ['visual', 'pt', 'rt', 'cmm'] })],
  nozzleExt: (p) => [S('procure', `Procure ${MATERIALS[p.mat].name} sheet`), S('spin', 'Spin-form extension'), S('coatSilicide'), S('inspect', null, { methods: ['visual', 'pt', 'cmm'] })],
  injector: (p) => [S('procure', 'Procure stainless bar'), S('machine', 'Machine body & manifolds'), S('drill', null, { elements: p.elements }), S('braze', 'Braze faceplate'), S('inspect', null, { methods: ['visual', 'rt', 'ct', 'cmm'] }), S('flow'), S('o2clean')],
  turbopump: (p) => [S('procure', 'Procure Inconel/aluminum forgings'), S('machine', 'Machine impellers, inducers, turbine disk'), S('heatTreat', 'Heat-treat turbine disk', { mat: 'in718' }), S('balance'), S('bearings', null, { preload: p.preload }), S('o2clean', 'Clean LOX pump'), S('inspect', null, { methods: ['visual', 'pt', 'ct', 'cmm'] }), S('spinTest')],
  gasGenerator: (p) => [S('procure', 'Procure Inconel'), S('machine', 'Machine GG body + injector'), S('weldFusion', 'Weld GG assembly', { mat: 'in718' }), S('inspect', null, { methods: NDI_METAL }), S('flow')],
  motorPump: (p) => [S('buy', 'Buy BLDC motors + inverters', { buyCost: 2500 * Math.max(1, p.powerKW / 50), lead: 30 }), S('machine', 'Machine pumps'), S('balance'), S('bearings', null, { preload: 200 }), S('functional', 'Spin-up test')],
  valves: (p) => [S('buy', 'Buy main propellant valves', { buyCost: 1500 + 40 * p.mass, lead: 45, buyDefect: 'pinchedSeal' }), S('o2clean'), S('leak'), S('functional', 'Cycle & response-time test')],
  igniterLiquid: (p) => [S('buy', 'Buy igniter hardware', { buyCost: 800, lead: 21 }), S('assemble'), S('functional', 'Igniter light-off test')],
  gimbal: (p) => [S('procure', 'Procure Ti / steel'), S('machine', 'Machine gimbal block & clevises'), S('buy', 'Buy actuators', { buyCost: 3000 + 50 * p.mass, lead: 45 }), S('assemble'), S('functional', 'Actuator frequency-response test')],
  copv: (p) => [S('buy', 'Buy COPVs', { buyCost: p.cost || 3000, lead: 60, buyDefect: 'copvLiner', defTier: 'industrial' }), S('proof', 'Acceptance proof'), S('leak')],
  plumbing: (p) => [S('procure', 'Procure stainless tube & fittings'), S('form', 'Bend lines'), S('weldFusion', 'Orbital-weld joints', { mat: 'ss304L' }), S('o2clean'), S('assemble'), S('leak')],
  thrustStructure: (p) => [S('procure', `Procure ${MATERIALS[p.mat].name}`), S('machine', 'Machine thrust frame members'), S('weldFusion', 'Weld frame'), S('inspect', null, { methods: NDI_METAL })],
  avionics: (p) => [S('buy', 'Buy electronic components', { buyCost: p.cost || 2000, lead: 21, defTier: p.tier || 'industrial' }), S('reflow'), S('coat'), S('hitl'), S('burnin')],
  harness: (p) => [S('procure', 'Procure wire & connectors'), S('crimp'), S('inspect', null, { methods: ['visual'] })],
  battery: (p) => [S('buy', 'Buy Li-ion cells', { buyCost: 50 + 400 * p.mass, lead: 14 }), S('assemble', 'Spot-weld & pot pack'), S('burnin', 'Acceptance charge/discharge cycles')],
  fts: (p) => [S('buy', 'Buy command receivers & safe-arm device', { buyCost: 25000, lead: 60, defTier: 'space' }), S('assemble'), S('functional', 'End-to-end command destruct test')],
  parachute: (p) => [S('sew'), S('pack', null, { charge: p.charge })],
  sepSystem: (p) => [S('buy', p.kind === 'pneumatic' ? 'Buy pneumatic pushers' : 'Buy pyrotechnic separation hardware', { buyCost: p.cost || 4000, lead: 45, buyDefect: 'pinchedSeal' }), S('assemble'), S('functional', 'Separation function test')],
  rcs: (p) => [S('buy', 'Buy cold-gas thrusters & valves', { buyCost: 6000, lead: 45 }), S('plumbing' in STEP_KINDS ? 'assemble' : 'assemble'), S('leak'), S('functional')],
  adapter: (p) => [S('procure', 'Procure aluminum'), S('machine', 'Machine adapter ring'), S('inspect', null, { methods: ['visual', 'cmm'] })],
};

export const LABOR_RATE = 95;     // $/h, fully burdened technician
export const OUTSOURCE_FACTOR = 2.4;
export const OUTSOURCE_DAYS = 10;
