// Minimal WebAudio blips (no audio files): shot, boom, pickup, cash, crash. Created lazily on the
// first user gesture; every call is guarded so a missing AudioContext never breaks the game.
let ctx = null;

function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(f, d, type = 'square', g = 0.08, slide = 0) {
  const c = ac();
  if (!c) return;
  const o = c.createOscillator(), v = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, c.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), c.currentTime + d);
  v.gain.setValueAtTime(g, c.currentTime);
  v.gain.exponentialRampToValueAtTime(0.001, c.currentTime + d);
  o.connect(v); v.connect(c.destination);
  o.start(); o.stop(c.currentTime + d);
}

export const sfx = {
  unlock() { ac(); },
  shoot() { tone(240, 0.09, 'square', 0.1, -170); },
  boom() { tone(70, 0.55, 'sawtooth', 0.2, -45); },
  pickup() { tone(660, 0.07, 'sine', 0.1); setTimeout(() => tone(990, 0.1, 'sine', 0.1), 70); },
  cash() { tone(880, 0.08, 'sine', 0.09); setTimeout(() => tone(1320, 0.13, 'sine', 0.09), 80); },
  crash() { tone(130, 0.16, 'sawtooth', 0.12, -70); },
  thud() { tone(90, 0.12, 'triangle', 0.15, -40); },
  denied() { tone(180, 0.12, 'square', 0.08, -60); },
};
