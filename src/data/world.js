// Facilities, contracts, launch sites & climatology, staff.

export const FACILITIES = {
  machine: { name: 'CNC machine shop', cost: 450000, upkeep: 3500, desc: '5-axis mill, lathe, EDM. Needed for almost everything.' },
  weld: { name: 'Welding bay (TIG / VPPA)', cost: 150000, upkeep: 1200, desc: 'Fusion welding with argon shielding and purge fixtures.' },
  forming: { name: 'Forming shop (rolls, brake, spin lathe)', cost: 600000, upkeep: 3000, desc: 'Roll barrels and spin-form domes in-house.' },
  fsw: { name: 'Friction-stir welder (gantry)', cost: 2500000, upkeep: 12000, desc: 'Solid-state welding for Al-Li and 2xxx alloys.' },
  heatTreat: { name: 'Heat-treat & vacuum furnaces', cost: 700000, upkeep: 5000, desc: 'Aging, tempering, stress relief, vacuum brazing, coating firing.' },
  composites: { name: 'Composites shop (layup room + cure oven)', cost: 400000, upkeep: 3000, desc: 'Layup, filament winding, oven cure of out-of-autoclave prepregs.' },
  autoclave: { name: 'Autoclave', cost: 1800000, upkeep: 9000, desc: 'Pressure cure for void-free aerospace laminates.' },
  metalAM: { name: 'Metal 3D printer (L-PBF)', cost: 1500000, upkeep: 15000, desc: 'Print combustion chambers with integral cooling channels.' },
  hip: { name: 'HIP press', cost: 3000000, upkeep: 14000, desc: 'Hot isostatic pressing to close print porosity.' },
  plating: { name: 'Electroforming / plating line', cost: 900000, upkeep: 6000, desc: 'Electrodeposited nickel channel closeouts.' },
  ndtBasic: { name: 'NDT lab (PT + phased-array UT)', cost: 180000, upkeep: 1500, desc: 'Surface and volumetric inspection.' },
  xray: { name: 'Digital radiography bay', cost: 650000, upkeep: 4000, desc: 'X-ray welds, grains and castings.' },
  ct: { name: 'Industrial CT scanner', cost: 2200000, upkeep: 12000, desc: 'Full 3-D internal inspection — the best defect finder.' },
  cleanRoom: { name: 'Clean room + O₂ cleaning line', cost: 400000, upkeep: 4000, desc: 'Precision cleaning for oxygen service, bearing assembly.' },
  electronics: { name: 'Electronics lab (SMT + HITL bench)', cost: 500000, upkeep: 4000, desc: 'Board assembly, burn-in, hardware-in-the-loop simulation.' },
  propellant: { name: 'Propellant mixing & casting bunker', cost: 1200000, upkeep: 8000, desc: 'Remote-operated mixer, casting pit, cure ovens.' },
  hydro: { name: 'Hydrostatic / leak test cell', cost: 220000, upkeep: 1500, desc: 'Proof, leak, and water-flow testing.' },
  testSmall: { name: 'Test stand (≤ 50 kN)', cost: 900000, upkeep: 7000, desc: 'Static fires of small motors and engines.' },
  testLarge: { name: 'Test stand (≤ 3 MN)', cost: 14000000, upkeep: 60000, desc: 'Full-scale engine and stage static fires.' },
  vibe: { name: 'Shake table + thermal-vacuum chamber', cost: 1600000, upkeep: 8000, desc: 'Environmental qualification of avionics and structures.' },
};

export const START_FACILITIES = ['machine', 'weld', 'composites', 'ndtBasic', 'electronics', 'hydro'];

export const SITES = {
  desert: {
    name: 'High-Desert Test Range', lat: 32.9, elev: 1200, azRange: [0, 360], suborbitalOnly: true, licenseDays: 21, licenseCost: 12000, padFee: 9000,
    impactLimit: 90000, uprangeLimit: 3000,
    climate: { wind: [5, 3], gust: [4, 3], jet: [35, 15], temp: [18, 9], lightning: 0.08, precip: 0.06, ceiling: [6000, 3000] },
    desc: 'Inland range for sounding rockets. Impacts must stay within 90 km of the pad. Hot days, windy afternoons.',
  },
  coastal: {
    name: 'Eastern Coastal Range', lat: 28.5, elev: 3, azRange: [35, 120], licenseDays: 120, licenseCost: 150000, padFee: 400000,
    impactLimit: Infinity, uprangeLimit: 2000,
    climate: { wind: [6, 3], gust: [4, 3], jet: [30, 15], temp: [24, 5], lightning: 0.22, precip: 0.25, ceiling: [2500, 1500] },
    desc: 'Launch over the ocean toward the east. Inclinations 28.5°–57°. Summer thunderstorms.',
  },
  polar: {
    name: 'Northern Polar Range', lat: 57.4, elev: 20, azRange: [150, 215], licenseDays: 150, licenseCost: 180000, padFee: 450000,
    impactLimit: Infinity, uprangeLimit: 2000,
    climate: { wind: [9, 4], gust: [6, 4], jet: [45, 18], temp: [4, 8], lightning: 0.03, precip: 0.35, ceiling: [1200, 900] },
    desc: 'Southward launches over the sea: polar and sun-synchronous orbits (needs ~194° azimuth for SSO). Cold and windy.',
  },
  equatorial: {
    name: 'Equatorial Island Range', lat: 5.2, elev: 10, azRange: [70, 110], licenseDays: 140, licenseCost: 200000, padFee: 550000,
    impactLimit: Infinity, uprangeLimit: 2000,
    climate: { wind: [4, 2], gust: [3, 2], jet: [20, 10], temp: [27, 2], lightning: 0.3, precip: 0.4, ceiling: [1800, 1000] },
    desc: 'Maximum free speed from Earth rotation (463 m/s) and low-inclination orbits — best for GTO. Daily storms.',
  },
};

