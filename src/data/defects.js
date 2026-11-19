// Defect catalogue and non-destructive-inspection (NDI) capability.
// Effects: strength = knock-down coefficient on structural capacity (×(1 − k·severity));
// other keys are consumed by the reliability model (hotspot, ofShift, vib, leak, elec, ...).

export const DEFECTS = {
  lackOfFusion: { name: 'Lack of fusion', strength: 0.55, leak: 0.15, desc: 'Weld metal did not fuse with the parent metal — an internal planar flaw.' },
  porosity: { name: 'Weld porosity', strength: 0.18, leak: 0.12, desc: 'Gas bubbles trapped in weld metal (contamination, poor shielding).' },
  crack: { name: 'Crack', strength: 0.7, leak: 0.35, desc: 'Hot crack / cold crack — the worst kind of flaw; grows under cyclic load.' },
  hazSoftening: { name: 'Heat-affected-zone softening', strength: 0.32, desc: 'Excess heat input over-aged the metal beside the weld.' },
  burnThrough: { name: 'Burn-through', strength: 0.9, leak: 0.9, desc: 'Weld melted through the joint. Obvious on visual inspection.' },
  mismatch: { name: 'Joint mismatch / peaking', strength: 0.25, desc: 'Edges out of alignment — secondary bending at the seam.' },
  thinWall: { name: 'Undersize wall (over-machined)', strength: 0.4, desc: 'Pocket milling or chem-mill removed too much material.' },
  dimensional: { name: 'Out-of-tolerance dimension', fit: 1, strength: 0.08, desc: 'Part does not match the drawing; may not mate at integration.' },
  underaged: { name: 'Incorrect heat treatment (under-aged)', strength: 0.3, desc: 'Did not reach the specified temper — low strength.' },
  overaged: { name: 'Over-aged / over-tempered', strength: 0.22, desc: 'Too hot or too long — strength lost.' },
  quenchCrack: { name: 'Quench crack', strength: 0.65, desc: 'Cracking from thermal shock during quench.' },
  lowLot: { name: 'Low-strength material lot', strength: 1.0, desc: 'Mill certificate shows strength below specification.' },
  contamination: { name: 'Oxygen-system contamination', loxIgnite: 0.6, desc: 'Hydrocarbon residue or particles in LOX-wetted hardware: an ignition source.' },
  fod: { name: 'Foreign object debris (FOD)', fod: 0.4, desc: 'Loose debris left inside hardware. Can be ingested by pumps or block orifices.' },
  wrinkle: { name: 'Ply wrinkle', strength: 0.35, desc: 'Fibers out-of-plane — big compression strength loss.' },
  compPorosity: { name: 'Laminate porosity', strength: 0.25, desc: 'Voids in the resin from low consolidation pressure.' },
  delamination: { name: 'Delamination', strength: 0.6, desc: 'Plies separated — a planar flaw in composites.' },
  dryFiber: { name: 'Resin-starved / dry fiber', strength: 0.4, desc: 'Not enough resin wet-out.' },
  undercure: { name: 'Under-cured resin', strength: 0.3, temp: 0.3, desc: 'Resin did not reach full cross-link — weak and heat-sensitive.' },
  fiberAngle: { name: 'Fiber-angle error', strength: 0.3, desc: 'Winding angle off the design (netting-analysis optimum).' },
  void: { name: 'Propellant void', grain: 1, desc: 'Gas bubble in the propellant — extra burning surface when exposed.' },
  grainCrack: { name: 'Propellant crack', grain: 1, desc: 'Crack in the grain — instantly adds burning area at ignition.' },
  debond: { name: 'Liner/propellant debond', grain: 1, desc: 'Propellant not bonded to the case liner — flame can run down the gap.' },
  offRatio: { name: 'Off-ratio propellant batch', rate: 1, desc: 'Curative/oxidizer ratio off spec: burn rate and mechanical properties shift.' },
  trappedPowder: { name: 'Trapped powder in channels', hotspot: 1.0, desc: 'Unremoved metal powder blocking cooling channels.' },
  amPorosity: { name: 'Print porosity (lack-of-fusion)', strength: 0.35, hotspot: 0.25, desc: 'Under-melted layers in additively-manufactured metal.' },
  closeoutDebond: { name: 'Closeout debond', hotspot: 0.8, strength: 0.3, desc: 'Electroformed/brazed jacket not bonded over the channel lands.' },
  channelBlock: { name: 'Coolant channel blockage', hotspot: 1.0, desc: 'Braze alloy or debris in a coolant channel.' },
  orifice: { name: 'Injector orifice out of tolerance', ofShift: 0.08, hotspot: 0.5, desc: 'Orifices mis-sized — mixture ratio shifts and wall streaking.' },
  imbalance: { name: 'Rotor imbalance', vib: 1, desc: 'Residual imbalance in the turbopump rotor → vibration, bearing wear.' },
  bearing: { name: 'Bearing preload error', vib: 0.7, desc: 'Incorrect preload → skidding or overheating bearings.' },
  sealLeak: { name: 'Inter-propellant seal leak', leak: 1, interprop: 1, desc: 'Fuel and oxidizer can meet inside the turbopump.' },
  pinchedSeal: { name: 'Pinched O-ring', leak: 0.8, desc: 'Seal damaged during assembly.' },
  solder: { name: 'Defective solder joint', elec: 1, desc: 'Cold or cracked solder joint — opens under vibration.' },
  crimp: { name: 'Bad crimp / connector pin', elec: 0.8, desc: 'Intermittent connection.' },
  firmware: { name: 'Flight-software bug', software: 1, desc: 'Latent bug that manifests in a specific flight condition.' },
  infant: { name: 'Infant-mortality component', elec: 0.9, desc: 'Weak part that fails early in life — screened by burn-in.' },
  packing: { name: 'Parachute packing error', chute: 1, desc: 'Lines twisted / wrong fold — chute may not inflate.' },
  finMisalign: { name: 'Fin misalignment', misalign: 1, desc: 'Fins not parallel to the body axis — unwanted moments.' },
  copvLiner: { name: 'COPV liner/overwrap flaw', copv: 1, desc: 'Composite overwrapped pressure vessel flaw — can rupture when pressurized.' },
  coating: { name: 'Coating defect', hotspot: 0.6, desc: 'Silicide coating gap on refractory metal — oxidizes at temperature.' },
  thermalShock: { name: 'Graphite insert microcrack', throat: 1, desc: 'Graphite throat cracked — may eject under pressure.' },
};

