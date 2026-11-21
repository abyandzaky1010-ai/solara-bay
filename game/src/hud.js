// HUD: corner readouts, objective line, toasts, panels and the 180 px minimap.

import { CONFIG } from './config.js';
import { carSpeedKmh } from './car.js';

const K = CONFIG.hud.minimapScale;      // 180 px / 440 m
const PX = 180, MID = PX / 2, RIM = PX / 2 - 3;
const SEA = CONFIG.world.sea;
const GRID = [-160, -80, 0, 80, 160];
const PANELS = ['title', 'pause', 'shop', 'complete', 'busted', 'wasted'];
const TOAST_LIFE = 2.5, TOAST_MAX = 3;

const COL = {
  sea: '#3d8ea8', surf: '#6fc0d6', sand: '#d8cdb2', pave: '#cbbfa4', block: '#e6ded0',
  road: '#454b53', dash: 'rgba(243,233,200,0.55)', park: '#6fae5e', pond: '#4f9cc0',
  build: '#8f9aa6', glass: '#7f8b98', player: '#ffffff', traffic: '#ffffff',
  parked: '#6fc8ff', ped: '#6b7683', cop: '#ff3b30', gold: '#ffd24a', mint: '#8ff0c4', ink: '#101a26',
};

const byId = (id) => document.getElementById(id);
const clamp100 = (v) => Math.max(0, Math.min(100, v || 0));
const mx = (x) => MID + (x + 20) * K;
const my = (z) => MID + (z + 20) * K;

export function createHUD() {
  const hp = byId('healthbar'), ar = byId('armorbar');
  const H = {
    money: byId('money'), stars: byId('stars'), healthFill: hp && hp.firstElementChild,
    armorFill: ar && ar.firstElementChild, weapon: byId('weapon'), speed: byId('speed'),
    objective: byId('objective'), timer: byId('timer'), toasts: byId('toasts'),
    banner: byId('banner'), root: byId('hud'), minimap: byId('minimap'), panels: {},
    glyphs: [], shown: -1, cash: -1, lastCash: -1, cashT: 0, stack: [], bannerT: 0,
    line: '', frame: 0, hurtT: 0,
  };
  for (const id of PANELS) H.panels[id] = byId(id);
  H.stars.textContent = '';
  for (let i = 0; i < 5; i += 1) {
    const g = document.createElement('span');
    g.textContent = '\u2605';
    g.className = 'off';
    H.stars.append(g);
    H.glyphs.push(g);
  }
  H.ctx = H.minimap && H.minimap.getContext ? H.minimap.getContext('2d') : null;
  H.toast = (txt) => toast(H, txt);
  H.setBanner = (txt, ms) => setBanner(H, txt, ms);
  return H;
}

/** Fill the Vine Mart rows once; buy(item) comes from boot. */
export function fillShop(H, shop, buy) {
  const box = byId('shop-items') || byId('shop-list');
  if (!box) return;
  box.replaceChildren();
  for (const row of shop) {
    const line = document.createElement('div');
    line.className = 'shoprow';
    line.innerHTML = '<span>' + row.label + '</span><span class="price">$' + row.price + '</span><button>Buy</button>';
    line.lastChild.onclick = () => buy(row.item);
    box.append(line);
  }
}

function rollCash(H, money, dt) {
  const gap = money - (H.cash < 0 ? money : H.cash);
  H.cash = Math.abs(gap) < 1 ? money : H.cash + Math.sign(gap) * Math.min(Math.abs(gap), Math.max(1, Math.abs(gap) * dt * 9));
  H.money.textContent = '$' + Math.round(H.cash);
  if (H.cash > H.lastCash) {
    H.cashT = 0.45;
    H.money.style.textShadow = '0 0 14px rgba(143,240,196,0.95)';   // the '+' roll
  }
  if (H.cashT > 0 && (H.cashT -= dt) <= 0) H.money.style.textShadow = '';
  H.lastCash = H.cash;
}

function showStars(H, stars) {
  const n = Math.max(0, Math.min(5, stars | 0));
  if (n === H.shown) return;
  if (n > H.shown && H.shown >= 0) {
    H.stars.classList.remove('pulse');
    void H.stars.offsetWidth;                // restart the keyframe
    H.stars.classList.add('pulse');
  }
  H.glyphs.forEach((g, i) => {
    g.className = i < n ? 'on' : 'off';
    g.style.color = i < n && n >= 4 ? '#ff6a5a' : '';
  });
  H.shown = n;
}

