// Physical constants (SI). Sources: CODATA 2018, IERS, WGS-84 / EGM96.
export const G0 = 9.80665;               // standard gravity, m/s^2
export const RU = 8314.462618;           // universal gas constant, J/(kmol·K)
export const MU = 3.986004418e14;        // Earth gravitational parameter, m^3/s^2
export const RE = 6371000;               // mean Earth radius, m
export const OMEGA_E = 7.2921159e-5;     // Earth sidereal rotation rate, rad/s
export const P_SL = 101325;              // sea-level pressure, Pa
export const SIGMA_SB = 5.670374419e-8;  // Stefan–Boltzmann constant
export const R_AIR = 287.05287;          // specific gas constant of air
export const DEG = Math.PI / 180;
export const R_HE = 2077.1;              // helium specific gas constant
export const R_N2 = 296.8;

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;

// Piecewise-linear interpolation in a table of rows [x, ...values]; returns array of values.
export function interpRows(rows, x) {
  if (x <= rows[0][0]) return rows[0].slice(1);
  const n = rows.length;
  if (x >= rows[n - 1][0]) return rows[n - 1].slice(1);
  let i = 0;
  while (i < n - 2 && rows[i + 1][0] < x) i++;
  const a = rows[i], b = rows[i + 1];
  const t = (x - a[0]) / (b[0] - a[0]);
  const out = [];
  for (let k = 1; k < a.length; k++) out.push(a[k] + (b[k] - a[k]) * t);
  return out;
}