// [a50 severity, coverage] — POD(sev) = coverage / (1 + (a50/sev)^3)
export const NDI = {
  visual: {
    name: 'Visual (10× loupe)', facility: null, hoursBase: 0.5, cost: 0,
    pod: { burnThrough: [0.05, 0.98], mismatch: [0.3, 0.7], dimensional: [0.5, 0.5], fod: [0.4, 0.5], wrinkle: [0.4, 0.7], dryFiber: [0.4, 0.7], finMisalign: [0.4, 0.6], crack: [0.7, 0.25], coating: [0.4, 0.6], pinchedSeal: [0.6, 0.3] },
  },
  pt: {
    name: 'Dye penetrant (PT)', facility: 'ndtBasic', hoursBase: 1.5, cost: 150,
    pod: { crack: [0.25, 0.8], porosity: [0.5, 0.35], lackOfFusion: [0.7, 0.2], quenchCrack: [0.2, 0.9], coating: [0.3, 0.8] },
  },
  rt: {
    name: 'Radiography (X-ray film/DR)', facility: 'xray', hoursBase: 3, cost: 900,
    pod: { porosity: [0.15, 0.95], lackOfFusion: [0.35, 0.8], crack: [0.45, 0.55], void: [0.15, 0.95], grainCrack: [0.3, 0.75], trappedPowder: [0.35, 0.75], amPorosity: [0.4, 0.6], channelBlock: [0.4, 0.7], debond: [0.7, 0.3], burnThrough: [0.05, 0.99], fod: [0.2, 0.9] },
  },
  ut: {
    name: 'Phased-array ultrasonic (PAUT)', facility: 'ndtBasic', hoursBase: 3, cost: 700,
    pod: { lackOfFusion: [0.18, 0.92], crack: [0.22, 0.85], delamination: [0.12, 0.96], debond: [0.18, 0.92], porosity: [0.4, 0.6], compPorosity: [0.2, 0.92], thinWall: [0.08, 0.98], closeoutDebond: [0.2, 0.9], dryFiber: [0.3, 0.7] },
  },
  ct: {
    name: 'Computed tomography (CT)', facility: 'ct', hoursBase: 6, cost: 4500,
    pod: { porosity: [0.08, 0.98], lackOfFusion: [0.15, 0.95], crack: [0.22, 0.88], void: [0.06, 0.99], grainCrack: [0.15, 0.95], trappedPowder: [0.06, 0.99], channelBlock: [0.1, 0.97], amPorosity: [0.1, 0.97], debond: [0.25, 0.85], delamination: [0.18, 0.92], compPorosity: [0.15, 0.95], fod: [0.08, 0.98], thermalShock: [0.15, 0.95], closeoutDebond: [0.25, 0.85] },
  },
  cmm: {
    name: 'CMM / laser-scan dimensional', facility: 'machine', hoursBase: 2, cost: 200,
    pod: { dimensional: [0.05, 0.99], thinWall: [0.12, 0.9], mismatch: [0.1, 0.95], finMisalign: [0.05, 0.99], orifice: [0.3, 0.6] },
  },
  tap: {
    name: 'Tap test (composites)', facility: null, hoursBase: 0.5, cost: 0,
    pod: { delamination: [0.4, 0.6], debond: [0.5, 0.5], compPorosity: [0.6, 0.3] },
  },
};

export function podFor(method, defect) {
  const m = NDI[method];
  const e = m && m.pod[defect.type];
  if (!e) return 0;
  const [a50, cov] = e;
  return cov / (1 + Math.pow(a50 / Math.max(defect.severity, 1e-3), 3));
}