const clock = (s) => Math.floor(s / 60) + ':' + String(Math.ceil(s) % 60).padStart(2, '0');

// "Wheels for Vesper \u2014 steal the coupe \u00b7 128 m", plus its timer.
function goalLine(G) {
  const M = G.M || {}, tab = G.objective || null;
  const title = (tab && tab.title) || (M.active && M.active.title) || '';
  const step = (tab && tab.text) || M.step || 'See Vesper at the Glass Orchid';
  const mark = M.target || M.marker || G.fareMarker;
  const p = (G.P && G.P.pos) || G.P || { x: 0, z: 0 };
  const dist = mark ? ' \u00b7 ' + Math.round(Math.hypot(mark.x - p.x, mark.z - p.z)) + ' m' : '';
  return { line: (title ? title + ' \u2014 ' : '') + step + dist, timer: (tab && tab.timer) || M.timer || 0 };
}

export function updateHUD(H, G, dt) {
  const step = Math.max(0, Math.min(0.25, Number(dt) || 0));
  const P = G.P || {}, PO = G.PO || {};
  rollCash(H, (G.E && G.E.money) || 0, step);
  showStars(H, PO.stars || 0);
  if (H.healthFill) H.healthFill.style.width = clamp100(P.hp) + '%';
  if (H.armorFill) H.armorFill.style.width = clamp100(P.armor) + '%';
  const rifle = P.weapon === 'rifle' || (P.rifle && P.weapon !== 'pistol');
  H.weapon.textContent = rifle ? 'Rifle \u00d7' + (P.ammo | 0) : 'Pistol';
  H.speed.textContent = G.inCar && !G.inCar.wrecked ? carSpeedKmh(G.inCar) + ' km/h' : '';

  const goal = goalLine(G);
  if (goal.line !== H.line) {
    H.line = goal.line;
    H.objective.textContent = goal.line;
    H.objective.appendChild(H.timer);
  }
  H.timer.textContent = goal.timer > 0 ? clock(goal.timer) : '';

  for (let i = H.stack.length - 1; i >= 0; i -= 1) {
    const t = H.stack[i];
    if ((t.t += step) >= TOAST_LIFE) H.stack.splice(i, 1), t.node.remove();
    else if (t.t > TOAST_LIFE - 0.5 && !t.fading) t.fading = t.node.classList.add('fade');
  }
  if (H.bannerT > 0 && (H.bannerT -= step) <= 0) H.banner.style.display = 'none';
  if (H.hurtT > 0 && (H.hurtT -= step) <= 0) H.root.classList.remove('hurt');
}

export function toast(H, txt) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = txt;
  H.toasts.append(node);
  H.stack.push({ node, t: 0 });
  while (H.stack.length > TOAST_MAX) H.stack.shift().node.remove();
}

export function setBanner(H, txt, ms) {
  H.banner.textContent = txt;
  H.banner.style.display = 'block';
  H.bannerT = Math.max(0.8, (ms || 2500) / 1000);
}

export function showPanel(H, id) {
  hidePanels(H);
  H.panels[id].classList.add('on');
}

export function hidePanels(H) {
  for (const id of PANELS) H.panels[id].classList.remove('on');
}

// ---------------------------------------------------------------- minimap

function dot(ctx, x, z, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(mx(x), my(z), r, 0, Math.PI * 2);
  ctx.fill();
}

// Gold diamond, pulled to the rim with a pointer when the goal is off-map.
function goal(ctx, point, fill) {
  let x = mx(point.x), y = my(point.z);
  const dx = x - MID, dy = y - MID, far = Math.hypot(dx, dy);
  if (far > RIM) {
    x = MID + (dx / far) * RIM;
    y = MID + (dy / far) * RIM;
    const a = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * 8, y + Math.sin(a) * 8);
    ctx.lineTo(x + Math.cos(a + 2.4) * 4, y + Math.sin(a + 2.4) * 4);
    ctx.lineTo(x + Math.cos(a - 2.4) * 4, y + Math.sin(a - 2.4) * 4);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = 'rgba(16,26,38,0.9)';
  ctx.fillRect(-4, -4, 8, 8);
  ctx.strokeRect(-4, -4, 8, 8);
  ctx.restore();
}

