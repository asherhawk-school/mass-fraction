import { h } from '../dom.js';
import { MATERIALS } from '../../data/materials.js';
import { PAIRS, LIQUIDS } from '../../data/propellants.js';
import { DEFECTS, NDI } from '../../data/defects.js';

const TOPICS = [
  ['How the game is realistic', [
    ['First-principles sizing', 'Nothing has a made-up stat. Every mass comes from geometry × material density, every wall thickness from stress equations, every Isp from thermochemistry and nozzle flow. Change a parameter and the physics responds.'],
    ['Hidden defects', 'Manufacturing steps have true process windows you cannot see until you qualify the procedure with test coupons. Deviations (and plain random scatter) create defects. Inspections find them only with a probability of detection that depends on method, defect type and size. Whatever escapes flies with the rocket.'],
    ['Root-cause traceability', 'When something fails in test or flight, the investigation traces it to the exact part, process step and parameter that caused it.'],
  ]],
  ['Propulsion', [
    ['Characteristic velocity c*', 'c* = √(R·Tc/M) / Γ(γ), where Γ is the Vandenkerckhove function. Measures combustion quality; multiplied by c* efficiency (injector type, L*, film cooling).'],
    ['Thrust', 'F = ṁ·vₑ + (pₑ − pₐ)·Aₑ. Exit Mach comes from the area ratio ε by solving the isentropic area–Mach relation; thrust rises as ambient pressure falls.'],
    ['Flow separation', 'If the exit pressure is below ~0.4× ambient (Summerfield criterion) the jet separates from the nozzle wall, creating violent side loads. Sea-level engines need modest ε; vacuum engines can use ε = 50–300.'],
    ['Shifting equilibrium', 'Recombination of dissociated species in the nozzle releases energy — modelled as an effective γ that falls with area ratio. Calibrated against Merlin-1D, F-1, RL10 and AJ10.'],
    ['Regenerative cooling', 'Gas-side heat flux from the Bartz correlation (tens of MW/m² at the throat). Fuel flows through milled channels (Dittus–Boelter heat transfer). Hot-wall temperature must stay below the liner limit; kerosene cokes above ~560 K wall temperature; coolant must not boil/decompose.'],
    ['Combustion stability', 'Low-frequency "chugging" couples with the feed system if injector ΔP/Pc < ~15%. High-frequency acoustic modes (1T ≈ 1.84·a/(π·Dc)) can destroy a chamber in milliseconds; baffles and acoustic cavities add damping.'],
    ['Turbomachinery', 'Pump power = ṁ·ΔP/(ρ·η). Pump inlet pressure must exceed vapour pressure + NPSH, which sets minimum tank pressure. Bearing DN (bore mm × rpm) above ~2 million causes bearing failure. Gas generators dump 2–5% of flow; staged combustion dumps none but needs extreme pressures.'],
    ['Solid motors', 'Burn rate r = a·Pcⁿ (Saint-Robert). Chamber pressure Pc = (a·ρp·c*·Kn)^(1/(1−n)) where Kn = burning area / throat area. Burn rate rises ~0.17%/K with grain temperature — a hot day raises pressure. Voids and debonds add burning area: pressure spike → case burst (CATO).'],
  ]],
  ['Structures', [
    ['Hoop stress', 'σ = P·r/t. Required wall = SF·P·r/(allowable × joint efficiency). Safety factor 1.4 for untested designs, 1.25 once a burst test qualifies the design.'],
    ['Allowables', 'A-basis = strength that 99% of lots exceed with 95% confidence (≈ mean − 2.33σ). Every material lot arrives with a mill test report; weak lots exist.'],
    ['Weld joint efficiency', 'Fusion welding destroys the temper of heat-treated aluminium: 6061-T6 welds retain only ~45% strength. Friction-stir welding retains much more. 7075 cannot be fusion-welded at all.'],
    ['Buckling', 'Thin shells buckle at σ = 0.605·E·t/r times a knockdown factor (NASA SP-8007) — often 0.3–0.6. Internal pressure stabilizes tanks. Isogrid/orthogrid stiffening raises capacity.'],
    ['Flight loads', 'Every structural section is checked continuously: axial load (mass above × acceleration + drag) plus bending from aerodynamic normal force (q·α).'],
  ]],
  ['Aerodynamics & flight', [
    ['Stability', 'Unguided rockets need the centre of pressure (Barrowman method) 1–2 body diameters behind the centre of gravity. CG moves as propellant drains; CP moves forward at supersonic speeds as fins lose effectiveness.'],
    ['Fin flutter', 'NACA TN-4197: flutter speed ∝ a·√(G / (P·AR³·(λ+1)/(t/c)³)). Thin, flexible, high-aspect-ratio fins shred at high speed in dense air.'],
    ['Aerodynamic heating', 'Stagnation heating q = k·√(ρ/Rn)·v³ (Sutton–Graves). Nose tips heat-soak; epoxy composites fail around 410–450 K. Fairings jettison once free-molecular heating ½ρv³ < 1135 W/m².'],
    ['Guidance', 'Guided vehicles fly vertical, pitch over by a small kick once they reach a set speed, then gravity-turn at zero angle of attack. The final stage uses closed-loop linear-tangent steering (tan γ = A − B·t) re-solved every 0.5 s.'],
    ['Control', 'A PID autopilot commands the gimbal with rate and angle limits. Aerodynamically unstable launchers need enough TVC authority to beat the aerodynamic overturning moment at max-Q.'],
    ['Navigation', 'IMU gyro drift and accelerometer bias corrupt the navigated state. Space-rated GPS bounds the error; consumer GPS shuts off above 18 km or 515 m/s (COCOM export limits).'],
    ['Orbits', 'Two-body mechanics with universal-variable propagation. Earth rotation adds 465·cos(latitude)·sin(azimuth) m/s. Inclination: cos i = cos φ · sin Az.'],
    ['Atmosphere', 'U.S. Standard Atmosphere 1976 to 1000 km. Thermospheric density drives orbital decay.'],
  ]],
  ['Operations', [
    ['Launch commit criteria', 'Surface winds, upper-level wind shear, lightning within 10 nmi, precipitation, temperature limits (solid motors and seals), cloud ceiling for tracking.'],
    ['Range safety', 'Instantaneous impact point is computed continuously. If it leaves the corridor, the range safety officer destructs the vehicle — if it has a flight termination system.'],
    ['Licensing', 'Expected casualty Ec must be below 1×10⁻⁴; flight termination systems reduce Ec.'],
  ]],
];

