// One job: everything the player reads — money, stars, bars, objective line,
// toast stack, six screens and the 180 px canvas minimap.
import { CONFIG } from './config.js';

const STAR_COLORS = ['#ffd24a', '#ffc23a', '#ffa93a', '#ff7a3a', '#ff4d3a'];
const TOAST_LIFE = 2.5;
const MAP_PX = 180;
const MAP_SCALE = MAP_PX / 440;
const MAP_HALF = 220;
const MAP_EVERY = 2;
const ROAD_HALF = CONFIG.world.roadHalf;
const PED_SKIP = 56;
const PANEL_IDS = ['title', 'pause', 'shop', 'complete', 'busted', 'wasted'];

const INK = {
  sea: '#2f7d99', beach: '#d8cdb2', ground: '#e6dfd0', block: '#d3ccbd',
  road: '#8d9399', line: '#dfe6ea', park: '#6fae5e',
  house: '#a9a294', tower: '#8b93a0', player: '#ffffff', traffic: '#f7f7f2',
  parked: '#5ea9ff', ped: '#b9b3a6', police: '#ff3b30', goal: '#ffd24a',
  fare: '#7be0c0', stamp: '#ffd24a',
};

const el = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mapX = (x) => (x + MAP_HALF) * MAP_SCALE;
const mapZ = (z) => (z + MAP_HALF) * MAP_SCALE;
const pad2 = (n) => String(n).padStart(2, '0');

/** Build the HUD handle: element bindings, five stars, the map context. */
export function createHUD() {
  const H = { panels: {}, starMarks: [], toastList: [], frame: 0, time: 0, hurtUntil: 0 };
  for (const id of ['root', 'money', 'stars', 'healthbar', 'armorbar', 'weapon', 'speed',
    'objective', 'timer', 'toasts', 'crosshair']) H[id] = el(id);
  H.canvas = el('minimap');
  for (const id of PANEL_IDS) H.panels[id] = el(id);
  H.health = H.healthbar ? H.healthbar.firstElementChild : null;
  H.armor = H.armorbar ? H.armorbar.firstElementChild : null;
  H.shownStars = -1;
  H.pulseUntil = 0;
  H.open = null;

  H.stars.replaceChildren();
  for (let i = 0; i < 5; i++) H.starMarks.push(H.stars.appendChild(document.createElement('i')));

  H.banner = { text: document.createTextNode(''), until: 0, live: '' };
  H.objective.insertBefore(H.banner.text, H.timer);

  H.ctx = H.canvas.getContext('2d');
  H.weaponKey = '';
  H.weapon.innerHTML = '<b>Pistol</b> \u221E';
  H.toast = (txt) => toast(H, txt);
  H.setBanner = (txt, ms) => setBanner(H, txt, ms);
  H.starsPulse = () => starsPulse(H);
  return H;
}

/** Push a line onto the stack, oldest first out; three on screen at most. */
export function toast(H, txt) {
  if (!H || !H.toasts || !txt) return;
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = String(txt);
  H.toasts.appendChild(node);
  H.toastList.push({ el: node, age: 0 });
  while (H.toastList.length > 3) {
    const old = H.toastList.shift();
    if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
  }
  requestAnimationFrame(() => node.classList.add('show'));
}

function fadeToasts(H, dt) {
  const list = H.toastList;
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i];
    t.age += dt;
    if (t.age > TOAST_LIFE - 0.26) t.el.classList.remove('show');
    if (t.age <= TOAST_LIFE) continue;
    if (t.el.parentNode) t.el.parentNode.removeChild(t.el);
    list.splice(i, 1);
  }
}

function starsPulse(H) {
  H.pulseUntil = H.time + 0.5;
  const s = H.stars.classList;
  s.remove('pulse');
  void H.stars.offsetWidth;
  s.add('pulse');
}

