// Two-body orbital mechanics in the trajectory plane (2D inertial frame, Earth at origin).
// Universal-variable Kepler propagation (Curtis Alg. 3.3/3.4) works for elliptic and hyperbolic paths.
import { MU, RE, DEG } from './constants.js';

export function elements(x, y, vx, vy) {
  const r = Math.hypot(x, y), v2 = vx * vx + vy * vy;
  const h = x * vy - y * vx;
  const E = v2 / 2 - MU / r;
  const a = -MU / (2 * E);
  const rv = x * vx + y * vy;
  const ex = ((v2 - MU / r) * x - rv * vx) / MU;
  const ey = ((v2 - MU / r) * y - rv * vy) / MU;
  const e = Math.hypot(ex, ey);
  const rp = a * (1 - e), ra = e < 1 ? a * (1 + e) : Infinity;
  const period = e < 1 ? 2 * Math.PI * Math.sqrt(a * a * a / MU) : Infinity;
  const argp = Math.atan2(ey, ex);
  let nu = Math.atan2(y, x) - argp;
  if (h < 0) nu = -nu;
  return { a, e, h, E, rp, ra, periAlt: rp - RE, apoAlt: ra - RE, period, argp, nu, r, v: Math.sqrt(v2), retro: h < 0 };
}

function stumpC(z) { return z > 1e-8 ? (1 - Math.cos(Math.sqrt(z))) / z : z < -1e-8 ? (Math.cosh(Math.sqrt(-z)) - 1) / (-z) : 0.5; }
function stumpS(z) {
  if (z > 1e-8) { const s = Math.sqrt(z); return (s - Math.sin(s)) / (s * s * s); }
  if (z < -1e-8) { const s = Math.sqrt(-z); return (Math.sinh(s) - s) / (s * s * s); }
  return 1 / 6;
}

export function propagate(x, y, vx, vy, dt) {
  const r0 = Math.hypot(x, y), v0 = Math.hypot(vx, vy);
  const vr0 = (x * vx + y * vy) / r0;
  const alpha = 2 / r0 - v0 * v0 / MU;
  const sq = Math.sqrt(MU);
  let chi = sq * Math.abs(alpha) * dt;
  if (!isFinite(chi) || chi === 0) chi = sq * dt / r0;
  for (let i = 0; i < 60; i++) {
    const z = alpha * chi * chi;
    const C = stumpC(z), S = stumpS(z);
    const F = r0 * vr0 / sq * chi * chi * C + (1 - alpha * r0) * chi * chi * chi * S + r0 * chi - sq * dt;
    const dF = r0 * vr0 / sq * chi * (1 - alpha * chi * chi * S) + (1 - alpha * r0) * chi * chi * C + r0;
    const step = F / dF;
    chi -= step;
    if (Math.abs(step) < 1e-9) break;
  }
  const z = alpha * chi * chi, C = stumpC(z), S = stumpS(z);
  const f = 1 - chi * chi / r0 * C;
  const g = dt - chi * chi * chi / sq * S;
  const nx = f * x + g * vx, ny = f * y + g * vy;
  const r = Math.hypot(nx, ny);
  const fd = sq / (r * r0) * (alpha * chi * chi * chi * S - chi);
  const gd = 1 - chi * chi / r * C;
  return { x: nx, y: ny, vx: fd * x + gd * vx, vy: fd * y + gd * vy };
}

// Time from current position to reach radius rTarget (descending). Returns null if never.
export function timeToRadius(x, y, vx, vy, rTarget, descending = true) {
  const el = elements(x, y, vx, vy);
  if (el.rp > rTarget) return null;
  // march with propagation (robust, few hundred evaluations max)
  let t = 0, dt = 5, st = { x, y, vx, vy };
  const r0 = Math.hypot(x, y);
  if (r0 < rTarget) return 0;
  for (let i = 0; i < 4000; i++) {
    const n = propagate(st.x, st.y, st.vx, st.vy, dt);
    const r = Math.hypot(n.x, n.y);
    if (r < rTarget) {
      // bisect
      let lo = 0, hi = dt;
      for (let k = 0; k < 40; k++) {
        const m = (lo + hi) / 2;
        const q = propagate(st.x, st.y, st.vx, st.vy, m);
        if (Math.hypot(q.x, q.y) < rTarget) hi = m; else lo = m;
      }
      return t + hi;
    }
    st = n; t += dt;
    dt = Math.min(60, dt * 1.15);
    if (t > el.period * 1.1) return null;
  }
  return null;
}

// Instantaneous impact point: downrange central angle (rad, Earth-fixed) where a vacuum ballistic
// trajectory from the current state meets the surface, accounting for Earth rotation in-plane.
export function iip(x, y, vx, vy, omegaPlane, theta0) {
  const t = timeToRadius(x, y, vx, vy, RE);
  if (t === null) return null;
  const p = propagate(x, y, vx, vy, t);
  const ang = Math.atan2(p.x, p.y); // angle from launch vertical (y-axis), + downrange (clockwise convention)
  return { t, angle: ang - theta0 - omegaPlane * t };
}

// Inclination from launch latitude and azimuth: cos i = cos φ · sin Az
export function inclination(latDeg, azDeg) {
  return Math.acos(Math.max(-1, Math.min(1, Math.cos(latDeg * DEG) * Math.sin(azDeg * DEG)))) / DEG;
}
export function azimuthFor(latDeg, incDeg) {
  const s = Math.cos(incDeg * DEG) / Math.cos(latDeg * DEG);
  if (Math.abs(s) > 1) return null;
  return Math.asin(s) / DEG;
}
export function circularVelocity(alt) { return Math.sqrt(MU / (RE + alt)); }
