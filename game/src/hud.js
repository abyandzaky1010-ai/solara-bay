// Solara Bay — the HUD: wallet, heat, vitals, objective, toasts, round minimap.
import { CONFIG } from './config.js';

const MM = 180, SPAN = 440, K = MM / SPAN, HALF = SPAN / 2;
const GRID = [-160, -80, 0, 80, 160];
const EDGE = CONFIG.world.roadHalf;
const TOAST_MAX = 3, TOAST_LIFE = 2.5, PED_RANGE = 40;
const STAR_INK = ['#ffd24a', '#ffcd3c', '#ffb43c', '#ff8f45', '#ff6247'];
const STAMPS = [['vineMart', 'S', '#ffd24a'], ['glassOrchid', '!', '#7fe0c0'], ['station', 'P', '#9fc3d9']];
const PANELS = ['title', 'pause', 'shop', 'complete', 'busted', 'wasted'];
const SHOP = ['rifle', 'ammo', 'armor', 'medkit'];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mx = (x) => (x + HALF) * K; // world x to minimap column
const mz = (z) => (z + HALF) * K; // world z to minimap row

export function createHUD() {
  const $ = (id) => document.getElementById(id);
  const H = {
    root: $('hud'), starsEl: $('stars'), moneyEl: $('money'), healthBar: $('healthbar'),
    armorBar: $('armorbar'), weaponEl: $('weapon'), ammoEl: $('ammotext'), speedEl: $('speed'),
    objectiveEl: $('objective'), timerEl: $('timer'), toastsEl: $('toasts'), minimap: $('minimap'),
    crosshair: $('crosshair'), saveStatus: $('savestatus'), shopMoney: $('shopmoney'),
    completeTitle: $('complete-title'), completeStory: $('complete-story'),
    completeReward: $('complete-reward'), bustedFee: $('busted-fee'), wastedFee: $('wasted-fee'),
    btnContinue: $('btn-continue'), btnNew: $('btn-new'), btnResume: $('btn-resume'),
    btnNext: $('btn-next'), btnShopClose: $('btn-shop-close'), btnBusted: $('btn-busted'),
    btnWasted: $('btn-wasted'), buyButtons: {}, panels: {}, ctx: null, stars: [], toastList: [],
    frame: 0, shownMoney: 0, lastStars: -1, starPulse: 0,
    bannerT: 0, bannerText: '', hurtT: 0, lastHealth: -1, lastArmor: -1,
  };
  for (const id of PANELS) H.panels[id] = $(id);
  for (const item of SHOP) H.buyButtons[item] = $(`buy-${item}`);

  if (H.starsEl) {
    for (let i = 0; i < 5; i++) {
      const s = document.createElement('span');
      s.className = 'off';
      s.textContent = '\u2605';
      H.starsEl.appendChild(s);
      H.stars.push(s);
    }
  }
  if (H.minimap) H.ctx = H.minimap.getContext('2d');
  if (H.toastsEl) H.toastsEl.textContent = '';
  return H;
}

/** Corner note; only the newest three stay. */
export function toast(H, txt) {
  if (!H || !H.toastsEl || !txt) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = String(txt);
  el.style.opacity = '1';
  H.toastsEl.appendChild(el);
  H.toastList.push({ el, t: 0 });
  while (H.toastList.length > TOAST_MAX) {
    const old = H.toastList.shift();
    if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
  }
}

export function setBanner(H, txt, ms = 2200) {
  if (!H) return;
  H.bannerText = txt || '';
  H.bannerT = Math.max(0, ms) / 1000;
  if (H.objectiveEl && H.bannerText) {
    H.objectiveEl.textContent = H.bannerText;
    H.objectiveEl.classList.add('show');
  }
}

export function showPanel(H, id) {
  hidePanels(H);
  const p = H && H.panels ? H.panels[id] : null;
  if (p) p.classList.add('show');
}

export function hidePanels(H) {
  if (!H || !H.panels) return;
  for (const id of Object.keys(H.panels)) H.panels[id] && H.panels[id].classList.remove('show');
}

