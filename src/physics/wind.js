// Wind model: surface boundary layer (power law), jet stream, stratospheric decay,
// plus Dryden-style first-order Gauss–Markov turbulence evaluated in the sim.
// Wind is resolved into the trajectory plane (component along launch azimuth; + = downrange).
import { DEG } from './constants.js';

export function windSpeedAt(h, wx) {
  const hs = Math.max(h, 2);
  const V1k = wx.surface * Math.pow(1000 / 10, 0.143);
  let v;
  if (hs < 1000) v = wx.surface * Math.pow(hs / 10, 0.143);
  else if (hs < wx.jetAlt) {
    const t = (hs - 1000) / (wx.jetAlt - 1000);
    v = V1k + (wx.jet - V1k) * Math.pow(Math.sin(t * Math.PI / 2), 1.6);
  } else if (hs < 50000) {
    const t = (hs - wx.jetAlt) / 7000;
    v = wx.jet * Math.exp(-t * t) + wx.strato * (1 - Math.exp(-t * t));
  } else if (hs < 90000) v = wx.strato + (wx.meso - wx.strato) * (hs - 50000) / 40000;
  else v = wx.meso * Math.exp(-(hs - 90000) / 20000);
  return v;
}

// Direction the wind blows TOWARD, interpolated between surface and jet direction.
export function windDirAt(h, wx) {
  const t = Math.min(1, Math.max(0, (h - 500) / (wx.jetAlt - 500)));
  return wx.surfaceDirTo + angDiff(wx.jetDirTo, wx.surfaceDirTo) * t;
}
function angDiff(a, b) { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; }

// In-plane (downrange) and crossrange components for a given launch azimuth (deg)
export function windComponents(h, wx, azimuthDeg) {
  const v = windSpeedAt(h, wx);
  const d = (windDirAt(h, wx) - azimuthDeg) * DEG;
  return { along: v * Math.cos(d), cross: v * Math.sin(d), speed: v };
}

// Max wind shear (m/s per km) between 4 and 16 km — the classic upper-level-winds constraint.
export function maxShear(wx, azimuthDeg) {
  let worst = 0, alt = 0;
  for (let h = 4000; h <= 16000; h += 250) {
    const a = windComponents(h, wx, azimuthDeg), b = windComponents(h + 1000, wx, azimuthDeg);
    const s = Math.hypot(b.along - a.along, b.cross - a.cross);
    if (s > worst) { worst = s; alt = h; }
  }
  return { shear: worst, alt };
}

// Turbulence intensity (m/s, 1-sigma) vs altitude; scale length (m)
export function turbulence(h, wx) {
  const sig = h < 1000 ? 0.1 * wx.surface + 0.25 * wx.gust
    : h < 15000 ? 0.8 + 0.06 * wx.jet
      : 0.4 * Math.exp(-(h - 15000) / 8000);
  const L = h < 1000 ? 200 + h * 0.3 : 530;
  return { sigma: sig * wx.turbScale, L };
}
