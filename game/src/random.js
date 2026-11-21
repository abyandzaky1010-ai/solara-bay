// Seedable pseudo-random numbers so every run and every screenshot is reproducible.

export function makeRng(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function range(a, b) {
    return a + (b - a) * next();
  }

  function int(a, b) {
    const lo = Math.ceil(a);
    const hi = Math.floor(b);
    if (hi < lo) return lo;
    return lo + Math.floor(next() * (hi - lo + 1));
  }

  function pick(arr) {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(next() * arr.length) % arr.length];
  }

  function chance(p) {
    return next() < p;
  }

  function angle() {
    return next() * Math.PI * 2;
  }

  return { next, range, int, pick, chance, angle };
}

export function hashString(s) {
  let h = 2166136261 >>> 0;
  const text = String(s ?? '');
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
