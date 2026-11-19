// Component catalogue: parameters the engineer sets, and compute() that sizes the part from physics.
// Every component also declares the physical parts that must be fabricated (fabParts).
import { G0, P_SL, DEG, clamp } from '../physics/constants.js';
import { MATERIALS, TPS, allowable } from '../data/materials.js';
import { PAIRS, LIQUIDS, AP_BLENDS } from '../data/propellants.js';
import { NOSE_SHAPES, finFlutterSpeed } from '../physics/aero.js';
import { atmosphere } from '../physics/atmosphere.js';
import { simulateSolid, caseBurstPressure, hotDayPc, propellantDensity } from '../physics/solidMotor.js';
import { designLiquidEngine, INJECTORS, CYCLES, IGNITERS } from '../physics/liquidEngine.js';
import { designTank, designPressurant, designShell, WELD_PROCESSES, STIFFENING, COPV_TYPES, jointEfficiency } from '../physics/structures.js';
import { expansionGamma } from '../physics/nozzle.js';

const num = (key, label, unit, min, max, step, def, help, show) => ({ key, label, unit, type: 'num', min, max, step, def, help, show });
const sel = (key, label, options, def, help, show) => ({ key, label, type: 'sel', options, def, help, show });
const bool = (key, label, def, help, show) => ({ key, label, type: 'bool', def, help, show });
const opts = (obj, f = (v) => v.name) => Object.entries(obj).map(([k, v]) => [k, f(v)]);
const matOpts = (keys) => keys.map(k => [k, MATERIALS[k].name]);
const W = () => { const a = []; a.add = (lvl, msg) => a.push({ lvl, msg }); return a; };
const fmt = (v, d = 1) => (Math.abs(v) >= 1e4 ? v.toExponential(2) : v.toFixed(d));
const fabPart = (key, name, route, data) => ({ key, name, route, ...data });

