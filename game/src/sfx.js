// Solara Bay: all sound is synthesised with WebAudio. No files, no network.

const SIREN = [659, 494], STEP = 0.45, START = 0.0001;
let ctx, master, noise, engine, sirenOn = false, sirenReady = false, sirenHop = 0, phase = 0, vib = 0;

const live = () => (ctx && master ? ctx : null);
const later = (ms, fn) => window.setTimeout(fn, ms);
const safe = (fn) => () => { try { fn(); } catch { /* audio is a garnish */ } };

// One second of white noise, made once and reused by every burst.
function noiseBuffer() {
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

// Opens the context on the first gesture; null if the browser has no audio.
export function initSfx() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.25;
      master.connect(ctx.destination);
      noiseBuffer();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    ctx = null;
    return null;
  }
}

// An envelope that snaps to peak and decays to silence over `dur`.
function envelope(peak, dur) {
  const amp = ctx.createGain(), t = ctx.currentTime;
  amp.gain.setValueAtTime(START, t);
  amp.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  amp.gain.exponentialRampToValueAtTime(START, t + dur);
  amp.connect(master);
  return { amp, t };
}

// A short blip with an exponential tail, optionally sliding to another pitch.
function tone(hz, dur, type, peak, slide) {
  if (!live()) return;
  const osc = ctx.createOscillator(), { amp, t } = envelope(peak, dur);
  osc.type = type;
  osc.frequency.setValueAtTime(hz, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
  osc.connect(amp);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// Filtered noise: a shot's crack, a crash's thud, an explosion's roar.
function burst(dur, peak, cut) {
  if (!live()) return;
  const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), { amp, t } = envelope(peak, dur);
  src.buffer = noiseBuffer();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cut, t);
  filter.frequency.exponentialRampToValueAtTime(cut * 0.25, t + dur);
  src.connect(filter).connect(amp);
  src.start(t, Math.random() * 0.4);
  src.stop(t + dur + 0.02);
}

const note = (hz) => tone(hz, 0.16, 'triangle', 0.18);
const notes = (list) => list.forEach((hz, i) => later(i * 130, () => note(hz)));

export const S = {
  shot: safe(() => { burst(0.08, 0.5, 4200); tone(900, 0.05, 'square', 0.16, 420); }),
  chime: safe(() => { tone(660, 0.11, 'sine', 0.2); later(90, () => tone(880, 0.16, 'sine', 0.18)); }),
  explode: safe(() => { tone(60, 0.5, 'sine', 0.5, 28); burst(0.6, 0.45, 1600); }),
  crash: safe(() => { burst(0.14, 0.42, 900); tone(140, 0.09, 'triangle', 0.2, 70); }),
  honk: safe(() => tone(440, 0.2, 'square', 0.14)),
  jingle: (win) => safe(() => notes(win ? [523, 659, 784] : [415, 330, 262]))(),
};

// Sawtooth 50-120 Hz by speed through a lowpass, with a small vibrato.
export function engineOn(kind) {
  try {
    initSfx();
    if (!live() || engine) return;
    const osc = ctx.createOscillator(), filter = ctx.createBiquadFilter(), amp = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 50;
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    amp.gain.value = START;
    osc.connect(filter).connect(amp).connect(master);
    osc.start();
    engine = { osc, filter, amp };
    amp.gain.setTargetAtTime(kind === 'sport' ? 0.06 : 0.045, ctx.currentTime, 0.1);
  } catch { /* silence */ }
}

// speed01 = 0..1 of top speed: the hum climbs, the vibrato rides on top.
export function engineUpdate(speed01, dt) {
  if (!engine || !live()) return;
  try {
    vib += dt || 0;
    const speed = Math.max(0, Math.min(1, speed01 || 0)), t = ctx.currentTime;
    engine.osc.frequency.setTargetAtTime(50 + 70 * speed + Math.sin(vib * 5.5) * 2.2, t, 0.08);
    engine.filter.frequency.setTargetAtTime(320 + speed * 780, t, 0.12);
  } catch { /* silence */ }
}

export function engineOff() {
  const old = engine;
  if (!old || !live()) return;
  try {
    old.amp.gain.setTargetAtTime(START, ctx.currentTime, 0.08);
    engine = null;
    later(400, () => { try { old.osc.stop(); } catch { /* gone */ } });
  } catch { engine = null; }
}

// Two-tone siren at 659/494 Hz: starts on the call, then hops inside sirenTick,
// which the main loop calls once per fixed step.
const wail = () => {
  if (live()) tone(SIREN[phase], STEP * 0.9, 'square', 0.05);
  phase = 1 - phase;
};

export function siren(on) {
  try {
    sirenOn = !!on;
    if (!sirenOn) {
      sirenHop = 0;
      phase = 0;
    } else if (initSfx() && !sirenReady) {
      sirenReady = true;
      wail();
    }
  } catch { /* silence */ }
}

// Keeps the two tones hopping; the gate that starts them lives in siren().
export function sirenTick(dt) {
  if (!sirenOn) return;
  sirenHop += dt || 0;
  if (sirenHop < STEP) return;
  sirenHop -= STEP;
  try { wail(); } catch { /* silence */ }
}
