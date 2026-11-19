// U.S. Standard Atmosphere 1976.
// 0–86 km: exact layer equations (geopotential altitude, hydrostatic, ideal gas).
// 86–1000 km: tabulated values from the 1976 tables, log-interpolated (thermosphere; drives orbital decay).
import { R_AIR, G0 } from './constants.js';

const R0 = 6356766; // effective Earth radius used by US1976 for geopotential conversion

// [base geopotential altitude m, base temperature K, lapse rate K/m, base pressure Pa]
const LAYERS = [
  [0, 288.15, -0.0065, 101325.0],
  [11000, 216.65, 0.0, 22632.06],
  [20000, 216.65, 0.001, 5474.889],
  [32000, 228.65, 0.0028, 868.0187],
  [47000, 270.65, 0.0, 110.9063],
  [51000, 270.65, -0.0028, 66.93887],
  [71000, 214.65, -0.002, 3.956420],
];

// [geometric altitude km, T K, P Pa, rho kg/m3]
const UPPER = [
  [86, 186.87, 3.7338e-1, 6.958e-6],
  [90, 186.87, 1.8359e-1, 3.416e-6],
  [95, 188.42, 7.5966e-2, 1.393e-6],
  [100, 195.08, 3.2011e-2, 5.604e-7],
  [110, 240.0, 7.1042e-3, 9.708e-8],
  [120, 360.0, 2.5382e-3, 2.222e-8],
  [130, 469.27, 1.2505e-3, 8.152e-9],
  [150, 634.39, 4.5422e-4, 2.076e-9],
  [180, 787.55, 1.5381e-4, 5.194e-10],
  [200, 854.56, 8.4736e-5, 2.541e-10],
  [250, 941.33, 2.4767e-5, 6.073e-11],
  [300, 976.01, 8.7704e-6, 1.916e-11],
  [350, 990.06, 3.4518e-6, 7.014e-12],
  [400, 995.83, 1.4518e-6, 2.803e-12],
  [450, 998.22, 6.4468e-7, 1.184e-12],
  [500, 999.24, 3.0236e-7, 5.215e-13],
  [600, 999.85, 8.2130e-8, 1.137e-13],
  [700, 999.97, 3.1908e-8, 3.070e-14],
  [800, 999.99, 1.7036e-8, 1.136e-14],
  [900, 1000.0, 1.0873e-8, 5.759e-15],
  [1000, 1000.0, 7.5138e-9, 3.561e-15],
];

let densityScale = 1; // solar-activity multiplier for the thermosphere (>1 during solar max)
export function setSolarActivity(scale) { densityScale = scale; }

export function atmosphere(z) {
  if (z < 86000) {
    const zz = Math.max(z, -1000);
    const h = (R0 * zz) / (R0 + zz);
    let i = LAYERS.length - 1;
    while (i > 0 && h < LAYERS[i][0]) i--;
    const [hb, Tb, L, Pb] = LAYERS[i];
    const T = Tb + L * (h - hb);
    const P = L === 0
      ? Pb * Math.exp((-G0 * (h - hb)) / (R_AIR * Tb))
      : Pb * Math.pow(T / Tb, -G0 / (R_AIR * L));
    const rho = P / (R_AIR * T);
    return { T, P, rho, a: Math.sqrt(1.4 * R_AIR * T), mu: sutherland(T) };
  }
  const km = z / 1000;
  if (km >= 1000) {
    const f = Math.exp(-(km - 1000) / 270);
    return { T: 1000, P: 7.5138e-9 * f, rho: 3.561e-15 * f * densityScale, a: 600, mu: sutherland(1000) };
  }
  let i = 0;
  while (i < UPPER.length - 2 && UPPER[i + 1][0] < km) i++;
  const A = UPPER[i], B = UPPER[i + 1];
  const t = (km - A[0]) / (B[0] - A[0]);
  const T = A[1] + (B[1] - A[1]) * t;
  const P = Math.exp(Math.log(A[2]) + (Math.log(B[2]) - Math.log(A[2])) * t);
  const scale = km > 100 ? densityScale : 1;
  const rho = Math.exp(Math.log(A[3]) + (Math.log(B[3]) - Math.log(A[3])) * t) * scale;
  return { T, P, rho, a: Math.sqrt(1.4 * R_AIR * Math.min(T, 300)), mu: sutherland(T) };
}

function sutherland(T) { return (1.458e-6 * Math.pow(T, 1.5)) / (T + 110.4); }
