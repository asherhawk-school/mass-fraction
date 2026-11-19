// Propellant properties and equilibrium-combustion tables.
// Tables are approximate fits to NASA CEA shifting-equilibrium output at Pc = 7 MPa:
// rows = [O/F, chamber temperature Tc (K), product molecular weight (kg/kmol), effective expansion gamma].
// Gamma is an effective isentropic exponent tuned so delivered Isp matches flight engines.

export const LIQUIDS = {
  LOX: { name: 'Liquid oxygen', role: 'ox', rho: 1141, Tstore: 90.2, Tboil: 90.2, pv: 101.3e3, hvap: 213e3, cryo: true, cost: 0.2, toxic: false },
  RP1: {
    name: 'RP-1 kerosene', role: 'fuel', rho: 810, Tstore: 293, Tboil: 490, pv: 2e3, hvap: 250e3, cryo: false, cost: 1.6, toxic: false,
    coolant: { cp: 2010, rho: 790, mu: 1.4e-3, k: 0.12, Tmax: 590, wallCoke: 560, gamma: 1.05, note: 'Cokes (deposits carbon) on coolant walls hotter than ~560 K' },
  },
  LH2: {
    name: 'Liquid hydrogen', role: 'fuel', rho: 70.85, Tstore: 20.3, Tboil: 20.3, pv: 101.3e3, hvap: 446e3, cryo: true, cost: 6.0, toxic: false,
    coolant: { cp: 14300, rho: 45, mu: 1.2e-5, k: 0.12, Tmax: 1000, wallCoke: 9999, gamma: 1.4, note: 'Superb coolant; supercritical in channels' },
  },
  LCH4: {
    name: 'Liquid methane', role: 'fuel', rho: 422.6, Tstore: 111.7, Tboil: 111.7, pv: 101.3e3, hvap: 510e3, cryo: true, cost: 0.9, toxic: false,
    coolant: { cp: 3500, rho: 300, mu: 7e-5, k: 0.13, Tmax: 850, wallCoke: 950, gamma: 1.3, note: 'Good coolant; little coking' },
  },
  ETH: {
    name: 'Ethanol (95%)', role: 'fuel', rho: 800, Tstore: 293, Tboil: 351, pv: 6e3, hvap: 840e3, cryo: false, cost: 1.2, toxic: false,
    coolant: { cp: 2500, rho: 780, mu: 1.0e-3, k: 0.17, Tmax: 500, wallCoke: 700, gamma: 1.1, note: 'Boils near 510 K at pressure — limits regen heat load' },
  },
  NTO: { name: 'Nitrogen tetroxide', role: 'ox', rho: 1440, Tstore: 293, Tboil: 294.3, pv: 96e3, hvap: 414e3, cryo: false, cost: 30, toxic: true },
  MMH: {
    name: 'Monomethylhydrazine', role: 'fuel', rho: 875, Tstore: 293, Tboil: 360.6, pv: 5e3, hvap: 875e3, cryo: false, cost: 65, toxic: true,
    coolant: { cp: 2900, rho: 870, mu: 8e-4, k: 0.25, Tmax: 450, wallCoke: 600, gamma: 1.1, note: 'Decomposes if overheated (~450 K bulk)' },
  },
  A50: {
    name: 'Aerozine-50 (UDMH/N2H4)', role: 'fuel', rho: 903, Tstore: 293, Tboil: 343, pv: 17e3, hvap: 900e3, cryo: false, cost: 55, toxic: true,
    coolant: { cp: 2950, rho: 900, mu: 8e-4, k: 0.25, Tmax: 450, wallCoke: 600, gamma: 1.1, note: 'Decomposes if overheated' },
  },
};

