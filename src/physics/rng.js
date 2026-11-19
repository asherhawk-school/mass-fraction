// Seeded PRNG (mulberry32) + helpers. Deterministic so tests and replays are reproducible.
export function makeRng(seed = 12345) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  const gauss = (mean = 0, sd = 1) => {
    if (spare !== null) { const v = spare; spare = null; return mean + sd * v; }
    let u, v, r;
    do { u = next() * 2 - 1; v = next() * 2 - 1; r = u * u + v * v; } while (r >= 1 || r === 0);
    const f = Math.sqrt(-2 * Math.log(r) / r);
    spare = v * f;
    return mean + sd * u * f;
  };
  return {
    next,
    gauss,
    range: (a, b) => a + (b - a) * next(),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    get state() { return s; },
    set state(v) { s = v >>> 0; },
  };
}

// Global game RNG (re-seeded from save state)
export const rng = makeRng(Date.now() & 0xffffffff);