export const COMPONENTS = {
  payload: {
    label: 'Payload (customer-supplied)', stack: true, top: true, fixed: true,
    params: [num('mass', 'Payload mass', 'kg', 0.1, 20000, 0.1, 1), num('length', 'Payload length', 'm', 0.05, 15, 0.01, 0.2)],
    compute(c, ctx) {
      return { length: c.params.length, dryMass: c.params.mass, d: ctx.D, outputs: [['Mass', c.params.mass + ' kg']], warnings: [], fabParts: [], draw: { kind: 'payload' } };
    },
  },

  nosecone: {
    label: 'Nose cone', stack: true, top: true,
    params: [
      sel('shape', 'Profile', opts(NOSE_SHAPES), 'vonKarman', 'Von Kármán minimizes transonic/supersonic wave drag for a given length.'),
      num('fineness', 'Fineness (L/D)', '', 1.5, 8, 0.1, 4),
      sel('mat', 'Material', matOpts(['g10', 'cfrp', 'al6061', 'ss304L']), 'g10'),
      num('wall', 'Wall thickness', 'mm', 0.8, 8, 0.1, 2.0),
      sel('tip', 'Tip', [['same', 'Same material'], ['steel', 'Steel tip'], ['tungsten', 'Tungsten heat-sink tip']], 'same', 'Stagnation-point heating is worst at the tip.'),
      num('tipR', 'Tip radius', 'mm', 1, 50, 1, 6, 'Blunter tips heat less (q ∝ 1/√Rn) but add drag.'),
    ],
    compute(c, ctx) {
      const p = c.params, D = ctx.D, R = D / 2, m = MATERIALS[p.mat];
      const L = p.fineness * D;
      const shapeF = { vonKarman: 1.05, ogive: 1.08, conical: 1.0, elliptical: 1.15 }[p.shape];
      const area = Math.PI * R * Math.sqrt(R * R + L * L) * shapeF;
      const shoulder = Math.PI * D * 0.5 * D * p.wall / 1000 * m.rho;
      let tipMass = 0;
      if (p.tip !== 'same') tipMass = (p.tip === 'tungsten' ? 19300 : 7850) * (4 / 3) * Math.PI * Math.pow(Math.max(p.tipR, 8) / 1000, 3) * 2;
      const mass = area * p.wall / 1000 * m.rho * 1.08 + shoulder + tipMass;
      const w = W();
      if (p.mat === 'al6061' && p.wall < 1.2) w.add('warn', 'Thin aluminum nose cones dent and buckle easily.');
      const tipMax = p.tip === 'tungsten' ? 3000 : p.tip === 'steel' ? 1100 : m.Tmax;
      return {
        length: L, dryMass: mass, d: D, outputs: [['Length', L.toFixed(3) + ' m'], ['Mass', mass.toFixed(2) + ' kg'], ['Tip temp limit', tipMax + ' K']], warnings: w,
        aero: { type: 'nose', shape: p.shape, L, d: D }, heat: { tipR: p.tipR / 1000, tipMax, tipMassPerArea: (p.tip === 'tungsten' ? 19300 * 0.01 * 134 : p.tip === 'steel' ? 7850 * 0.008 * 500 : m.rho * p.wall / 1000 * m.cp) },
        draw: { kind: 'nose', shape: p.shape, mat: p.mat },
        fabParts: [fabPart('nose', 'Nose cone', 'nose', { mat: p.mat, mass, area, thk: p.wall, plies: Math.max(2, Math.round(p.wall / 0.25)) })],
      };
    },
  },

  fairing: {
    label: 'Payload fairing', stack: true, top: true,
    params: [
      num('dia', 'Fairing diameter', 'm', 0.2, 6, 0.05, 1.2), num('cyl', 'Cylinder length', 'm', 0.2, 15, 0.05, 1.5), num('fineness', 'Ogive fineness', '', 1, 3, 0.1, 1.6),
      sel('mat', 'Construction', [['cfrp', 'Carbon/honeycomb sandwich'], ['al2219', 'Aluminum isogrid']], 'cfrp'),
      sel('sep', 'Separation system', [['pneumatic', 'Pneumatic pushers (low shock)'], ['pyro', 'Pyrotechnic frangible joint']], 'pneumatic'),
      bool('acoustic', 'Acoustic blankets', true, 'Reduce payload acoustic load ~6 dB'),
      num('cork', 'Cork TPS on nose cap', 'mm', 0, 15, 0.5, 3, 'Ablative cork insulation protects the composite nose cap from ascent heating'),
    ],
    compute(c, ctx) {
      const p = c.params, R = p.dia / 2;
      const Ln = p.fineness * p.dia;
      const areaNose = Math.PI * R * Math.sqrt(R * R + Ln * Ln) * 1.08;
      const areaCyl = Math.PI * p.dia * p.cyl;
      const areal = p.mat === 'cfrp' ? 4.6 : 10.5;
      let mass = (areaNose + areaCyl) * areal * (p.acoustic ? 1.12 : 1) + areaNose * 0.5 * 480 * (p.cork || 0) / 1000;
      const sepMass = mass * 0.05 + 2;
      const adapter = 2 + 0.03 * ctx.payloadMass;
      const w = W();
      if (p.dia < ctx.D * 0.98) w.add('info', 'Fairing narrower than the stage below.');
      if (p.dia > ctx.D * 1.6) w.add('warn', 'Hammerhead fairing much wider than the stage: big aerodynamic loads and buffet at transonic speeds.');
      if (ctx.payloadLength > p.cyl + Ln * 0.4) w.add('error', `Payload (${ctx.payloadLength} m) does not fit inside the fairing envelope.`);
      return {
        length: Ln + p.cyl, dryMass: mass + sepMass + adapter, jettisonMass: mass + sepMass, d: p.dia, outputs: [['Fairing mass', mass.toFixed(1) + ' kg'], ['Adapter', adapter.toFixed(1) + ' kg']], warnings: w,
        aero: { type: 'nose', shape: 'ogive', L: Ln, d: p.dia }, fairing: true, sepType: p.sep,
        heat: { tipR: 0.15 * p.dia, tipMax: p.cork > 0 ? 700 + 40 * p.cork : (p.mat === 'cfrp' ? 450 : 500), tipMassPerArea: areal * 1200 + 480 * (p.cork || 0) / 1000 * 2000 },
        draw: { kind: 'fairing', Ln, cyl: p.cyl },
        fabParts: [
          fabPart('fairingA', 'Fairing half A', p.mat === 'cfrp' ? 'shellComposite' : 'shellMetal', { mat: p.mat, mass: mass / 2, area: (areaNose + areaCyl) / 2, thk: 3, plies: 10 }),
          fabPart('fairingB', 'Fairing half B', p.mat === 'cfrp' ? 'shellComposite' : 'shellMetal', { mat: p.mat, mass: mass / 2, area: (areaNose + areaCyl) / 2, thk: 3, plies: 10 }),
          fabPart('fairingSep', 'Fairing separation system', 'sepSystem', { kind: p.sep, mass: sepMass, cost: 8000 + 200 * sepMass }),
          fabPart('adapter', 'Payload adapter', 'adapter', { mat: 'al7075', mass: adapter }),
        ],
      };
    },
  },

  airframe: {
    label: 'Airframe tube / payload bay', stack: true,
    params: [num('length', 'Length', 'm', 0.1, 20, 0.01, 0.4), sel('mat', 'Material', matOpts(['g10', 'cfrp', 'al6061', 'al7075']), 'g10'), num('wall', 'Wall thickness', 'mm', 0.5, 12, 0.1, 1.6)],
    compute(c, ctx) {
      const p = c.params, D = ctx.D, m = MATERIALS[p.mat];
      const mass = Math.PI * D * p.length * p.wall / 1000 * m.rho * 1.1 + 0.05 * D * D * 1000 * 0.2;
      const sh = designShell({ matKey: p.mat, R: D / 2, length: p.length, loadN: 0, SF: 1.4, wallMm: p.wall });
      return {
        length: p.length, dryMass: mass, d: D, outputs: [['Mass', mass.toFixed(2) + ' kg'], ['Axial buckling capacity', (sh.capacity / 1000).toFixed(1) + ' kN']], warnings: [],
        capacity: sh.capacity, draw: { kind: 'tube', mat: p.mat },
        fabParts: [fabPart('airframe', 'Airframe tube', m.cls === 'composite' ? 'shellComposite' : 'shellMetal', { mat: p.mat, mass, area: Math.PI * D * p.length, thk: p.wall, plies: Math.max(2, Math.round(p.wall / 0.25)) })],
      };
    },
  },

  avionics: {
    label: 'Avionics bay', stack: true,
    params: [
      sel('computer', 'Flight computer', [['hobby', 'Hobby altimeter/flight computer'], ['industrial', 'Industrial ARM flight computer'], ['radhard', 'Rad-tolerant flight computer']], 'hobby'),
      sel('imu', 'Inertial measurement unit', [['mems', 'MEMS IMU (10°/h drift)'], ['fog', 'Fiber-optic gyro IMU (0.5°/h)'], ['rlg', 'Ring-laser gyro INS (0.01°/h)']], 'mems'),
      sel('gps', 'GPS receiver', [['none', 'None'], ['consumer', 'Consumer GPS (COCOM-limited)'], ['space', 'Space-rated GPS']], 'none', 'Export-controlled consumer receivers stop reporting above 18 km altitude or 515 m/s.'),
      num('tlm', 'Telemetry transmitter power', 'W', 0.05, 50, 0.05, 0.5),
      sel('antenna', 'Antenna', [['dipole', 'Wrap-around dipole'], ['patch', 'Patch array'], ['helix', 'Quadrifilar helix']], 'dipole'),
      bool('fts', 'Flight termination system', false, 'Range-safety destruct system. Required for orbital launches and large vehicles.'),
      num('wh', 'Battery capacity (0 = auto)', 'Wh', 0, 5000, 1, 0),
    ],
    compute(c, ctx) {
      const p = c.params, D = ctx.D;
      const comp = { hobby: [0.05, 1.5], industrial: [0.35, 6], radhard: [1.5, 12] }[p.computer];
      const imu = { mems: [0.02, 0.5, 10, 0.002], fog: [1.6, 12, 0.5, 0.0001], rlg: [4.5, 25, 0.01, 0.00003] }[p.imu];
      const gps = { none: [0, 0], consumer: [0.05, 1], space: [0.7, 5] }[p.gps];
      const tlmMass = 0.08 + 0.03 * p.tlm, tlmPow = p.tlm / 0.35;
      const ftsMass = p.fts ? 3.5 : 0, ftsPow = p.fts ? 4 : 0;
      const power = comp[1] + imu[1] + gps[1] + tlmPow + ftsPow;
      const missionH = ctx.mission === 'orbit' ? 3 : 1.5;
      const need = power * missionH * 1.5 / 0.8;
      const wh = p.wh > 0 ? p.wh : Math.ceil(need);
      const batMass = wh / 140 + 0.03;
      const bayLen = clamp(0.12 + 0.03 * (comp[0] + imu[0] + gps[0] + ftsMass + batMass) / Math.max(D * D, 0.01) * 0.02 + 0.6 * D * 0.3, 0.12, 1.5);
      const structure = Math.PI * D * bayLen * 0.0015 * 1850 + 0.1;
      const mass = comp[0] + imu[0] + gps[0] + tlmMass + ftsMass + batMass + structure + 0.08 + 0.02 * ctx.vehicleLength + 0.4 * D * ctx.vehicleLength;
      const w = W();
      if (wh < need) w.add('error', `Battery ${wh} Wh is below the ${need.toFixed(0)} Wh needed (incl. pad hold, 1.5× margin, 80% depth of discharge).`);
      if (ctx.mission === 'orbit' && p.computer === 'hobby') w.add('error', 'A hobby flight computer cannot run closed-loop orbital guidance.');
      if (ctx.guided && p.computer === 'hobby') w.add('error', 'Guided flight (TVC) needs an industrial or better flight computer.');
      if (ctx.mission === 'orbit' && p.imu === 'mems') w.add('warn', 'MEMS gyro drift (~10°/h) will produce large orbit-insertion errors without GPS aiding.');
      if (ctx.mission === 'orbit' && p.gps === 'consumer') w.add('warn', 'Consumer GPS is disabled above 18 km / 515 m/s (COCOM limits) — useless for orbital navigation.');
      if (ctx.needsFTS && !p.fts) w.add('error', 'Range safety requires a flight termination system for this vehicle/range.');
      const range = 250 * Math.sqrt(p.tlm) * { dipole: 1, patch: 1.7, helix: 2.6 }[p.antenna];
      const fabParts = [
        fabPart('fc', 'Flight computer & navigation unit', 'avionics', { mass: comp[0] + imu[0] + gps[0], cost: { hobby: 400, industrial: 6000, radhard: 60000 }[p.computer] + { mems: 300, fog: 45000, rlg: 180000 }[p.imu] + { none: 0, consumer: 60, space: 25000 }[p.gps], tier: p.computer === 'radhard' ? 'space' : p.computer === 'hobby' ? 'commercial' : 'industrial', hasSoftware: true }),
        fabPart('harness', 'Wiring harness', 'harness', { mass: 0.08 + 0.02 * ctx.vehicleLength + 0.4 * D * ctx.vehicleLength }),
        fabPart('battery', 'Battery pack', 'battery', { mass: batMass }),
        fabPart('tlm', 'Telemetry transmitter', 'avionics', { mass: tlmMass, cost: 300 + 400 * p.tlm, tier: 'industrial' }),
        fabPart('avbay', 'Avionics bay structure', 'shellComposite', { mat: 'g10', mass: structure, area: Math.PI * D * bayLen, thk: 1.5, plies: 6 }),
      ];
      if (p.fts) fabParts.push(fabPart('fts', 'Flight termination system', 'fts', { mass: ftsMass }));
      return {
        length: bayLen, dryMass: mass, d: D, warnings: w,
        outputs: [['Mass', mass.toFixed(2) + ' kg'], ['Power draw', power.toFixed(1) + ' W'], ['Battery', wh + ' Wh'], ['Telemetry range', range.toFixed(0) + ' km'], ['Gyro drift', imu[2] + ' °/h']],
        avionics: { computer: p.computer, imu: p.imu, drift: imu[2], accelBias: imu[3], gps: p.gps, tlmRange: range * 1000, fts: p.fts, batteryWh: wh, power },
        draw: { kind: 'bay' }, fabParts,
      };
    },
  },

  recovery: {
    label: 'Recovery system', stack: true,
    params: [
      num('drogue', 'Drogue diameter (0 = none)', 'm', 0, 10, 0.05, 0.45), num('main', 'Main parachute diameter', 'm', 0.2, 40, 0.05, 1.5),
      num('mainAlt', 'Main deploy altitude (AGL)', 'm', 100, 3000, 10, 450),
      sel('mat', 'Canopy & lines', [['nylon', 'Nylon'], ['kevlar', 'Kevlar-reinforced (high q)']], 'nylon'),
      bool('sepApogee', 'Separate payload section at apogee', false, 'Recover only the forward section; the spent booster falls separately. Essential for high-altitude flights.'),
    ],
    compute(c, ctx) {
      const p = c.params, D = ctx.D;
      const aD = Math.PI * p.drogue * p.drogue / 4, aM = Math.PI * p.main * p.main / 4;
      const k = p.mat === 'kevlar' ? 1.5 : 1;
      const chuteMass = (aD * 0.09 + aM * 0.075) * k + 0.15 + 0.02 * ctx.recoveredMass;
      const bayLen = clamp(0.15 + (aD * 0.004 + aM * 0.003) * 4 / (Math.PI * D * D) + 0.4 * D, 0.15, 3);
      const struct = Math.PI * D * bayLen * 0.0015 * 1850;
      const mass = chuteMass + struct + 0.1;
      const rho0 = 1.1;
      const m = ctx.recoveredMass || 5;
      const vMain = Math.sqrt(2 * m * G0 / (rho0 * 1.5 * aM));
      const vDrogue = aD > 0 ? Math.sqrt(2 * m * G0 / (rho0 * 0.8 * aD)) : Infinity;
      const w = W();
      if (vMain > 9) w.add('warn', `Main-chute landing speed ${vMain.toFixed(1)} m/s exceeds ~9 m/s — payload will be damaged.`);
      if (vDrogue > 45 && p.drogue > 0) w.add('warn', `Drogue descent ${vDrogue.toFixed(0)} m/s is fast — the main may tear at deployment.`);
      if (p.drogue === 0) w.add('info', 'No drogue: the main deploys at the main altitude while falling fast (risky), or at apogee (drifts far).');
      const bayIn = [D / 0.0254, bayLen / 0.0254];
      const charge = 0.00052 * bayIn[0] * bayIn[0] * bayIn[1] * 1.0;
      return {
        length: bayLen, dryMass: mass, d: D, warnings: w,
        outputs: [['Mass', mass.toFixed(2) + ' kg'], ['Landing speed', vMain.toFixed(1) + ' m/s'], ['Drogue descent', isFinite(vDrogue) ? vDrogue.toFixed(0) + ' m/s' : '—'], ['Ejection charge', charge.toFixed(1) + ' g']],
        recovery: { drogueArea: aD, mainArea: aM, mainAlt: p.mainAlt, qMaxDrogue: p.mat === 'kevlar' ? 18000 : 6000, qMaxMain: p.mat === 'kevlar' ? 3000 : 1200, sepApogee: p.sepApogee },
        draw: { kind: 'bay' },
        fabParts: [
          ...(p.drogue > 0 ? [fabPart('drogue', 'Drogue parachute', 'parachute', { area: aD, mass: aD * 0.09 * k, charge })] : []),
          fabPart('main', 'Main parachute', 'parachute', { area: aM, mass: aM * 0.075 * k, charge }),
          fabPart('recbay', 'Recovery bay & deployment hardware', 'shellComposite', { mat: 'g10', mass: struct, area: Math.PI * D * bayLen, thk: 1.5, plies: 6 }),
        ],
      };
    },
  },

  solidMotor: {
    label: 'Solid rocket motor', stack: true, propulsion: 'solid',
    params: [
      num('length', 'Case length', 'm', 0.15, 40, 0.01, 1.0),
      sel('caseMat', 'Case material', matOpts(['al6061', 'al7075', 'steel4130', 'd6ac', 'cfrp']), 'al6061'),
      num('wall', 'Case wall', 'mm', 0.8, 30, 0.1, 3.2),
      sel('grain', 'Grain geometry', [['bates', 'BATES segments (neutral-ish)'], ['star', 'Case-bonded star (neutral)'], ['finocyl', 'Finocyl (high initial thrust)'], ['endburner', 'End-burner (long, low thrust)']], 'bates'),
      num('segments', 'BATES segments', '', 1, 12, 1, 4, null, (p) => p.grain === 'bates'),
      num('core', 'Core diameter', 'mm', 5, 3000, 1, 30, null, (p) => p.grain !== 'endburner'),
      num('points', 'Star points', '', 3, 12, 1, 6, null, (p) => p.grain === 'star'),
      num('depth', 'Star/fin depth', 'mm', 0, 2000, 1, 20, null, (p) => p.grain === 'star' || p.grain === 'finocyl'),
      num('al', 'Aluminum fraction', '%', 0, 20, 1, 16),
      sel('blend', 'AP particle blend', opts(AP_BLENDS, (v) => `${v.label} (a=${v.a}, n=${v.n})`), 'bimodal'),
      num('throat', 'Throat diameter', 'mm', 3, 3000, 0.5, 30),
      num('exit', 'Exit diameter', 'mm', 5, 6000, 0.5, 70),
      sel('throatMat', 'Throat material', opts(TPS, v => v.name).filter(([k]) => ['graphite', 'carbonPhenolic', 'silicaPhenolic'].includes(k)), 'graphite'),
      num('cone', 'Exit cone half-angle', '°', 8, 25, 0.5, 15),
      num('liner', 'Insulation + liner', 'mm', 0.5, 40, 0.5, 2),
      sel('tvc', 'Thrust vector control', [['none', 'None (fins only)'], ['flex', 'Flex-bearing gimballed nozzle']], 'none'),
      num('gimbal', 'Gimbal range', '°', 1, 8, 0.5, 4, null, (p) => p.tvc === 'flex'),
    ],
    compute(c, ctx) {
      const p = c.params, D = ctx.D, m = MATERIALS[p.caseMat];
      const w = W();
      const wall = p.wall / 1000, liner = p.liner / 1000;
      const grainD = D - 2 * wall - 2 * liner;
      const grainL = Math.max(0.05, p.length - 0.3 * D);
      if (grainD <= 0) { w.add('error', 'Case wall + liner leave no room for propellant.'); return { length: p.length, dryMass: 1, d: D, warnings: w, outputs: [], fabParts: [] }; }
      const core = p.grain === 'endburner' ? 0 : p.core / 1000;
      if (core >= grainD * 0.95) w.add('error', 'Core diameter is larger than the grain.');
      const caseMEOPdesign = ctx.qualified?.has('case:' + p.caseMat) ? 1.25 : 1.4;
      const je = m.cls === 'composite' ? 1 : (m.needsHT ? 0.95 : 0.9);
      const burst = caseBurstPressure(p.caseMat, D, wall, je, ctx.asBuilt?.strength ?? 1);
      const sim = simulateSolid({
        D: grainD, L: grainL, type: p.grain, segments: p.segments, coreDia: Math.max(core, 0.002), points: p.points, starDepth: p.depth / 1000, fins: 6, finDepth: p.depth / 1000,
        alFrac: p.al / 100, blend: p.blend, throatDia: p.throat / 1000, exitDia: p.exit / 1000, throatMat: p.throatMat, coneDeg: p.cone, grainTempK: ctx.grainTempK ?? 293,
        defects: ctx.asBuilt?.grainDefects || [], rateBias: ctx.asBuilt?.rateBias ?? 1, burstPressure: ctx.asBuilt ? burst : 0,
      });
      const hotPc = hotDayPc(sim.maxPc, sim.n, ctx.grainTempK ?? 293, 313);
      const sfCase = burst / hotPc;
      if (sfCase < caseMEOPdesign) w.add(sfCase < 1.05 ? 'error' : 'warn', `Case safety factor ${sfCase.toFixed(2)} on a hot day (40 °C, Pc ${(hotPc / 1e6).toFixed(1)} MPa) — need ≥ ${caseMEOPdesign} ${caseMEOPdesign === 1.4 ? '(untested design)' : '(burst-qualified)'}. Thicker case or lower Kn.`);
      const At = Math.PI * (p.throat / 2000) ** 2;
      const portA = Math.PI * (Math.max(core, 0.002) / 2) ** 2;
      if (p.grain !== 'endburner' && At / portA > 0.9) w.add('error', `Port-to-throat area ratio ${(portA / At).toFixed(2)} < 1.1: the core chokes — massive erosive burning and pressure spike.`);
      else if (p.grain !== 'endburner' && At / portA > 0.6) w.add('warn', `Port/throat ratio ${(portA / At).toFixed(2)} is low: erosive burning will spike early pressure.`);
      if (sim.maxPc < 1.5e6) w.add('warn', `Chamber pressure only ${(sim.maxPc / 1e6).toFixed(2)} MPa — APCP burns unstably (chuffing) below ~1.5 MPa.`);
      if (sim.maxPc > 15e6) w.add('warn', `Very high chamber pressure ${(sim.maxPc / 1e6).toFixed(1)} MPa.`);
      if (sim.slSeparated && ctx.isBottom) w.add('warn', 'Nozzle over-expanded enough to separate at sea level.');
      if (p.exit <= p.throat) w.add('error', 'Exit must be larger than throat.');
      if (m.cls === 'composite' && sim.burnTime > 20 && p.liner < 3) w.add('warn', 'Composite case needs thicker insulation for long burns (epoxy limit 150 °C).');
      const caseMass = (Math.PI * (D - wall) * p.length * wall + 2 * Math.PI / 4 * D * D * wall * 1.6) * m.rho;
      const insul = liner * (Math.PI * grainD * grainL + Math.PI / 2 * D * D) * 1100;
      const Dt = p.throat / 1000, De = p.exit / 1000;
      const nozLen = Math.max(0.01, (De - Dt) / 2 / Math.tan(p.cone * DEG));
      const insert = 1760 * Math.PI / 4 * ((2.2 * Dt) ** 2 - Dt * Dt) * 1.5 * Dt;
      const cone = 1450 * Math.PI * (De + Dt) / 2 * nozLen / Math.cos(p.cone * DEG) * Math.max(0.003, 0.03 * De);
      const housing = 0.08 * caseMass;
      const nozzleMass = insert + cone + housing;
      const ign = 0.03 + 0.002 * sim.propMass;
      const tvcMass = p.tvc === 'flex' ? 0.004 * sim.avgThrustVac ** 0.7 + 2 : 0;
      const dry = caseMass + insul + nozzleMass + ign + tvcMass;
      const mf = sim.propMass / (sim.propMass + dry);
      const fabParts = [
        fabPart('case', 'Motor case', m.cls === 'composite' ? 'motorCaseComposite' : 'motorCaseMetal', { mat: p.caseMat, mass: caseMass, area: Math.PI * D * p.length, thk: p.wall, welded: m.needsHT, pressure: { meop: hotPc, burst } }),
        fabPart('grain', 'Propellant grain', 'grain', { mass: sim.propMass, area: Math.PI * D * p.length, matCostPerKg: 14 }),
        fabPart('noz', 'Motor nozzle', 'solidNozzle', { mass: nozzleMass, mat: 'steel4130' }),
        fabPart('ign', 'Motor igniter', 'igniterPyro', { mass: ign }),
      ];
      if (p.tvc === 'flex') fabParts.push(fabPart('tvc', 'Flex-seal TVC & actuators', 'gimbal', { mass: tvcMass, mat: 'steel4130' }));
      return {
        length: p.length, nozzleLen: nozLen, exitD: De, dryMass: dry, propMass: sim.propMass, d: D, warnings: w,
        outputs: [
          ['Motor', sim.motorClass], ['Total impulse', (sim.impulseVac / 1000).toFixed(1) + ' kN·s'], ['Avg thrust (vac)', (sim.avgThrustVac / 1000).toFixed(2) + ' kN'],
          ['Burn time', sim.burnTime.toFixed(2) + ' s'], ['Isp SL / vac', sim.ispSL.toFixed(0) + ' / ' + sim.ispVac.toFixed(0) + ' s'], ['Max Pc', (sim.maxPc / 1e6).toFixed(2) + ' MPa'],
          ['Initial Kn', sim.kn0.toFixed(0)], ['Propellant', sim.propMass.toFixed(2) + ' kg'], ['Dry mass', dry.toFixed(2) + ' kg'], ['Mass fraction', mf.toFixed(3)], ['Case SF (hot day)', sfCase.toFixed(2)],
        ],
        motor: { sim, Ae: sim.Ae, gimbal: p.tvc === 'flex' ? p.gimbal : 0, gammaExp: sim.gammaExp, etaCf: sim.etaCf, eps: (p.exit / p.throat) ** 2, plume: 'solid', burst, caseMat: p.caseMat },
        thrustCurve: sim, draw: { kind: 'motor' }, fabParts,
      };
    },
  },

  liquidEngine: {
    label: 'Liquid rocket engine(s)', stack: true, propulsion: 'liquid',
    params: [
      sel('pair', 'Propellants', Object.keys(PAIRS).map(k => [k, k]), 'LOX/Ethanol'),
      num('of', 'Mixture ratio O/F', '', 0.8, 8, 0.01, 1.4),
      num('pc', 'Chamber pressure', 'MPa', 0.3, 35, 0.05, 2.0),
      num('thrust', 'Design thrust (per engine)', 'kN', 0.2, 8000, 0.1, 10),
      sel('thrustRef', 'Thrust rated at', [['SL', 'Sea level'], ['vac', 'Vacuum']], 'SL'),
      num('eps', 'Nozzle area ratio ε', '', 2, 300, 0.5, 5),
      sel('nozzle', 'Nozzle contour', [['bell', 'Rao bell'], ['cone', 'Conical']], 'cone'),
      num('bellFrac', 'Bell length', '% of 15° cone', 60, 100, 1, 80, null, (p) => p.nozzle === 'bell'),
      num('coneDeg', 'Cone half-angle', '°', 8, 25, 0.5, 15, null, (p) => p.nozzle === 'cone'),
      sel('cycle', 'Engine cycle', opts(CYCLES), 'pressure'),
      sel('injector', 'Injector type', opts(INJECTORS), 'doublet'),
      num('injDp', 'Injector ΔP / Pc', '%', 5, 50, 1, 20),
      num('lstar', 'Characteristic length L*', 'm', 0.3, 3, 0.05, 1.2),
      num('cr', 'Contraction ratio Ac/At', '', 1.5, 8, 0.1, 4),
      sel('cooling', 'Chamber cooling', [['regen', 'Regenerative (fuel-cooled)'], ['ablative', 'Ablative liner'], ['radiative', 'Radiative (refractory metal)']], 'ablative'),
      num('filmPct', 'Film cooling', '% of fuel', 0, 20, 0.5, 3),
      sel('chamberMat', 'Chamber / liner material', matOpts(['cucrzr', 'grcop42', 'in718', 'ss304L', 'nbC103', 'al6061', 'steel4130']), 'steel4130'),
      sel('method', 'Chamber manufacturing', [['machined', 'Machined channels + closeout'], ['lpbf', 'Metal 3D print (L-PBF)']], 'machined', null, (p) => p.cooling === 'regen'),
      num('channels', 'Coolant channels', '', 8, 800, 1, 60, null, (p) => p.cooling === 'regen'),
      num('chHeight', 'Channel height', 'mm', 0.5, 10, 0.1, 2, null, (p) => p.cooling === 'regen'),
      num('wallThk', 'Hot-wall thickness', 'mm', 0.4, 4, 0.05, 1.0, null, (p) => p.cooling === 'regen'),
      num('regenEps', 'Regen-cooled to ε', '', 1, 300, 0.5, 5, 'Beyond this the nozzle is a radiatively-cooled extension', (p) => p.cooling === 'regen'),
      sel('extMat', 'Nozzle-extension material', matOpts(['nbC103', 'in718', 'ss304L']), 'nbC103', null, (p) => p.cooling === 'regen'),
      num('linerThk', 'Ablative liner thickness', 'mm', 2, 80, 0.5, 12, null, (p) => p.cooling === 'ablative'),
      sel('ablMat', 'Ablative', [['silicaPhenolic', 'Silica-phenolic'], ['carbonPhenolic', 'Carbon-phenolic']], 'silicaPhenolic', null, (p) => p.cooling === 'ablative'),
      sel('damping', 'Acoustic damping', [['none', 'None'], ['baffles', 'Injector baffles'], ['cavities', 'Acoustic cavities'], ['both', 'Baffles + cavities']], 'none'),
      num('rpm', 'Turbopump speed', 'rpm', 3000, 100000, 500, 30000, null, (p) => p.cycle !== 'pressure'),
      sel('inducer', 'Pump inducer', [['none', 'None'], ['std', 'Standard inducer'], ['hp', 'High-suction-performance inducer']], 'std', null, (p) => p.cycle !== 'pressure'),
      num('ggTemp', 'Gas-generator temperature', 'K', 600, 1300, 10, 950, null, (p) => p.cycle === 'gg'),
      sel('turbineMat', 'Turbine / hot-gas material', matOpts(['in718', 'oxAlloy', 'ss304L']), 'in718', null, (p) => p.cycle !== 'pressure' && p.cycle !== 'electric'),
      sel('igniter', 'Ignition system', opts(IGNITERS), 'pyro'),
      num('ignitions', 'TEA-TEB cartridges (restarts)', '', 1, 10, 1, 3, null, (p) => p.igniter === 'teateb'),
      num('gimbal', 'Gimbal range (0 = fixed)', '°', 0, 12, 0.5, 0),
      sel('actuator', 'TVC actuators', [['electromech', 'Electromechanical'], ['hydraulic', 'Hydraulic']], 'electromech', null, (p) => p.gimbal > 0),
    ],
    compute(c, ctx) {
      const p = c.params;
      const n = ctx.stage.engineCount || 1;
      const prop = ctx.stage.propLoad || 0;
      const est = designLiquidEngine({ ...p, burnTimeHint: 60 }, ctx.asBuilt || {});
      const burn = prop > 0 ? prop / (est.mdotTotal * n) : 60;
      const e = designLiquidEngine({ ...p, burnTimeHint: burn }, ctx.asBuilt || {});
      const w = W(); for (const x of e.warnings) w.push(x);
      if (e.maxBurn < burn * 1.2 && p.cooling === 'ablative') { /* already flagged */ }
      if (ctx.isBottom && e.sepSL) w.add('error', 'First-stage engine nozzle separates at sea level. Reduce area ratio.');
      if (!ctx.isBottom && p.thrustRef === 'SL') w.add('info', 'Upper-stage engine rated at sea level — consider a vacuum-optimized nozzle (higher ε).');
      if (p.cycle === 'electric' && burn > 0) {
        const wh = e.feed.elecPower * burn / 3600;
        const batt = Math.max(e.feed.elecPower / 4000, wh / 160);
        e.mass += batt; e.massBreakdown.battery = batt;
      }
      const thrustStruct = 1.5e-4 * e.FvacTotal * n + 1;
      const dry = e.mass * n + thrustStruct;
      const L = e.length + 0.15 * e.Dc + 0.1;
      const fab = [];
      for (let i = 1; i <= n; i++) {
        const tag = n > 1 ? ` #${i}` : '';
        const chRoute = p.cooling === 'regen' ? (p.method === 'lpbf' ? 'chamberAM' : 'chamberMachined') : p.cooling === 'ablative' ? 'chamberAblative' : 'chamberRadiative';
        fab.push(fabPart('chamber' + i, 'Thrust chamber' + tag, chRoute, { mat: p.chamberMat, mass: e.massBreakdown.chamber + e.massBreakdown.nozzle, area: 0.5, thk: p.wallThk, lox: true, engine: i, pressure: { meop: e.feed.pDisFuel || e.pc, burst: (e.feed.pDisFuel || e.pc) * 1.6 } }));
        if (e.massBreakdown.extension > 0) fab.push(fabPart('ext' + i, 'Nozzle extension' + tag, 'nozzleExt', { mat: p.extMat, mass: e.massBreakdown.extension, area: 1, engine: i }));
        fab.push(fabPart('inj' + i, 'Injector' + tag, 'injector', { mass: e.massBreakdown.injector, elements: Math.round(20 + e.mdot * 3), lox: true, engine: i }));
        if (p.cycle === 'electric') fab.push(fabPart('pump' + i, 'Electric pumps' + tag, 'motorPump', { mass: e.massBreakdown.turbopump + e.massBreakdown.motors, powerKW: e.feed.elecPower / 1000, engine: i }));
        else if (p.cycle !== 'pressure') fab.push(fabPart('tp' + i, 'Turbopump' + tag, 'turbopump', { mass: e.massBreakdown.turbopump, preload: 300 + e.feed.turbineP / 2000, rpm: p.rpm, lox: true, engine: i }));
        if (p.cycle === 'gg' || p.cycle.startsWith('staged')) fab.push(fabPart('gg' + i, (p.cycle === 'gg' ? 'Gas generator' : 'Preburner') + tag, 'gasGenerator', { mass: e.massBreakdown.gasGenerator, engine: i }));
        fab.push(fabPart('valves' + i, 'Main valves' + tag, 'valves', { mass: e.massBreakdown.valves, lox: true, engine: i }));
        if (p.igniter !== 'hypergolic') fab.push(fabPart('ign' + i, 'Igniter' + tag, p.igniter === 'pyro' ? 'igniterPyro' : 'igniterLiquid', { mass: e.massBreakdown.igniter, engine: i }));
        if (p.gimbal > 0) fab.push(fabPart('gim' + i, 'Gimbal & TVC actuators' + tag, 'gimbal', { mat: 'ti64', mass: e.massBreakdown.gimbal, engine: i }));
      }
      fab.push(fabPart('thrust', 'Thrust structure', 'thrustStructure', { mat: 'al2219', mass: thrustStruct }));
      return {
        length: L, dryMass: dry, d: Math.max(e.De * (n > 1 ? Math.ceil(Math.sqrt(n)) : 1), e.Dc), warnings: w,
        outputs: [
          ['Thrust SL / vac', (e.FslTotal / 1000).toFixed(1) + ' / ' + (e.FvacTotal / 1000).toFixed(1) + ' kN'], ['Isp SL / vac', e.ispSL.toFixed(1) + ' / ' + e.ispVac.toFixed(1) + ' s'],
          ['c* (efficiency)', e.cstar.toFixed(0) + ' m/s (' + (e.etaC * 100).toFixed(1) + '%)'], ['Tc', e.comb.Tc.toFixed(0) + ' K'], ['Mass flow', e.mdotTotal.toFixed(2) + ' kg/s'],
          ['Throat / exit dia', (e.Dt * 1000).toFixed(1) + ' / ' + (e.De * 1000).toFixed(0) + ' mm'], ['Engine length', e.length.toFixed(3) + ' m'], ['Engine mass', e.mass.toFixed(1) + ' kg (×' + n + ')'], ['Engine T/W', e.tw.toFixed(0)],
          ...(e.ht ? [['Throat heat flux', (e.ht.qThroat / 1e6).toFixed(1) + ' MW/m²'], ['Max hot-wall', e.ht.TwgMax.toFixed(0) + ' K'], ['Coolant out', e.ht.TcoolOut.toFixed(0) + ' K'], ['Jacket ΔP', (e.ht.dp / 1e6).toFixed(2) + ' MPa'], ['Fatigue life', e.ht.fatigueLife + ' firings']] : []),
          ...(e.abl ? [['Ablative life', e.maxBurn.toFixed(0) + ' s']] : []),
          ['Tank pressure ox / fuel', (e.feed.pTankOx / 1e6).toFixed(2) + ' / ' + (e.feed.pTankFuel / 1e6).toFixed(2) + ' MPa'],
          ...(p.cycle !== 'pressure' ? [['Pump power', (e.feed.turbineP / 1000).toFixed(0) + ' kW'], ['Bearing DN', (e.feed.dn / 1e6).toFixed(2) + 'M']] : []),
          ...(p.cycle === 'gg' ? [['GG flow', (e.mdotGG / e.mdotTotal * 100).toFixed(1) + '% of total']] : []),
          ['Min throttle', (e.throttleMin * 100).toFixed(0) + '%'], ['HF instability risk', (e.stability.hfRisk * 100).toFixed(1) + '% / start'], ['Burn time', burn.toFixed(1) + ' s'],
        ],
        engine: { ...e, count: n, gimbal: p.gimbal, actuatorRate: p.actuator === 'hydraulic' ? 20 : 12, ignitions: e.ignitions, plume: PAIRS[p.pair].plume, pairKey: p.pair, burnTime: burn },
        draw: { kind: 'engine', contour: e.contour, n }, fabParts: fab,
      };
    },
  },

  tank: {
    label: 'Propellant tank', stack: true,
    params: [
      sel('role', 'Contents', [['ox', 'Oxidizer'], ['fuel', 'Fuel']], 'ox'),
      sel('mat', 'Material', matOpts(['al6061', 'al2219', 'al2195', 'al7075', 'ss304L', 'steel4130', 'ti64', 'cfrp']), 'al6061'),
      sel('process', 'Joining', opts(WELD_PROCESSES), 'tig'),
      sel('dome', 'Dome shape', [['hemi', 'Hemispherical'], ['ellip2', '√2 ellipsoidal (shorter)']], 'ellip2'),
      sel('stiff', 'Wall stiffening', opts(STIFFENING), 'monocoque'),
      num('wall', 'Wall thickness (0 = auto-size)', 'mm', 0, 50, 0.05, 0),
      num('ullage', 'Ullage volume', '%', 1, 15, 0.5, 4),
      num('meop', 'MEOP override (0 = auto)', 'MPa', 0, 40, 0.05, 0),
      num('insul', 'Foam insulation (cryogens)', 'mm', 0, 80, 1, 0),
      bool('baffles', 'Anti-slosh baffles', false),
    ],
    compute(c, ctx) {
      const p = c.params;
      const eng = ctx.engine;
      const w = W();
      if (!eng) { w.add('error', 'Tank has no liquid engine in this stage.'); return { length: 0.1, dryMass: 0.1, d: ctx.D, warnings: w, outputs: [], fabParts: [] }; }
      const pair = PAIRS[eng.pairKey];
      const liq = LIQUIDS[p.role === 'ox' ? pair.ox : pair.fuel];
      const frac = p.role === 'ox' ? eng.of / (1 + eng.of) : 1 / (1 + eng.of);
      const tanksSameRole = ctx.stage.components.filter(x => x.type === 'tank' && x.params.role === p.role).length;
      const propMass = (ctx.stage.propLoad || 0) * frac / Math.max(1, tanksSameRole);
      const auto = (p.role === 'ox' ? eng.feed.pTankOx : eng.feed.pTankFuel) * 1.1;
      const meop = p.meop > 0 ? p.meop * 1e6 : auto;
      if (p.meop > 0 && p.meop * 1e6 < auto / 1.1) w.add('error', `MEOP ${p.meop} MPa is below the ${(auto / 1.1e6).toFixed(2)} MPa the engine needs at its inlet (${eng.cycle === 'pressure' ? 'pressure-fed' : 'pump NPSH'}).`);
      const SF = ctx.qualified?.has(`tank:${p.mat}:${p.process}`) ? 1.25 : 1.4;
      const t = designTank({
        propMass, rho: liq.rho, ullage: p.ullage / 100, diameter: ctx.D, dome: p.dome, MEOP: meop, accelG: ctx.maxAccelG || 5, matKey: p.mat, process: p.process === 'wound' ? 'wound' : p.process,
        stiffening: p.stiff, SF, cryo: liq.cryo, axialLoad: (ctx.aboveMass || 0) * G0 * (ctx.maxAccelG || 5) * 1.25, insulMm: p.insul, baffles: p.baffles, wallMm: p.wall, Tprop: liq.Tstore, hvap: liq.hvap, isLox: liq === LIQUIDS.LOX, strengthFactor: ctx.asBuilt?.strength ?? 1,
      });
      for (const x of t.warnings) w.push(x);
      if (p.process === 'wound' && MATERIALS[p.mat].cls !== 'composite') w.add('error', 'Filament winding requires a composite material.');
      if (MATERIALS[p.mat].cls === 'composite' && p.process !== 'wound') w.add('error', 'Composite tanks are filament-wound, not welded.');
      if (liq.cryo && p.insul === 0 && liq.Tstore < 100) w.add('warn', `Uninsulated ${liq.name} tank boils off ${(t.boiloff * 3600).toFixed(0)} kg/h and builds ice on the pad.`);
      const welds = 2 * Math.PI * ctx.D * 2 + (t.barrelLength > 0 ? Math.ceil(t.barrelLength / 1.5) * Math.PI * ctx.D + t.barrelLength : 0);
      return {
        length: t.length, dryMass: t.mass, propMass, d: ctx.D, warnings: w,
        outputs: [['Contents', liq.name], ['Propellant', propMass.toFixed(1) + ' kg'], ['Volume', (t.V * 1000).toFixed(1) + ' L'], ['MEOP', (meop / 1e6).toFixed(2) + ' MPa'], ['Design pressure (incl. head)', (t.pDesign / 1e6).toFixed(2) + ' MPa'],
          ['Wall', (t.t * 1000).toFixed(2) + ' mm (min ' + (t.tHoop * 1000).toFixed(2) + ')'], ['Joint efficiency', (t.jointEff * 100).toFixed(0) + '%'], ['Safety factor', SF.toFixed(2)], ['Tank mass', t.mass.toFixed(2) + ' kg'], ['Burst (calc.)', (t.burstCapacity / 1e6).toFixed(2) + ' MPa'],
          ...(liq.cryo ? [['Boil-off', (t.boiloff * 3600).toFixed(1) + ' kg/h']] : [])],
        tank: { role: p.role, liquid: liq, rho: liq.rho, meop, burst: t.burstCapacity, axialCap: t.axialCap, barrelLength: t.barrelLength, domeH: t.domeH, boiloff: t.boiloff, V: t.V, cryo: liq.cryo, R: ctx.D / 2 },
        draw: { kind: 'tank', role: p.role, cryo: liq.cryo, domeH: t.domeH },
        fabParts: [fabPart('tank', `${p.role === 'ox' ? 'Oxidizer' : 'Fuel'} tank`, p.process === 'wound' ? 'tankComposite' : 'tankWelded', {
          mat: p.mat, mass: t.mass, area: t.wetArea, thk: t.t * 1000, weldLen: welds, process: p.process, stiffening: p.stiff, lox: liq === LIQUIDS.LOX, pressure: { meop, burst: t.burstCapacity, yieldP: t.burstCapacity * MATERIALS[p.mat].Fty / MATERIALS[p.mat].Ftu },
        })],
      };
    },
  },

  pressurization: {
    label: 'Pressurization system', stack: false,
    params: [
      sel('gas', 'Pressurant', [['helium', 'Helium'], ['nitrogen', 'Nitrogen'], ['autogenous', 'Autogenous (vaporized propellant)']], 'nitrogen'),
      sel('copv', 'Storage bottles', opts(COPV_TYPES), 'cfAl', null, (p) => p.gas !== 'autogenous'),
      num('mpa', 'Storage pressure', 'MPa', 5, 60, 0.5, 30, null, (p) => p.gas !== 'autogenous'),
      bool('cold', 'Submerge bottles in LOX (cold helium)', false, 'Cold helium is ~3× denser — smaller bottles', (p) => p.gas === 'helium'),
    ],
    compute(c, ctx) {
      const p = c.params;
      const w = W();
      const tanks = ctx.stageTanks || [];
      if (!tanks.length) { w.add('warn', 'No tanks to pressurize.'); return { length: 0, dryMass: 0.5, d: ctx.D, warnings: w, outputs: [], fabParts: [] }; }
      if (p.gas === 'autogenous') {
        if (ctx.engine?.cycle === 'pressure' || ctx.engine?.cycle === 'electric') w.add('error', 'Autogenous pressurization needs heat exchangers on a turbine-driven engine.');
        if (tanks.some(t => !t.cryo)) w.add('error', 'Autogenous pressurization only works with cryogenic propellants (needs a vaporizable liquid).');
      }
      if (p.cold && !tanks.some(t => t.liquid?.name === 'Liquid oxygen')) w.add('error', 'No LOX tank to submerge bottles in.');
      const r = designPressurant({ tanks: tanks.map(t => ({ V: t.V, p: t.meop, cryo: t.cryo })), gas: p.gas, copvType: p.copv, copvMPa: p.mpa, coldStorage: p.cold });
      for (const x of r.warnings || []) w.push(x);
      const plumbing = 0.5 + 0.004 * (ctx.stage.propLoad || 0) ** 0.8;
      const fabParts = [];
      if (p.gas !== 'autogenous') fabParts.push(fabPart('copv', `Pressurant bottles (×${r.nCopv})`, 'copv', { mass: r.copvMass, cost: COPV_TYPES[p.copv].cost * Math.max(1, r.copvVolume * 40), pressure: { meop: p.mpa * 1e6, burst: p.mpa * 1e6 * 1.5 } }));
      fabParts.push(fabPart('plumb', 'Feed lines, regulators & valves', 'plumbing', { mass: plumbing, lox: true, mat: 'ss304L', weldLen: 2 }));
      return {
        length: 0, dryMass: r.systemMass + plumbing, gasMass: r.gasMass, d: ctx.D, warnings: w,
        outputs: [['Pressurant mass', r.gasMass.toFixed(2) + ' kg'], ['Bottle volume', (r.copvVolume * 1000).toFixed(1) + ' L'], ['Bottle mass', r.copvMass.toFixed(2) + ' kg'], ['Lines & valves', plumbing.toFixed(1) + ' kg']],
        press: { gas: p.gas, copvMPa: p.mpa }, draw: { kind: 'none' }, fabParts,
      };
    },
  },

  interstage: {
    label: 'Interstage & separation', stack: true,
    params: [
      num('length', 'Length', 'm', 0.1, 15, 0.01, 0.5), sel('mat', 'Construction', [['cfrp', 'Carbon/honeycomb sandwich'], ['al2219', 'Aluminum isogrid'], ['al6061', 'Aluminum skin-stringer']], 'cfrp'),
      sel('sep', 'Separation', [['pneumatic', 'Pneumatic pushers + latches'], ['frangible', 'Pyrotechnic frangible joint'], ['marman', 'Marman clamp band'], ['hot', 'Hot staging (vented truss)']], 'marman'),
      sel('ullage', 'Ullage settling for next stage', [['none', 'None'], ['motors', 'Solid ullage motors'], ['rcs', 'Upper-stage cold-gas thrusters']], 'motors', 'Liquid propellants float in free-fall; they must be settled against the tank outlets before ignition.'),
    ],
    compute(c, ctx) {
      const p = c.params, R = ctx.D / 2;
      const load = (ctx.aboveMass || 10) * G0 * (ctx.maxAccelG || 5) * 1.3 + 2 * (ctx.aboveMass || 10) * G0 * 0.3;
      const matKey = p.mat === 'cfrp' ? 'cfrp' : p.mat;
      const sh = designShell({ matKey, R, length: p.length, loadN: load, SF: 1.4, stiffening: p.mat === 'al2219' ? 'isogrid' : p.mat === 'al6061' ? 'stringer' : 'monocoque', sandwich: p.mat === 'cfrp', minMm: p.mat === 'cfrp' ? 0.5 : 1.0 });
      let mass = sh.mass * (p.sep === 'hot' ? 0.75 : 1);
      const sepMass = { pneumatic: 0.012, frangible: 0.006, marman: 0.01, hot: 0.004 }[p.sep] * (ctx.aboveMass || 10) + 0.5;
      const ullMass = p.ullage === 'motors' ? 0.004 * (ctx.aboveMass || 10) + 0.3 : 0;
      const w = W();
      if (ctx.upperEngineLen && ctx.upperEngineLen > p.length + 0.05) w.add('error', `Upper-stage engine/nozzle (${ctx.upperEngineLen.toFixed(2)} m) does not fit inside the ${p.length.toFixed(2)} m interstage.`);
      if (ctx.upperLiquid && p.ullage === 'none' && p.sep !== 'hot') w.add('warn', 'No ullage settling: the upper-stage liquid engine will likely ingest gas at ignition (turbopump cavitation / start failure).');
      if (p.ullage === 'rcs' && !ctx.upperHasRcs) w.add('error', 'Upper stage has no RCS to settle propellant.');
      return {
        length: p.length, dryMass: mass + sepMass + ullMass, d: ctx.D, warnings: w,
        outputs: [['Shell mass', mass.toFixed(1) + ' kg'], ['Design load', (load / 1000).toFixed(1) + ' kN'], ['Separation hardware', sepMass.toFixed(1) + ' kg'], ...(ullMass ? [['Ullage motors', ullMass.toFixed(1) + ' kg']] : [])],
        interstage: { sep: p.sep, ullage: p.ullage, capacity: sh.capacity }, draw: { kind: 'interstage', hot: p.sep === 'hot' },
        fabParts: [
          fabPart('istg', 'Interstage', p.mat === 'cfrp' ? 'shellComposite' : 'shellMetal', { mat: matKey, mass, area: 2 * Math.PI * R * p.length, thk: sh.t * 1000, plies: 8, welded: p.mat !== 'cfrp' }),
          fabPart('sep', 'Stage separation system', 'sepSystem', { kind: p.sep === 'pneumatic' ? 'pneumatic' : 'pyro', mass: sepMass, cost: 5000 + 300 * sepMass }),
          ...(ullMass ? [fabPart('ullage', 'Ullage motors', 'igniterPyro', { mass: ullMass })] : []),
        ],
      };
    },
  },

  fins: {
    label: 'Fin set', stack: false, bottomMount: true,
    params: [
      num('count', 'Number of fins', '', 3, 8, 1, 4), num('root', 'Root chord', 'm', 0.02, 5, 0.005, 0.15), num('tip', 'Tip chord', 'm', 0, 5, 0.005, 0.05),
      num('span', 'Span (semi-span)', 'm', 0.01, 3, 0.005, 0.08), num('sweep', 'Leading-edge sweep length', 'm', 0, 5, 0.005, 0.10),
      num('thk', 'Thickness', 'mm', 0.5, 40, 0.1, 3.0), sel('mat', 'Material', matOpts(['plywood', 'g10', 'cfrp', 'al6061', 'steel4130']), 'g10'), bool('bevel', 'Beveled leading edges', true),
    ],
    compute(c, ctx) {
      const p = c.params, m = MATERIALS[p.mat];
      const area = 0.5 * (p.root + p.tip) * p.span;
      const mass = area * p.thk / 1000 * m.rho * p.count * 1.15 + 0.02 * p.count;
      const fin = { G: m.G, Cr: p.root, Ct: p.tip, span: p.span, t: p.thk / 1000 };
      const vfSL = finFlutterSpeed(fin, atmosphere(0));
      const vf5 = finFlutterSpeed(fin, atmosphere(5000));
      const w = W();
      if (ctx.vmaxEst && vfSL < ctx.vmaxEst * 1.15) w.add('warn', `Fin flutter speed at sea level is ${vfSL.toFixed(0)} m/s; rough max velocity estimate ${ctx.vmaxEst.toFixed(0)} m/s. Run the trajectory simulation to check flutter margin along the actual flight path (flutter speed rises with altitude).`);
      if (p.tip > p.root) w.add('warn', 'Tip chord larger than root chord: odd planform, heavy tip.');
      return {
        length: 0, dryMass: mass, d: ctx.D + 2 * p.span, warnings: w,
        outputs: [['Mass', mass.toFixed(2) + ' kg'], ['Flutter speed SL', vfSL.toFixed(0) + ' m/s'], ['Flutter speed 5 km', vf5.toFixed(0) + ' m/s'], ['Planform area (each)', (area * 1e4).toFixed(0) + ' cm²']],
        aero: { type: 'fins', n: p.count, Cr: p.root, Ct: p.tip, span: p.span, sweep: p.sweep, d: ctx.D, thk: p.thk / 1000, G: m.G, bevel: p.bevel },
        draw: { kind: 'fins', ...p },
        fabParts: [fabPart('fins', `Fin set (×${p.count})`, 'fins', { mat: p.mat, mass, area: area * p.count, thk: p.thk })],
      };
    },
  },

  rcs: {
    label: 'Reaction control system (cold gas)', stack: false,
    params: [num('gas', 'Nitrogen load', 'kg', 0.1, 500, 0.1, 2), num('thrust', 'Thruster force', 'N', 1, 2000, 1, 20)],
    compute(c, ctx) {
      const p = c.params;
      const bottle = p.gas * 296.8 * 290 / 30e6 * 30e6 * 1.5 / 1.9e5;
      const mass = bottle + 0.4 * 8 * Math.max(0.2, p.thrust / 100) ** 0.5 + 0.5;
      return {
        length: 0, dryMass: mass, rcsGas: p.gas, d: ctx.D, warnings: [],
        outputs: [['Dry mass', mass.toFixed(1) + ' kg'], ['Isp', '70 s'], ['Total impulse', (p.gas * 70 * G0 / 1000).toFixed(1) + ' kN·s']],
        rcs: { gas: p.gas, thrust: p.thrust, isp: 70 }, draw: { kind: 'none' },
        fabParts: [fabPart('rcs', 'RCS module', 'rcs', { mass })],
      };
    },
  },
};

export function defaultParams(type) {
  const o = {};
  for (const p of COMPONENTS[type].params) o[p.key] = p.def;
  return o;
}
