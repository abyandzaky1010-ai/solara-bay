import * as cfg from './config.js';
import * as rnd from './random.js';
import * as inp from './input.js';
import * as wld from './world.js';
import * as cty from './city.js';
import * as ply from './player.js';
import * as veh from './car.js';
import * as trf from './traffic.js';
import * as pds from './peds.js';
import * as pol from './police.js';
import * as msn from './missions.js';
import * as eco from './economy.js';
import * as hud from './hud.js';
import * as sfx from './sfx.js';
import * as fx from './render.js';
import * as sht from './shots.js';
const el = (id) => document.getElementById(id);
const CFG = cfg.CONFIG, COST = CFG.economy, WANT = CFG.wanted.stars, PC = CFG.player, STEP = cfg.STEP, S = sfx.S;
const tell = hud.toast, showP = hud.showPanel, hideP = hud.hidePanels, showHud = hud.showHUD, save = eco.saveGame;
const far = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const hold = (I, a, b) => (I.down(a) ? 1 : 0) - (I.down(b) ? 1 : 0);
const fail = (e) => {
 const m = String((e && e.message) || e).slice(0,100);
 document.title = 'SB-error-' + m;
 const b = el('boot-error') || document.body.appendChild(document.createElement('pre'));
 b.id = 'boot-error'; b.textContent = m;
};
function boot() {
 const q = new URLSearchParams(location.search);
 const seed = rnd.hashString(q.get('seed') || '1337');
 const W = wld.initWorld(document.createElement('canvas'));
 el('app').appendChild(W.canvas);
 const town = cty.buildCity(W, rnd.makeRng(seed));
 const I = inp.createInput(W.canvas);
 const P = ply.createPlayer(W, town);
 const rng = rnd.makeRng(seed + 7);
 const sound = { ...S, ...sfx.initSfx(), engineOff: sfx.engineOff, engine: (on) => (on ? sfx.engineOn('sport') : sfx.engineOff()) };
 const cars = town.spawns.carParks.map((p) => {
  const c = veh.makeCar(p.kind, p.x, p.z, p.heading || 0, p.color);
  c.tag = p.tag;
  W.scene.add(c.mesh);
  return c;
 });
 const traffic = trf.spawnTraffic(W, rng, 11);
 traffic.forEach((c) => W.scene.add(c.mesh));
 const peds = pds.spawnPeds(W, town, rng, 15);
 const PO = pol.initPolice(W, town, rnd.makeRng(seed + 11));
 const M = msn.initMissions();
 const saved = eco.loadGame(), E = eco.initEconomy(saved);
 const H = hud.createHUD();
 const crate = town.pickup;
 let loot = false;
 const cash = () => { H.shopStatus.textContent = `Cash: $${(E.money|0)}`; };
 const stars = (n) => pol.addStars(PO, n, G);
 function wreck(car) {
  if (!car || car.blown) return;
  const lit = (b) => far(b.pos || b, car) < 4 && !b.down && b.state !== 'down';
  car.blown = true;
  fx.spawnExplosion({ x: car.x, y: 0.9, z: car.z });
  S.explode();
  PO.foot.forEach((c) => { if (lit(c)) pol.officerHit(PO, c, 99, G); });
  peds.forEach((b) => { if (lit(b)) b.hp = 0; });
  if (G.inCar === car) { G.inCar = null; I.unlock(); G.wasted(); }
 }
 function recover() {
  const out = G.screen === 'busted';
  eco.addMoney(E, -Math.min(E.money, out ? COST.bustedFee : COST.hospitalFee), null);
  pol.clearWanted(PO, G);
  ply.respawnPlayer(P, G, town.places[out ? 'station' : 'hospital']);
  P.dead = false; P.hp = PC.hp; P.group.visible = true;
  hideP(H); save(G); G.screen = 'play';
 }
 function leave() {
  const s = veh.seatPoints(G.inCar);
  Object.assign(G.inCar, { player: false, occupant: null, speed: 0 });
  G.inCar = null;
  P.pos.x = s.x; P.pos.z = s.z;
  P.group.position.set(s.x, 0, s.z); P.group.visible = true;
  sfx.engineOff();
 }
 function take(car) {
  if (!car || car.wrecked) return;
  const cop = car.kind === 'police';
  if (cop) stars(WANT.policeCar);
  if (car.occupant) {
  if (!cop) stars(WANT.theftOccupied);
  const out = peds.find((p) => p.state === 'walk'), side = car.heading + Math.PI / 2;
  if (out) {
    Object.assign(out, { state: 'flee', fleeT: 6, leg: null });
    Object.assign(out.pos, { x: car.x + Math.sin(side) * 2, z: car.z + Math.cos(side) * 2 });
    out.mesh.visible = true;
    tell(H, 'Stolen car. Noticed.');
  }
  }
  Object.assign(car, { occupant: 'player', player: true });
  G.inCar = car;
  sfx.engineOn(car.kind);
  I.lock();
 }
 const nearest = () => cars.concat(traffic).filter((c) => !c.wrecked && far(c, P.pos) < 3.2)
  .sort((a, b) => far(a, P.pos) - far(b, P.pos))[0];
 const end = (how) => {
  if (G.screen !== 'play') return;
  if (G.inCar) leave();
  G.screen = how; showP(H, how); S.jingle(how === 'complete');
 };
 function missionComplete(pay, story) {
  eco.addMoney(E, pay, H);
  H.completeTitle.textContent = 'Job done'; H.completeStory.textContent = story;
  H.completeReward.textContent = `+$${pay}`;
  save(G); end('complete');
 }
 const G = Object.assign({ W, city: town, P, cars, traffic, peds, PO, M, E, H, I, effects: fx, sound, rng, cash, stars },
  { screen: 'title', inCar: null, alarm: 0, alarmX: 0, alarmZ: 0, time: 0, saveT: 0, objective: null,
  shot: q.get('shot') || null, explodeCar: wreck, onCarExplode: wreck, addStars: stars, damagePed: () => {},
  damageTrafficCar: (c, d) => { c.hp -= d; if (c.hp <= 0) wreck(c); }, missionComplete, toast: (t) => tell(H, t),
  saveGame: () => save(G), clearWanted: () => pol.clearWanted(PO, G), damagePlayer: (a) => ply.damagePlayer(P, a, G),
  damageCop: (c, d) => pol.officerHit(PO, c, d, G), bust: () => end('busted'), wasted: () => end('wasted'),
  missionStart: (d) => { hud.setBanner(H, d.title, 2600); tell(H, d.brief); }, missionFail: (t, h) => tell(H, `${t}: ${h}`),
  onPedHit: (p, how) => stars(how === 'car' ? WANT.hitPed : WANT.killPed), onPedKill: () => stars(WANT.killPed),
  onCopDown: () => stars(WANT.killCop) });
 const resume = (fn) => () => { hideP(H); showHud(H, true); G.screen = 'play'; I.lock(); fn?.(); };
 const on = {};
 on.continue = resume(() => {
  const s = saved || {}; E.money = s.money || 0;
  Object.assign(P, { rifle: !!s.rifle, ammo: s.ammo || 0, armor: s.armor || 0, weapon: s.rifle ? 'rifle' : 'pistol' });
  msn.restoreMissions(M, s);
 });
 on.new = resume(() => { eco.clearSave(); tell(H, 'Vesper waits at the Glass Orchid'); });
 on.title = () => { save(G); showHud(H, false); I.unlock(); G.screen = 'title'; showP(H, 'title'); };
 on.shop = () => (far(town.places.vineMart, P.pos) > 3 ? tell(H, 'Vine Mart is the shop')
  : (cash(), G.screen = 'shop', showP(H, 'shop')));
 on.resume = on['shop-close'] = on['complete-next'] = resume();
 on.busted = on.wasted = resume(recover);
 for (const id in on) el('btn-' + id).addEventListener('click', on[id]);
 if (saved) el('btn-continue').classList.remove('hidden');
 eco.SHOP.forEach((r) => document.querySelector(`[data-buy="${r.item}"]`)
  .addEventListener('click', () => { eco.buyItem(E, P, r.item, G); cash(); }));
 W.canvas.addEventListener('mousedown', (ev) => {
  if (G.screen !== 'play' || ev.button) return;
  if (!I.locked) return I.lock();
  if (!G.inCar) ply.fireWeapon(P, G);
 });
 function step(dt) {
  const live = G.screen === 'play', hit = I.wasPressed, car = G.inCar;
  G.time += dt;
  if (hit('Escape')) {
  G.screen = live ? 'pause' : 'play';
  live ? (showP(H, 'pause'), I.unlock()) : (hideP(H), I.lock());
  }
  if (!live) { fx.updateEffects(W, dt); wld.renderFrame(W); return; }
  if (hit('KeyE')) (car ? leave() : take(nearest()));
  if (hit('KeyF') && !car) ply.fireWeapon(P, G);
  if (hit('KeyQ') && P.rifle) P.weapon = P.weapon === 'rifle' ? 'pistol' : 'rifle';
  if (hit('KeyB') && !car) on.shop();
  if (hit('KeyT') && car && car.kind === 'taxi') eco.setFares(E, !E.fares, G);
  if (crate && !loot && far(crate, P.pos) < 2) {
  loot = true; ply.givePickup(P, G, 'rifle'); S.chime();
  tell(H, 'Rifle from the crate. Q swaps.');
  }
  if (car) {
  veh.updateCarDrive(car, hold(I, 'KeyW', 'KeyS'), hold(I, 'KeyA', 'KeyD'), I.down('Space'), dt, W, G);
  sfx.engineUpdate(Math.min(1, Math.abs(car.speed) / car.max), dt);
  } else ply.updatePlayerFoot(P, G, I, dt);
  trf.updateTraffic(traffic, W, G, dt);
  pds.updatePeds(peds, W, G, dt);
  pol.updatePolice(PO, G, I, dt);
  msn.updateMissions(M, G, dt);
  eco.updateFares(E, G, dt);
  G.alarm = Math.max(0, G.alarm - dt * 0.5);
  if ((G.saveT += dt) > 10) { G.saveT = 0; save(G); }
  fx.updateEffects(W, dt);
  fx.updateHurtFx();
  hud.updateHUD(H, G, dt);
  if (H.frame % 2 === 0) hud.drawMinimap(H, G);
  wld.updateCamera(W, I, car ? { x: car.x, z: car.z, y: 1.3, dist: 8.5 }
  : { x: P.pos.x, z: P.pos.z, y: PC.camHeight, dist: PC.camDistFoot }, dt);
  wld.renderFrame(W);
 }
 let last = 0, acc = 0;
 function frame(now) {
  try {
  requestAnimationFrame(frame);
  const t = now * 0.001;
  acc = Math.min(0.25, acc + (last ? t - last : STEP));
  last = t;
  for (let n = 0; acc >= STEP && n < 5; n += 1) { step(STEP); acc -= STEP; }
  if (acc >= STEP) acc = 0;
  I.endFrame();
  } catch (e) { fail(e); }
 }
 const name = G.shot && sht.applyShot(G.shot, G);
 if (name) requestAnimationFrame(() => requestAnimationFrame(() => {
  window.__shotReady = true;
  document.title = 'SB-' + name + '-ok';
 }));
 else if (!G.shot) { showHud(H, false); showP(H, 'title'); }
 requestAnimationFrame(frame);
}
try {
 boot();
} catch (e) { fail(e); }
