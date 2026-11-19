// 3-DOF (planar translation + pitch rotation) flight simulator around a rotating spherical Earth.
// Inertial frame: Earth centre at origin, launch site initially at (0, RE+elev); downrange = +x (clockwise).
// Attitude ψ: body-axis angle, counter-clockwise from +x (math convention). Vertical at pad: ψ = π/2.
import { G0, MU, RE, OMEGA_E, DEG, SIGMA_SB, clamp } from './constants.js';
import { atmosphere } from './atmosphere.js';
import { windComponents, turbulence } from './wind.js';
import { cdMach, cpAnalysis, finFlutterSpeed, suttonGraves, fmHeating } from './aero.js';
import { nozzlePerf, pRatio } from './nozzle.js';
import { elements, propagate, iip, inclination } from './orbit.js';
import { aeroElements } from '../model/vehicle.js';
import { makeRng } from './rng.js';

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class FlightSim {
  constructor({ design, analysis, hazards = [], site, weather, program, seed = 1, grainTempK = 293 }) {
    this.design = design; this.an = analysis; this.site = site; this.wx = weather; this.prog = program;
    this.rng = makeRng(seed);
    this.hazards = hazards.map(h => ({ ...h }));
    this.placed = analysis.placed;
    this.n = design.stages.length;
    this.t = 0;
    this.events = [];
    this.tlm = [];
    this.debris = [];
    this.az = program.azimuth ?? 90;
    this.incl = inclination(site.lat, this.az);
    this.omegaP = OMEGA_E * Math.cos(this.incl * DEG);
    const r0 = RE + (site.elev || 0);
    this.state = { x: 0, y: r0, vx: this.omegaP * r0, vy: 0, psi: Math.PI / 2 + (program.mode === 'suborbital' ? -(90 - (program.elevation ?? 88)) * DEG : 0), w: 0 };
    this.padR = r0;
    this.psi0 = this.state.psi;
    this.phase = 'pad';
    this.stageIdx = 0;
    this.fairingOn = analysis.placed.some(p => p.type === 'fairing');
    this.finsLost = false;
    this.guided = analysis.guided;
    this.out = { result: null, apogee: 0, maxMach: 0, maxQ: 0, maxG: 0, maxV: 0, failures: [], downrange: 0 };
    this.gimbal = 0; this.gimbalCmd = 0;
    this.nav = { dpsi: 0, dvx: 0, dvy: 0, dx: 0, dy: 0, gpsLost: false };
    this.turb = 0;
    this.tipT = 290;
    this.recovery = null; this.chute = null;
    this.guid = { mode: 'vertical', A: null, B: null, lastSolve: -1, burnPhase: 0 };
    this.lastIIP = -10;
    this.tlmTimer = 0;
    this.massTimer = -1;
    this.stages = design.stages.map((st, i) => this._initStage(st, i, grainTempK));
    const recP = analysis.placed.find(p => p.type === 'recovery');
    if (recP) this.recovery = { ...recP.r.recovery, stage: recP.stage, drogueOut: false, mainOut: false };
    const av = analysis.placed.find(p => p.type === 'avionics' && p.stage === this.n - 1) || analysis.placed.find(p => p.type === 'avionics');
    this.av = av ? av.r.avionics : { computer: 'hobby', imu: 'mems', drift: 10, accelBias: 0.002, gps: 'none', tlmRange: 5e4, fts: false };
    this.computerOK = true;
    this._configChanged();
    this.log(`Range: ${site.name}. Azimuth ${this.az.toFixed(1)}°, inclination ${this.incl.toFixed(2)}°. Surface wind ${weather.surface.toFixed(1)} m/s, ground temp ${(weather.tempC).toFixed(0)} °C.`);
  }

  _initStage(st, i, grainTempK) {
    const eP = this.placed.find(p => p.stage === i && p.type === 'liquidEngine');
    const mP = this.placed.find(p => p.stage === i && p.type === 'solidMotor');
    const S = { idx: i, lit: false, done: false, sepDone: i === 0, ignT: null, throttle: 1, ignUsed: 0, out: 0, kind: null, settled: 0, rcsGas: 0 };
    if (eP) {
      const e = eP.r.engine;
      S.kind = 'liquid'; S.e = e; S.count = e.count; S.gx = e.gammaExp; S.eps = e.Ae / e.At;
      const tanks = this.placed.filter(p => p.stage === i && p.type === 'tank');
      S.ox = tanks.filter(t => t.r.tank.role === 'ox').reduce((s, t) => s + t.r.propMass, 0);
      S.fu = tanks.filter(t => t.r.tank.role === 'fuel').reduce((s, t) => s + t.r.propMass, 0);
      S.ox0 = S.ox; S.fu0 = S.fu;
      S.of = e.of * (1 + (this.hz('ofShift', i)?.shift || 0));
      S.gimbalMax = (e.gimbal || 0) * DEG; S.actRate = (e.actuatorRate || 12) * DEG;
      S.gimbalX = eP.x0 + 0.25 * eP.len; S.exitX = eP.x0 + eP.len;
      S.engines = Array.from({ length: e.count }, (_, k) => ({ k, alive: true, lit: false, failT: null }));
    } else if (mP) {
      const m = mP.r.motor;
      S.kind = 'solid'; S.m = m; S.curve = m.sim; S.prop0 = mP.r.propMass; S.burned = 0; S.count = 1;
      S.gimbalMax = (m.gimbal || 0) * DEG; S.actRate = 10 * DEG;
      const noz = this.placed.find(p => p.id === mP.id + ':noz');
      S.gimbalX = mP.x0 + mP.len; S.exitX = noz ? noz.x0 + noz.len : mP.x0 + mP.len;
      S.engines = [{ k: 0, alive: true }];
    }
    const rcsP = this.placed.find(p => p.stage === i && p.type === 'rcs');
    if (rcsP) { S.rcs = rcsP.r.rcs; S.rcsGas = rcsP.r.rcs.gas; }
    const ist = this.placed.find(p => p.stage === i && p.type === 'interstage');
    if (ist) S.interstage = ist.r.interstage;
    return S;
  }

  _pinToPad() {
    const th = this.omegaP * this.t, r0 = this.padR, st = this.state;
    st.x = r0 * Math.sin(th); st.y = r0 * Math.cos(th);
    st.vx = this.omegaP * r0 * Math.cos(th); st.vy = -this.omegaP * r0 * Math.sin(th);
    st.psi = this.psi0 - th; st.w = 0;
  }

  hz(kind, stage, engine) { return this.hazards.find(h => h.kind === kind && (stage === undefined || h.stage === stage) && (engine === undefined || h.engine === undefined || h.engine === engine) && !h.spent); }
  log(text, kind = 'info') { this.events.push({ t: this.t, text, kind }); }
  fail(text, cause, fatal = true) {
    this.out.failures.push({ t: this.t, text, cause });
    this.log(text + (cause ? ` — root cause: ${cause}` : ''), 'fail');
    if (fatal && this.phase !== 'destroyed') { this.phase = 'destroyed'; this.out.result = this.out.result || 'destroyed'; this._spawnDebris(this.state, this.massNow?.mass || 10, 'Vehicle debris'); }
  }

  // ---------- configuration (active stack) ----------
  _configChanged() {
    this.elems = aeroElements(this.placed, this.stageIdx, { noFairing: !this.fairingOn, finsLost: this.finsLost });
    const act = this.placed.filter(p => p.stage >= this.stageIdx && !(p.type === 'fairing' && !this.fairingOn));
    this.dRef = Math.max(...act.filter(p => p.type !== 'fins' && p.d).map(p => p.d));
    this.Sref = Math.PI * this.dRef * this.dRef / 4;
    const nose = this.elems.find(e => e.type === 'nose');
    const body = this.elems.find(e => e.type === 'body');
    const fins = this.elems.filter(e => e.type === 'fins' && !e.lost);
    const finArea = fins.reduce((s, f) => s + 0.5 * (f.Cr + f.Ct) * f.span * f.n, 0);
    this.cdCfg = { nose: nose?.shape || 'ogive', fineness: nose ? nose.L / nose.d : 1, bodyLD: body ? (body.L + (nose?.L || 0)) / this.dRef : 5, finRatio: finArea / this.Sref, finThick: fins[0] ? fins[0].thk / fins[0].Cr : 0.05, finBevel: fins[0]?.bevel };
    this.finElems = fins;
    this.xTop = Math.min(...act.map(p => p.x0));
    this.structSections = act.filter(p => ['tank', 'interstage', 'airframe', 'solidMotor', 'avionics', 'recovery'].includes(p.type) && p.len > 0);
    this.massTimer = -1;
  }

  _massProps() {
    let m = 0, mx = 0;
    const items = [];
    for (const p of this.placed) {
      if (p.stage < this.stageIdx || p.type === 'motorNozzle') continue;
      if (p.type === 'fairing' && !this.fairingOn) { const adapter = (p.r.dryMass - p.r.jettisonMass); items.push({ m: adapter, x: p.x0 + p.len, L: 0.1 }); continue; }
      const S = this.stages[p.stage];
      const r = p.r;
      let dry = (r.dryMass || 0) + (r.gasMass || 0);
      if (p.type === 'rcs') dry = r.dryMass + S.rcsGas;
      const xc = p.len > 0 ? p.x0 + p.len * (p.type === 'nosecone' || p.type === 'fairing' ? 0.66 : 0.5) : p.x0;
      if (dry > 0) items.push({ m: dry, x: xc, L: p.len });
      if (r.tank) {
        const f = r.tank.role === 'ox' ? S.ox / Math.max(S.ox0, 1e-9) : S.fu / Math.max(S.fu0, 1e-9);
        const pm = r.propMass * f;
        if (pm > 0) items.push({ m: pm, x: p.x0 + p.len - p.len * f / 2, L: p.len * f, tank: p });
      } else if (r.propMass && S.kind === 'solid') {
        const pm = Math.max(0, S.prop0 - S.burned);
        if (pm > 0) items.push({ m: pm, x: xc, L: p.len });
      }
    }
    for (const it of items) { m += it.m; mx += it.m * it.x; }
    const cg = mx / m;
    let I = 0;
    for (const it of items) I += it.m * ((it.x - cg) ** 2 + it.L * it.L / 12);
    this.massItems = items.sort((a, b) => a.x - b.x);
    return { mass: m, cg, I };
  }

  // ---------- propulsion ----------
  _thrust(S, pa) {
    if (!S || !S.lit || S.done) return { F: 0, mdot: 0, pc: 0 };
    if (S.kind === 'solid') {
      const tb = this.t - S.ignT;
      const c = S.curve;
      if (tb >= c.t[c.t.length - 1]) return { F: 0, mdot: 0, pc: 0, burnout: true };
      let i = 0; while (i < c.t.length - 2 && c.t[i + 1] < tb) i++;
      const u = (tb - c.t[i]) / Math.max(c.t[i + 1] - c.t[i], 1e-9);
      const fv = c.fvac[i] + (c.fvac[i + 1] - c.fvac[i]) * u;
      const md = c.mdot[i] + (c.mdot[i + 1] - c.mdot[i]) * u;
      const pc = c.pc[i] + (c.pc[i + 1] - c.pc[i]) * u;
      let F = fv - pa * S.m.Ae;
      const pe = pc * pRatio(S.m.sim ? 1 : 1, 1.2) * 0; // placeholder (separation handled below)
      const eps = S.m.eps;
      if (pa > 0 && pc > 0) {
        const perf = nozzlePerf({ g: S.m.gammaExp, eps, pc, pa, etaCf: S.m.etaCf });
        if (perf.separated) F = perf.cf * pc * (S.m.sim.At0);
      }
      return { F: Math.max(0, F), mdot: md, pc, frac: 1 };
    }
    // liquid
    const e = S.e;
    const tRun = this.t - S.ignT;
    const ramp = clamp(tRun / e.startTime, 0, 1);
    const frac = ramp * ramp * (3 - 2 * ramp);
    const alive = S.engines.filter(x => x.alive && x.lit).length;
    if (!alive) return { F: 0, mdot: 0, pc: 0 };
    const th = S.throttle * frac;
    let Fm;
    if (e.peFull * th >= 0.4 * pa) Fm = th * e.FvacMain - pa * e.Ae;
    else { const perf = nozzlePerf({ g: S.gx, eps: S.eps, pc: e.pc * th, pa, etaCf: e.etaCf }); Fm = perf.cf * e.pc * th * e.At; }
    const ofLoss = 1 - 0.8 * Math.abs(S.of / e.of - 1);
    const F = alive * (Math.max(0, Fm) * ofLoss + th * e.mdotGG * 900);
    return { F, mdot: alive * th * e.mdotTotal, pc: e.pc * th, frac, alive };
  }

  _ignite(S, opts = {}) {
    if (!S || S.lit || S.done) return false;
    if (S.kind === 'solid') {
      S.lit = true; S.ignT = this.t; S.ignUsed++;
      const th = this.hz('throatCrack', S.idx);
      if (th && this.rng.chance(th.prob)) { th.spent = true; this.fail(`Stage ${S.idx + 1} nozzle throat insert ejected at ignition`, th.cause, true); return false; }
      if (S.curve.cato) this.pendingCato = { t: this.t + S.curve.cato.time, S };
      this.log(`Stage ${S.idx + 1} solid motor ignition (${S.m.sim.motorClass})`);
      return true;
    }
    const e = S.e;
    if (S.ignUsed >= e.ignitions) { this.log(`Stage ${S.idx + 1}: no restarts left (igniter cartridges exhausted)`, 'warn'); return false; }
    S.ignUsed++;
    // propellant settling: liquids in free-fall must be settled for a clean start
    let unsettled = false;
    if (opts.vacuumStart && !(S.settled > 0) && !opts.hot) unsettled = true;
    let started = 0;
    for (const eng of S.engines) {
      if (!eng.alive) continue;
      let ok = true, why = null;
      const ign = this.hz('igniterFail', S.idx, eng.k);
      if (this.rng.chance(1 - e.igniterReliability)) { ok = false; why = 'igniter did not light (random igniter failure)'; }
      if (ok && ign && this.rng.chance(ign.prob)) { ok = false; why = ign.cause; ign.spent = true; }
      if (ok && unsettled && this.rng.chance(0.75)) { ok = false; why = 'Propellant not settled — turbopump ingested ullage gas (no ullage settling before vacuum start)'; }
      if (ok) {
        const lox = this.hz('loxIgnite', S.idx, eng.k);
        if (lox && this.rng.chance(lox.prob)) { lox.spent = true; this.fail(`Stage ${S.idx + 1} engine ${eng.k + 1} exploded at start (LOX-system ignition)`, lox.cause, true); return false; }
        const hf = this.hz('hfInstab', S.idx, eng.k);
        const p = (e.stability.hfRisk) * (hf ? 1 + 3 * hf.severity : 1);
        if (this.rng.chance(Math.min(0.97, p * 0.35))) {
          eng.alive = false; S.out++;
          if (S.count === 1) { this.fail(`Stage ${S.idx + 1} engine destroyed by high-frequency combustion instability (${(e.stability.f1T / 1000).toFixed(1)} kHz 1T mode)`, hf ? hf.cause : 'Design: insufficient acoustic damping / injector type', true); return false; }
          this.log(`Stage ${S.idx + 1} engine ${eng.k + 1} shut down: combustion instability`, 'fail');
          continue;
        }
        eng.lit = true; eng.ignT = this.t; started++;
        const hs = this.hz('hotspot', S.idx, eng.k);
        if (hs) eng.failT = this.t + hs.tFail;
      } else {
        this.log(`Stage ${S.idx + 1} engine ${eng.k + 1} failed to start: ${why}`, 'fail');
        if (S.count === 1) this.out.failures.push({ t: this.t, text: `Stage ${S.idx + 1} failed to ignite`, cause: why });
      }
    }
    if (!started) return false;
    S.lit = true; S.ignT = this.t;
    this.log(`Stage ${S.idx + 1} ignition: ${started}/${S.count} engine${S.count > 1 ? 's' : ''} running`);
    return true;
  }

  _shutdown(S, reason) {
    if (!S || !S.lit) return;
    S.lit = false; S.done = S.kind === 'solid' || reason === 'depletion' || reason === 'failure';
    for (const e of S.engines || []) e.lit = false;
    this.log(`Stage ${S.idx + 1} ${this.stageIdx === this.n - 1 && this.n > 1 ? 'SECO' : 'MECO'}: ${reason}`);
  }

  _separate() {
    const S = this.stages[this.stageIdx];
    const nxt = this.stages[this.stageIdx + 1];
    if (!nxt) return false;
    const sf = this.hz('sepFail', this.stageIdx);
    const base = { pneumatic: 0.002, frangible: 0.0008, marman: 0.0015, hot: 0.001 }[S.interstage?.sep || 'marman'];
    if (this.rng.chance(base) || (sf && this.rng.chance(sf.prob))) {
      this.fail(`Stage ${this.stageIdx + 1}/${this.stageIdx + 2} separation failed — vehicles did not separate`, sf ? sf.cause : 'Random separation-system failure', true);
      return false;
    }
    const m = this._massProps();
    const spentMass = this.placed.filter(p => p.stage === this.stageIdx).reduce((s, p) => s + (p.r.dryMass || 0), 0) + (S.ox || 0) + (S.fu || 0);
    this._spawnDebris(this.state, spentMass, `Stage ${this.stageIdx + 1} (spent)`);
    this.stageIdx++;
    this._configChanged();
    this.log(`Stage separation: stage ${this.stageIdx} jettisoned`);
    // ullage provision
    const ul = S.interstage?.ullage;
    if (ul === 'motors') { nxt.settled = 5; this.ullageThrust = { until: this.t + 5, accel: 0.04 * G0 }; this.log('Ullage motors fire (propellant settling)'); }
    else if (ul === 'rcs' && nxt.rcsGas > 0) { nxt.settled = 6; this.ullageThrust = { until: this.t + 6, accel: Math.min(0.02 * G0, 2 * nxt.rcs.thrust / Math.max(this._massProps().mass, 1)), rcs: true }; this.log('RCS settling burn'); }
    this.massNow = this._massProps();
    return true;
  }

  _spawnDebris(st, mass, name) {
    this.debris.push({ name, x: st.x, y: st.y, vx: st.vx, vy: st.vy, mass, CdA: 0.5 * this.Sref * 4, alive: true });
  }

  // ---------- guidance ----------
  _local(st) {
    const r = Math.hypot(st.x, st.y);
    const ux = st.x / r, uy = st.y / r;
    const hx = uy, hy = -ux; // downrange (clockwise) horizontal
    return { r, ux, uy, hx, hy, alt: r - RE };
  }
  _pitchToPsi(gamma, L) { return Math.atan2(Math.cos(gamma) * L.hy + Math.sin(gamma) * L.uy, Math.cos(gamma) * L.hx + Math.sin(gamma) * L.ux); }

  _guidance(st, L, vrel, thrusting) {
    const P = this.prog;
    // navigated state (with sensor errors)
    const nx = st.x + this.nav.dx, ny = st.y + this.nav.dy, nvx = st.vx + this.nav.dvx, nvy = st.vy + this.nav.dvy;
    const Ln = this._local({ x: nx, y: ny });
    const vr = nvx * Ln.ux + nvy * Ln.uy, vh = nvx * Ln.hx + nvy * Ln.hy;
    const g = this.guid;
    const vrelH = vrel.x * L.hx + vrel.y * L.hy, vrelR = vrel.x * L.ux + vrel.y * L.uy;
    const fpaRel = Math.atan2(vrelR, vrelH);
    if (!this.computerOK) return this.guid.lastPsi ?? st.psi;
    let psi;
    if (P.mode === 'suborbital' && !this.guided) return st.psi;
    if (g.mode === 'vertical') {
      psi = this._pitchToPsi(Math.PI / 2, L);
      if (L.alt - (this.site.elev || 0) > 100 && Math.hypot(vrel.x, vrel.y) > (P.kickSpeed ?? 50)) { g.mode = 'kick'; g.kickStart = this.t; this.log(`Pitch kick ${P.kickAngle}° at ${Math.hypot(vrel.x, vrel.y).toFixed(0)} m/s`); }
    }
    if (g.mode === 'kick') {
      const f = clamp((this.t - g.kickStart) / 6, 0, 1);
      psi = this._pitchToPsi(Math.PI / 2 - (P.kickAngle || 2) * DEG * f, L);
      if (f >= 1 && Math.abs(wrap(Math.atan2(vrel.y, vrel.x) - psi)) < 0.5 * DEG) { g.mode = 'gravityTurn'; this.log('Gravity turn'); }
      if (f >= 1 && this.t - g.kickStart > 20) { g.mode = 'gravityTurn'; this.log('Gravity turn'); }
    }
    if (g.mode === 'gravityTurn') {
      psi = Math.atan2(vrel.y, vrel.x); // zero angle of attack w.r.t. Earth-relative velocity
      if (P.mode === 'orbit' && this.stageIdx === this.n - 1) { g.mode = 'closedLoop'; this.log('Closed-loop guidance (linear-tangent steering)'); }
    }
    if (g.mode === 'closedLoop' || g.mode === 'raise' || g.mode === 'circ') {
      const S = this.stages[this.stageIdx];
      const m = this.massNow.mass;
      const th = thrusting ? thrusting : { F: S.e ? S.e.FvacTotal * S.count : 1, mdot: S.e ? S.e.mdotTotal * S.count : 0.01 };
      if (g.mode === 'closedLoop') {
        const rT = RE + (P.insertion === 'parking' ? P.parkingAlt : P.targetAlt);
        if (this.t - g.lastSolve > 0.5 || g.A === null) {
          const sol = ltsSolve({ r: Ln.r, vr, vh, m, F: th.F || 1, mdot: th.mdot || 0.01, rT, A: g.A, B: g.B, propLeft: this._propLeft(S) });
          if (sol) { g.A = sol.A; g.B = sol.B; g.t0 = this.t; g.tgo = sol.tgo; }
          g.lastSolve = this.t;
        }
        const tau = this.t - (g.t0 ?? this.t);
        const gam = Math.atan(g.A - g.B * tau);
        psi = this._pitchToPsi(clamp(gam, -0.6, 1.2), Ln);
      } else {
        psi = Math.atan2(nvy, nvx); // prograde (inertial)
      }
    }
    if (g.mode === 'coast' || g.mode === 'done') psi = Math.atan2(nvy, nvx);
    g.lastPsi = psi;
    return psi - this.nav.dpsi;
  }

  _propLeft(S) {
    if (!S) return 0;
    if (S.kind === 'liquid') return Math.max(0, Math.min(S.ox - 0.006 * S.ox0, (S.fu - 0.006 * S.fu0) * S.of) * (1 + 1 / S.of));
    return Math.max(0, S.prop0 - S.burned);
  }

  // ---------- dynamics ----------
  _forces(st, ctx) {
    const L = this._local(st);
    const atm = atmosphere(L.alt);
    // air velocity: co-rotating atmosphere + wind along local horizontal
    const wind = (this.wx ? windComponents(Math.max(0, L.alt), this.wx, this.az).along : 0) + this.turb;
    const vax = this.omegaP * st.y + wind * L.hx, vay = -this.omegaP * st.x + wind * L.hy;
    const vrx = st.vx - vax, vry = st.vy - vay;
    const V = Math.hypot(vrx, vry);
    const bx = Math.cos(st.psi), by = Math.sin(st.psi);
    const r3 = L.r * L.r * L.r;
    let ax = -MU * st.x / r3, ay = -MU * st.y / r3;
    let torque = 0;
    const m = ctx.mass, I = ctx.I, cg = ctx.cg;
    const q = 0.5 * atm.rho * V * V;
    const M = V / atm.a;
    let alpha = 0, N = 0, D = 0, xcp = cg, cna = 0;
    if (this.chute || this.capsule) {
      const Dc = q * (this.chute ? this.chute.CdA : 0) + q * (this.capsule ? this.capsule.CdA : this.Sref * 0.8);
      if (V > 0) { ax -= Dc / m * vrx / V; ay -= Dc / m * vry / V; }
      return { ax, ay, alpha: 0, torque: 0, q, M, V, atm, L, D: Dc, N: 0, xcp, wind, vrx, vry };
    }
    if (V > 0.5 && atm.rho > 1e-12) {
      const ux = vrx / V, uy = vry / V;
      alpha = Math.atan2(ux * by - uy * bx, ux * bx + uy * by);
      const cp = cpAnalysis(this.elems, this.dRef, M, alpha);
      cna = cp.cna; xcp = cp.xcp;
      const cd = cdMach(M, { ...this.cdCfg, powerOn: ctx.F > 0 }) * (1 + 0.5 * Math.min(1, Math.abs(alpha)));
      D = q * this.Sref * cd;
      N = q * this.Sref * cna * Math.sin(alpha) * Math.cos(alpha);
      ax -= D / m * ux; ay -= D / m * uy;
      // normal force: along crossflow (−v_rel component ⟂ body)
      const vb = vrx * bx + vry * by;
      let wx = -(vrx - vb * bx), wy = -(vry - vb * by);
      const wl = Math.hypot(wx, wy);
      if (wl > 1e-9) { wx /= wl; wy /= wl; ax += Math.abs(N) / m * wx; ay += Math.abs(N) / m * wy; }
      const rcp = cg - xcp; // CP position relative to CG along +b
      torque += rcp * (bx * Math.abs(N) * wy - by * Math.abs(N) * wx);
      // aerodynamic pitch damping (Barrowman) + fin misalignment
      let damp = 0;
      for (const e of this.elems) {
        if (e.type === 'fins' && !e.lost) { const xf = e.x + e.Cr * 0.5; damp += 0.5 * atm.rho * V * this.Sref * 4 * e.n * (e.span / this.dRef) ** 2 * (xf - cg) ** 2; }
        if (e.type === 'nose') damp += 0.5 * atm.rho * V * this.Sref * 2 * (e.x + e.L * 0.5 - cg) ** 2 * 0.2;
      }
      torque -= damp * st.w;
      const mis = this.hz('finMisalign');
      if (mis && !this.finsLost) torque += q * this.Sref * 0.5 * mis.deg * DEG * (cg - (this.finElems[0]?.x ?? cg));
    }
    // thrust
    if (ctx.F > 0) {
      const d = st.psi + ctx.gimbal + ctx.thrustMis;
      ax += ctx.F / m * Math.cos(d); ay += ctx.F / m * Math.sin(d);
      torque += (cg - ctx.gimbalX) * ctx.F * Math.sin(ctx.gimbal + ctx.thrustMis);
      torque -= ctx.mdot * (ctx.exitX - cg) ** 2 * st.w; // jet damping
    }
    if (ctx.ullage) { ax += ctx.ullage * bx; ay += ctx.ullage * by; }
    torque += ctx.rcsTorque || 0;
    return { ax, ay, alpha, torque, q, M, V, atm, L, D, N, xcp, cna, wind, vrx, vry, Iang: torque / I };
  }

  _deriv(st, ctx) {
    const f = this._forces(st, ctx);
    return { dx: st.vx, dy: st.vy, dvx: f.ax, dvy: f.ay, dpsi: st.w, dw: f.torque / ctx.I, f };
  }

  // One integration step
  step(dt) {
    if (this.phase === 'destroyed' || this.phase === 'landed' || this.phase === 'done') return;
    const st = this.state;
    if (this.massTimer <= 0) { this.massNow = this.capsule ? { mass: this.capsule.mass, cg: 0, I: 1 } : this._massProps(); this.massTimer = 0.05; }
    this.massTimer -= dt;
    const S = this.stages[this.stageIdx];
    const L0 = this._local(st);
    const atm0 = atmosphere(L0.alt);
    const pa = atm0.P;
    // ---- pad / hold-down ----
    if (this.phase === 'pad') {
      this.phase = 'hold';
      this.holdT = this.t;
      if (S.kind === 'liquid') this._ignite(S); else this._ignite(S);
      if (!S.lit) { if (this.phase === 'destroyed') { this.phase = 'done'; return; } this.out.result = this.out.result || 'padAbort'; this.phase = 'done'; this.log('Launch abort on pad: ignition failure. Vehicle safed.', 'fail'); return; }
    }
    let th = this._thrust(S, pa);
    if (this.phase === 'hold') {
      const W = this.massNow.mass * G0;
      const ready = S.kind === 'solid' || (th.frac >= 0.999 && this.t - this.holdT > S.e.startTime + 0.5);
      if (ready) {
        if (th.F < W * 1.02) {
          if (S.kind === 'liquid') { this._shutdown(S, 'insufficient thrust at hold-down'); this.out.result = 'padAbort'; this.phase = 'done'; this.log('Hold-down abort: thrust below vehicle weight. Engines safed.', 'fail'); return; }
          if (th.F < W) { this.t += dt; this._pinToPad(); if (this.t - this.holdT > 3) { this.fail('Vehicle never left the pad (thrust < weight) — burned in place', 'Design: liftoff thrust-to-weight below 1', true); } return; }
        }
        if (S.kind === 'liquid' && S.engines.some(e => !e.alive)) { this._shutdown(S, 'engine anomaly at hold-down'); this.out.result = 'padAbort'; this.phase = 'done'; this.log('Hold-down abort: engine-out detected before release.', 'fail'); return; }
        this.phase = this.guided ? 'ascent' : (this.prog.railLength > 0 ? 'rail' : 'ascent');
        this._pinToPad();
        this.t0 = this.t;
        this.log('LIFTOFF', 'success');
      } else { this.t += dt; this._pinToPad(); this._recordTlm(dt, null, th); return; }
    }
    // ---- events before integration ----
    this._events(dt, th);
    if (this.phase === 'destroyed' || this.phase === 'done' || this.phase === 'landed') return;
    th = this._thrust(this.stages[this.stageIdx], pa);
    const Sc = this.stages[this.stageIdx];
    // ---- guidance & control ----
    const vrelGuess = { x: st.vx - this.omegaP * st.y, y: st.vy + this.omegaP * st.x };
    let psiCmd = this.guided ? this._guidance(st, L0, vrelGuess, th.F > 0 ? th : null) : null;
    let gimbalCmd = 0, rcsTorque = 0;
    const mp = this.massNow;
    if (psiCmd !== null && this.computerOK) {
      const e = wrap(psiCmd - st.psi);
      const tvcOK = th.F > 0 && Sc.gimbalMax > 0;
      if (tvcOK) {
        const Lg = Math.max(0.05, Sc.gimbalX - mp.cg);
        const auth = Lg * th.F * Math.sin(Sc.gimbalMax);
        const wn = clamp(1.2 * Math.sqrt(auth / mp.I), 1.0, 8), z = 0.75;
        const fa = this._lastAeroTorque || 0;
        this.ctrlInt = clamp((this.ctrlInt || 0) + e * dt, -0.15, 0.15);
        const tauReq = mp.I * (wn * wn * e + 0.25 * wn * wn * wn * this.ctrlInt - 2 * z * wn * st.w) - fa;
        gimbalCmd = Math.asin(clamp(-tauReq / (Lg * th.F), -1, 1));
        gimbalCmd = clamp(gimbalCmd, -Sc.gimbalMax, Sc.gimbalMax);
      } else if (Sc.rcs && Sc.rcsGas > 0 && atm0.rho < 1e-4) {
        const arm = this.dRef / 2 + 0.5;
        const tmax = 2 * Sc.rcs.thrust * arm;
        const want = mp.I * (0.4 * e - 1.2 * st.w);
        rcsTorque = clamp(want, -tmax, tmax);
        Sc.rcsGas = Math.max(0, Sc.rcsGas - Math.abs(rcsTorque) / arm / (Sc.rcs.isp * G0) * dt);
      }
    }
    const rate = (Sc.actRate || 10 * DEG) * dt;
    this.gimbal += clamp(gimbalCmd - this.gimbal, -rate, rate);
    if (!(th.F > 0)) this.gimbal = 0;
    const ull = this.ullageThrust && this.t < this.ullageThrust.until ? this.ullageThrust.accel : 0;
    if (this.ullageThrust?.rcs && ull) { Sc.rcsGas = Math.max(0, Sc.rcsGas - 2 * Sc.rcs.thrust / (Sc.rcs.isp * G0) * dt); }
    if (!this.thrustMis) this.thrustMis = this.rng.gauss(0, 0.08) * DEG;
    const ctx = { mass: mp.mass, I: mp.I, cg: mp.cg, F: th.F, mdot: th.mdot, gimbal: this.gimbal, thrustMis: th.F > 0 ? this.thrustMis : 0, gimbalX: Sc.gimbalX ?? mp.cg + 1, exitX: Sc.exitX ?? mp.cg + 1, ullage: ull, rcsTorque };
    // ---- integrate ----
    if (this.phase === 'rail') {
      // constrained to launch rail: only translation along rail
      const f = this._forces(st, ctx);
      const bx = Math.cos(st.psi), by = Math.sin(st.psi);
      const a = Math.max(0, f.ax * bx + f.ay * by);
      const vb = (st.vx - this.omegaP * st.y) * bx + (st.vy + this.omegaP * st.x) * by;
      const vn = vb + a * dt;
      st.vx = this.omegaP * st.y + vn * bx; st.vy = -this.omegaP * st.x + vn * by;
      st.x += st.vx * dt; st.y += st.vy * dt;
      this.railTravel = (this.railTravel || 0) + vn * dt;
      if (this.railTravel >= this.prog.railLength) { this.phase = 'ascent'; this.out.railExit = vn; this.log(`Rail exit at ${vn.toFixed(1)} m/s${vn < 15 ? ' — slow: weathercocking risk' : ''}`, vn < 15 ? 'warn' : 'info'); }
      this._lastF = f;
    } else {
      const k1 = this._deriv(st, ctx);
      const s2 = { x: st.x + k1.dx * dt / 2, y: st.y + k1.dy * dt / 2, vx: st.vx + k1.dvx * dt / 2, vy: st.vy + k1.dvy * dt / 2, psi: st.psi + k1.dpsi * dt / 2, w: st.w + k1.dw * dt / 2 };
      const k2 = this._deriv(s2, ctx);
      const s3 = { x: st.x + k2.dx * dt / 2, y: st.y + k2.dy * dt / 2, vx: st.vx + k2.dvx * dt / 2, vy: st.vy + k2.dvy * dt / 2, psi: st.psi + k2.dpsi * dt / 2, w: st.w + k2.dw * dt / 2 };
      const k3 = this._deriv(s3, ctx);
      const s4 = { x: st.x + k3.dx * dt, y: st.y + k3.dy * dt, vx: st.vx + k3.dvx * dt, vy: st.vy + k3.dvy * dt, psi: st.psi + k3.dpsi * dt, w: st.w + k3.dw * dt };
      const k4 = this._deriv(s4, ctx);
      st.x += dt / 6 * (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx);
      st.y += dt / 6 * (k1.dy + 2 * k2.dy + 2 * k3.dy + k4.dy);
      st.vx += dt / 6 * (k1.dvx + 2 * k2.dvx + 2 * k3.dvx + k4.dvx);
      st.vy += dt / 6 * (k1.dvy + 2 * k2.dvy + 2 * k3.dvy + k4.dvy);
      st.psi += dt / 6 * (k1.dpsi + 2 * k2.dpsi + 2 * k3.dpsi + k4.dpsi);
      st.w += dt / 6 * (k1.dw + 2 * k2.dw + 2 * k3.dw + k4.dw);
      if (this.chute || this.capsule) { st.psi = Math.atan2(-k1.f.vry, -k1.f.vrx) + Math.PI; st.w = 0; }
      this._lastF = k1.f;
      this._lastAeroTorque = k1.f.torque - (ctx.F > 0 ? (mp.cg - ctx.gimbalX) * ctx.F * Math.sin(ctx.gimbal + ctx.thrustMis) : 0) - (rcsTorque || 0);
    }
    // ---- mass flow ----
    if (th.mdot > 0) {
      if (Sc.kind === 'liquid') { const dm = th.mdot * dt; Sc.ox -= dm * Sc.of / (1 + Sc.of); Sc.fu -= dm / (1 + Sc.of); }
      else if (Sc.kind === 'solid') Sc.burned = Math.min(Sc.prop0, Sc.burned + th.mdot * dt);
    }
    if (Sc.settled > 0) Sc.settled -= dt;
    // ---- turbulence (Gauss–Markov) ----
    const f = this._lastF;
    if (f && f.L.alt < 30000) {
      const tb = turbulence(f.L.alt, this.wx);
      const V = Math.max(f.V, 1);
      const a = V * dt / tb.L;
      this.turb = this.turb * Math.exp(-a) + tb.sigma * Math.sqrt(1 - Math.exp(-2 * a)) * this.rng.gauss();
    } else this.turb *= 0.99;
    // ---- navigation error growth ----
    this._nav(dt, f);
    this.t += dt;
    this._checks(dt, f, th);
    this._recordTlm(dt, f, th);
    this._debrisStep(dt);
  }

  _nav(dt, f) {
    const av = this.av;
    if (!this.guided) return;
    const L = f ? f.L : this._local(this.state);
    const V = Math.hypot(this.state.vx, this.state.vy);
    let gpsOK = av.gps === 'space' || (av.gps === 'consumer' && L.alt < 18000 && V < 515);
    if (av.gps === 'consumer' && !gpsOK && !this.nav.gpsLost) { this.nav.gpsLost = true; this.log('GPS receiver stopped reporting (COCOM altitude/velocity limit) — inertial-only navigation', 'warn'); }
    this.nav.dpsi += (av.drift * DEG / 3600) * dt * (this.nav.sign ??= (this.rng.chance(0.5) ? 1 : -1));
    const ab = av.accelBias * G0 * (this.nav.signA ??= (this.rng.chance(0.5) ? 1 : -1));
    const thrusting = this.stages[this.stageIdx]?.lit;
    if (gpsOK) { this.nav.dx *= 0.98; this.nav.dy *= 0.98; this.nav.dvx *= 0.98; this.nav.dvy *= 0.98; this.nav.dpsi *= 0.999; }
    else {
      const Lh = L;
      const e = thrusting ? 1 : 0.2;
      this.nav.dvx += (ab * e + 9.8 * Math.sin(this.nav.dpsi) * e) * Lh.hx * dt; this.nav.dvy += (ab * e) * Lh.hy * dt;
      this.nav.dx += this.nav.dvx * dt; this.nav.dy += this.nav.dvy * dt;
    }
  }

  _events(dt, th) {
    const S = this.stages[this.stageIdx];
    const st = this.state;
    const L = this._local(st);
    const P = this.prog;
    // engine hazards while running
    if (S && S.lit && S.kind === 'liquid') {
      for (const eng of S.engines) {
        if (!eng.lit || !eng.alive) continue;
        if (eng.failT && this.t >= eng.failT) {
          const hs = this.hz('hotspot', S.idx, eng.k);
          eng.alive = false; eng.lit = false; S.out++;
          if (S.count === 1 || this.rng.chance(0.35)) { this.fail(`Stage ${S.idx + 1} engine ${eng.k + 1} burn-through — uncontained failure`, hs?.cause || 'Chamber wall overheated', true); return; }
          this.log(`Stage ${S.idx + 1} engine ${eng.k + 1} shut down (chamber burn-through)`, 'fail');
          this.out.failures.push({ t: this.t, text: `Engine ${eng.k + 1} burn-through (engine-out)`, cause: hs?.cause });
        }
        for (const h of this.hazards) {
          if (h.spent || h.stage !== S.idx || (h.engine !== undefined && h.engine !== eng.k)) continue;
          if (h.kind === 'engineRate' && this.rng.chance(h.rate * dt)) {
            h.spent = true; eng.alive = false; eng.lit = false; S.out++;
            if (S.count === 1 || this.rng.chance(h.uncontained ?? 0.5)) { this.fail(`Stage ${S.idx + 1} ${h.text}`, h.cause, true); return; }
            this.log(`Stage ${S.idx + 1} engine ${eng.k + 1}: ${h.text} — engine shut down`, 'fail');
            this.out.failures.push({ t: this.t, text: h.text + ' (engine-out)', cause: h.cause });
          }
        }
      }
      if (S.engines.every(e => !e.alive)) { this._shutdown(S, 'failure'); }
    }
    // avionics hazards
    for (const h of this.hazards) {
      if (h.spent || h.kind !== 'avionics') continue;
      if (h.stage !== undefined && h.stage < this.stageIdx) continue;
      const vib = (this.phase === 'ascent' && this.t - (this.t0 || 0) < 10) ? 4 : (this._lastF && this._lastF.q > 15000) ? 3 : S?.lit ? 1.5 : 0.3;
      if (this.rng.chance(h.rate * vib * dt)) {
        h.spent = true;
        if (h.sub === 'computer') { this.computerOK = false; this.fail(`Flight computer reset/failed (${h.text})`, h.cause, false); this.log('Vehicle flying open-loop with frozen gimbal', 'fail'); }
        else if (h.sub === 'telemetry') { this.tlmLost = true; this.log(`Telemetry lost: ${h.text}`, 'warn'); this.out.failures.push({ t: this.t, text: 'Telemetry dropout', cause: h.cause }); }
        else if (h.sub === 'deploy') { this.deployCircuitFail = true; this.out.failures.push({ t: this.t, text: 'Recovery deployment circuit failed', cause: h.cause }); }
        else if (h.sub === 'ignition') { this.ignCircuitFail = true; this.out.failures.push({ t: this.t, text: 'Upper-stage ignition circuit failed', cause: h.cause }); }
      }
    }
    if (this.pendingCato && this.t >= this.pendingCato.t) {
      const ps = this.pendingCato; this.pendingCato = null;
      const gh = this.hazards.find(h => h.kind === 'grain' && h.stage === ps.S.idx);
      this.fail(`Stage ${ps.S.idx + 1} motor case burst (CATO) at Pc ${(ps.S.curve.cato.pc / 1e6).toFixed(1)} MPa`, gh?.cause || 'Chamber pressure exceeded case burst strength', true);
      return;
    }
    // burnout / depletion
    if (S && S.lit) {
      if (S.kind === 'solid' && th.burnout) { S.lit = false; S.done = true; this.log(`Stage ${S.idx + 1} burnout`); this.burnoutT = this.t; }
      if (S.kind === 'liquid' && (S.ox <= 0.006 * S.ox0 || S.fu <= 0.006 * S.fu0)) {
        const which = S.ox <= 0.006 * S.ox0 ? 'oxidizer' : 'fuel';
        this._shutdown(S, `propellant depletion (${which} ran out first; residual ${which === 'oxidizer' ? 'fuel' : 'oxidizer'} ${(which === 'oxidizer' ? S.fu : S.ox).toFixed(1)} kg)`);
        S.done = true; this.burnoutT = this.t;
      }
    }
    // max-G / max-Q throttling (liquid, guided)
    if (S && S.lit && S.kind === 'liquid' && this._lastF) {
      const m = this.massNow.mass;
      const Ffull = S.e.FvacTotal * S.engines.filter(e => e.alive && e.lit).length;
      let thr = 1;
      if (P.maxG && Ffull / m > P.maxG * G0) thr = Math.min(thr, P.maxG * G0 * m / Ffull);
      if (P.maxQ && this._lastF.q > 0.9 * P.maxQ && this._lastF.M < 2.5) thr = Math.min(thr, clamp(1 - 0.5 * (this._lastF.q - 0.9 * P.maxQ) / (0.2 * P.maxQ), 0.6, 1));
      S.throttle = Math.max(S.e.throttleMin, thr);
    }
    // staging logic
    if (S && S.done && !S.lit && this.stageIdx < this.n - 1) {
      if (this.stagingT === undefined) { this.stagingT = this.t + (P.stagingCoast ?? 2); }
      if (this.t >= this.stagingT) {
        this.stagingT = undefined;
        const nxt = this.stages[this.stageIdx + 1];
        const hot = S.interstage?.sep === 'hot';
        const fw = this.hz('firmware', undefined);
        if (fw && fw.event === 'staging' && this.rng.chance(fw.prob)) { fw.spent = true; this.fail('Flight software fault at staging: separation command not issued', fw.cause, true); return; }
        if (!this._separate()) return;
        this.upperIgnT = this.t + (hot ? 0 : (P.ignitionDelay ?? 2) + (nxt.settled > 0 ? 1.5 : 0));
      }
    }
    if (this.upperIgnT !== undefined && this.t >= this.upperIgnT) {
      this.upperIgnT = undefined;
      const Sn = this.stages[this.stageIdx];
      if (this.ignCircuitFail) this.fail(`Stage ${Sn.idx + 1} did not ignite`, 'Ignition circuit failure (avionics workmanship)', false);
      else {
        const ok = this._ignite(Sn, { vacuumStart: L.alt > 30000 || (this._lastF && this._lastF.q < 500) });
        if (!ok && this.phase !== 'destroyed') this.out.failures.push({ t: this.t, text: `Stage ${Sn.idx + 1} failed to ignite`, cause: 'see event log' });
      }
    }
    // orbit insertion / cutoff
    if (P.mode === 'orbit' && S && S.lit && this.stageIdx === this.n - 1) {
      const nx = st.x + this.nav.dx, ny = st.y + this.nav.dy, nvx = st.vx + this.nav.dvx, nvy = st.vy + this.nav.dvy;
      const el = elements(nx, ny, nvx, nvy);
      const g = this.guid;
      if (g.mode === 'closedLoop') {
        const rT = RE + (P.insertion === 'parking' ? P.parkingAlt : P.targetAlt);
        if (el.a >= (RE + (P.insertion === 'parking' ? P.parkingAlt : P.targetAlt) + rT) / 2 && el.E > -MU / (2 * rT) - 1) {
          this._shutdown(S, 'guidance cutoff (target energy reached)'); S.done = false;
          const fw = this.hz('firmware'); if (fw && fw.event === 'cutoff' && this.rng.chance(fw.prob)) { fw.spent = true; this.out.failures.push({ t: this.t, text: 'Software fault: premature cutoff command', cause: fw.cause }); }
          if (P.insertion === 'parking') { g.mode = 'coastToRaise'; g.raiseT = this.t + 30; this.log('Parking orbit — coasting'); }
          else { g.mode = 'done'; this._checkOrbit(); }
        }
      } else if (g.mode === 'raise') {
        const tgt = P.raiseApo ?? P.targetAlt;
        if (el.apoAlt >= tgt) { this._shutdown(S, 'apogee-raise burn complete'); S.done = false; if (P.raiseApo) { g.mode = 'done'; this._checkOrbit(); } else { g.mode = 'coastToApo'; this.log('Coasting to apogee'); } }
      } else if (g.mode === 'circ') {
        if (el.periAlt >= P.targetAlt - 5000 || el.apoAlt > P.targetAlt + 40000) { this._shutdown(S, 'circularization complete'); S.done = false; g.mode = 'done'; this._checkOrbit(); }
      }
    }
    if (P.mode === 'orbit' && this.guid.mode === 'coastToRaise' && this.t >= this.guid.raiseT) {
      const S2 = this.stages[this.stageIdx];
      const el = elements(st.x, st.y, st.vx, st.vy);
      // burn near perigee of parking orbit
      const atPeri = Math.abs(Math.sin(el.nu)) < 0.05 || this.t > this.guid.raiseT + el.period;
      if (atPeri && this._propLeft(S2) > 0) {
        if (S2.rcs && S2.rcsGas > 0) { S2.settled = 4; this.ullageThrust = { until: this.t + 4, accel: Math.min(0.02 * G0, 2 * S2.rcs.thrust / this.massNow.mass), rcs: true }; }
        this.guid.mode = 'raise'; this.raiseIgnT = this.t + 4;
      }
    }
    if (this.raiseIgnT && this.t >= this.raiseIgnT) { this.raiseIgnT = null; const S2 = this.stages[this.stageIdx]; if (!this._ignite(S2, { vacuumStart: true })) this.log('Raise burn failed to start', 'fail'); }
    if (P.mode === 'orbit' && this.guid.mode === 'coastToApo') {
      const el = elements(st.x, st.y, st.vx, st.vy);
      const vr = (st.x * st.vx + st.y * st.vy) / Math.hypot(st.x, st.y);
      if (vr <= 0 && el.ra - Math.hypot(st.x, st.y) < 2000) {
        const S2 = this.stages[this.stageIdx];
        if (S2.rcs && S2.rcsGas > 0) { S2.settled = 4; this.ullageThrust = { until: this.t + 4, accel: Math.min(0.02 * G0, 2 * S2.rcs.thrust / this.massNow.mass), rcs: true }; }
        this.guid.mode = 'circ'; this.circIgnT = this.t + 4;
      }
    }
    if (this.circIgnT && this.t >= this.circIgnT) { this.circIgnT = null; const S2 = this.stages[this.stageIdx]; if (!this._ignite(S2, { vacuumStart: true })) this.log('Circularization burn failed to start', 'fail'); }
    // top-stage burnout in orbital mode without reaching orbit
    const Stop = this.stages[this.stageIdx];
    if (P.mode === 'orbit' && this.stageIdx === this.n - 1 && Stop.done && !Stop.lit && this.guid.mode !== 'done' && !this.out.result) {
      const el = elements(st.x, st.y, st.vx, st.vy);
      if (el.periAlt > 120000) { this.guid.mode = 'done'; this._checkOrbit(); }
      else if (!this._subOrbitLogged) { this._subOrbitLogged = true; this.log(`Upper stage depleted before orbit (perigee ${(el.periAlt / 1000).toFixed(0)} km) — suborbital`, 'fail'); this.out.failures.push({ t: this.t, text: 'Insufficient Δv: propellant depleted before orbital velocity', cause: 'Vehicle performance shortfall (mass, Isp, or losses)' }); }
    }
    // fairing jettison
    if (this.fairingOn && this._lastF && L.alt > 70000 && fmHeating(this._lastF.atm.rho, this._lastF.V) < 1135) {
      const ff = this.hz('fairingFail');
      if (ff && this.rng.chance(ff.prob)) { ff.spent = true; this.out.failures.push({ t: this.t, text: 'Fairing failed to separate (vehicle carrying dead weight)', cause: ff.cause }); this.log('FAIRING SEPARATION FAILURE', 'fail'); this.fairingOn = false; this.fairingStuck = true; }
      else {
        const fr = this.placed.find(p => p.type === 'fairing');
        this.fairingOn = false; this._configChanged();
        this._spawnDebris(st, fr.r.jettisonMass, 'Fairing halves');
        this.log(`Fairing jettison (free-molecular heating ${fmHeating(this._lastF.atm.rho, this._lastF.V).toFixed(0)} W/m²)`);
      }
    }
    // recovery sequence
    this._recoveryLogic(L);
  }

  _recoveryLogic(L) {
    const rec = this.recovery;
    const top = this.stages[this.n - 1];
    if (!rec || this.prog.mode === 'orbit') return;
    if (this.stageIdx < rec.stage) return;
    if (top.lit) return;
    const st = this.state;
    const vr = (st.x * st.vx + st.y * st.vy) / Math.hypot(st.x, st.y);
    const f = this._lastF;
    if (!f) return;
    const agl = L.alt - (this.site.elev || 0);
    if (rec.sepApogee && !this.capsule && vr < 0 && this.out.apogee > 1500) {
      const top = this.placed.filter(p => p.stage === this.n - 1 && p.len > 0).sort((a, b) => a.x0 - b.x0);
      const cut = top.find(p => ['tank', 'solidMotor', 'liquidEngine', 'interstage'].includes(p.type));
      const fwd = top.filter(p => !cut || p.x0 < cut.x0);
      const mass = fwd.reduce((s, p) => s + (p.r.dryMass || 0), 0) + this.placed.filter(p => p.stage === this.n - 1 && p.len === 0 && p.type === 'avionics').reduce((s, p) => s + p.r.dryMass, 0);
      const Lc = fwd.reduce((s, p) => s + p.len, 0);
      const D = this.dRef;
      this._spawnDebris(this.state, Math.max(1, (this.massNow?.mass || mass) - mass), 'Spent booster');
      this.capsule = { mass, CdA: 0.9 * D * Lc * 0.7 + 0.3 * Math.PI * D * D / 4 };
      this.massTimer = -1;
      this.log(`Payload section separated at apogee (${(L.alt / 1000).toFixed(1)} km), ${mass.toFixed(1)} kg, tumbling re-entry`);
    }
    const drogueTrigger = this.out.apogee < 25000 ? true : (L.alt < 20000 && f.q < 0.85 * rec.qMaxDrogue) || L.alt < 5000;
    if (!rec.drogueOut && vr < 0 && rec.drogueArea > 0 && drogueTrigger) {
      rec.drogueOut = true;
      if (this.deployCircuitFail) { this.log('Drogue did not deploy (deployment circuit failure)', 'fail'); return; }
      const fw = this.hz('firmware'); if (fw && fw.event === 'deploy' && this.rng.chance(fw.prob)) { fw.spent = true; this.log('Software fault: drogue deploy command missed', 'fail'); this.out.failures.push({ t: this.t, text: 'Drogue not commanded', cause: fw.cause }); return; }
      const ch = this.hz('chuteFail', undefined); const chD = this.hazards.find(h => h.kind === 'chuteFail' && h.which === 'drogue' && !h.spent);
      if (chD && this.rng.chance(chD.prob)) { chD.spent = true; this.log('Drogue tangled / failed to inflate', 'fail'); this.out.failures.push({ t: this.t, text: 'Drogue failed to inflate', cause: chD.cause }); return; }
      if (f.q > rec.qMaxDrogue) { this.log(`Drogue deployed at q = ${(f.q / 1000).toFixed(1)} kPa (limit ${(rec.qMaxDrogue / 1000).toFixed(1)}) — canopy shredded`, 'fail'); this.out.failures.push({ t: this.t, text: 'Drogue shredded at deployment', cause: 'Deployed above rated dynamic pressure' }); return; }
      this.chute = { CdA: 0.8 * rec.drogueArea, kind: 'drogue' };
      this.log(`Drogue deployed (${(L.alt / 1000).toFixed(2)} km, q ${(f.q).toFixed(0)} Pa)`);
    }
    if (!rec.mainOut && vr < 0 && agl < rec.mainAlt) {
      rec.mainOut = true;
      if (this.deployCircuitFail) { this.log('Main did not deploy (deployment circuit failure)', 'fail'); return; }
      const chM = this.hazards.find(h => h.kind === 'chuteFail' && h.which === 'main' && !h.spent);
      if (chM && this.rng.chance(chM.prob)) { chM.spent = true; this.log('Main parachute failed to inflate (packing error)', 'fail'); this.out.failures.push({ t: this.t, text: 'Main parachute failed to inflate', cause: chM.cause }); return; }
      if (this.rng.chance(0.004)) { this.log('Main parachute streamered (random)', 'fail'); return; }
      if (f.q > rec.qMaxMain) { this.log(`Main deployed at q = ${(f.q).toFixed(0)} Pa (limit ${rec.qMaxMain}) — canopy torn`, 'fail'); this.out.failures.push({ t: this.t, text: 'Main torn at deployment', cause: 'Deployed too fast (no drogue / drogue too small)' }); return; }
      this.chute = { CdA: 1.5 * rec.mainArea + (this.chute ? 0.3 * this.chute.CdA : 0), kind: 'main' };
      this.log(`Main deployed (${agl.toFixed(0)} m AGL)`);
    }
  }

  _checkOrbit() {
    const st = this.state;
    const el = elements(st.x, st.y, st.vx, st.vy);
    this.out.orbit = { periAlt: el.periAlt, apoAlt: el.apoAlt, a: el.a, e: el.e, period: el.period, incl: this.incl };
    if (el.periAlt > 120000) { this.out.result = this.out.result || 'orbit'; this.log(`ORBIT: ${(el.periAlt / 1000).toFixed(1)} × ${(el.apoAlt / 1000).toFixed(1)} km, i = ${this.incl.toFixed(2)}°, period ${(el.period / 60).toFixed(1)} min`, 'success'); }
    else { this.log(`Insertion short: perigee ${(el.periAlt / 1000).toFixed(0)} km — vehicle will re-enter`, 'fail'); }
    this.phase = this.phase === 'destroyed' ? 'destroyed' : 'coastOrbit';
  }

  _checks(dt, f, th) {
    if (!f) return;
    const st = this.state;
    const L = f.L;
    const o = this.out;
    const agl = L.alt - (this.site.elev || 0);
    o.apogee = Math.max(o.apogee, agl);
    o.maxMach = Math.max(o.maxMach, f.M || 0);
    o.maxQ = Math.max(o.maxQ, f.q || 0);
    o.maxV = Math.max(o.maxV, Math.hypot(st.vx, st.vy));
    const sensed = th.F > 0 ? (th.F - f.D) / this.massNow.mass : f.D / this.massNow.mass;
    o.maxG = Math.max(o.maxG, Math.abs(sensed) / G0);
    o.downrange = Math.atan2(st.x, st.y) * RE - this.omegaP * this.t * RE;
    if (this.phase === 'destroyed' || this.chute) { this._groundCheck(L, f); return; }
    if (f.q > 500 && this.massNow && (st.x * st.vx + st.y * st.vy) > 0) { const mg = (f.xcp - this.massNow.cg) / this.dRef; if (mg < (o.minMargin ?? 99)) { o.minMargin = mg; o.minMarginMach = f.M; } }
    // structural: q·α bending + axial + tank pressure
    if (f.q > 200 && this.phase !== 'rail') {
      const m = this.massNow;
      const axial = th.F > 0 ? th.F : 0;
      const Nn = Math.abs(f.N);
      let massAbove = 0, idx = 0;
      const items = this.massItems || [];
      for (const sec of this.structSections) {
        const xs = sec.x0 + sec.len;
        while (idx < items.length && items[idx].x < xs) { massAbove += items[idx].m; idx++; }
        const aAx = (th.F - f.D) / m.mass;
        const Nax = massAbove * aAx + f.D * (th.F > 0 ? 1 : 0.5);
        const Mb = Nn * Math.abs(xs - f.xcp) * 0.5;
        const R = (sec.d || this.dRef) / 2;
        const Neq = Math.max(0, Nax) + 2 * Mb / R;
        let cap = sec.r.capacity || sec.r.tank?.axialCap || sec.r.interstage?.capacity || (sec.r.motor ? 2 * Math.PI * R * 0.002 * 2e8 : 0);
        if (!cap) continue;
        const hz = this.hazards.find(h => h.kind === 'strength' && h.comp === sec.id);
        if (hz) cap *= hz.factor;
        if (Neq > cap * 1.1) {
          this.fail(`Structural failure of ${sec.r.tank ? 'tank' : sec.type} (stage ${sec.stage + 1}) — load ${(Neq / 1000).toFixed(0)} kN > capacity ${(cap / 1000).toFixed(0)} kN at q=${(f.q / 1000).toFixed(1)} kPa, α=${(f.alpha / DEG).toFixed(1)}°`, hz ? hz.cause : (Math.abs(f.alpha) > 5 * DEG ? 'Excessive angle of attack at high dynamic pressure (q·α)' : 'Design: structure undersized for flight loads'), true);
          return;
        }
      }
    }
    // tank burst (ullage + head)
    const S = this.stages[this.stageIdx];
    if (S && S.kind === 'liquid' && S.lit) {
      const aAx = Math.max(0, (th.F - f.D) / this.massNow.mass);
      for (const p of this.placed) {
        if (p.stage !== S.idx || !p.r.tank) continue;
        const tk = p.r.tank;
        const fill = tk.role === 'ox' ? S.ox / S.ox0 : S.fu / S.fu0;
        const pr = tk.meop + tk.rho * aAx * (tk.barrelLength + tk.domeH) * fill;
        let burst = tk.burst * 1.12; // actual mean strength above A-basis allowable
        const hz = this.hazards.find(h => h.kind === 'strength' && h.comp === p.id);
        if (hz) burst *= hz.factor;
        if (pr > burst) { this.fail(`${tk.role === 'ox' ? 'Oxidizer' : 'Fuel'} tank (stage ${S.idx + 1}) ruptured at ${(pr / 1e6).toFixed(2)} MPa`, hz ? hz.cause : 'Tank wall too thin for operating pressure + acceleration head', true); return; }
      }
    }
    // fin flutter
    if (!this.finsLost && this.finElems.length && f.V > 50) {
      const fe = this.finElems[0];
      const vf = finFlutterSpeed({ G: fe.G, Cr: fe.Cr, Ct: fe.Ct, span: fe.span, t: fe.thk }, f.atm);
      o.flutterMargin = Math.min(o.flutterMargin ?? 99, vf / f.V);
      if (f.V > vf) {
        this.finsLost = true; this._configChanged();
        this.fail(`Fin flutter at ${f.V.toFixed(0)} m/s (flutter boundary ${vf.toFixed(0)} m/s at ${(L.alt / 1000).toFixed(1)} km) — fins torn off`, 'Design: fins too thin / too flexible for the flight speed', false);
      }
    }
    // nose / fairing stagnation heating (lumped heat-sink tip with radiative cooling)
    const noseP = this.placed.find(p => (p.type === 'nosecone' || (p.type === 'fairing' && this.fairingOn)) && p.stage >= this.stageIdx);
    if (noseP && f.atm.rho > 1e-9) {
      const h = noseP.r.heat;
      const T0 = f.atm.T * (1 + 0.2 * f.M * f.M);
      const qs = suttonGraves(f.atm.rho, f.V, h.tipR) * Math.max(0, 1 - this.tipT / T0); // hot-wall correction
      const qr = 0.8 * SIGMA_SB * this.tipT ** 4;
      this.tipT += (qs - qr) * dt / Math.max(h.tipMassPerArea, 1);
      o.maxTipT = Math.max(o.maxTipT || 0, this.tipT);
      if (this.tipT > h.tipMax && !this.noseFailed) {
        this.noseFailed = true;
        this.fail(`Nose ${noseP.type === 'fairing' ? 'fairing' : 'cone'} overheated (${this.tipT.toFixed(0)} K > ${h.tipMax} K) and failed`, 'Aerodynamic heating: tip material/radius inadequate for the speed at this altitude', true);
        return;
      }
    }
    // loss of control / tumbling
    if (Math.abs(st.w) > 60 * DEG && f.q > 3000) {
      this.fail(`Vehicle tumbling (${(st.w / DEG).toFixed(0)}°/s at q=${(f.q / 1000).toFixed(1)} kPa) — aerodynamic breakup`, this.finsLost ? 'Lost fins → aerodynamically unstable' : !this.computerOK ? 'Loss of guidance/control' : 'Insufficient control authority or negative static margin', true);
      return;
    }
    // range safety (IIP)
    if (S && S.lit && this.t - this.lastIIP > 0.5 && this.phase !== 'rail') {
      this.lastIIP = this.t;
      const theta0 = 0;
      const ip = iip(st.x, st.y, st.vx, st.vy, this.omegaP, theta0);
      if (ip) {
        o.iip = ip.angle * RE;
        const lim = this.site.impactLimit ?? Infinity;
        if (o.iip < -(this.site.uprangeLimit ?? 2000) || o.iip > lim || (Math.abs(f.alpha) > 35 * DEG && f.q > 2000)) {
          if (this.av.fts) {
            const ft = this.hz('ftsFail');
            if (ft && this.rng.chance(ft.prob)) { ft.spent = true; this.log('RANGE SAFETY: destruct commanded — FTS DID NOT FUNCTION', 'fail'); this.out.rangeViolation = true; }
            else { this.fail(`Range safety officer commanded flight termination (IIP ${(o.iip / 1000).toFixed(1)} km — outside corridor)`, 'Trajectory left the range safety corridor', true); return; }
          } else if (!this.out.rangeViolation) { this.out.rangeViolation = true; this.log('RANGE SAFETY VIOLATION: impact point outside range limits and no flight termination system', 'fail'); }
        }
      }
    }
    this._groundCheck(L, f);
  }

  _groundCheck(L, f) {
    const st = this.state;
    const agl = L.alt - (this.site.elev || 0);
    if (agl <= 0 && this.t - (this.t0 || 0) > 1) {
      const v = Math.hypot(f.vrx, f.vry);
      this.out.landingSpeed = v;
      this.out.flightTime = this.t - (this.t0 || 0);
      if (this.phase === 'destroyed') { this.phase = 'done'; return; }
      if (this.chute && v < 9) { this.out.result = this.out.result || 'recovered'; this.log(`Touchdown at ${v.toFixed(1)} m/s — payload recovered`, 'success'); }
      else if (this.chute && v < 15) { this.out.result = this.out.result || 'damaged'; this.log(`Hard landing at ${v.toFixed(1)} m/s — payload damaged`, 'warn'); }
      else { this.out.result = this.out.result || 'impact'; this.log(`Ground impact at ${v.toFixed(0)} m/s`, 'fail'); }
      this.phase = 'landed';
    }
  }

  _debrisStep(dt) {
    for (const d of this.debris) {
      if (!d.alive) continue;
      const r = Math.hypot(d.x, d.y);
      if (r < RE) { d.alive = false; continue; }
      const atm = atmosphere(r - RE);
      const vax = this.omegaP * d.y, vay = -this.omegaP * d.x;
      const vrx = d.vx - vax, vry = d.vy - vay, V = Math.hypot(vrx, vry);
      const k = 0.5 * atm.rho * V * d.CdA / d.mass;
      d.vx += (-MU * d.x / r ** 3 - k * vrx) * dt; d.vy += (-MU * d.y / r ** 3 - k * vry) * dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
    }
  }

  _recordTlm(dt, f, th) {
    this.tlmTimer -= dt;
    if (this.tlmTimer > 0) return;
    this.tlmTimer = this.tlm.length < 600 ? 0.1 : 0.5;
    const st = this.state;
    const L = this._local(st);
    const el = elements(st.x, st.y, st.vx, st.vy);
    const vr = (st.x * st.vx + st.y * st.vy) / L.r;
    const V = f ? f.V : 0;
    const range = Math.hypot(Math.atan2(st.x, st.y) * RE - this.omegaP * this.t * RE, L.alt);
    const dropout = this.tlmLost || range > this.av.tlmRange;
    this.tlm.push({
      t: this.t - (this.t0 ?? this.t), alt: L.alt - (this.site.elev || 0), v: Math.hypot(st.vx, st.vy), vrel: V, vr, mach: f ? f.M : 0, q: f ? f.q : 0,
      acc: f ? ((th?.F || 0) - (f.D || 0)) / (this.massNow?.mass || 1) / G0 : 0, F: th?.F || 0, mass: this.massNow?.mass || 0, alpha: f ? f.alpha / DEG : 0,
      pitch: Math.atan2(Math.cos(st.psi) * L.ux + Math.sin(st.psi) * L.uy, Math.cos(st.psi) * L.hx + Math.sin(st.psi) * L.hy) / DEG,
      gimbal: this.gimbal / DEG, pc: th?.pc || 0, peri: el.periAlt, apo: el.apoAlt, down: Math.atan2(st.x, st.y) * RE - this.omegaP * this.t * RE, tipT: this.tipT, dropout,
    });
  }

  advance(simSeconds, maxSteps = 40000) {
    const target = this.t + simSeconds;
    let steps = 0;
    while (this.t < target && steps < maxSteps && !['destroyed', 'landed', 'done'].includes(this.phase)) {
      const f = this._lastF;
      let dt = 0.01;
      if (f) {
        const stiff = Math.sqrt(Math.abs(f.q * this.Sref * (f.cna || 2) * Math.max(0.05, Math.abs((this.massNow?.cg ?? 0) - f.xcp))) / Math.max(this.massNow?.I || 1, 1e-3));
        dt = clamp(0.4 / Math.max(stiff, 0.5), 0.002, 0.02);
        const S = this.stages[this.stageIdx];
        if (!S?.lit && f.atm.rho < 1e-7 && !this.ullageThrust?.until && !this.upperIgnT && !this.raiseIgnT && !this.circIgnT && this.guid.mode !== 'coastToApo' && this.guid.mode !== 'coastToRaise') dt = this.phase === 'coastOrbit' ? 2 : 0.1;
        if (this.chute) dt = 0.05;
      }
      if (this.phase === 'coastOrbit') {
        // analytic coast
        const n = propagate(this.state.x, this.state.y, this.state.vx, this.state.vy, Math.min(10, target - this.t));
        Object.assign(this.state, n);
        this.t += Math.min(10, target - this.t);
        this._recordTlm(10, this._lastF, null);
        steps++;
        continue;
      }
      this.step(Math.min(dt, Math.max(1e-4, target - this.t)));
      steps++;
    }
    if (this.phase === 'coastOrbit' && this.t - (this.t0 || 0) > 2 * 3600) this.phase = 'done';
    return this.phase;
  }

  get finished() { return ['destroyed', 'landed', 'done'].includes(this.phase) || (this.phase === 'coastOrbit' && this.t - this.t0 > 900); }

  summary() {
    const o = this.out;
    if (!o.result) o.result = this.phase === 'coastOrbit' ? 'orbit' : this.phase;
    o.events = this.events;
    o.flightTime = o.flightTime ?? (this.t - (this.t0 || 0));
    return o;
  }
}