// Peds (1 px, nearby only), parked cars, traffic, police, then the player arrow.
function actors(ctx, G) {
  const P = G.P || {}, p = P.pos || P;
  ctx.fillStyle = COL.ped;
  for (const ped of G.peds || []) {
    if (!ped.pos || ped.state === 'down' || ped.state === 'ride') continue;
    if (Math.hypot(ped.pos.x - p.x, ped.pos.z - p.z) < 40) ctx.fillRect(mx(ped.pos.x), my(ped.pos.z), 1.2, 1.2);
  }
  for (const c of G.cars || []) if (!c.player) dot(ctx, c.x, c.z, 1.6, COL.parked);
  for (const c of G.traffic || []) dot(ctx, c.x, c.z, 1.5, COL.traffic);
  for (const c of (G.PO && G.PO.cars) || []) dot(ctx, c.x, c.z, 2.2, COL.cop);
  for (const c of (G.PO && G.PO.foot) || []) dot(ctx, c.x, c.z, 1.8, COL.cop);
  ctx.save();
  ctx.translate(mx(p.x), my(p.z));
  ctx.rotate(Math.PI - (P.yaw || 0));
  ctx.fillStyle = COL.player;
  ctx.strokeStyle = 'rgba(16,26,38,0.95)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, -5.5);
  ctx.lineTo(3.6, 4);
  ctx.lineTo(0, 2.2);
  ctx.lineTo(-3.6, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawMinimap(H, G) {
  if (!H || !H.ctx) return;
  const ctx = H.ctx, city = G.city || {}, park = CONFIG.world.parkRect, marks = city.markers || {};
  ctx.clearRect(0, 0, PX, PX);
  // sea, promenade, sand
  ctx.fillStyle = COL.sand;
  ctx.fillRect(0, 0, PX, PX);
  ctx.fillStyle = COL.pave;
  ctx.fillRect(mx(-172), 0, Math.max(0, mx(SEA) - mx(-172) + 2), PX);
  ctx.fillStyle = COL.sea;
  ctx.fillRect(0, 0, mx(SEA), PX);
  ctx.fillStyle = COL.surf;
  ctx.fillRect(mx(SEA) - 2, 0, 2, PX);
  // city blocks, park green
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      const x0 = GRID[i] + 6, z0 = GRID[j] + 6, w = GRID[i + 1] - x0, d = GRID[j + 1] - z0;
      if (x0 < SEA) continue;
      const inPark = x0 < park.maxX && x0 + w > park.minX && z0 < park.maxZ && z0 + d > park.minZ;
      ctx.fillStyle = inPark ? COL.park : COL.block;
      ctx.fillRect(mx(x0), my(z0), w * K, d * K);
    }
  }
  dot(ctx, (park.minX + park.maxX) / 2, (park.minZ + park.maxZ) / 2, 7, COL.pond);
  // street grid: asphalt, then cream centre dashes
  const lane = () => {
    ctx.beginPath();
    for (const z of GRID) { ctx.moveTo(mx(-172), my(z)); ctx.lineTo(mx(172), my(z)); }
    for (const x of GRID) if (x >= SEA) { ctx.moveTo(mx(x), my(-172)); ctx.lineTo(mx(x), my(172)); }
    ctx.stroke();
  };
  ctx.strokeStyle = COL.road;
  ctx.lineWidth = 12 * K;
  lane();
  ctx.strokeStyle = COL.dash;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 5]);
  lane();
  ctx.setLineDash([]);
  // building footprints
  for (const b of city.buildings || []) {
    const w = Math.max(1.5, b.w * K), d = Math.max(1.5, b.d * K);
    ctx.fillStyle = b.h > 26 ? COL.glass : COL.build;
    ctx.fillRect(mx(b.x) - w / 2, my(b.z) - d / 2, w, d);
  }
  // 'S' at Vine Mart, '!' at the Glass Orchid
  ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [point, letter, fill] of [[marks.vineMart, 'S', COL.mint], [marks.glassOrchid, '!', COL.gold]]) {
    if (!point) continue;
    dot(ctx, point.x, point.z, 6.5, fill);
    ctx.fillStyle = COL.ink;
    ctx.fillText(letter, mx(point.x), my(point.z) + 0.5);
  }
  const M = G.M || {};
  const lift = M.target || M.marker;
  if (lift) goal(ctx, lift, COL.gold);
  if (G.fareMarker) goal(ctx, G.fareMarker, COL.mint);
  actors(ctx, G);
  ctx.strokeStyle = 'rgba(16,26,38,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, PX - 1, PX - 1);
}

/** Redraw on every second rendered frame. */
export function tickMinimap(H, G) {
  if (++H.frame % 2 === 0) drawMinimap(H, G);
}