function setBar(bar, frac) {
  const fill = bar && bar.firstElementChild;
  if (fill) fill.style.width = `${Math.round(clamp01(frac) * 100)}%`;
}

/** Heat ramps gold to red as the stars stack up, and pulses on each gain. */
function paintStars(H, wanted, dt) {
  if (!H.stars.length) return;
  if (wanted !== H.lastStars) {
    if (wanted > H.lastStars) H.starPulse = 0.4;
    const ink = STAR_INK[Math.min(4, Math.max(0, wanted - 1))];
    H.stars.forEach((s, i) => { s.className = i < wanted ? 'on' : 'off'; s.style.color = i < wanted ? ink : ''; });
    H.lastStars = wanted;
  }
  if (!H.starsEl) return;
  H.starPulse = H.starPulse > 0 ? H.starPulse - dt : 0;
  H.starsEl.classList.toggle('pulse', H.starPulse > 0);
}

const clock = (sec) => {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function updateObjective(H, G, dt) {
  if (H.bannerT > 0) {
    H.bannerT -= dt;
    if (H.bannerT <= 0) {
      H.bannerText = '';
      H.objectiveEl && H.objectiveEl.classList.remove('show');
    }
  }
  const o = G.objective, banner = H.bannerT > 0 && !!H.bannerText;
  if (H.objectiveEl) {
    const cls = H.objectiveEl.classList;
    if (banner) cls.add('show');
    else if (o) {
      const far = o.dist == null ? '' : o.dist > 4 ? ` · ${Math.round(o.dist)} m` : ' · here';
      H.objectiveEl.textContent = `${o.title} — ${o.text}${far}`;
      cls.add('show');
    } else cls.remove('show');
  }
  if (H.timerEl) {
    const live = !!(!banner && o && o.timer > 0);
    H.timerEl.classList.toggle('show', live);
    H.timerEl.classList.toggle('hurry', live && o.timer < 15);
    if (live) H.timerEl.textContent = clock(o.timer);
  }
}

function ageToasts(H, dt) {
  for (let i = H.toastList.length - 1; i >= 0; i--) {
    const t = H.toastList[i];
    t.t += dt;
    if (t.t >= TOAST_LIFE) {
      t.el.parentNode && t.el.parentNode.removeChild(t.el);
      H.toastList.splice(i, 1);
    } else if (t.t > TOAST_LIFE - 0.8) {
      t.el.style.opacity = String(Math.max(0, (TOAST_LIFE - t.t) / 0.8));
    }
  }
}

/** Every frame, screen on: wallet, heat, vitals, gun, speed, objective, toasts. */
export function updateHUD(H, G, dt) {
  if (!H || !G) return;
  H.frame++;

  // Wallet rolls toward the real balance so payouts read as motion.
  const money = G.E ? G.E.money : 0;
  if (H.shownMoney !== money) {
    const gap = money - H.shownMoney;
    H.shownMoney += Math.sign(gap) * Math.max(1, Math.round(Math.abs(gap) * Math.min(1, dt * 8)));
    if (Math.abs(money - H.shownMoney) < 1) H.shownMoney = money;
  }
  if (H.moneyEl) H.moneyEl.textContent = `$${Math.round(H.shownMoney)}`;

  paintStars(H, G.PO ? Math.max(0, Math.min(5, G.PO.stars || 0)) : 0, dt);

  const P = G.P;
  if (P) {
    if (P.hp !== H.lastHealth) { setBar(H.healthBar, P.hp / CONFIG.player.hp); H.lastHealth = P.hp; }
    if (P.armor !== H.lastArmor) { setBar(H.armorBar, P.armor / 100); H.lastArmor = P.armor; }
    const rifle = P.rifle && P.weapon === 'rifle';
    if (H.weaponEl) H.weaponEl.textContent = rifle ? 'Rifle' : 'Pistol';
    if (H.ammoEl) H.ammoEl.textContent = rifle ? String(P.ammo || 0) : '\u221e';
  }

  const car = G.inCar;
  if (H.speedEl) {
    if (car) H.speedEl.textContent = `${Math.round(Math.abs(car.speed || 0) * 3.6)} km/h`;
    H.speedEl.classList.toggle('show', !!car);
  }
  if (H.crosshair) H.crosshair.style.display = car ? 'none' : '';

  updateObjective(H, G, dt);
  ageToasts(H, dt);
  if (H.hurtT > 0) {
    H.hurtT -= dt;
    if (H.hurtT <= 0 && H.root) H.root.classList.remove('hurt');
  }
}

/** Red edge flash from damage; render.js calls this. */
export function flashHurt(H, ms = 200) {
  if (!H) return;
  if (H.root) {
    H.root.classList.remove('hurt');
    void H.root.offsetWidth; // restart the CSS animation on back-to-back hits
    H.root.classList.add('hurt');
  }
  H.hurtT = Math.max(0, ms) / 1000;
}

/* ------------------------------------------------------------------- minimap */

/** Round badge with a glyph: shop, mission giver, station. */
function stamp(c, x, z, glyph, bg) {
  const px = mx(x), pz = mz(z);
  c.beginPath();
  c.arc(px, pz, 6, 0, Math.PI * 2);
  c.fillStyle = bg;
  c.fill();
  c.fillStyle = '#101820';
  c.font = 'bold 8px "Trebuchet MS", sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(glyph, px, pz + 0.5);
}

/** Gold diamond, nudged to the rim when the target is off the map. */
function diamond(c, x, z, size) {
  const cx = Math.max(7, Math.min(MM - 7, mx(x))), cz = Math.max(7, Math.min(MM - 7, mz(z)));
  c.beginPath();
  c.moveTo(cx, cz - size);
  c.lineTo(cx + size, cz);
  c.lineTo(cx, cz + size);
  c.lineTo(cx - size, cz);
  c.closePath();
  c.fillStyle = '#ffd24a';
  c.fill();
  c.strokeStyle = '#3a2f0a';
  c.lineWidth = 1;
  c.stroke();
}

/** Pale cream between the roads, with the streets kept as dark ribbons. */
function paintBlocks(c) {
  for (let i = 0; i < GRID.length; i++) {
    const lo = GRID[i] - EDGE, hi = GRID[i] + EDGE;
    c.fillRect(mx(lo), 0, hi - lo, MM);
    c.fillRect(0, mz(lo), MM, hi - lo);
    if (i === GRID.length - 1) break;
    const a = hi, b = GRID[i + 1] - EDGE, span = (b - a) * K;
    for (let j = 0; j < GRID.length - 1; j++) {
      c.fillRect(mx(a), mz(GRID[j] + EDGE), span, (GRID[j + 1] - EDGE - GRID[j] - EDGE) * K);
    }
  }
}

/** Road links straight from the graph, so the map matches what cars drive. */
function paintLinks(c, nodes) {
  if (!nodes) return;
  c.strokeStyle = 'rgba(232,224,203,0.85)';
  c.lineWidth = 1;
  c.beginPath();
  nodes.forEach((na, a) => {
    for (const b of na.neighbors || []) {
      if (b >= a && nodes[b]) {
        c.moveTo(mx(na.x), mz(na.z));
        c.lineTo(mx(nodes[b].x), mz(nodes[b].z));
      }
    }
  });
  c.stroke();
}

/** The district map: sea, streets, blocks, park, buildings, blips. */
export function drawMinimap(H, G) {
  if (!H || !H.ctx || !G) return;
  const c = H.ctx;
  const here = G.inCar || (G.P && G.P.pos) || { x: 0, z: 0 };
  const city = G.city || { park: CONFIG.world.parkRect, buildings: [], markers: {} };
  const seaX = mx(CONFIG.world.sea);
  const sea = c.createLinearGradient(seaX, 0, 0, 0);

  c.fillStyle = '#d9cdb0'; // land base
  c.fillRect(0, 0, MM, MM);
  sea.addColorStop(0, '#3d8ea8');
  sea.addColorStop(1, '#6fb6c9');
  c.fillStyle = sea;
  c.fillRect(0, 0, seaX, MM); // the bay down the west edge
  c.fillStyle = '#efe6d2';
  paintBlocks(c);
  paintLinks(c, G.W && G.W.roads ? G.W.roads.nodes : null);

  const pk = city.park;
  c.fillStyle = '#6fae5e';
  c.fillRect(mx(pk.minX), mz(pk.minZ), (pk.maxX - pk.minX) * K + 1, (pk.maxZ - pk.minZ) * K + 1);
  if (pk.pond) {
    c.fillStyle = '#3d8ea8';
    c.beginPath();
    c.arc(mx(pk.pond.x), mz(pk.pond.z), Math.max(1.5, pk.pond.r * K), 0, Math.PI * 2);
    c.fill();
  }
  for (const b of city.buildings || []) { // tall towers read darker
    c.fillStyle = b.h > 30 ? '#5d6f82' : '#c3a893';
    c.fillRect(mx(b.x) - Math.max(2, b.w * K) / 2, mz(b.z) - Math.max(2, b.d * K) / 2, Math.max(2, b.w * K), Math.max(2, b.d * K));
  }
  const mk = city.markers || {};
  for (const [key, glyph, bg] of STAMPS) if (mk[key]) stamp(c, mk[key].x, mk[key].z, glyph, bg);

  // Parked cars blue, ambient traffic white, cruisers and officers red.
  c.fillStyle = '#4d8dff';
  for (const car of G.cars || []) if (car !== G.inCar) c.fillRect(mx(car.x) - 1, mz(car.z) - 1, 2.5, 2.5);
  c.fillStyle = '#ffffff';
  for (const car of G.traffic || []) c.fillRect(mx(car.x) - 1, mz(car.z) - 1, 2.5, 2.5);
  if (G.PO) {
    c.fillStyle = '#ff3b30';
    for (const car of G.PO.cars || []) c.fillRect(mx(car.x) - 1.5, mz(car.z) - 1.5, 3, 3);
    for (const f of G.PO.foot || []) if (!f.down) c.fillRect(mx(f.x) - 1, mz(f.z) - 1, 2.5, 2.5);
  }

  // Pedestrians: one grey pixel, close ones only, and only on even frames.
  if (H.frame % 2 === 0) {
    c.fillStyle = 'rgba(60,60,60,0.8)';
    for (const p of G.peds || []) {
      const q = p && (p.pos || p);
      if (!q || p.gone || p.state === 'down') continue;
      if (Math.hypot(q.x - here.x, q.z - here.z) > PED_RANGE) continue;
      c.fillRect(mx(q.x), mz(q.z), 1, 1.5);
    }
  }

  // Mission marker, then an active fare.
  const obj = G.objective;
  if (obj && obj.at) diamond(c, obj.at.x, obj.at.z, 4);
  const fare = G.E && G.E.fareState;
  if (fare && fare.phase === 'riding' && fare.dest) diamond(c, fare.dest.x, fare.dest.z, 3.5);

  // The player: a triangle that turns with the character or the car.
  const yaw = G.inCar ? G.inCar.heading : (G.P ? G.P.yaw : 0);
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), sx = mx(here.x), sz = mz(here.z);
  const bx = fz * 3.4 - fx * 3.5, bz = fx * 3.4 + fz * 3.5;
  c.beginPath();
  c.moveTo(sx + fx * 6, sz + fz * 6);
  c.lineTo(sx - bx, sz - bz);
  c.lineTo(sx + bx, sz + bz);
  c.closePath();
  c.fillStyle = '#ffffff';
  c.fill();
  c.strokeStyle = '#16202c';
  c.lineWidth = 1.2;
  c.stroke();

  c.fillStyle = 'rgba(246,251,255,0.85)';
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.fillText('N', MM - 12, 4);
}