function drawMoney(H, E, dt) {
  if (!H.money) return;
  const target = E ? Math.max(0, Math.round(E.money || 0)) : 0;
  if (H.moneyShown == null) H.moneyShown = target;
  const gap = target - H.moneyShown;
  if (gap) {
    const step = Math.max(1, Math.ceil(Math.abs(gap) * Math.min(1, dt * 9)));
    H.moneyShown += Math.sign(gap) * Math.min(Math.abs(gap), step);
  }
  H.money.textContent = '$' + Math.round(H.moneyShown).toLocaleString('en-US');
  H.money.style.color = H.moneyShown < target ? '#ffffff' : '';
}

function drawBars(H, P) {
  const hp = clamp(P ? P.hp : 0, 0, CONFIG.player.hp);
  const armor = clamp(P ? P.armor : 0, 0, 100);
  if (H.health) H.health.style.width = hp + '%';
  if (H.armor) H.armor.style.width = armor + '%';
  H.healthbar.style.opacity = hp > 0 ? '1' : '0.45';
  H.armorbar.style.opacity = armor > 0 ? '1' : '0.35';
}

function drawWeapon(H, P) {
  if (!H.weapon || !P) return;
  const rifle = P.rifle && P.ammo > 0;
  const key = rifle ? 'r' + P.ammo : 'p';
  if (key === H.weaponKey) return;
  H.weaponKey = key;
  H.weapon.innerHTML = rifle ? '<b>Rifle</b> ' + P.ammo + ' rds' : '<b>Pistol</b> \u221E';
}

function drawSpeed(H, G) {
  H.speed.style.display = G.inCar ? '' : 'none';
  if (!G.inCar) return;
  const txt = Math.round(Math.abs(G.inCar.speed || 0) * 3.6) + ' km/h';
  if (H.speed.textContent !== txt) H.speed.textContent = txt;
}

/** Top line: job, step, distance and countdown, or the taxi call. */
function drawObjective(H, G) {
  const out = H.banner.text;
  const M = G.M;
  let text = '';
  let left = 0;
  const panel = G.missionText ? G.missionText() : null;
  if (panel && panel.text) {
    text = panel.text;
    left = panel.timer || 0;
  }
  if (!text && M && M.active) {
    const here = G.inCar || (G.P && G.P.pos);
    const away = M.target && here
      ? ' \u00b7 ' + Math.round(Math.hypot(M.target.x - here.x, M.target.z - here.z)) + ' m'
      : '';
    text = M.active.title + ' \u2014 ' + (M.step || 'get moving') + away;
    left = M.timer || 0;
  }
  if (!text && G.E && G.E.fares && G.fareText) {
    text = 'Taxi: ' + G.fareText().text + ' \u00b7 ' + Math.round(G.fareMeters()) + ' m';
  }
  if (!text && H.banner.until > H.time) text = H.banner.live;

  H.objective.style.display = text ? 'block' : 'none';
  if (!text) return;
  if (out.textContent !== text) out.textContent = text;
  H.timer.textContent = left > 0 ? pad2(Math.floor(left / 60)) + ':' + pad2(Math.ceil(left % 60) % 60) : '';
  H.timer.style.color = left > 0 && left <= 10 ? '#ff8a6b' : '';
}

/** One step of HUD state, cheap enough for 60 Hz. */
export function updateHUD(H, G, dt) {
  if (!H || !G) return;
  H.frame++;
  H.time += dt;
  drawMoney(H, G.E, dt);
  drawBars(H, G.P);
  drawWeapon(H, G.P);
  drawSpeed(H, G);

  const stars = G.PO ? G.PO.stars || 0 : 0;
  if (stars !== H.shownStars) {
    if (stars > H.shownStars && H.shownStars >= 0) starsPulse(H);
    H.shownStars = stars;
    for (let i = 0; i < 5; i++) {
      H.starMarks[i].classList.toggle('on', i < stars);
      H.starMarks[i].style.color = i < stars ? STAR_COLORS[stars - 1] : '';
    }
    H.stars.style.opacity = stars ? '1' : '0.55';
  }
  if (H.time > H.pulseUntil) H.stars.classList.remove('pulse');

  drawObjective(H, G);
  fadeToasts(H, dt);

  if (H.hurtUntil && H.time > H.hurtUntil) {
    H.root.classList.remove('damage');
    H.hurtUntil = 0;
  }
  H.crosshair.style.display = !G.inCar && (!G.P || !G.P.dead) && !H.open ? 'block' : 'none';
  if (H.frame % MAP_EVERY === 0) drawMinimap(H, G);
}