export function renderLibrary(root, app) {
  const mats = h('table', { class: 't' }, h('thead', null, h('tr', null, ['Material', 'ρ kg/m³', 'Fty MPa', 'Ftu MPa', 'E GPa', 'Tmax K', 'Weld eff.', 'LOX', '$/kg', 'Lead d'].map(x => h('th', null, x)))),
    h('tbody', null, Object.values(MATERIALS).map(m => h('tr', null, h('td', null, m.name, h('div', { class: 'sub' }, m.note)), h('td', { class: 'num' }, m.rho), h('td', { class: 'num' }, (m.Fty / 1e6).toFixed(0)), h('td', { class: 'num' }, (m.Ftu / 1e6).toFixed(0)), h('td', { class: 'num' }, (m.E / 1e9).toFixed(0)), h('td', { class: 'num' }, m.Tmax), h('td', { class: 'num' }, m.weld.fusion === false ? '—' : (m.weld.fusion * 100).toFixed(0) + '%'), h('td', null, m.lox ? '✓' : '✗'), h('td', { class: 'num' }, m.cost), h('td', { class: 'num' }, m.lead)))));
  const props = h('table', { class: 't' }, h('thead', null, h('tr', null, ['Pair', 'O/F range', 'Ignition', 'Notes'].map(x => h('th', null, x)))), h('tbody', null, Object.entries(PAIRS).map(([k, p]) => h('tr', null, h('td', null, k), h('td', { class: 'num' }, p.ofRange.join('–')), h('td', null, p.igniters.join(', ')), h('td', { class: 'sub' }, p.note)))));
  const defects = h('table', { class: 't' }, h('tbody', null, Object.values(DEFECTS).map(d => h('tr', null, h('td', null, d.name), h('td', { class: 'sub' }, d.desc)))));
  const ndi = h('table', { class: 't' }, h('tbody', null, Object.values(NDI).map(m => h('tr', null, h('td', null, m.name), h('td', { class: 'sub' }, 'Detects: ' + Object.keys(m.pod).map(t => DEFECTS[t]?.name).join(', '))))));
  root.append(h('div', { class: 'grid cols-2' },
    h('div', { class: 'panel stack ency' }, h('h2', null, 'Engineering handbook'), TOPICS.map(([t, items]) => h('div', null, h('h3', null, t), h('dl', null, items.flatMap(([a, b]) => [h('dt', null, a), h('dd', null, b)]))))),
    h('div', { class: 'stack' },
      h('div', { class: 'panel' }, h('h3', null, 'Materials'), h('div', { class: 'scroll' }, mats)),
      h('div', { class: 'panel' }, h('h3', null, 'Propellants'), props),
      h('div', { class: 'panel' }, h('h3', null, 'Inspection methods'), ndi),
      h('div', { class: 'panel' }, h('h3', null, 'Defect catalogue'), h('div', { class: 'scroll' }, defects)))));
}
