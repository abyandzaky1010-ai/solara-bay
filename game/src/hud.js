// Solara Bay: every HUD element, the toasts, the panel switches and the 180 px minimap.

import { CONFIG } from './config.js';
import { fareMarker } from './economy.js';

const MAP = 180, SCALE = MAP / 440, RIM = 6, BLOCK = 68;
const DIRS = [-160, -80, 0, 80, 160], PANELS = ['title', 'pause', 'shop', 'complete', 'busted', 'wasted'];
const PALE = '#eef3ee', TAN = '#d8cfbf', WATER = '#5fb3c8', DARK = '#3a3f46', GRASS = '#7cc06a';
const GOLD = '#ffd24a', COP = '#ff3b30', CIV = '#fff', PARKED = '#4f8cff', PLAYER = '#ff8a6b';

const sx = (x) => (x + 220) * SCALE;
const sz = (z) => (z + 220) * SCALE;
const byId = (id) => document.getElementById(id);

export function createHUD() {
  const H = {
    hud: byId('hud'), stars: byId('stars'), money: byId('money'), objective: byId('objective'), timer: byId('timer'),
    toasts: byId('toasts'), minimap: byId('minimap'), crosshair: byId('crosshair'), weapon: byId('weapon'), speed: byId('speed'),
    health: byId('healthbar')?.firstElementChild || null, armor: byId('armorbar')?.firstElementChild || null,
    panels: Object.fromEntries(PANELS.map((id) => [id, byId(id)])),
    banner: '', bannerT: 0, shownMoney: -1, lastStars: 0, pulseT: 0, frame: 0, starCache: '',
  };
  H.map = H.minimap?.getContext('2d') || null;
  return H;
}

// Filled stars glow gold, empty ones are dim; a gain pulses the row.
function paintStars(H, stars) {
  if (!H.stars) return;
  if (stars > H.lastStars) H.pulseT = 0.5;
  H.lastStars = stars;
  if (H.starCache === String(stars)) return;
  H.starCache = String(stars);
  H.stars.textContent = '\u2605'.repeat(stars) + '\u2606'.repeat(5 - stars);
  H.stars.style.color = stars ? GOLD : 'rgba(255,255,255,0.35)';
}

const totable = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const lineFor = (o) => [o.title, o.text, o.dist ? `${Math.round(o.dist)} m` : ''].filter(Boolean).join(' \u2014 ');

export function updateHUD(H, G, dt) {
  if (!H || !G) return;
  const P = G.P || {}, E = G.E || {};

  // Money rolls up to the real balance instead of snapping.
  const target = Math.max(0, Math.round(E.money || 0));
  if (H.shownMoney < 0) H.shownMoney = target;
  if (H.shownMoney !== target) {
    const step = Math.max(1, Math.ceil(Math.abs(target - H.shownMoney) * Math.min(1, dt * 9)));
    H.shownMoney = Math.abs(target - H.shownMoney) <= step ? target : H.shownMoney + Math.sign(target - H.shownMoney) * step;
  }
  if (H.money) {
    H.money.textContent = `$${H.shownMoney}`;
    H.money.classList.toggle('roll', H.shownMoney !== target);
  }

  paintStars(H, G.PO?.stars || 0);
  if (H.pulseT > 0) {
    H.pulseT = Math.max(0, H.pulseT - dt);
    H.stars?.classList.toggle('pulse', H.pulseT > 0);
  }

  // Vitals bars, as widths on the inner <i>.
  if (H.health) H.health.style.width = `${Math.max(0, Math.min(100, ((P.hp ?? 0) / CONFIG.player.hp) * 100))}%`;
  if (H.armor) H.armor.style.width = `${Math.max(0, Math.min(100, (P.armor ?? 0)))}%`;
  if (H.weapon) H.weapon.textContent = P.rifle && P.ammo > 0 ? `Rifle \u00b7 ${P.ammo}` : 'Pistol \u00b7 \u221e';

  const driving = !!G.inCar && !G.inCar.wrecked;
  if (H.speed) {
    H.speed.classList.toggle('off', !driving);
    if (driving) H.speed.textContent = `${Math.round(Math.abs(G.inCar.speed) * 3.6)} km/h`;
  }

  // Objective line, or a banner standing in for it for a moment.
  const obj = G.objective;
  const text = H.bannerT > 0 ? H.banner : obj ? lineFor(obj) : '';
  if (H.objective && H.objective.textContent !== text) H.objective.textContent = text;
  if (H.bannerT > 0) H.bannerT = Math.max(0, H.bannerT - dt * 1000);
  const timerText = obj?.timer ? totable(obj.timer) : '';
  if (H.timer && H.timer.textContent !== timerText) H.timer.textContent = timerText;

  H.crosshair?.classList.toggle('hide', G.screen !== 'play' || driving);
  H.hud?.classList.toggle('hidden', G.screen === 'title');
  H.frame += 1;
}

// Stack of three; the oldest leaves, all fade at 2.5 s.
export function toast(H, txt) {
  if (!H?.toasts || !txt) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = txt;
  H.toasts.appendChild(el);
  while (H.toasts.childElementCount > 3) H.toasts.removeChild(H.toasts.firstElementChild);
  window.setTimeout(() => {
    el.style.transition = 'opacity 0.35s linear';
    el.style.opacity = '0';
    window.setTimeout(() => el.remove(), 380);
  }, 2500);
}

export function setBanner(H, txt, ms) {
  if (!H) return;
  H.banner = txt || '';
  H.bannerT = Math.max(400, ms || 3200);
}

export function showPanel(H, id) {
  if (!H) return;
  hidePanels(H);
  H.panels[id]?.classList.remove('hide');
}

