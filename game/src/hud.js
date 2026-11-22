// Solara Bay — the glass over the city: bars, stars, wallet, objective, toasts,
// the panels, and the corner map that tells you where to drive.

import { CONFIG } from './config.js';
import { C } from './palette.js';

const W = CONFIG.world;
const HALF = W.half;
const SEA = W.sea;
const MINI = 180; // canvas px, square
const SPAN = 440; // m across the sheet: the 400 m town plus margin
const SCALE = MINI / SPAN;
const TOAST_MS = 2500;
const TOAST_MAX = 3;
const GRID = [-160, -80, 0, 80, 160];
const PANELS = ['title', 'pause', 'shop', 'complete', 'busted', 'wasted'];

const clock = (s) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, '0')}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

// Every HUD node once, plus a cache so text is only written when it changes.
export function createHUD() {
  const id = (x) => document.getElementById(x);
  const H = {
    hud: id('hud'),
    stars: id('stars'),
    money: id('money'),
    health: id('healthbar')?.querySelector('i'),
    armor: id('armorbar')?.querySelector('i'),
    weapon: id('weapon'),
    speed: id('speed'),
    objective: id('objective'),
    timer: id('timer'),
    toasts: id('toasts'),
    minimap: id('minimap'),
    crosshair: id('crosshair'),
    banner: id('banner'),
    panels: {},
    stars_live: [],
    toastsLive: [],
    frame: 0,
    c: { money: '', stars: -1, hp: -1, armor: -1, objective: '', timer: '' },
    pulse: 0,
    bannerT: 0,
    mapStatic: null,
  };
  // Five glyphs once; a class does the colouring.
  for (let i = 0; H.stars && i < 5; i += 1) {
    const el = document.createElement('span');
    el.textContent = '\u2605';
    H.stars.appendChild(el);
    H.stars_live.push(el);
  }
  for (const key of PANELS) if (id(key)) H.panels[key] = id(key);
  if (H.minimap) {
    H.mapCtx = H.minimap.getContext('2d');
    H.mapStatic = prerenderGround();
  }
  H.toast = (txt) => toast(H, txt);
  return H;
}

// Text and bar writers that skip the DOM when nothing changed.
const text = (el, value, c, k) => el && el.dataset.v !== value && ((el.dataset.v = value), (el.textContent = value), (c[k] = value));
const bar = (el, pct, c, k) => {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  if (el && c[k] !== v) el.style.width = `${(c[k] = v)}%`;
};

// ------------------------------------------------------------------ the frame

/** Bars, wallet, stars, gun, speed, the job line and the clocks. */
export function updateHUD(H, G, dt) {
  if (!H || !G) return;
  const P = G.P || {};
  const E = G.E || {};
  const car = G.inCar;
  const step = dt || 0;

  // Wallet: the roll lives in economy.
  if (H.money) {
    E.rollMoney?.(step);
    text(H.money, E.formatMoney ? E.formatMoney(E) : `$${Math.round(E.money || 0)}`, H.c, 'money');
  }

  // Stars, with a short pulse on a gain.
  const stars = Math.max(0, Math.min(5, G.PO?.stars | 0));
  if (H.c.stars !== stars) {
    if (stars > H.c.stars) H.pulse = 0.42;
    H.c.stars = stars;
    H.stars_live.forEach((el, i) => el.classList.toggle('on', i < stars));
  }
  if (H.pulse > 0 && (H.pulse -= step) <= 0) H.stars?.classList.remove('pulse');
  else if (H.pulse > 0) H.stars?.classList.add('pulse');

  bar(H.health, ((P.hp ?? 100) / CONFIG.player.hp) * 100, H.c, 'hp');
  bar(H.armor, ((P.armor ?? 0) / 100) * 100, H.c, 'armor');

  // Gun and rounds.
  const rifle = P.rifle && (P.ammo | 0) > 0;
  text(H.weapon, rifle ? `Rifle · ${P.ammo | 0}` : 'Pistol', H.c, 'weapon');

  if (H.speed) {
    const on = !!car && !car.wrecked;
    H.speed.classList.toggle('empty', !on);
    if (on) text(H.speed, `${Math.round(Math.abs(car.speed || 0) * 3.6)} km/h`, H.c, 'speed');
  }
  H.crosshair?.classList.toggle('empty', !!car || !!P.dead);

  // Job line and clock, banner, toasts.
  const O = G.objective;
  if (O) {
    const reach = O.dist > 0 ? ` · ${O.dist} m` : '';
    const line = `<b>${O.title || 'Job'}</b> — ${O.text || ''}${reach}`;
    H.objective?.classList.remove('empty');
    if (H.objective && H.c.objective !== line) {
      H.c.objective = line;
      H.objective.innerHTML = line;
    }
    if (H.timer) {
      H.timer.classList.toggle('empty', !(O.timer > 0));
      if (O.timer > 0) text(H.timer, clock(O.timer), H.c, 'timer');
    }
  } else {
    H.objective?.classList.add('empty');
    H.timer?.classList.add('empty');
    H.c.objective = '';
  }

  if (H.bannerT > 0 && (H.bannerT -= step) <= 0) setBanner(H, '', 0);
  for (let i = H.toastsLive.length - 1; i >= 0; i -= 1) {
    const row = H.toastsLive[i];
    const left = TOAST_MS / 1000 - (row.t += step);
    if (left <= 0) row.el.remove(), H.toastsLive.splice(i, 1);
    else if (left < 0.5) row.el.style.opacity = String(left / 0.5);
  }
}

