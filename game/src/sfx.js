// Solara Bay — all sound is synthesised with WebAudio: no files, no network.
// Every entry point is a no-op before a user gesture, or if there is no AudioContext.

let ac = null, master = null, noiseBuf = null, tried = false;
const eng = { on: false }, wail = { on: false, beat: 0, phase: 0 };
const VOLUME = 0.25, SIREN_HI = 659, SIREN_LO = 494, SIREN_SWAP = 0.45;

/** The context, built on first use; null when audio is unavailable. */
const audio = () => {
  if (tried) return ac;
  tried = true;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ac = new Ctor();
    master = ac.createGain();
    master.gain.value = VOLUME;
    master.connect(ac.destination);
    noiseBuf = makeNoise(ac, 0.8);
  } catch (err) { ac = null; }
  return ac;
};

/** Softened noise: filtered white is warmer than static. */
function makeNoise(context, seconds) {
  const len = Math.floor(context.sampleRate * seconds);
  const buf = context.createBuffer(1, len, context.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = last * 0.55 + w * 0.45;
    data[i] = last;
  }
  return buf;
}

/** First gesture: open the context if it is still closed. */
export function initSfx() {
  const a = audio();
  if (!a) return;
  try { if (a.state === 'suspended' && a.resume) a.resume(); } catch (err) { /* retry later */ }
}

function unlock() {
  if (!ac) return null;
  if (ac.state === 'suspended') {
    try { ac.resume(); } catch (err) { return null; }
  }
  return ac;
}

/** Gain envelope: silent, up to peak, back down by dur. */
function envelope(gain, peak, t0, dur, attack = 0.008) {
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

/** One enveloped oscillator; glide slides the pitch down over the note. */
function tone(freq, dur, type, level, when = 0, glide = 0) {
  const a = unlock();
  if (!a) return;
  const t0 = a.currentTime + when;
  try {
    const osc = a.createOscillator(), g = a.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t0 + dur);
    envelope(g, level, t0, dur);
    osc.connect(g); g.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  } catch (err) { /* stay silent */ }
}

/** Band-passed noise burst: impacts, grit, explosions. */
function noise(dur, level, hz = 1800, when = 0) {
  const a = unlock();
  if (!a || !noiseBuf) return;
  const t0 = a.currentTime + when;
  try {
    const src = a.createBufferSource(), bq = a.createBiquadFilter(), g = a.createGain();
    src.buffer = noiseBuf; src.loop = true;
    bq.type = 'bandpass'; bq.frequency.value = hz; bq.Q.value = 0.9;
    envelope(g, level, t0, dur, 0.002);
    src.connect(bq); bq.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  } catch (err) { /* ignore */ }
}

/* --------------------------------------------------------------- sound table */

/** Shoot, then chime, cash, boom, crunch, horn, two jingles, cough and buzz. */
const PLAY = {
  shot: (rifle) => { noise(0.08, 0.5, rifle ? 2400 : 1800); tone(900, 0.07, 'square', 0.16, 0, rifle ? 1040 : 880); },
  chime: () => { tone(660, 0.12, 'sine', 0.22); tone(880, 0.16, 'sine', 0.18, 0.09); },
  cash: () => { tone(1180, 0.06, 'triangle', 0.16); tone(1560, 0.09, 'triangle', 0.13, 0.06); },
  explode: () => { tone(60, 0.6, 'sine', 0.5, 0, 34); noise(0.6, 0.55, 700); noise(0.25, 0.3, 2600, 0.02); },
  crash: () => { noise(0.16, 0.42, 320); tone(120, 0.12, 'square', 0.1, 0, 70); },
  honk: () => { tone(440, 0.2, 'square', 0.14); tone(392, 0.2, 'square', 0.1); },
  jingle: (win) => (win ? [523, 659, 784] : [523, 415, 311]).forEach((n, i) => tone(n, 0.16, 'triangle', 0.2, i * 0.12)),
  engineSputter: () => { noise(0.12, 0.18, 500); tone(70, 0.1, 'sawtooth', 0.08, 0, 44); },
  deny: () => tone(180, 0.16, 'square', 0.12),
};