export const CONTRACTS = [
  { id: 'hop', title: 'University altitude hop', client: 'State university physics dept.', kind: 'suborbital', payloadMass: 1.0, payloadLength: 0.2, req: { apogee: 3000, recover: true }, reward: 220000, advance: 60000, deadline: 180, penalty: 30000, site: 'desert', desc: 'Loft a 1 kg instrument package to at least 3,000 m above the pad and recover it intact (landing < 9 m/s).' },
  { id: 'mach', title: 'Supersonic sensor test', client: 'Aero-instrument startup', kind: 'suborbital', payloadMass: 2.0, payloadLength: 0.25, req: { apogee: 9000, mach: 1.5, recover: true }, reward: 480000, advance: 100000, deadline: 240, penalty: 60000, after: 'hop', site: 'desert', desc: 'Exceed Mach 1.5, reach 9 km, recover the payload intact.' },
  { id: 'karman', title: 'Edge of space', client: 'Atmospheric research institute', kind: 'suborbital', payloadMass: 5.0, payloadLength: 0.35, req: { apogee: 100000, recover: true }, reward: 1500000, advance: 300000, deadline: 365, penalty: 200000, after: 'mach', site: 'desert', desc: 'Carry a 5 kg experiment past the Kármán line (100 km) and recover it.' },
  { id: 'hotfire', title: 'Liquid engine qualification', client: 'Defense innovation agency', kind: 'test', req: { hotfire: { thrust: 15000, duration: 20 } }, reward: 1200000, advance: 250000, deadline: 300, penalty: 100000, after: 'mach', desc: 'Demonstrate a liquid-propellant engine of ≥ 15 kN for ≥ 20 s continuous on a test stand.' },
  { id: 'liquidSounding', title: 'Liquid sounding rocket', client: 'Microgravity research consortium', kind: 'suborbital', payloadMass: 25, payloadLength: 0.6, req: { apogee: 120000, recover: true, liquid: true }, reward: 3000000, advance: 600000, deadline: 420, penalty: 400000, after: 'hotfire', site: 'desert', desc: 'Fly 25 kg above 120 km on liquid propulsion; recover the payload.' },
  { id: 'cubesat', title: 'First orbit: CubeSat', client: 'Earth-imaging startup', kind: 'orbit', payloadMass: 8, payloadLength: 0.4, req: { peri: 180000, apoMax: 1000000 }, reward: 7000000, advance: 1500000, deadline: 720, penalty: 800000, after: 'karman', desc: 'Place an 8 kg CubeSat in orbit with perigee ≥ 180 km (any inclination).' },
  { id: 'rideshare', title: 'Rideshare to 450 km', client: 'Smallsat aggregator', kind: 'orbit', payloadMass: 60, payloadLength: 0.8, req: { peri: 425000, apoMax: 475000, incMin: 40 }, reward: 11000000, advance: 2000000, deadline: 720, penalty: 1500000, after: 'cubesat', desc: '60 kg to a 450 ± 25 km near-circular orbit, inclination ≥ 40°.' },
  { id: 'sso', title: 'Sun-synchronous Earth observation', client: 'National space agency', kind: 'orbit', payloadMass: 150, payloadLength: 1.2, req: { peri: 480000, apoMax: 520000, inc: [97.0, 97.8] }, reward: 24000000, advance: 5000000, deadline: 900, penalty: 4000000, after: 'rideshare', desc: '150 kg into a 500 km sun-synchronous orbit (inclination 97.4°).' },
  { id: 'gto', title: 'Commercial GTO', client: 'Telecom operator', kind: 'orbit', payloadMass: 600, payloadLength: 2.0, req: { peri: 180000, apo: 35000000 }, reward: 70000000, advance: 15000000, deadline: 1200, penalty: 10000000, after: 'sso', desc: '600 kg to geostationary transfer orbit (apogee ≥ 35,000 km).' },
];

export const TECH_SKILL_FACTOR = (s) => [2.0, 1.55, 1.2, 1.0, 0.8, 0.62][Math.max(0, Math.min(5, Math.round(s)))];
