// WebAudio synthesis only: no files, no network, nothing to load.
// The context opens on the first gesture; every call checks it first, so a
// silent browser plays a silent game instead of throwing.

let ctx = null, master = null, noiseBuf = null, engine = null, sirenVoice = null;
const CYCLE = 0.45;   // siren half period

function open() {
  if (ctx) return ctx;
  const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
  if (!AC) return null;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.25;
    master.connect(ctx.destination);
  } catch (err) {
    ctx = master = null;
  }
  return ctx;
}

/** Arm audio: first click or key opens the context. No music, ever. */
export function initSfx() {
  if (typeof window === 'undefined') return null;
  const wake = () => {
    const live = open();
    if (live && live.state === 'suspended') live.resume().catch(() => {});
    window.removeEventListener('pointerdown', wake);
    window.removeEventListener('keydown', wake);
  };
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
  return master;
}

// One plucked oscillator; optional glide.
function tone(hz, dur, type, gain, slide, delay) {
  if (!ctx) return;
  const t0 = ctx.currentTime + (delay || 0), osc = ctx.createOscillator(), amp = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(hz, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(amp).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Filtered noise burst: the body of shots, crashes and fires.
function burst(dur, freq, gain, type) {
  if (!ctx) return;
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), amp = ctx.createGain();
  src.buffer = noiseBuf;
  f.type = type || 'lowpass';
  f.frequency.setValueAtTime(freq, t0);
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(amp).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

const RAW = {
  // gunshot: noise crack under a 900 Hz blip
  shot(rifle) {
    burst(rifle ? 0.11 : 0.08, rifle ? 2600 : 1800, rifle ? 0.45 : 0.32);
    tone(rifle ? 700 : 900, 0.06, 'square', 0.12, 220);
  },
  // two bells for cash and pickups
  chime() {
    tone(660, 0.12, 'sine', 0.3);
    tone(880, 0.16, 'sine', 0.26, 0, 0.09);
  },
  // 60 Hz swell under a long noise decay
  explode() {
    tone(60, 0.6, 'sine', 0.55, 28);
    burst(0.6, 900, 0.5);
    burst(0.35, 3200, 0.22, 'highpass');
  },
  // metal thud, brighter with force
  crash(force) {
    const f = Math.max(0.2, Math.min(1, Number(force) || 0.6));
    burst(0.12 + 0.1 * f, 500 + 700 * f, 0.28 * f + 0.08);
    tone(90 + 40 * f, 0.1, 'triangle', 0.12);
  },
  honk() {
    tone(440, 0.2, 'square', 0.14);
    tone(554, 0.2, 'square', 0.09);
  },
  // story sting: up for a win, down for a loss
  jingle(win) {
    (win ? [523, 659, 784] : [392, 330, 262]).forEach((hz, i) => tone(hz, 0.18, 'triangle', 0.24, 0, i * 0.11));
    if (win) tone(1568, 0.3, 'sine', 0.14, 0, 0.22);
  },
  dry() { burst(0.03, 2400, 0.16, 'highpass'); },
  door() {
    burst(0.09, 420, 0.22);
    tone(120, 0.07, 'triangle', 0.1);
  },
  // two-tone wail while wanted
  siren(on) {
    const v = sirenVoice;
    sirenVoice = null;
    if (!on) {
      if (!v || !ctx) return;
      const t = ctx.currentTime;
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), t);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      v.osc.stop(t + 0.18);
      return;
    }
    if (v) {
      sirenVoice = v;
      return;
    }
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 659;
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(master);
    gain.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 0.15);
    osc.start();
    sirenVoice = { osc, gain, phase: 0 };
  },
  // a wounded engine coughing under the loop
  engineSputter() {
    if (!ctx || !engine) return;
    const g = engine.gain.gain, t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(engine.level, t);
    g.linearRampToValueAtTime(0.02, t + 0.05);
    g.linearRampToValueAtTime(engine.level, t + 0.12);
  },
};

/** Every effect, each call guarded: audio never breaks the game. */
const S = Object.fromEntries(Object.entries(RAW).map(([k, fn]) => [k, (...a) => {
  try {
    if (ctx || open()) fn(...a);
  } catch (err) { /* silence */ }
}]));

/** Start the car voice: a sawtooth through a lowpass, quiet by default. */
export function engineOn() {
  engineOff();
  if (!ctx && !open()) return;
  const osc = ctx.createOscillator(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
  const lfo = ctx.createOscillator(), wobble = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.value = 55;
  filter.type = 'lowpass';
  filter.frequency.value = 380;
  filter.Q.value = 2.2;
  gain.gain.value = 0.0001;
  lfo.frequency.value = 18;
  wobble.gain.value = 1.6;
  lfo.connect(wobble).connect(osc.frequency);
  osc.connect(filter).connect(gain).connect(master);
  gain.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 0.18);
  osc.start();
  lfo.start();
  engine = { osc, filter, gain, lfo, level: 0.09 };
}

/** Tacho: 50 Hz at rest, 120 Hz flat out; brighter with speed. */
export function engineUpdate(speed01) {
  if (!engine) return;
  const s = Math.max(0, Math.min(1, Number(speed01) || 0)), t = ctx.currentTime;
  engine.osc.frequency.setTargetAtTime(50 + 70 * s, t, 0.08);
  engine.filter.frequency.setTargetAtTime(320 + 900 * s, t, 0.1);
}

export function engineOff() {
  const e = engine;
  engine = null;
  if (!e || !ctx) return;
  const t = ctx.currentTime;
  e.gain.gain.cancelScheduledValues(t);
  e.gain.gain.setValueAtTime(Math.max(0.0001, e.gain.gain.value), t);
  e.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
  e.osc.stop(t + 0.2);
  e.lfo.stop(t + 0.2);
}

/** Convenience for the loop: feed the driven car straight in. */
export function engineFromSpeed(car) {
  if (!car) return;
  engineUpdate(Math.min(1, Math.abs(car.speed || 0) / (car.kind === 'sport' || car.kind === 'police' ? 28 : 22)));
  if (car.kind === 'police') S.siren(car.sirenOn !== false);
}

/** Alternate 659 / 494 Hz every half second; called once per frame. */
export function sirenTick(dt) {
  if (!sirenVoice) return;
  sirenVoice.phase += Number(dt) || 0;
  if (sirenVoice.phase >= CYCLE) {
    sirenVoice.phase -= CYCLE;
    const osc = sirenVoice.osc;
    osc.frequency.setTargetAtTime(osc.frequency.value > 550 ? 494 : 659, ctx.currentTime, 0.02);
  }
}

export { S };