export function hidePanels(H) {
  if (!H) return;
  for (const id of PANEL_IDS) if (H.panels[id]) H.panels[id].classList.remove('open');
  H.open = null;
}

export function showPanel(H, id) {
  if (!H) return;
  hidePanels(H);
  const p = H.panels[id];
  if (p) p.classList.add('open');
  H.open = p ? id : null;
}

export function flashDamage(H) {
  if (!H || !H.root) return;
  H.root.classList.add('damage');
  H.hurtUntil = H.time + 0.2;
  clearTimeout(H.hurtTimer);
  H.hurtTimer = setTimeout(() => H.root.classList.remove('damage'), 200);
}

export function setBanner(H, txt, ms) {
  if (!H) return;
  H.banner.until = H.time + (ms || 2200) / 1000;
  H.banner.live = txt || '';
}

/** Square dot, or a wedge pointing along heading. */
function mark(ctx, x, z, heading, size, hex, arrow) {
  const px = mapX(x);
  const pz = mapZ(z);
  ctx.fillStyle = hex;
  if (!arrow) {
    ctx.fillRect(px - size / 2, pz - size / 2, size, size);
    return;
  }
  const fx = -Math.sin(heading) * size;
  const fz = -Math.cos(heading) * size;
  ctx.beginPath();
  ctx.moveTo(px + fx, pz + fz);
  ctx.lineTo(px - fz * 0.75, pz + fx * 0.75);
  ctx.lineTo(px + fz * 0.75, pz - fx * 0.75);
  ctx.closePath();
  ctx.fill();
}

function goalDiamond(ctx, x, z, hex, stamp) {
  const px = clamp(mapX(x), 9, MAP_PX - 9);
  const pz = clamp(mapZ(z), 9, MAP_PX - 9);
  const w = px !== mapX(x) || pz !== mapZ(z) ? 7 : 11;
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = hex;
  ctx.fillRect(-w / 2, -w / 2, w, w);
  ctx.restore();
  if (!stamp) return;
  ctx.fillStyle = '#1a2632';
  ctx.font = 'bold 11px "Trebuchet MS", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(stamp, px, pz + 0.5);
}

/** Pale blocks, then the street grid the roads module publishes. */
function paintStreets(ctx, coords) {
  const band = Math.max(2, ROAD_HALF * 2 * MAP_SCALE);
  ctx.fillStyle = INK.block;
  for (let i = 0; i < coords.length - 1; i++) {
    for (let j = 0; j < coords.length - 1; j++) {
      ctx.fillRect(
        mapX(coords[i] + ROAD_HALF), mapZ(coords[j] + ROAD_HALF),
        Math.max(1, (coords[i + 1] - coords[i]) * MAP_SCALE - band),
        Math.max(1, (coords[j + 1] - coords[j]) * MAP_SCALE - band),
      );
    }
  }
  for (let i = 0; i < coords.length; i++) {
    const cx = mapX(coords[i]);
    const cz = mapZ(coords[i]);
    ctx.fillStyle = INK.road;
    ctx.fillRect(cx - band / 2, 0, band, MAP_PX);
    ctx.fillRect(0, cz - band / 2, MAP_PX, band);
    ctx.fillStyle = INK.line;
    ctx.fillRect(cx - 0.5, 0, 1, MAP_PX);
    ctx.fillRect(0, cz - 0.5, MAP_PX, 1);
  }
}

