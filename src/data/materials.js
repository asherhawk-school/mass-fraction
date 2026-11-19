// Engineering material database (typical room-temperature properties; MMPDS / vendor-sheet ballpark).
// Fty/Ftu = yield/ultimate tensile strength (Pa). Tmax = max useful service temperature (K).
// cryoGain = strength multiplier at cryogenic service. weld.fusion/fsw = joint efficiency (weld-zone
// strength ÷ parent) or false if the process is not viable. lox = compatible with oxygen service.
// cv = lot-to-lot coefficient of variation of strength (drives A/B-basis allowables).

export const MATERIALS = {
  al6061: {
    name: 'Al 6061-T6', cls: 'metal', rho: 2700, Fty: 276e6, Ftu: 310e6, E: 68.9e9, G: 26e9, k: 167, cp: 896, alpha: 23.6e-6, nu: 0.33,
    Tmax: 450, cryoGain: 1.15, weld: { fusion: 0.45, fsw: 0.70 }, lox: true, cost: 9, lead: 5, cv: 0.035,
    note: 'Cheap and easy, but fusion welds soften the heat-affected zone to ~45% strength (T6 temper lost).',
  },
  al2219: {
    name: 'Al 2219-T87', cls: 'metal', rho: 2840, Fty: 393e6, Ftu: 476e6, E: 73.8e9, G: 27e9, k: 120, cp: 864, alpha: 22.3e-6, nu: 0.33,
    Tmax: 480, cryoGain: 1.25, weld: { fusion: 0.65, fsw: 0.78 }, lox: true, cost: 28, lead: 35, cv: 0.03,
    note: 'Classic cryogenic tank alloy — very weldable, gets stronger when cold.',
  },
  al2195: {
    name: 'Al-Li 2195-T8', cls: 'metal', rho: 2710, Fty: 525e6, Ftu: 560e6, E: 76e9, G: 28e9, k: 88, cp: 860, alpha: 22e-6, nu: 0.33,
    Tmax: 450, cryoGain: 1.2, weld: { fusion: 0.50, fsw: 0.75 }, lox: true, cost: 65, lead: 60, cv: 0.035, crackProne: true,
    note: 'Lighter, stiffer, stronger. Fusion welds are crack-prone — friction-stir welding strongly preferred.',
  },
  al7075: {
    name: 'Al 7075-T6', cls: 'metal', rho: 2810, Fty: 503e6, Ftu: 572e6, E: 71.7e9, G: 26.9e9, k: 130, cp: 960, alpha: 23.4e-6, nu: 0.33,
    Tmax: 420, cryoGain: 1.1, weld: { fusion: false, fsw: 0.70 }, lox: true, cost: 14, lead: 10, cv: 0.035,
    note: 'Very strong but NOT fusion-weldable (hot cracking). Fine for machined/bolted parts.',
  },
  ss304L: {
    name: 'Stainless 304L (cold-worked)', cls: 'metal', rho: 8000, Fty: 450e6, Ftu: 700e6, E: 193e9, G: 77e9, k: 16, cp: 500, alpha: 17e-6, nu: 0.29,
    Tmax: 1000, cryoGain: 1.6, weld: { fusion: 0.85, fsw: 0.85 }, lox: true, cost: 6, lead: 7, cv: 0.04,
    note: 'Heavy, but tough, cheap, hot-strong and much stronger at cryogenic temperature.',
  },
  steel4130: {
    name: 'Steel 4130 (Q&T)', cls: 'metal', rho: 7850, Fty: 965e6, Ftu: 1100e6, E: 205e9, G: 80e9, k: 43, cp: 477, alpha: 12.3e-6, nu: 0.29,
    Tmax: 700, cryoGain: 1.0, weld: { fusion: 0.6, fsw: false }, lox: true, cost: 4, lead: 5, cv: 0.04, needsHT: true,
    note: 'Needs quench & temper after welding to reach full strength. Brittle at cryogenic temperatures.',
  },
  d6ac: {
    name: 'Steel D6AC', cls: 'metal', rho: 7870, Fty: 1380e6, Ftu: 1520e6, E: 205e9, G: 80e9, k: 40, cp: 470, alpha: 12e-6, nu: 0.29,
    Tmax: 750, cryoGain: 1.0, weld: { fusion: 0.7, fsw: false }, lox: false, cost: 12, lead: 60, cv: 0.035, needsHT: true,
    note: 'Ultra-high-strength motor-case steel (large SRBs).',
  },
  ti64: {
    name: 'Ti-6Al-4V', cls: 'metal', rho: 4430, Fty: 880e6, Ftu: 950e6, E: 113.8e9, G: 44e9, k: 6.7, cp: 526, alpha: 8.6e-6, nu: 0.34,
    Tmax: 650, cryoGain: 1.3, weld: { fusion: 0.9, fsw: 0.85 }, lox: false, cost: 50, lead: 45, cv: 0.03,
    note: 'Excellent strength-to-weight — but titanium can ignite on impact in liquid oxygen. Never use in LOX service.',
  },
  in718: {
    name: 'Inconel 718', cls: 'metal', rho: 8190, Fty: 1030e6, Ftu: 1240e6, E: 200e9, G: 77e9, k: 11.4, cp: 435, alpha: 13e-6, nu: 0.29,
    Tmax: 980, cryoGain: 1.1, weld: { fusion: 0.85, fsw: false }, lox: true, cost: 70, lead: 120, cv: 0.03,
    note: 'Nickel superalloy for manifolds, turbines, jackets. Poor thermal conductor — bad liner.',
  },
  oxAlloy: {
    name: 'Ox-rich superalloy (Mondaloy-class)', cls: 'metal', rho: 8300, Fty: 900e6, Ftu: 1100e6, E: 210e9, G: 80e9, k: 12, cp: 450, alpha: 13e-6, nu: 0.3,
    Tmax: 1000, cryoGain: 1.05, weld: { fusion: 0.8, fsw: false }, lox: true, cost: 400, lead: 180, cv: 0.03, oxRich: true,
    note: 'Burn-resistant alloy that survives hot oxygen-rich turbine gas. Required for ox-rich staged combustion.',
  },
  cucrzr: {
    name: 'CuCrZr (C18150)', cls: 'metal', rho: 8900, Fty: 300e6, Ftu: 400e6, E: 120e9, G: 45e9, k: 320, cp: 385, alpha: 17e-6, nu: 0.34,
    Tmax: 800, cryoGain: 1.1, weld: { fusion: 0.5, fsw: false }, lox: true, cost: 45, lead: 60, cv: 0.04,
    note: 'High-conductivity copper alloy for regeneratively-cooled liners. Softens above ~800 K.',
  },
  grcop42: {
    name: 'GRCop-42 (AM powder)', cls: 'metal', rho: 8790, Fty: 200e6, Ftu: 330e6, E: 110e9, G: 41e9, k: 300, cp: 380, alpha: 17e-6, nu: 0.34,
    Tmax: 1000, cryoGain: 1.1, weld: { fusion: false, fsw: false }, lox: true, cost: 400, lead: 30, cv: 0.05, amOnly: true,
    note: 'NASA Cu-Cr-Nb alloy designed for 3D-printed combustion chambers. Holds strength to ~1000 K.',
  },
  nbC103: {
    name: 'Niobium C-103 (silicide coated)', cls: 'metal', rho: 8850, Fty: 280e6, Ftu: 370e6, E: 90e9, G: 37e9, k: 40, cp: 270, alpha: 7e-6, nu: 0.4,
    Tmax: 1640, emiss: 0.85, cryoGain: 1.0, weld: { fusion: 0.8, fsw: false }, lox: false, cost: 1100, lead: 120, cv: 0.04,
    note: 'Refractory metal for radiatively-cooled nozzle extensions. Glows white-hot in operation.',
  },
  nickelED: { name: 'Electrodeposited nickel', cls: 'metal', rho: 8900, Fty: 400e6, Ftu: 550e6, E: 200e9, G: 76e9, k: 70, cp: 444, alpha: 13e-6, nu: 0.31, Tmax: 900, cryoGain: 1.1, weld: { fusion: false, fsw: false }, lox: true, cost: 60, lead: 1, cv: 0.06, note: 'Closeout layer over milled cooling channels.' },
  cfrp: {
    name: 'Carbon/epoxy (T800-class)', cls: 'composite', rho: 1600, Fty: 600e6, Ftu: 600e6, E: 70e9, G: 20e9, k: 5, cp: 900, alpha: 1e-6, nu: 0.3,
    Tmax: 420, cryoGain: 1.0, weld: { fusion: false, fsw: false }, lox: false, cost: 90, lead: 21, cv: 0.06,
    note: 'Quasi-isotropic laminate. Light and stiff; epoxy limits temperature (~150 °C). Not LOX-compatible unlined.',
  },
  g10: {
    name: 'Fiberglass (G-10)', cls: 'composite', rho: 1850, Fty: 280e6, Ftu: 300e6, E: 18e9, G: 5e9, k: 0.3, cp: 1100, alpha: 10e-6, nu: 0.12,
    Tmax: 410, cryoGain: 1.0, weld: { fusion: false, fsw: false }, lox: false, cost: 20, lead: 7, cv: 0.06,
    note: 'Tough, cheap, radio-transparent (good for antenna bays).',
  },
  plywood: {
    name: 'Aircraft birch plywood', cls: 'wood', rho: 650, Fty: 40e6, Ftu: 45e6, E: 9e9, G: 0.6e9, k: 0.15, cp: 1700, alpha: 5e-6, nu: 0.3,
    Tmax: 400, cryoGain: 1.0, weld: { fusion: false, fsw: false }, lox: false, cost: 6, lead: 2, cv: 0.12,
    note: 'Fine for subsonic hobby rockets. Flutters and fails at high speed.',
  },
};

// Thermal-protection / nozzle materials
export const TPS = {
  graphite: { name: 'Graphite (ATJ) insert', rho: 1760, erosion: 0.004, cost: 50, note: 'Low throat erosion; can crack from thermal shock.' },
  carbonPhenolic: { name: 'Carbon-phenolic', rho: 1450, erosion: 0.025, char: 0.12, cost: 220, note: 'Tape-wrapped ablative; moderate erosion.' },
  silicaPhenolic: { name: 'Silica-phenolic', rho: 1700, erosion: 0.07, char: 0.20, cost: 80, note: 'Cheaper ablative; erodes faster.' },
  epdm: { name: 'EPDM (Kevlar-filled) insulation', rho: 1100, cost: 30 },
  tungsten: { name: 'Tungsten tip', rho: 19300, cp: 134, Tmax: 3000, cost: 300 },
};

// Allowable for design: A-basis ≈ mean − 2.3σ (99% of lots exceed with 95% confidence)
export function allowable(mat, kind = 'Ftu', basis = 'A') {
  const k = basis === 'A' ? 2.33 : 1.28;
  return mat[kind] * (1 - k * mat.cv);
}
