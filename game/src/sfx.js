// Solara Bay — every sound synthesised on the spot. No files, no network, never throws.

let ctx = null, out = null, noiseBuf = null, engine = null, wail = null;
const noop = () => {};

/** Make the context on the first gesture; repeat calls are free. */
export function initSfx() {
  try {
    const C = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (ctx || !C) return ctx;
    ctx = new C();
    out = ctx.createGain();
    out.gain.value = 0.25;
    out.connect(ctx.destination);
  } catch (err) {
    ctx = out = null;
  }
  return ctx;
}

const live = () => !!out; // initSfx() runs on the first gesture; until then, silence

// One second of white noise, built once and shared by every burst.
function noise() {
  if (!ctx) return null;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

// Envelope-shaped oscillator, swept f0 -> f1 when they differ.
function tone(type, f0, f1, dur, gain, delay = 0) {
  if (!live()) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(1e-4, t);
  g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.012, dur / 3));
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// Filtered noise: a shot's body, a thud, a blast.
function burst(dur, gain, hz, type = 'lowpass', q = 0.7, delay = 0) {
  if (!live() || !ctx) return;
  const buf = noise(), t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf;
  f.type = type;
  f.frequency.value = hz;
  f.Q.value = q;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t);
  s.stop(t + dur + 0.02);
}

const safe = (fn) => (...a) => { try { fn(...a); } catch (err) { noop(); } };

/** Pistol crack, chime, blast, thud, horn, mission notes. */
export const S = {
  shot: safe(() => (burst(0.08, 0.45, 2600, 'highpass'), tone('triangle', 900, 260, 0.09, 0.22))),
  chime: safe(() => (tone('sine', 660, 660, 0.16, 0.22), tone('sine', 880, 880, 0.22, 0.18, 0.1))),
  explode: safe(() => (tone('sine', 90, 60, 0.7, 0.55), burst(0.6, 0.6, 900, 'lowpass', 0.5), burst(0.35, 0.35, 240, 'lowpass', 0.7, 0.05))),
  crash: safe(() => (burst(0.14, 0.4, 380, 'lowpass', 1.4), tone('square', 140, 70, 0.12, 0.12))),
  honk: safe(() => (tone('square', 440, 440, 0.2, 0.12), tone('square', 554, 554, 0.2, 0.08))),
  jingle: safe((win) => (win ? [523, 659, 784] : [660, 520, 390]).forEach((f, i) => tone('sine', f, f, 0.18, 0.2, i * 0.12))),
};

/** Car drone: sawtooth plus sub square through a lowpass, started once. */
export function engineOn(kind) {
  try {
    if (!live()) return;
    engineOff();
    if (ctx.state === 'suspended') ctx.resume().catch(noop);
    const o = ctx.createOscillator(), s = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth';
    s.type = 'square';
    o.frequency.value = 55;
    s.frequency.value = kind === 'sport' ? 41 : kind === 'police' ? 46 : 37;
    f.type = 'lowpass';
    f.frequency.value = 420;
    f.Q.value = 3;
    g.gain.value = 1e-4;
    g.gain.setTargetAtTime(0.16, ctx.currentTime, 0.08);
    o.connect(f);
    s.connect(f);
    f.connect(g).connect(out);
    o.start();
    s.start();
    engine = { o, s, f, g };
  } catch (err) {
    engine = null;
  }
}

/** Pitch by speed (0..1) with a touch of vibrato. */
export function engineUpdate(speed01, dt) {
  void dt;
  if (!engine || !ctx) return;
  try {
    const v = Math.max(0, Math.min(1, speed01 || 0)), t = ctx.currentTime;
    engine.o.frequency.setTargetAtTime(50 + v * 70 + Math.sin(t * 31) * 1.6, t, 0.08);
    engine.s.frequency.setTargetAtTime(34 + v * 46, t, 0.12);
    engine.f.frequency.setTargetAtTime(380 + v * 900, t, 0.1);
  } catch (err) {
    noop();
  }
}

export function engineOff() {
  if (!engine || !ctx) return;
  try {
    engine.g.gain.setTargetAtTime(1e-4, ctx.currentTime, 0.05);
    engine.o.stop(ctx.currentTime + 0.25);
    engine.s.stop(ctx.currentTime + 0.25);
  } catch (err) {
    noop();
  }
  engine = null;
}

/** Two-tone wail: 659 Hz and 494 Hz, swapping every 0.45 s while on. */
export function siren(on) {
  try {
    if (!on) {
      if (wail) clearInterval(wail.timer), wail.o.stop(), (wail = null);
      return;
    }
    if (wail || !live()) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 659;
    g.gain.value = 0.045;
    o.connect(g).connect(out);
    o.start();
    wail = { o, timer: setInterval(() => o.frequency.setValueAtTime(o.frequency.value > 560 ? 494 : 659, ctx.currentTime), 450) };
  } catch (err) {
    wail = null;
  }
}

/** Per-tick keepalive for main; the wail runs on its own timer. */
export function sirenTick(dt) {
  void dt;
}