export const PAIRS = {
  'LOX/RP-1': {
    ox: 'LOX', fuel: 'RP1', lstar: 1.15, ofDefault: 2.4, ofRange: [1.6, 3.4], stoich: 3.4, plume: 'kerolox',
    igniters: ['teateb', 'spark', 'pyro'], soot: 0.7, ggCp: 2100, ggGamma: 1.12, ggVe: 1000, unlock: 'liquid',
    table: [[1.6, 2850, 18.1, 1.205], [1.8, 3080, 19.6, 1.197], [2.0, 3270, 20.4, 1.190], [2.2, 3420, 21.1, 1.183],
      [2.4, 3530, 21.7, 1.176], [2.6, 3600, 22.3, 1.170], [2.8, 3640, 22.9, 1.165], [3.0, 3655, 23.4, 1.160], [3.4, 3640, 24.6, 1.155]],
    note: 'Dense, cheap, storable fuel. Soot and coking. The workhorse of first stages.',
  },
  'LOX/LH2': {
    ox: 'LOX', fuel: 'LH2', lstar: 0.9, ofDefault: 5.5, ofRange: [3.0, 8.0], stoich: 7.94, plume: 'hydrolox',
    igniters: ['spark', 'pyro'], ggCp: 7500, ggGamma: 1.36, ggVe: 2000, unlock: 'hydrogen',
    table: [[3.0, 2580, 8.2, 1.27], [3.5, 2820, 9.1, 1.25], [4.0, 3010, 10.0, 1.24], [4.5, 3170, 10.9, 1.23], [5.0, 3300, 11.6, 1.22],
      [5.5, 3420, 12.4, 1.21], [6.0, 3480, 13.4, 1.205], [7.0, 3550, 15.0, 1.20], [8.0, 3560, 16.2, 1.195]],
    note: 'Highest practical Isp. LH2 is 1/16 the density of water: huge, heavily insulated tanks; 20 K storage.',
  },
  'LOX/CH4': {
    ox: 'LOX', fuel: 'LCH4', lstar: 1.0, ofDefault: 3.4, ofRange: [2.4, 4.0], stoich: 4.0, plume: 'methalox',
    igniters: ['spark', 'pyro'], ggCp: 2800, ggGamma: 1.15, ggVe: 1100, unlock: 'methane',
    table: [[2.4, 3150, 18.3, 1.195], [2.6, 3290, 19.0, 1.190], [2.8, 3380, 19.7, 1.185], [3.0, 3450, 20.3, 1.182], [3.2, 3510, 20.9, 1.178],
      [3.4, 3550, 21.5, 1.175], [3.6, 3580, 22.0, 1.172], [3.8, 3595, 22.5, 1.170], [4.0, 3600, 23.0, 1.168]],
    note: 'Clean-burning, low coking, mildly cryogenic. Good for reuse and staged combustion.',
  },
  'LOX/Ethanol': {
    ox: 'LOX', fuel: 'ETH', lstar: 1.3, ofDefault: 1.4, ofRange: [0.9, 2.1], stoich: 2.08, plume: 'alcolox',
    igniters: ['pyro', 'spark'], soot: 0.9, ggCp: 2300, ggGamma: 1.13, ggVe: 900, unlock: 'liquid',
    table: [[0.9, 2450, 18.2, 1.205], [1.1, 2780, 19.6, 1.198], [1.3, 3020, 20.9, 1.192], [1.5, 3180, 22.1, 1.186], [1.7, 3290, 23.2, 1.180], [2.1, 3330, 25.0, 1.175]],
    note: 'Forgiving, cheap, non-toxic, easy to ignite. Low performance. Classic first liquid engine.',
  },
  'NTO/MMH': {
    ox: 'NTO', fuel: 'MMH', lstar: 0.9, ofDefault: 1.65, ofRange: [1.2, 2.5], stoich: 2.5, plume: 'hypergolic',
    igniters: ['hypergolic'], ggCp: 2400, ggGamma: 1.14, ggVe: 1000, unlock: 'hypergolic',
    table: [[1.2, 2720, 18.8, 1.235], [1.4, 3000, 20.0, 1.228], [1.65, 3200, 21.3, 1.222], [2.0, 3380, 22.8, 1.216], [2.2, 3420, 23.6, 1.212], [2.5, 3420, 24.6, 1.208]],
    note: 'Ignites on contact (no igniter), storable for years — ideal for restartable upper stages. Highly toxic.',
  },
  'NTO/A50': {
    ox: 'NTO', fuel: 'A50', lstar: 0.9, ofDefault: 1.9, ofRange: [1.4, 2.6], stoich: 2.6, plume: 'hypergolic',
    igniters: ['hypergolic'], ggCp: 2400, ggGamma: 1.14, ggVe: 1000, unlock: 'hypergolic',
    table: [[1.4, 3020, 20.0, 1.23], [1.6, 3200, 21.1, 1.224], [2.0, 3350, 22.6, 1.218], [2.3, 3405, 23.6, 1.213], [2.6, 3415, 24.4, 1.209]],
    note: 'Hypergolic, storable, slightly denser than MMH systems. Toxic.',
  },
};

// Ammonium-perchlorate composite propellant (APCP): AP oxidizer + Al fuel + HTPB binder.
// Rows = [Al mass fraction, Tc, M (incl. condensed Al2O3 effective), gamma]
export const APCP_TABLE = [[0.0, 2950, 23.0, 1.22], [0.05, 3100, 24.6, 1.21], [0.10, 3250, 26.0, 1.20], [0.15, 3380, 27.5, 1.19], [0.20, 3480, 29.0, 1.18]];
export const AP_BLENDS = {
  coarse: { label: 'Coarse AP (200 µm)', a: 3.6, n: 0.30 },
  bimodal: { label: 'Bimodal AP (200/20 µm)', a: 5.0, n: 0.34 },
  fine: { label: 'Fine AP (20 µm)', a: 6.6, n: 0.38 },
};
export const SOLID_INGREDIENTS = { AP: { rho: 1950, cost: 9 }, Al: { rho: 2700, cost: 12 }, HTPB: { rho: 920, cost: 18 } };
export const TEMP_SENSITIVITY = 0.0017; // σp, 1/K — burn-rate sensitivity to grain temperature