/** Wrapped so every caller gets a no-op before the first gesture. */
export const S = {};
for (const [key, play] of Object.entries(PLAY)) S[key] = (...args) => { if (audio()) play(...args); };

/* ------------------------------------------------------- engine & siren loops */

/** A started oscillator wired through one gain into the master bus. */
function voice(a, type, hz, level, ramp) {
  const osc = a.createOscillator(), gain = a.createGain();
  osc.type = type;
  osc.frequency.value = hz;
  gain.gain.value = 0.0001;
  gain.gain.setTargetAtTime(level, a.currentTime, ramp);
  osc.connect(gain); gain.connect(master);
  osc.start();
  return { osc, gain };
}

/** Start the drone for the car the player just entered. */
export function engineOn(kind) {
  const a = audio();
  if (!a || eng.on) return;
  try {
    const heavy = kind === 'police' || kind === 'sedan' ? 0.8 : 1;
    eng.main = voice(a, 'sawtooth', 52 * heavy, 0.09, 0.25);
    eng.sub = voice(a, 'square', 26 * heavy, 0.09, 0.25);
    eng.filter = a.createBiquadFilter();
    eng.filter.type = 'lowpass';
    eng.filter.frequency.value = 420;
    eng.filter.Q.value = 1.1;
    // A tiny vibrato keeps the drone off a pure test tone.
    eng.lfo = a.createOscillator();
    eng.lfo.type = 'sine';
    eng.lfo.frequency.value = 5.5;
    eng.lfoGain = a.createGain();
    eng.lfoGain.gain.value = 2.2;
    eng.lfo.connect(eng.lfoGain);
    eng.lfoGain.connect(eng.main.osc.frequency);
    eng.filter.connect(eng.main.gain);
    eng.lfo.start();
    eng.on = true;
  } catch (err) { eng.on = false; }
}

/** Pitch, filter and level open up with speed01 (0 idle .. 1 flat out). */
export function engineUpdate(speed01, dt) {
  if (!eng.on || !ac) return;
  try {
    const v = Math.max(0, Math.min(1, speed01 || 0)), now = ac.currentTime;
    const glide = Math.max(0.02, dt * 3), hz = 50 + v * 70;
    eng.main.osc.frequency.setTargetAtTime(hz, now, glide);
    eng.sub.osc.frequency.setTargetAtTime(hz * 0.5, now, glide);
    eng.filter.frequency.setTargetAtTime(380 + v * 1500, now, glide);
    eng.main.gain.gain.setTargetAtTime(0.06 + v * 0.05, now, 0.08);
  } catch (err) { /* ignore */ }
}

export function engineOff() {
  if (!eng.on || !ac) { eng.on = false; return; }
  try {
    const now = ac.currentTime;
    for (const v of [eng.main, eng.sub]) v.gain.gain.setTargetAtTime(0.0001, now, 0.06);
    for (const p of [eng.main.osc, eng.sub.osc, eng.lfo]) p.stop(now + 0.35);
  } catch (err) { /* ignore */ }
  eng.on = false;
}

/** Two-tone police wail: 659 / 494 Hz square, swapping twice a second. */
export function siren(on) {
  const a = audio();
  if (!a || wail.on === !!on) return;
  try {
    if (on) {
      wail.tone = voice(a, 'square', SIREN_HI, 0.055, 0.12);
      wail.phase = 0;
      wail.beat = 0;
    } else {
      wail.tone.gain.gain.setTargetAtTime(0.0001, a.currentTime, 0.08);
      wail.tone.osc.stop(a.currentTime + 0.3);
    }
  } catch (err) { return; }
  wail.on = !!on;
}

/** Called from the main loop; flips the tone every 0.45 s while on. */
export function updateSiren(dt) {
  if (!wail.on || !wail.tone || !ac) return;
  wail.phase += dt;
  if (wail.phase < SIREN_SWAP) return;
  wail.phase -= SIREN_SWAP;
  wail.beat = 1 - wail.beat;
  try { wail.tone.osc.frequency.setTargetAtTime(wail.beat ? SIREN_LO : SIREN_HI, ac.currentTime, 0.01); }
  catch (err) { /* ignore */ }
}
