// Turns as-built hardware (with its accepted / undetected defects) into flight hazards with root causes.
import { DEFECTS } from '../data/defects.js';

const STRUCT_TYPES = ['tank', 'case', 'istg', 'airframe', 'fairingA', 'fairingB', 'nose', 'avbay', 'recbay', 'copv'];

// Defects that are still in the hardware: undetected, or detected but dispositioned "use as is".
export function liveDefects(part) {
  return (part.defects || []).filter(d => !d.fixed && !d.removed && (!d.detected || d.disposition === 'useAsIs'));
}

export function causeText(part, d) {
  const def = DEFECTS[d.type];
  let s = `${def ? def.name : d.type} (severity ${(d.severity * 100).toFixed(0)}%) in ${part.name}`;
  if (d.origin) s += ` — introduced at "${d.origin.step}"${d.origin.detail ? ` (${d.origin.detail})` : ''}`;
  if (d.detected && d.disposition === 'useAsIs') s += '; found in inspection but accepted "use-as-is"';
  else if (!d.detected) s += d.inspectedBy && d.inspectedBy.length ? `; missed by ${d.inspectedBy.join(', ')}` : '; never inspected for';
  return s;
}

export function strengthFactor(part) {
  let f = part.lot ? part.lot.factor : 1;
  let worst = null, worstK = 0;
  for (const d of liveDefects(part)) {
    const k = DEFECTS[d.type]?.strength;
    if (!k) continue;
    const loss = k * d.severity;
    f *= 1 - loss;
    if (loss > worstK) { worstK = loss; worst = d; }
  }
  return { factor: Math.max(0.05, f), worst };
}

/**
 * build: { parts: [...] } with uid "compId:key", data from fabParts
 * Returns hazards consumed by FlightSim, plus asBuilt adjustments for computeVehicle (solid grains, O/F shifts).
 */