// Linear-tangent steering solver: tan γ(τ) = A − B·τ, planar polar dynamics.
// Finds (A,B) so that at cutoff (v_h reaches circular speed at rT) r = rT and v_r = 0.
export function ltsSolve({ r, vr, vh, m, F, mdot, rT, A, B, propLeft }) {
  const vT = Math.sqrt(MU / rT);
  const sim = (A, B) => {
    let R = r, Vr = vr, Vh = vh, M = m, t = 0;
    const tmax = Math.max(1, propLeft / Math.max(mdot, 1e-6));
    const dt = Math.max(0.5, tmax / 200);
    while (t < tmax) {
      const a = F / M;
      const g = Math.atan(A - B * t);
      const dVr = a * Math.sin(g) - MU / (R * R) + Vh * Vh / R;
      const dVh = a * Math.cos(g) - Vr * Vh / R;
      const h = Math.min(dt, tmax - t);
      // stop when reaching target horizontal speed
      if (Vh + dVh * h >= vT) { const frac = (vT - Vh) / Math.max(dVh * h, 1e-9); R += Vr * h * frac; Vr += dVr * h * frac; t += h * frac; return { R, Vr, t, ok: true }; }
      R += Vr * h; Vr += dVr * h; Vh += dVh * h; M -= mdot * h; t += h;
    }
    return { R, Vr, t, ok: false };
  };
  let a = A ?? Math.tan(Math.max(0.02, Math.atan2(vr, vh) + 0.1)), b = B ?? 0.002;
  for (let it = 0; it < 12; it++) {
    const s0 = sim(a, b);
    const e1 = (s0.R - rT) / 1000, e2 = s0.Vr / 10;
    if (Math.abs(e1) < 0.2 && Math.abs(e2) < 0.2) return { A: a, B: b, tgo: s0.t };
    const da = 1e-3, db = 1e-5;
    const sa = sim(a + da, b), sb = sim(a, b + db);
    const J11 = ((sa.R - rT) / 1000 - e1) / da, J12 = ((sb.R - rT) / 1000 - e1) / db;
    const J21 = (sa.Vr / 10 - e2) / da, J22 = (sb.Vr / 10 - e2) / db;
    const det = J11 * J22 - J12 * J21;
    if (Math.abs(det) < 1e-12) break;
    let stepA = (J22 * e1 - J12 * e2) / det, stepB = (-J21 * e1 + J11 * e2) / det;
    const scale = Math.min(1, 0.5 / Math.max(Math.abs(stepA), 1e-9));
    a -= stepA * scale; b -= stepB * scale;
    a = clamp(a, -1, 4); b = clamp(b, -0.05, 0.2);
  }
  return { A: a, B: b, tgo: 0 };
}