// ------------------------------------------------------------------ words

/** One line, stacked last, oldest falling off the top when the stack is full. */
export function toast(H, txt) {
  if (!H?.toasts || !txt) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = txt;
  H.toasts.appendChild(el);
  H.toastsLive.push({ el, t: 0 });
  while (H.toastsLive.length > TOAST_MAX) H.toastsLive.shift().el.remove();
}

/** A big centred word: MISSION COMPLETE, WASTED, five stars. */
export function setBanner(H, txt, ms = 2200) {
  if (!H?.banner) return;
  H.banner.textContent = txt || '';
  H.banner.classList.toggle('show', !!txt);
  H.bannerT = txt ? ms / 1000 : 0;
}

// ------------------------------------------------------------------ panels

export function showPanel(H, id) {
  if (!H) return;
  for (const key of PANELS) H.panels[key]?.classList.toggle('hidden', key !== id);
  H.hud?.classList.toggle('hidden', ['title', 'busted', 'wasted'].includes(id));
}

export function hidePanels(H) {
  if (!H) return;
  for (const key of PANELS) H.panels[key]?.classList.add('hidden');
  H.hud?.classList.remove('hidden');
}

// ------------------------------------------------------------------ the minimap

const px = (x) => (x + SPAN / 2) * SCALE;
const py = (z) => (z + SPAN / 2) * SCALE;

// The city never moves: ground, blocks, park and avenues are painted once.
function prerenderGround() {
  if (typeof document === 'undefined') return null;
  const off = document.createElement('canvas');
  off.width = off.height = MINI;
  const g = off.getContext('2d');
  const P = W.parkRect;
  g.fillStyle = '#7fc6d8';
  g.fillRect(0, 0, px(SEA), MINI);
  g.fillStyle = '#cfe6d8';
  g.fillRect(px(SEA), 0, MINI - px(SEA), MINI);
  g.fillStyle = '#e8eee4';
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) g.fillRect(px(GRID[i] + W.roadHalf), py(GRID[j] + W.roadHalf), (W.pitch - 2 * W.roadHalf) * SCALE, (W.pitch - 2 * W.roadHalf) * SCALE);
  }
  g.fillStyle = '#8fd07a';
  g.fillRect(px(P.minX), py(P.minZ), (P.maxX - P.minX) * SCALE, (P.maxZ - P.minZ) * SCALE);
  g.fillStyle = '#96a3ae';
  for (const s of GRID) {
    g.fillRect(px(s) - W.roadHalf * SCALE, py(-HALF), 2 * W.roadHalf * SCALE, HALF * 2 * SCALE);
    g.fillRect(px(-HALF), py(s) - W.roadHalf * SCALE, HALF * 2 * SCALE, 2 * W.roadHalf * SCALE);
  }
  return off;
}