/** Cars and people, by colour and size. */
function paintBodies(ctx, G, P) {
  const here = P ? P.pos : { x: 0, z: 0 };
  for (const [list, size, hex] of [[G.traffic || [], 2.4, INK.traffic], [G.cars || [], 3, INK.parked]]) {
    for (let i = 0; i < list.length; i++) {
      const car = list[i];
      if (car && !car.wrecked) mark(ctx, car.x, car.z, car.heading || 0, size, hex, true);
    }
  }
  const peds = G.peds || [];
  ctx.fillStyle = INK.ped;
  for (let i = 0; i < peds.length; i++) {
    const ped = peds[i];
    if (!ped || !ped.pos || ped.state === 'ride') continue;
    if (Math.abs(ped.pos.x - here.x) + Math.abs(ped.pos.z - here.z) > PED_SKIP) continue;
    ctx.fillRect(mapX(ped.pos.x), mapZ(ped.pos.z), 1, 1);
  }
  const PO = G.PO;
  if (!PO) return;
  const foot = PO.foot || [];
  for (let i = 0; i < foot.length; i++) {
    if (foot[i] && !foot[i].down) mark(ctx, foot[i].x, foot[i].z, 0, 3, INK.police, false);
  }
  const cops = PO.cars || [];
  for (let i = 0; i < cops.length; i++) {
    if (cops[i] && !cops[i].wrecked) mark(ctx, cops[i].x, cops[i].z, cops[i].heading || 0, 3.4, INK.police, true);
  }
}

/** The whole 180 px map for this frame. */
export function drawMinimap(H, G) {
  const ctx = H && H.ctx;
  const coords = (G && G.W && G.W.roads && G.W.roads.coords) || [];
  if (!ctx || !coords.length) return;
  const city = G.city || {};
  const M = G.M;
  const park = CONFIG.world.parkRect;
  const P = G.P;

  // Sea down the west, sand strip beside it, pale ground across the rest.
  const shore = clamp(mapX(CONFIG.world.sea), 0, MAP_PX);
  ctx.fillStyle = INK.ground;
  ctx.fillRect(0, 0, MAP_PX, MAP_PX);
  ctx.fillStyle = INK.beach;
  ctx.fillRect(0, 0, shore, MAP_PX);
  ctx.fillStyle = INK.sea;
  ctx.fillRect(0, 0, Math.max(0, shore - 3), MAP_PX);

  paintStreets(ctx, coords);

  ctx.fillStyle = INK.park;
  ctx.fillRect(mapX(park.minX), mapZ(park.minZ),
    (park.maxX - park.minX) * MAP_SCALE, (park.maxZ - park.minZ) * MAP_SCALE);

  const buildings = city.buildings || [];
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    ctx.fillStyle = b.h > 26 ? INK.tower : INK.house;
    ctx.fillRect(mapX(b.x - b.w / 2), mapZ(b.z - b.d / 2),
      Math.max(2, b.w * MAP_SCALE), Math.max(2, b.d * MAP_SCALE));
  }

  const marks = city.markers || {};
  if (marks.vineMart) goalDiamond(ctx, marks.vineMart.x, marks.vineMart.z, INK.stamp, 'S');
  if (marks.glassOrchid) goalDiamond(ctx, marks.glassOrchid.x, marks.glassOrchid.z, INK.stamp, '!');

  paintBodies(ctx, G, P);

  // Goals: the job marker wins over the taxi call.
  if ((M && M.marker) || G.fareMarker) {
    const goal = (M && M.marker) || G.fareMarker;
    goalDiamond(ctx, goal.x, goal.z, M && M.marker ? INK.goal : INK.fare);
  }

  if (P && P.pos) mark(ctx, P.pos.x, P.pos.z, G.inCar ? G.inCar.heading || 0 : P.yaw || 0, 6, INK.player, true);
}
