// Deterministic seeded RNG (mulberry32): stable city layout and stable staged screenshots.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rr = (r, a, b) => a + r() * (b - a);
export const ri = (r, a, b) => Math.floor(rr(r, a, b + 1));
export const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
