
const MASTER = 0.25, IDLE_HZ = 50, TOP_HZ = 120;
const SIREN_HI = 659, SIREN_LO = 494, SIREN_SWITCH = 0.45;
let ctx = null, master = null, noise = null, engine = null, wailer = null;
let wanted = false, locked = true;
function ensure() {
  if (ctx) {
    if (ctx.state === 'suspended' && !locked) ctx.resume().catch(() => {});
    return ctx;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = MASTER;
    master.connect(ctx.destination);
    const frames = Math.floor(ctx.sampleRate * 1.2), data = (noise = ctx.createBuffer(1, frames, ctx.sampleRate)).getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  } catch (err) {
    ctx = null;
    master = null;
  }
  return ctx;
}
function voice(level) {
  const ac = ensure();
  if (!ac || !master) return null;
  const gain = ac.createGain();
  gain.gain.value = level;
  gain.connect(master);
  return { ac, gain };
}
function hiss(level, seconds, cutoff, q, dropTo) {
  const v = voice(level);
  if (!v || !noise) return;
  const { ac, gain } = v, now = ac.currentTime;
  const src = ac.createBufferSource(), filter = ac.createBiquadFilter();
  src.buffer = noise;
  filter.type = q > 1 ? 'bandpass' : 'lowpass';
  filter.frequency.setValueAtTime(cutoff, now);
  if (dropTo) filter.frequency.exponentialRampToValueAtTime(Math.max(60, dropTo), now + seconds);
  filter.Q.value = q;
  gain.gain.setValueAtTime(level, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
  src.connect(filter);
  filter.connect(gain);
  src.start(now);
  src.stop(now + seconds + 0.02);
  src.onended = () => { try { gain.disconnect(); filter.disconnect(); } catch (err) { /* gone */ } };
}
function blip(type, fromHz, toHz, level, attack, hold, release) {
  const v = voice(level);
  if (!v) return;
  const { ac, gain } = v, now = ac.currentTime, span = attack + hold, curve = gain.gain;
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(fromHz, now);
  osc.frequency.linearRampToValueAtTime(toHz, now + span + release);
  curve.setValueAtTime(0.0001, now);
  curve.linearRampToValueAtTime(1, now + attack);
  curve.setValueAtTime(1, now + span);
  curve.exponentialRampToValueAtTime(0.0001, now + span + release);
  osc.connect(gain);
  osc.start(now);
  osc.stop(now + span + release + 0.02);
  osc.onended = () => { try { gain.disconnect(); } catch (err) { /* gone */ } };
}
function notes(gain, ac, list, gap, tail) {
  gain.gain.value = 1;
  list.forEach((hz, i) => {
    const at = ac.currentTime + i * gap;
    const osc = ac.createOscillator(), env = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz, at);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(0.9, at + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.01 + tail);
    osc.connect(env);
    env.connect(gain);
    osc.start(at);
    osc.stop(at + tail + 0.05);
  });
}
function shot() {
  hiss(0.55, 0.08, 2400, 0.9, 400);
  blip('square', 900, 380, 0.18, 0.002, 0.01, 0.05);
}
function chime() {
  const v = voice(0.2);
  if (v) notes(v.gain, v.ac, [660, 880], 0.1, 0.16);
}
function explode() {
  blip('sine', 60, 34, 0.55, 0.01, 0.18, 0.4);
  hiss(0.6, 0.6, 1300, 0.6, 120);
}
function crash() {
  hiss(0.5, 0.14, 700, 0.7, 180);
  blip('triangle', 140, 70, 0.18, 0.002, 0.02, 0.1);
}
function honk() {
  blip('square', 440, 440, 0.1, 0.008, 0.18, 0.02);
}
function jingle(win) {
  const v = voice(0.18);
  if (v) notes(v.gain, v.ac, win ? [523, 659, 784] : [440, 392, 330], 0.13, 0.15);
}
export const S = { shot, chime, explode, crash, honk, jingle };
export function engineOn(kind) {
  const ac = ensure();
  if (!ac || !master) return;
  engineOff();
  try {
    const osc = ac.createOscillator(), filter = ac.createBiquadFilter(), gain = ac.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = kind === 'police' ? 58 : kind === 'sport' ? 66 : 54;
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    gain.gain.value = 0.0001;
    gain.gain.linearRampToValueAtTime(0.07, ac.currentTime + 0.25);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start();
    engine = { osc, filter, gain, kind };
  } catch (err) {
    engine = null;
  }
}
export function engineUpdate(speed01, dt) {
  if (!engine || !ctx) return;
  try {
    const now = ctx.currentTime, k = Math.max(0, Math.min(1, speed01 || 0));
    engine.osc.frequency.setTargetAtTime(IDLE_HZ + (TOP_HZ - IDLE_HZ) * k + Math.sin(now * 31) * 1.4, now, 0.05);
    engine.filter.frequency.setTargetAtTime(380 + 1500 * k, now, 0.08);
    engine.gain.gain.setTargetAtTime(0.05 + 0.05 * k, now, 0.12);
  } catch (err) {
    engine = null;
  }
}
export function engineOff() {
  const dead = engine;
  engine = null;
  if (!dead || !ctx) return;
  try {
    const now = ctx.currentTime;
    dead.gain.gain.cancelScheduledValues(now);
    dead.gain.gain.setTargetAtTime(0.0001, now, 0.06);
    dead.osc.stop(now + 0.4);
    dead.osc.onended = () => { try { dead.gain.disconnect(); dead.filter.disconnect(); } catch (err) { /* gone */ } };
  } catch (err) {
  }
}
export function siren(on) {
  wanted = !!on;
  const ac = ensure();
  if (!ac || !master || (wanted && wailer)) return;
  try {
    const now = ac.currentTime;
    if (!wanted) {
      const dead = wailer;
      wailer = null;
      if (!dead) return;
      dead.gain.gain.cancelScheduledValues(now);
      dead.gain.gain.setTargetAtTime(0.0001, now, 0.06);
      dead.osc.stop(now + 0.5);
      return;
    }
    const osc = ac.createOscillator(), gain = ac.createGain();
    osc.type = 'square';
    osc.frequency.value = SIREN_HI;
    gain.gain.value = 0.0001;
    gain.gain.linearRampToValueAtTime(0.045, now + 0.3);
    osc.connect(gain);
    gain.connect(master);
    osc.start();
    wailer = { osc, gain, next: now + SIREN_SWITCH };
  } catch (err) {
    wailer = null;
  }
}
export function initSfx() {
  ensure();
  try {
    const unlock = () => {
      locked = false;
      ensure();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  } catch (err) {
  }
  return ctx;
}
export function updateSfx(dt) {
  if (!wailer || !ctx) return;
  try {
    const now = ctx.currentTime;
    while (wailer.next <= now) {
      const hi = wailer.hi = !wailer.hi;
      wailer.osc.frequency.setValueAtTime(hi ? SIREN_HI : SIREN_LO, wailer.next);
      wailer.next += SIREN_SWITCH;
    }
    if (!wanted) siren(false);
  } catch (err) {
    wailer = null;
  }
}
