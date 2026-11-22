// Deterministic randomness: one seeded generator drives every layout decision,
// so a seed always rebuilds the same city, traffic and people.

/** mulberry32: 32-bit state, fast, good enough for placement, stable across engines. */
export function makeRng(seed) {
  let state = (Number(seed) | 0) >>> 0;
  if (state === 0) state = 0x9e3779b9;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** A float in [a, b). */
    range: (a, b) => a + (b - a) * next(),
    /** A whole number in [a, b]. */
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    /** One element of a non-empty array. */
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** True with probability p. */
    chance: (p) => next() < p,
    /** A heading in [0, 2pi). */
    angle: () => next() * Math.PI * 2,
  };
}

/** A string folded into a non-zero 32-bit seed (FNV-1a style). */
export function hashString(s) {
  let h = 0x811c9dc5;
  const text = String(s);
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) || 1;
}