export function buildHazards(design, analysis, build) {
  const hz = [];
  const asBuilt = {};
  if (!build) return { hazards: hz, asBuilt };
  const parts = build.parts.filter(p => p.status !== 'scrapped');
  const byComp = {};
  for (const p of parts) (byComp[p.compId] ||= []).push(p);
  const placedById = Object.fromEntries(analysis.placed.map(p => [p.id, p]));
  for (const [compId, ps] of Object.entries(byComp)) {
    const pl = placedById[compId];
    if (!pl) continue;
    const stage = pl.stage;
    for (const part of ps) {
      const live = liveDefects(part);
      const sf = strengthFactor(part);
      if (STRUCT_TYPES.includes(part.key) && sf.factor < 0.999) {
        hz.push({ kind: 'strength', comp: compId, stage, factor: sf.factor, cause: sf.worst ? causeText(part, sf.worst) : `Low-strength material lot in ${part.name} (mill cert ${(part.lot.factor * 100).toFixed(0)}% of nominal)` });
        if (part.key === 'case') (asBuilt[compId] ||= {}).strength = sf.factor;
      }
      for (const d of live) {
        const def = DEFECTS[d.type] || {};
        const cause = causeText(part, d);
        const eng = part.data?.engine ? part.data.engine - 1 : undefined;
        if (def.hotspot && /chamber|ext|inj/.test(part.key)) {
          const sev = d.severity * def.hotspot;
          const e = pl.r.engine;
          const margin = e?.ht ? (MATERIALS_TMAX(e) - e.ht.TwgMax) / Math.max(1, e.ht.TwgMax - 300) : 0.3;
          if (sev * 0.9 > margin) hz.push({ kind: 'hotspot', stage, engine: eng, tFail: 3 + 60 * Math.max(0, 1 - (sev * 0.9 - margin) * 3) * Math.random(), cause });
        }
        if (def.ofShift) hz.push({ kind: 'ofShift', stage, engine: eng, shift: (Math.random() < 0.5 ? -1 : 1) * def.ofShift * d.severity, cause });
        if (d.type === 'contamination') hz.push({ kind: 'loxIgnite', stage, engine: eng, prob: def.loxIgnite * d.severity, cause });
        if (d.type === 'imbalance' || d.type === 'bearing') hz.push({ kind: 'engineRate', stage, engine: eng, rate: 0.03 * d.severity * d.severity * (def.vib || 1), text: 'turbopump bearing failure / rotor rub', uncontained: 0.6, cause });
        if (d.type === 'sealLeak') hz.push({ kind: 'engineRate', stage, engine: eng, rate: 0.02 * d.severity, text: 'turbopump inter-propellant seal failure — fire', uncontained: 0.8, cause });
        if (d.type === 'pinchedSeal' && /valves|plumb|ign/.test(part.key)) hz.push({ kind: 'engineRate', stage, engine: eng, rate: 0.006 * d.severity, text: 'propellant leak and engine-bay fire', uncontained: 0.3, cause });
        if (d.type === 'fod' && /tp|inj|valves|plumb|pump/.test(part.key)) hz.push({ kind: 'engineRate', stage, engine: eng, rate: 0.004 * d.severity, text: 'debris ingested by pump / blocked injector', uncontained: 0.4, cause });
        if (d.type === 'coating') hz.push({ kind: 'engineRate', stage, engine: eng, rate: 0.01 * d.severity, text: 'nozzle extension oxidized through and tore', uncontained: 0.2, cause });
        if (d.type === 'thermalShock') hz.push({ kind: 'throatCrack', stage, prob: 0.5 * d.severity, cause });
        if (d.type === 'orifice' && part.key.startsWith('inj')) hz.push({ kind: 'hfInstab', stage, engine: eng, severity: d.severity * 0.5, cause });
        if (def.elec || def.software) {
          const sub = { fc: 'computer', tlm: 'telemetry', harness: Math.random() < 0.5 ? 'deploy' : 'ignition', battery: 'computer', fts: 'fts' }[part.key] || 'computer';
          if (d.type === 'firmware') hz.push({ kind: 'firmware', stage, event: ['staging', 'cutoff', 'deploy'][Math.floor(Math.random() * 3)], prob: 0.5 * d.severity + 0.2, cause });
          else if (part.key === 'fts') hz.push({ kind: 'ftsFail', prob: 0.7 * d.severity, cause });
          else hz.push({ kind: 'avionics', stage, sub, rate: (def.elec || 1) * 0.004 * d.severity * (part.vibHard ?? 1), text: DEFECTS[d.type].name, cause });
        }
        if (d.type === 'packing') hz.push({ kind: 'chuteFail', which: part.key === 'drogue' ? 'drogue' : 'main', prob: Math.min(0.95, 0.3 + 0.7 * d.severity), cause });
        if (d.type === 'finMisalign') hz.push({ kind: 'finMisalign', deg: 0.1 + 1.5 * d.severity, cause });
        if ((d.type === 'pinchedSeal' || d.type === 'infant' || d.type === 'dimensional') && part.key === 'sep') hz.push({ kind: 'sepFail', stage, prob: 0.6 * d.severity, cause });
        if ((d.type === 'pinchedSeal' || d.type === 'infant') && part.key === 'fairingSep') hz.push({ kind: 'fairingFail', prob: 0.6 * d.severity, cause });
        if (d.type === 'copvLiner') hz.push({ kind: 'copv', stage, prob: 0.6 * d.severity, cause });
        if (def.grain) {
          const ab = (asBuilt[compId] ||= {});
          ab.grainDefects ||= [];
          ab.grainDefects.push({ type: d.type, severity: d.severity, webFrac: d.webFrac ?? Math.random() * 0.8 });
          hz.push({ kind: 'grain', stage, cause });
        }
        if (d.type === 'offRatio' && part.key === 'grain') { const ab = (asBuilt[compId] ||= {}); ab.rateBias = (ab.rateBias || 1) * (1 + (d.sign || 1) * 0.12 * d.severity); }
      }
    }
  }
  return { hazards: hz, asBuilt };
}

function MATERIALS_TMAX(e) { return e.wallTmax ?? 900; }
