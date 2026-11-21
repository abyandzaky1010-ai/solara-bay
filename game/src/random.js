// Seeded randomness. Everything the city builds from — building sizes, palm
// placement, car colours — comes out of mulberry32 so a seed always yields the
// same Solara Bay.

export function hashString(s) {
  let h = 2166136261 >>> 0;
  const text = String(s);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function makeRng(seed) {
  let state = (typeof seed === 'number' ? seed >>> 0 : hashString(seed)) || 1;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,
    range(a, b) {
      return a + (b - a) * next();
    },
    int(a, b) {
      return Math.floor(a + (b - a + 1) * next());
    },
    pick(arr) {
      return arr[Math.floor(next() * arr.length) % arr.length];
    },
    chance(p) {
      return next() < p;
    },
    angle() {
      return next() * Math.PI * 2;
    },
  };
}
