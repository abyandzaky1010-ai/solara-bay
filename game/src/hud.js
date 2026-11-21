// HUD: DOM widgets (objective, wanted stars, money, health, ammo, speed, prompts, dialog lines,
// overlays) plus the required canvas minimap with streets, blocks, park, bay, player arrow,
// traffic, flashing police and the mission marker.
import { CFG } from './config.js';
import { W } from './world.js';

const el = {};
const IDS = ['hud', 'objective', 'objtext', 'stars', 'minimap', 'money', 'hpfill', 'gun', 'speed',
  'prompt', 'dialog', 'vignette', 'start', 'btnNew', 'btnContinue', 'pause', 'btnResume',
  'busted', 'wasted', 'mdone', 'mdtitle', 'mdtext', 'btnOk', 'shop'];

export function initHUD() {
  for (const id of IDS) el[id] = document.getElementById(id);
}

export function showStart(hasSave) {
  el.start.classList.remove('hidden');
  el.hud.classList.add('hidden');
  if (hasSave) el.btnContinue.classList.remove('hidden');
}
export function hideStart() {
  el.start.classList.add('hidden');
  el.hud.classList.remove('hidden');
}
export function showOverlay(id) { el[id].classList.remove('hidden'); }
export function hideOverlay(id) { el[id].classList.add('hidden'); }

export function updateHUD(dt) {
  if (W.mode === 'start') return;
  const p = W.player;
  let s = '';
  for (let i = 0; i < 5; i++) s += i < W.wanted ? '★' : '<span class="off">★</span>';
  el.stars.innerHTML = s;
  el.stars.className = W.wanted > 0 && W.time - W.lastCrime < 3 ? 'blink' : '';
  el.money.textContent = '$' + W.money;
  el.hpfill.style.width = Math.max(0, p.hp) + '%';
  el.gun.textContent = p.inCar ? 'DRIVING' : `PISTOL ${p.ammo}/${p.pool}`;
  el.speed.textContent = p.inCar ? Math.round(Math.abs(p.inCar.speed) * 3.6) + ' km/h' : '';
  el.objtext.textContent = W.objective || '';
  el.objective.style.display = W.objective ? '' : 'none';
  el.prompt.textContent = W.prompt || '';
  el.prompt.style.display = W.prompt ? '' : 'none';
  if (W.dialogT > 0) W.dialogT -= dt;
  else if (W.dialog.length) { el.dialog.textContent = W.dialog.shift(); el.dialog.classList.remove('hidden'); W.dialogT = 4.5; }
  else el.dialog.classList.add('hidden');
  const v = Math.max(0, 1 - p.hp / CFG.playerHp);
  el.vignette.style.boxShadow = `inset 0 0 ${60 + v * 100}px rgba(220,30,30,${(v * 0.5).toFixed(2)})`;
  el.shop.classList.toggle('hidden', !W.shopOpen);
  if (W.mode === 'busted') showOverlay('busted'); else hideOverlay('busted');
  if (W.mode === 'wasted') showOverlay('wasted'); else hideOverlay('wasted');
  if (W.mdone) { el.mdtitle.textContent = W.mdone.title; el.mdtext.textContent = W.mdone.text; showOverlay('mdone'); }
  else hideOverlay('mdone');
  drawMinimap();
}

function drawMinimap() {
  const c = el.minimap;
  const g = c.getContext('2d');
  const S = c.width / CFG.world;
  const mx = (x) => c.width / 2 + x * S;
  const mz = (z) => c.height / 2 + z * S;
  g.fillStyle = '#0e141c';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#1d4e6e'; // the bay, south (bottom of the map)
  g.fillRect(0, mz(CFG.waterZ), c.width, c.height - mz(CFG.waterZ));
  g.fillStyle = '#2c5a34'; // the park
  if (W.park) g.fillRect(mx(W.park.x - 18), mz(W.park.z - 18), 36 * S, 36 * S);
  g.strokeStyle = '#4a5262';
  g.lineWidth = Math.max(2, CFG.roadW * S * 0.7);
  for (const p of CFG.roadAt) {
    g.beginPath(); g.moveTo(mx(p), mz(-200)); g.lineTo(mx(p), mz(CFG.beachZ)); g.stroke();
    g.beginPath(); g.moveTo(mx(-200), mz(p)); g.lineTo(mx(200), mz(p)); g.stroke();
  }
  g.fillStyle = '#7c8698';
  for (const b of W.blocks) if (b.build && b.used) g.fillRect(mx(b.x) - 3, mz(b.z) - 3, 6, 6);
  const blink = Math.floor(W.time * 6) % 2 === 0;
  for (const car of W.cars) {
    if (car.dead) continue;
    if (car.kind === 'police') g.fillStyle = blink ? '#ff4040' : '#4060ff';
    else if (car.kind === 'taxi' || car.kind === 'target') g.fillStyle = '#f5c518';
    else if (car.kind === 'gang') g.fillStyle = '#c04040';
    else g.fillStyle = '#b8bcc8';
    g.fillRect(mx(car.pos.x) - 1.5, mz(car.pos.z) - 1.5, 3, 3);
  }
  if (W.markerPos) {
    g.strokeStyle = '#ffc857';
    g.lineWidth = 2;
    const r = 5 + Math.sin(W.time * 5) * 1.5;
    g.beginPath(); g.arc(mx(W.markerPos.x), mz(W.markerPos.z), r, 0, 7); g.stroke();
  }
  // player arrow
  const p = W.player;
  const px = p.inCar ? p.inCar.pos.x : p.pos.x;
  const pz = p.inCar ? p.inCar.pos.z : p.pos.z;
  g.save();
  g.translate(mx(px), mz(pz));
  g.rotate(Math.atan2(Math.sin(W.camYaw), -Math.cos(W.camYaw)));
  g.fillStyle = '#ffffff';
  g.beginPath(); g.moveTo(0, -5); g.lineTo(3.5, 4); g.lineTo(-3.5, 4); g.closePath(); g.fill();
  g.restore();
  g.fillStyle = '#fff';
  g.font = 'bold 10px sans-serif';
  g.fillText('N', 4, 12);
}
