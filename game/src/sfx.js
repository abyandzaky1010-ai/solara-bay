// One job: noise. Everything is synthesised with WebAudio on the spot, so the
// game ships no audio files and makes no requests. With no AudioContext (or no
// gesture yet) every call is a silent no-op.
import { CONFIG } from './config.js';

const MASTER = 0.25;
const SHOT_HZ = 900;
const SIREN_A = 659;
const SIREN_B = 494;
const SIREN_SWAP = 0.45;
const ENGINE_MIN = 50;
const ENGINE_MAX = 120;
const VIBRATO = 2.4;
const ENGINE_CUT = [['sport', 900], ['police', 800]];
const WIN_NOTES = [523, 659, 784];
const LOSS_NOTES = [523, 415, 330];

let ctx = null;
let master = null;
let noiseBuf = null;
let engine = null;
let sirenVoice = null;

/** Call from the first click: browsers start audio suspended until a gesture. */
export function initSfx() {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = MASTER;
      master.connect(ctx.destination);
      // One second of white noise, reused by every percussive sound.
      const len = Math.floor(ctx.sampleRate);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return true;
  } catch (err) {
    ctx = null;
    return false;
  }
}

/** One enveloped oscillator: peaks quickly, decays, never throws. */
function tone(freq, dur, type, peak, at) {
  if (!initSfx()) return;
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime + (at || 0);
    o.type = type || 'sine';
    o.frequency.setValueAtTime(Math.max(20, freq), t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.002, peak), t + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  } catch (err) {
    /* audio is decoration */
  }
}

/** A burst of filtered noise: the crack, the thud, the roar. */
function noiseBurst(dur, peak, filterHz, type) {
  if (!initSfx() || !noiseBuf) return;
  try {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterHz;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(Math.max(0.002, peak), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.02);
  } catch (err) {
    /* ignore */
  }
}

/** Fade a live voice out and stop it, so it never clicks. */
function release(voice, fall) {
  if (!voice || !ctx) return;
  try {
    const t = ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(t);
    voice.gain.gain.setValueAtTime(Math.max(0.0002, voice.gain.gain.value), t);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + fall);
    voice.osc.stop(t + fall + 0.04);
  } catch (err) {
    /* ignore */
  }
}

// ---------- one-shots ----------

/** Pistol or rifle: a short crack with a mid-frequency body under it. */
export function shot(rifle) {
  const heavy = !!rifle;
  noiseBurst(heavy ? 0.07 : 0.09, heavy ? 0.5 : 0.42, heavy ? 880 : SHOT_HZ, 'bandpass');
  tone(heavy ? 620 : SHOT_HZ, 0.05, 'square', 0.12);
}

/** Shop bell: two bright sines. */
export function chime() {
  tone(660, 0.16, 'sine', 0.22);
  tone(880, 0.22, 'sine', 0.18);
}

/** A car going up: a low swell under a long noise decay. */
export function explode() {
  tone(60, 0.48, 'sine', 0.5);
  noiseBurst(0.6, 0.55, 480, 'lowpass');
  noiseBurst(0.24, 0.3, 2400, 'highpass');
}

/** Sheet metal: a short dull thud with a rattle on top. */
export function crash(force) {
  const f = Math.max(0.25, Math.min(1, typeof force === 'number' ? force : 0.6));
  noiseBurst(0.18, 0.4 * f, 260, 'lowpass');
  noiseBurst(0.108, 0.22 * f, 1800, 'bandpass');
}

/** Taxi horn: a 440 Hz square held flat. */
export function honk() {
  tone(440, 0.2, 'square', 0.14);
}

/** Payday or failure: three notes up for a win, down for a loss. */
export function jingle(win) {
  const notes = win ? WIN_NOTES : LOSS_NOTES;
  for (let i = 0; i < notes.length; i++) tone(notes[i], 0.24, 'triangle', 0.22, i * 0.11);
}

// ---------- engine ----------

/** Start (or restyle) the engine: one sawtooth through a lowpass. */
export function engineOn(kind) {
  if (!initSfx()) return;
  engineOff();
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const named = ENGINE_CUT.find((pair) => pair[0] === kind);
    o.type = 'sawtooth';
    o.frequency.value = ENGINE_MIN;
    filter.type = 'lowpass';
    filter.frequency.value = named ? named[1] : 620;
    g.gain.value = 0.0001;
    o.connect(filter);
    filter.connect(g);
    g.connect(master);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.25);
    engine = { osc: o, gain: g, filter, t: 0 };
  } catch (err) {
    engine = null;
  }
}

/** Follow the throttle (0..1) with pitch, filter and a little vibrato. */
export function engineUpdate(speed01, dt) {
  if (!engine || !ctx) return;
  try {
    const v = Math.max(0, Math.min(1, speed01 || 0));
    engine.t += dt || 0;
    const wobble = Math.sin(engine.t * Math.PI * 2 * VIBRATO) * (1.5 + v * 2.5);
    const t = ctx.currentTime;
    engine.osc.frequency.setTargetAtTime(ENGINE_MIN + (ENGINE_MAX - ENGINE_MIN) * v + wobble, t, 0.08);
    engine.filter.frequency.setTargetAtTime(520 + v * 900, t, 0.1);
    engine.gain.gain.setTargetAtTime(0.05 + v * 0.07, t, 0.15);
  } catch (err) {
    /* ignore */
  }
}

/** Kill the engine voice with a quick fade. */
export function engineOff() {
  const e = engine;
  engine = null;
  release(e, 0.18);
}

// ---------- siren ----------

/** Two-tone wail on a single square wave; sirenTick does the swapping. */
export function siren(on) {
  if (!on) {
    const v = sirenVoice;
    sirenVoice = null;
    release(v, 0.2);
    return;
  }
  if (sirenVoice || !initSfx()) return;
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = SIREN_A;
    g.gain.value = 0.055;
    o.connect(g);
    g.connect(master);
    o.start();
    sirenVoice = { osc: o, gain: g, t: 0, high: true };
  } catch (err) {
    sirenVoice = null;
  }
}

/** Called each frame: alternate the wail every 0.45 s while it is live. */
export function sirenTick(dt) {
  const v = sirenVoice;
  if (!v || !ctx) return;
  v.t += dt || 0;
  if (v.t < SIREN_SWAP) return;
  v.t = 0;
  v.high = !v.high;
  try {
    v.osc.frequency.setValueAtTime(v.high ? SIREN_A : SIREN_B, ctx.currentTime);
  } catch (err) {
    /* ignore */
  }
}

/** The bag of sounds the rest of the game calls through G.sound. */
export const S = {
  shot: (rifle) => shot(rifle),
  chime: () => chime(),
  explode: () => explode(),
  crash: (force) => crash(force),
  honk: () => honk(),
  jingle: (win) => jingle(win),
  siren: (on) => siren(on),
  dry: () => tone(180, 0.04, 'square', 0.06),
};

/** Convenience for main: engine pitch straight from a car's speed. */
export function engineFromSpeed(car, dt) {
  if (!car) return;
  const spec = CONFIG.car.kinds[car.kind] || CONFIG.car.kinds.sedan;
  engineUpdate(Math.min(1, Math.abs(car.speed || 0) / spec.max), dt);
}