// A gold diamond, clamped to the rim when its target is off the sheet.
function diamond(g, x, z, hex, r = 6) {
  const cx = Math.max(r + 3, Math.min(MINI - r - 3, px(x)));
  const cy = Math.max(r + 3, Math.min(MINI - r - 3, py(z)));
  g.beginPath();
  g.moveTo(cx, cy - r);
  g.lineTo(cx + r, cy);
  g.lineTo(cx, cy + r);
  g.lineTo(cx - r, cy);
  g.closePath();
  g.fillStyle = hex;
  g.fill();
}

// A round stamp with one letter: '!' for the giver, 'S' for the shop.
function stamp(g, p, hex, letter, r) {
  g.fillStyle = hex;
  g.beginPath();
  g.arc(px(p.x), py(p.z), r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff7e6';
  g.fillText(letter, px(p.x), py(p.z) + 0.5);
}

/** The 180 px map, called every second frame; everything comes from G. */
export function drawMinimap(H, G) {
  const g = H?.mapCtx;
  if (!g || !G) return;
  const me = G.inCar || G.P?.pos || { x: 0, z: 0 };
  const marks = G.city?.markers || {};
  g.clearRect(0, 0, MINI, MINI);
  if (H.mapStatic) g.drawImage(H.mapStatic, 0, 0);
  else g.fillStyle = '#cfe6d8', g.fillRect(0, 0, MINI, MINI);

  // Skyline: cool towers east, warm low-rise west.
  for (const b of G.city?.buildings || []) {
    g.fillStyle = b.x >= 0 ? '#9fb3c4' : '#d9a98f';
    g.fillRect(px(b.x - b.w / 2), py(b.z - b.d / 2), Math.max(2, b.w * SCALE), Math.max(2, b.d * SCALE));
  }

  // Traffic white, parked cars blue.
  g.fillStyle = '#ffffff';
  for (const car of G.traffic || []) g.fillRect(px(car.x) - 1.5, py(car.z) - 1.5, 3, 3);
  g.fillStyle = '#4aa3ff';
  for (const car of G.cars || []) if (car !== G.inCar) g.fillRect(px(car.x) - 2, py(car.z) - 2, 4, 3);

  // Walkers.
  g.fillStyle = '#5a6470';
  for (const ped of G.peds || []) {
    const p = ped.pos;
    if (p) g.fillRect(px(p.x), py(p.z), 2, 1);
  }

  // Police red, blinking with the lightbar.
  g.fillStyle = Math.floor((G.time || 0) * 4) % 2 === 0 ? '#ff3b30' : '#ff9b94';
  for (const row of G.PO?.cars || []) {
    const c = row.car || row;
    g.fillRect(px(c.x) - 2, py(c.z) - 2, 4, 4);
  }
  for (const cop of G.PO?.foot || []) if (cop.pos) g.fillRect(px(cop.pos.x) - 1.5, py(cop.pos.z) - 1.5, 3, 3);

  g.font = 'bold 11px "Segoe UI",Arial,sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (marks.glassOrchid) stamp(g, marks.glassOrchid, '#c8791f', '!', 6);
  if (marks.vineMart) stamp(g, marks.vineMart, '#2e7d52', 'S', 5.5);

  // Job and fare markers, gold, edge-clamped.
  if (G.M?.marker) diamond(g, G.M.marker.x, G.M.marker.z, C.marker);
  const fare = G.E?.fareState && G.E.fares ? (G.fareMarker?.() || G.E.fareState.dest) : null;
  if (fare && Number.isFinite(fare.x)) diamond(g, fare.x, fare.z, fare.kind === 'fare' ? '#ffb347' : C.marker, 5);

  // Player triangle, turned to the heading.
  const yaw = G.inCar ? G.inCar.heading : G.P?.yaw || 0;
  g.save();
  g.translate(px(me.x), py(me.z));
  g.rotate(-yaw + Math.PI);
  g.beginPath();
  g.moveTo(0, -6);
  g.lineTo(4.5, 4);
  g.lineTo(0, 1.5);
  g.lineTo(-4.5, 4);
  g.closePath();
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#1d2733';
  g.lineWidth = 1.5;
  g.stroke();
  g.fill();
  g.restore();
  g.fillStyle = 'rgba(20,32,48,.75)';
  g.font = 'bold 10px "Segoe UI",Arial,sans-serif';
  g.textAlign = 'left';
  g.fillText('N', 5, 9);
}
