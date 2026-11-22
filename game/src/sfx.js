// Solara Bay — the sound board: short WebAudio envelopes for guns, sirens, horns and
// engines. No files, no music; with no AudioContext every call here is a no-op.

const MASTER = 0.25;
let ac = null;
let out = null;
let noise = null;
let hum = null;
let wail = null;
let live = false;

/** Master gain and white noise; false when WebAudio is missing. */
function open() {
  if (ac) return true;
  const C = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!C) return false;
  try {
    ac = new C();
    out = ac.createGain();
    out.gain.value = MASTER;
    out.connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  } catch (err) {
    ac = null;
    return false;
  }
}

/** A gesture unlocks the suspended context. */
function wake() {
  live = true;
  if (open() && ac.state === 'suspended') ac.resume().catch(() => {});
}

/** Gain up to `vol` then to silence, over `dur` seconds. */
function fade(t, vol, dur) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return g;
}

/** One oscillator, short envelope, optional slide to `to` Hz. */
function tone(type, hz, dur, vol, to = hz) {
  if (!live || !open()) return false;
  const t = ac.currentTime;
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(hz, t);
  if (to !== hz) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  osc.connect(fade(t, vol, dur)).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.03);
  return true;
}

/** Filtered noise: impacts, bangs, a shot's tail. */
function burst(dur, vol, cut) {
  if (!live || !open()) return false;
  const t = ac.currentTime;
  const src = ac.createBufferSource();
  const lp = ac.createBiquadFilter();
  src.buffer = noise;
  lp.type = 'lowpass';
  lp.frequency.value = cut;
  src.connect(lp).connect(fade(t, vol, dur)).connect(out);
  src.start(t);
  src.stop(t + dur + 0.03);
  return true;
}

/** A sustained voice: engine hum, siren wail. */
function loop(type, hz, vol) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = hz;
  gain.gain.setValueAtTime(0.0001, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(vol, ac.currentTime + 0.2);
  osc.connect(gain).connect(out);
  osc.start();
  return { osc, gain };
}

/** Fade a voice out and stop it. */
function release(voice) {
  if (!voice || !ac) return;
  voice.gain.gain.setTargetAtTime(0.0001, ac.currentTime, 0.1);
  try {
    voice.osc.stop(ac.currentTime + 0.5);
  } catch (err) {
    return;
  }
}

/** Wait for a gesture, per browser policy. */
export function initSfx() {
  if (typeof window === 'undefined') return { ready: () => false };
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, wake, { once: true, passive: true });
  return { ready: () => Boolean(ac) };
}

/** Open the context now, e.g. from a panel button. */
export function resumeSfx() {
  wake();
  return live;
}

/** The board other modules reach through G.sound. */
export const S = {
  shot: () => (tone('square', 720, 0.07, 0.16, 90), burst(0.09, 0.2, 3200)),
  chime: () => (tone('sine', 880, 0.1, 0.1), tone('sine', 1320, 0.16, 0.07)),
  explode: () => (burst(0.45, 0.34, 500), tone('sine', 110, 0.5, 0.2, 34)),
  crash: () => (burst(0.16, 0.22, 1400), tone('triangle', 160, 0.12, 0.12, 60)),
  honk: () => (tone('square', 392, 0.16, 0.09), tone('square', 330, 0.16, 0.06)),
  jingle: (win) => (win ? [523, 659, 784, 1047] : [523, 440, 349, 262]).forEach((hz) => tone('triangle', hz, 0.18, 0.09)),
};

/** The engine hum, higher in a sport than a sedan. */
export function engineOn(kind) {
  if (!live || !open()) return false;
  engineOff();
  hum = loop('sawtooth', kind === 'sport' ? 64 : 52, 0.05);
  return true;
}

/** Pitch follows the throttle, speed01 0..1. */
export function engineUpdate(speed01) {
  if (!hum || !ac) return;
  const v = Math.max(0, Math.min(1, speed01 || 0));
  hum.osc.frequency.setTargetAtTime(52 + v * 170, ac.currentTime, 0.08);
  hum.gain.gain.setTargetAtTime(0.02 + 0.03 * v, ac.currentTime, 0.12);
}

/** Fade the hum out. */
export function engineOff() {
  const old = hum;
  hum = null;
  release(old);
}

/** The wail while the law chases. */
export function siren(on) {
  if (!on) {
    const old = wail;
    wail = null;
    release(old);
    return false;
  }
  if (!live || !open()) return false;
  if (wail) return true;
  wail = loop('triangle', 900, 0.04);
  const lfo = ac.createOscillator();
  const depth = ac.createGain();
  lfo.frequency.value = 0.9;
  depth.gain.value = 260;
  lfo.connect(depth).connect(wail.osc.frequency);
  lfo.start();
  return true;
}
