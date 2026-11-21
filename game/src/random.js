// Solara Bay — deterministic randomness. One seed drives the city, traffic,
// pedestrians and every screenshot scene, so the same seed is the same bay.

/**
 * mulberry32: 32-bit state, tiny and fast, good enough for city dressing.
 */
export function makeRng(seed) {
  let state = (Number(seed) || 0) >>> 0;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const range = (a, b) => a + (b - a) * next();

  return {
    next,
    range,
    int(a, b) {
      return Math.floor(range(a, b + 1));
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length)];
    },
    chance(p) {
      return next() < p;
    },
    angle() {
      return next() * Math.PI * 2;
    },
  };
}

/**
 * Stable 32-bit hash of a string (FNV-1a), used to derive sub-seeds.
 */
export function hashString(s) {
  let h = 0x811c9dc5;
  const text = String(s);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
