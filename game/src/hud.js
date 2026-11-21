
import { CONFIG } from './config.js';
import { SHOP } from './economy.js';
const PANELS = ['title', 'pause', 'shop', 'complete', 'busted', 'wasted'];
const TOAST_MAX = 3, TOAST_LIFE = 2.5, TOAST_FADE = 0.6;
const PX = 180, SCALE = PX / 440, EAST = 200, SEA = CONFIG.world.sea;
const ROADS = [-160, -80, 0, 80, 160], PARK = CONFIG.world.parkRect, PED_RANGE = 40;
const ON = '\u2605', OFF = '\u2606';
const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mx = (x) => (x + EAST + 20) * SCALE;
const mz = (z) => (z + EAST) * SCALE;
function clock(sec) {
  const w = Math.max(0, Math.ceil(sec)), s = w % 60;
  return `${Math.floor(w / 60)}:${s < 10 ? '0' : ''}${s}`;
}
const pct = (v, max) => (Number.isFinite(v) && max ? clamp((v / max) * 100, 0, 100) : 0);
export function createHUD() {
  const H = {
    root: $('hud'), moneyEl: $('money'), starsEl: $('stars'), weaponEl: $('weapon'),
    healthBar: document.querySelector('#healthbar i'), armorBar: document.querySelector('#armorbar i'),
    speedEl: $('speed'), objectiveEl: $('objective'), timerEl: $('timer'), toastsEl: $('toasts'),
    minimap: $('minimap'), crosshair: $('crosshair'), panels: {}, stars: [], toasts: [], buyButtons: {},
    completeTitle: $('complete-title'), completeStory: $('complete-story'),
    completeReward: $('complete-reward'), shopStatus: $('shop-status'), shopMoney: $('shop-status'),
    pauseStatus: $('pause-status'),
    shownMoney: 0, lastStars: 0, lastHealth: -1, lastArmor: -1,
    lastWeapon: '', lastObjective: null, lastTimer: '', lastSpeed: '', frame: 0,
    banner: '', bannerMs: 0, ctx: null,
  };
  H.ctx = H.minimap ? H.minimap.getContext('2d') : null;
  for (const id of PANELS) H.panels[id] = $(id);
  for (const row of SHOP) H.buyButtons[row.item] = document.querySelector(`[data-buy="${row.item}"]`);
  buildStars(H);
  if (H.toastsEl) H.toastsEl.textContent = '';
  hidePanels(H);
  return H;
}
function buildStars(H) {
  if (!H.starsEl) return;
  H.starsEl.textContent = '';
  H.stars.length = 0;
  for (let i = 0; i < 5; i++) {
    const star = document.createElement('span');
    star.className = 'wait';
    star.textContent = OFF;
    H.starsEl.appendChild(star);
    H.stars.push(star);
  }
}
export function toast(H, txt) {
  if (!H || !H.toastsEl || !txt) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = String(txt);
  H.toastsEl.appendChild(el);
  H.toasts.push({ el, t: 0, shown: true });
  while (H.toasts.length > TOAST_MAX) {
    const old = H.toasts.shift();
    if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
  }
}
function tickToasts(H, dt) {
  for (let i = H.toasts.length - 1; i >= 0; i--) {
    const it = H.toasts[i];
    it.t += dt;
    if (it.t >= TOAST_LIFE && it.shown) {
      it.shown = false;
      it.el.classList.add('out');
    }
    if (it.t >= TOAST_LIFE + TOAST_FADE) {
      if (it.el.parentNode) it.el.parentNode.removeChild(it.el);
      H.toasts.splice(i, 1);
    }
  }
}
export function setBanner(H, txt, ms) {
  if (!H) return;
  H.banner = txt ? String(txt) : '';
  H.bannerMs = H.banner ? Math.max(1200, Number(ms) || 2000) / 1000 : 0;
  if (H.objectiveEl && H.banner) {
    H.objectiveEl.textContent = H.banner;
    H.objectiveEl.classList.add('show');
  }
}
export function showPanel(H, id) {
  const p = H && H.panels ? H.panels[id] : null;
  if (!p) return;
  hidePanels(H);
  p.classList.remove('hidden');
  if (id === 'shop' && H.shopStatus) H.shopStatus.textContent = `Cash: $${Math.round(H.shownMoney)}`;
}
export function hidePanels(H) {
  if (!H || !H.panels) return;
  for (const id of PANELS) if (H.panels[id]) H.panels[id].classList.add('hidden');
}
function paintBars(H, P) {
  const hp = pct(P && P.hp, CONFIG.player.hp), armor = pct(P && P.armor, 100);
  if (hp !== H.lastHealth) {
    if (H.healthBar) H.healthBar.style.width = `${hp.toFixed(1)}%`;
    H.lastHealth = hp;
  }
  if (armor !== H.lastArmor) {
    if (H.armorBar) H.armorBar.style.width = `${armor.toFixed(1)}%`;
    H.lastArmor = armor;
  }
}
function paintStars(H, wanted) {
  const live = clamp(Math.round(wanted || 0), 0, 5);
  if (live === H.lastStars) return;
  if (live > H.lastStars && H.starsEl) {
    H.starsEl.classList.remove('pulse');
    void H.starsEl.offsetWidth;
    H.starsEl.classList.add('pulse');
  }
  H.stars.forEach((s, i) => {
    s.textContent = i < live ? ON : OFF;
    s.className = i < live ? 'on' : 'wait';
  });
  H.lastStars = live;
}
function paintMoney(H, money, dt) {
  const target = Math.round(money || 0), gap = target - H.shownMoney;
  if (gap) {
    H.shownMoney += Math.sign(gap) * Math.max(1, Math.round(Math.abs(gap) * Math.min(1, dt * 9)));
    if (Math.abs(target - H.shownMoney) < 1) H.shownMoney = target;
  }
  if (H.moneyEl) H.moneyEl.textContent = `$${Math.round(H.shownMoney)}`;
}
function paintWeapon(H, P, inCar) {
  if (!P) return;
  const label = P.weapon === 'rifle' ? `Rifle ${P.ammo || 0}` : 'Pistol';
  if (label !== H.lastWeapon) {
    if (H.weaponEl) H.weaponEl.textContent = label;
    H.lastWeapon = label;
  }
  if (H.crosshair) H.crosshair.style.display = inCar ? 'none' : '';
}
function paintObjective(H, G, dt) {
  const line = G.objective;
  let text = '';
  if (H.bannerMs > 0) {
    H.bannerMs = Math.max(0, H.bannerMs - dt);
    text = H.banner;
  } else if (line) {
    const far = line.dist !== null && line.dist !== undefined ? ` \u00b7 ${Math.round(line.dist)} m` : '';
    text = `${line.title} \u2014 ${line.text}${far}`;
  }
  if (H.objectiveEl && text !== H.lastObjective) {
    H.objectiveEl.textContent = text;
    H.objectiveEl.classList.toggle('show', !!text);
    H.lastObjective = text;
  }
  if (H.timerEl) {
    const shown = line && line.timer > 0 ? clock(line.timer) : '';
    if (shown !== H.lastTimer) {
      H.timerEl.textContent = shown;
      H.lastTimer = shown;
    }
  }
}
export function updateHUD(H, G, dt) {
  if (!H || !G) return;
  H.frame++;
  const P = G.P || {}, car = G.inCar;
  paintMoney(H, G.E ? G.E.money : 0, dt);
  paintStars(H, G.PO ? G.PO.stars : 0);
  paintBars(H, P);
  paintWeapon(H, P, !!car);
  const speed = car ? `${Math.round(Math.abs(car.speed || 0) * 3.6)} km/h` : '';
  if (H.speedEl && speed !== H.lastSpeed) {
    H.speedEl.textContent = speed;
    H.lastSpeed = speed;
  }
  paintObjective(H, G, dt);
  tickToasts(H, dt);
}
export function flashHurt(H) {
  if (!H || !H.root) return;
  H.root.classList.add('hurt');
  window.setTimeout(() => H.root && H.root.classList.remove('hurt'), 200);
}
export function showHUD(H, on) {
  if (!H || !H.root) return;
  H.root.classList.toggle('hidden', !on);
  H.root.classList.toggle('playing', !!on);
}
function drawDiamond(c, x, z, hue) {
  const pad = 7, mid = PX / 2;
  let px = mx(x), py = mz(z);
  const off = px < pad || py < pad || px > PX - pad || py > PX - pad;
  if (off) {
    const dx = px - mid, dy = py - mid, reach = mid - pad, len = Math.hypot(dx, dy) || 1;
    px = mid + (dx / len) * reach;
    py = mid + (dy / len) * reach;
  }
  const s = off ? 4 : 5.5;
  c.save();
  c.translate(px, py);
  c.rotate(Math.PI / 4);
  c.fillStyle = hue;
  c.strokeStyle = 'rgba(30, 22, 4, 0.85)';
  c.lineWidth = 1.5;
  c.fillRect(-s, -s, s * 2, s * 2);
  c.strokeRect(-s, -s, s * 2, s * 2);
  c.restore();
}
function drawStamp(c, spot, letter, fill) {
  const px = mx(spot.x), py = mz(spot.z);
  c.fillStyle = 'rgba(10, 22, 32, 0.82)';
  c.beginPath();
  c.arc(px, py, 6.5, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = fill;
  c.font = 'bold 9px "Trebuchet MS", sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(letter, px, py + 0.5);
}
export function drawMinimap(H, G) {
  if (!H || !H.ctx || !G || H.frame % 2 !== 0) return;
  const c = H.ctx, W = G.W, city = G.city || { buildings: [] };
  const here = G.inCar ? G.inCar : G.P.pos || { x: 0, z: 0 };
  const roadHalf = CONFIG.world.roadHalf, pitch = CONFIG.world.pitch, span = PARK;
  c.clearRect(0, 0, PX, PX);
  for (const [hex, x0, x1] of [['#3d8ea8', 0, PX], ['#e7dfcf', mx(SEA), PX], ['#d9d0be', mx(SEA), mx(-CONFIG.world.half)]]) {
    c.fillStyle = hex;
    c.fillRect(x0, 0, x1 - x0, PX);
  }
  c.fillStyle = '#f3ede0';
  for (let i = 0; i < ROADS.length - 1; i++) {
    for (let j = 0; j < ROADS.length - 1; j++) {
      const w = (ROADS[i + 1] - ROADS[i] - roadHalf * 2) * SCALE;
      const d = (ROADS[j + 1] - ROADS[j] - roadHalf * 2) * SCALE;
      if (w > 0 && d > 0) c.fillRect(mx(ROADS[i] + roadHalf), mz(ROADS[j] + roadHalf), w, d);
    }
  }
  c.fillStyle = '#6fae5e';
  c.fillRect(mx(span.x0), mz(span.z0), (span.x1 - span.x0) * SCALE, (span.z1 - span.z0) * SCALE);
  if (W && W.roads && W.roads.nodes) {
    c.strokeStyle = '#818b95';
    c.lineWidth = 3.4;
    c.beginPath();
    for (const n of W.roads.nodes) {
      c.moveTo(mx(n.x), mz(n.z));
      c.lineTo(mx(n.x), mz(n.z - pitch));
      c.lineTo(mx(n.x + pitch), mz(n.z - pitch));
    }
    c.stroke();
  }
  for (const b of city.buildings || []) {
    c.fillStyle = b.x >= 0 ? '#8fa2b4' : '#cbb4a4';
    c.fillRect(mx(b.x - b.w / 2), mz(b.z - b.d / 2), Math.max(2, b.w * SCALE), Math.max(2, b.d * SCALE));
  }
  const mk = city.markers || {};
  if (mk.vineMart) drawStamp(c, mk.vineMart, 'S', '#74e2b6');
  if (mk.glassOrchid) drawStamp(c, mk.glassOrchid, '!', '#ffd24a');
  const dot = (x, z, hex, size) => {
    c.fillStyle = hex;
    c.fillRect(mx(x) - size / 2, mz(z) - size / 2, size, size);
  };
  for (const car of G.cars || []) {
    if (!car.wrecked) dot(car.x, car.z, car.player ? '#ffffff' : car.kind === 'police' ? '#ff3b30' : '#6fc6ff', 3);
  }
  for (const car of G.traffic || []) {
    if (Math.hypot(car.x - here.x, car.z - here.z) < 120) dot(car.x, car.z, '#ffffff', 2.6);
  }
  for (const cop of (G.PO && G.PO.cars) || []) if (!cop.wrecked) dot(cop.x, cop.z, '#ff3b30', 3.4);
  for (const cop of (G.PO && G.PO.foot) || []) if (!cop.down) dot(cop.x, cop.z, '#ff3b30', 2.6);
  c.fillStyle = 'rgba(70, 84, 96, 0.85)';
  for (const ped of G.peds || []) {
    if (!ped || ped.gone || ped.state === 'ride' || ped.state === 'down') continue;
    if (Math.hypot(ped.pos.x - here.x, ped.pos.z - here.z) > PED_RANGE) continue;
    c.fillRect(mx(ped.pos.x), mz(ped.pos.z), 1, 1);
  }
  const fare = G.E && G.E.fareState;
  const stop = fare && fare.dest ? fare.dest : fare && fare.phase === 'waiting' ? fare.ped && fare.ped.pos : null;
  if (stop) drawDiamond(c, stop.x, stop.z, '#74e2b6');
  if (G.objective && G.objective.at) drawDiamond(c, G.objective.at.x, G.objective.at.z, '#ffd24a');
  c.save();
  c.translate(mx(here.x), mz(here.z));
  c.rotate(-(G.inCar ? G.inCar.heading : (G.P ? G.P.yaw : 0)));
  c.fillStyle = '#ffffff';
  c.strokeStyle = '#12202c';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, -5.5);
  c.lineTo(3.6, 4.2);
  c.lineTo(0, 2.2);
  c.lineTo(-3.6, 4.2);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();
}