export function hidePanels(H) {
  if (!H) return;
  for (const id of PANELS) H.panels[id]?.classList.add('hide');
}

// ---- Minimap -------------------------------------------------------------

function edgeClamp(px, py, pad) {
  const mid = MAP / 2, dx = px - mid, dy = py - mid, reach = Math.max(Math.abs(dx), Math.abs(dy)), limit = mid - pad;
  return reach <= limit ? { x: px, y: py } : { x: mid + (dx / reach) * limit, y: mid + (dy / reach) * limit };
}

function stamp(ctx, place, letter, ink) {
  if (!place || !place.x) return;
  const x = sx(place.x), y = sz(place.z);
  ctx.fillStyle = 'rgba(20,28,34,0.82)';
  ctx.beginPath();
  ctx.arc(x, y, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, x, y + 0.5);
}

/** 180 px of city around the player: sea, grid, park, blocks, blips, stamps. */
export function drawMinimap(H, G) {
  const ctx = H?.map;
  if (!ctx || !G) return;
  const city = G.city || { buildings: [], markers: {} };
  const me = G.inCar && !G.inCar.wrecked
    ? { x: G.inCar.x, z: G.inCar.z, yaw: G.inCar.heading }
    : { x: G.P?.pos?.x ?? 0, z: G.P?.pos?.z ?? 0, yaw: G.P?.yaw ?? 0 };

  // Sea west of the shore, promenade band, pale blocks between the avenues.
  ctx.fillStyle = PALE;
  ctx.fillRect(0, 0, MAP, MAP);
  ctx.fillStyle = WATER;
  ctx.fillRect(0, 0, sx(CONFIG.world.sea), MAP);
  ctx.fillStyle = TAN;
  ctx.fillRect(sx(CONFIG.world.sea), 0, 28 * SCALE, MAP);
  ctx.fillStyle = '#e2e7df';
  for (const x0 of DIRS.slice(0, 4)) {
    for (const z0 of DIRS.slice(0, 4)) ctx.fillRect(sx(x0 + 9), sz(z0 + 9), BLOCK * SCALE, BLOCK * SCALE);
  }

  // The street grid, 2 px of asphalt so it reads at 180 px.
  ctx.strokeStyle = DARK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const d of DIRS) {
    ctx.moveTo(sx(d), 0);
    ctx.lineTo(sx(d), MAP);
    ctx.moveTo(0, sz(d));
    ctx.lineTo(MAP, sz(d));
  }
  ctx.stroke();

  const park = city.park;
  if (park) {
    ctx.fillStyle = GRASS;
    ctx.fillRect(sx(park.x - BLOCK / 2), sz(park.z - BLOCK / 2), BLOCK * SCALE, BLOCK * SCALE);
  }

  // Towers grey-blue downtown, pastel stucco in Palm Ward.
  for (const b of city.buildings || []) {
    ctx.fillStyle = b.x >= 0 ? '#9fb7c6' : '#e3bca8';
    ctx.fillRect(sx(b.x - b.w / 2), sz(b.z - b.d / 2), Math.max(2, b.w * SCALE), Math.max(2, b.d * SCALE));
  }

  ctx.fillStyle = PARKED;
  for (const car of G.cars || []) ctx.fillRect(sx(car.x) - 1, sz(car.z) - 1, 2, 2);
  ctx.fillStyle = CIV;
  for (const car of G.traffic || []) ctx.fillRect(sx(car.x) - 1, sz(car.z) - 1, 2, 2);

  // Walkers: 1 px, within 40 m.
  ctx.fillStyle = '#8a8f96';
  for (const p of G.peds || []) {
    if (!p || p.riding || p.state === 'down' || Math.hypot(p.pos.x - me.x, p.pos.z - me.z) > 40) continue;
    ctx.fillRect(sx(p.pos.x), sz(p.pos.z), 1, 1);
  }

  ctx.fillStyle = COP;
  for (const row of G.PO?.cars || []) if (row?.car) ctx.fillRect(sx(row.car.x) - 1.5, sz(row.car.z) - 1.5, 3, 3);
  for (const cop of G.PO?.foot || []) if (cop?.alive && !cop.down) ctx.fillRect(sx(cop.pos.x) - 1, sz(cop.pos.z) - 1, 2, 2);

  // Mission and fare markers as gold diamonds, pinned to the rim if off-map.
  const fare = fareMarker(G.E);
  const marks = [G.M?.marker && { ...G.M.marker, color: GOLD }, fare && { ...fare, color: '#ffb347' }].filter(Boolean);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1;
  for (const m of marks) {
    const p = edgeClamp(sx(m.x), sz(m.z), RIM);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 4);
    ctx.lineTo(p.x + 4, p.y);
    ctx.lineTo(p.x, p.y + 4);
    ctx.lineTo(p.x - 4, p.y);
    ctx.closePath();
    ctx.fillStyle = m.color;
    ctx.fill();
    ctx.stroke();
  }

  stamp(ctx, city.markers?.vineMart, 'S', '#9cf0c0');
  stamp(ctx, city.markers?.glassOrchid, '!', GOLD);

  // The player: a triangle aimed where the body faces.
  ctx.save();
  ctx.translate(sx(me.x), sz(me.z));
  ctx.rotate(-me.yaw);
  ctx.beginPath();
  ctx.moveTo(0, -5);
  ctx.lineTo(3.6, 4);
  ctx.lineTo(0, 2.2);
  ctx.lineTo(-3.6, 4);
  ctx.closePath();
  ctx.fillStyle = PLAYER;
  ctx.strokeStyle = '#1a2026';
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
