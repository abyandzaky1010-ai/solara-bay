// Solara Bay — boot, screens and the one fixed-step game loop.

import { CONFIG, STEP } from './config.js';
import { makeRng } from './random.js';
import { createInput } from './input.js';
import { initWorld, updateCamera, renderFrame } from './world.js';
import { buildCity } from './city.js';
import { createPlayer, updatePlayerFoot, fireWeapon, damagePlayer, respawnPlayer, givePickup, syncRig } from './player.js';
import { makeCar, updateCarDrive, seatPoints } from './car.js';
import { spawnTraffic, updateTraffic } from './traffic.js';
import { spawnPeds, updatePeds, makeFarePed, knockDown } from './peds.js';
import { initPolice, addStars, updatePolice, clearWanted, officerHit } from './police.js';
import { initMissions, updateMissions, startMission } from './missions.js';
import { initEconomy, buyItem, setFares, updateFares, saveGame, loadGame, clearSave, SHOP } from './economy.js';
import { createHUD, updateHUD, drawMinimap, toast, showPanel, hidePanels, setBanner } from './hud.js';
import { initSfx, S, engineOn, engineUpdate, engineOff, siren } from './sfx.js';
import { initEffects, updateEffects, spawnExplosion, spawnTracer } from './render.js';
import { applyShot } from './shots.js';

const $ = (id) => document.getElementById(id);
const K = CONFIG;
const GRAB = 3.2;

function boot() {
  const q = new URLSearchParams(location.search);
  const shot = q.get('shot');
  const seed = Number(q.get('seed')) || K.seed;
  const canvas = $('app').appendChild(document.createElement('canvas'));
  const W = initWorld(canvas);
  const city = buildCity(W, makeRng(seed));
  const P = createPlayer(W, city);
  const rng = makeRng(seed + 7);
  const cars = city.spawns.carParks.map((p) => {
    const c = makeCar(p.kind, p.x, p.z, p.heading, p.color);
    W.scene.add(c.mesh);
    c.tag = p.tag;
    return c;
  });
  const traffic = spawnTraffic(W, rng, K.traffic.count);
  const peds = spawnPeds(W, city, rng, K.peds.count);
  const PO = initPolice(W, city, rng);
  const saved = loadGame();
  const M = initMissions();
  const E = initEconomy(saved);
  const H = createHUD();
  const I = createInput(canvas);
  initSfx();

  const G = {
    W, city, P, cars, traffic, peds, PO, M, E, H, I, rng, effects: initEffects(W), sound: { ...S, siren },
    screen: 'title', inCar: null, alarm: 0, alarmX: 0, alarmZ: 0, time: 0, saveT: 0,
    shot: null, objective: null, m1Car: cars.find((c) => c.tag === 'm1car') || cars[0],
    engine: { on: engineOn, update: engineUpdate, off: engineOff },
    toast: (t) => toast(H, t),
    damagePlayer: (amt) => damagePlayer(P, amt, G),
    damagePed: (ped, dmg) => { if ((ped.hp -= dmg) <= 0) knockDown(ped, G, 'shot'); },
    damageCop: (cop, dmg) => officerHit(PO, cop, dmg, G),
    damageTrafficCar: (car, dmg) => (car.hp -= dmg),
    onPedHit: (ped, cause) => addStars(PO, cause === 'shot' ? K.wanted.killPed : K.wanted.hitPed, G),
    onCopDown: () => addStars(PO, K.wanted.killCop, G),
    explodeCar: (car) => { spawnExplosion({ x: car.x, y: 1, z: car.z }); S.explode(); },
    spawnFare: (x, z) => { const p = makeFarePed(W, city, rng, x, z); peds.push(p); return p; },
    saveGame: () => saveGame(G),
    missionStart: (def) => setBanner(H, def.title, 2200),
    missionComplete: (reward, story) => {
      E.money += reward;
      H.completeStory.textContent = story;
      H.completeReward.textContent = '+$' + reward;
      G.screen = 'complete';
      showPanel(H, 'complete');
      S.jingle(true);
      saveGame(G);
    },
    missionFail: (title, hint) => { toast(H, hint); startMission(M, G, { force: true }); },
    bust: () => payPanel(G, 'busted'),
    wasted: () => payPanel(G, 'wasted'),
  };

  if (shot) applyShot(shot, G);
  if (saved && !shot) {
    $('btn-continue').style.display = '';
    M.index = Math.min(saved.missionIndex || 0, 3);
    Object.assign(P, { rifle: !!saved.rifle, ammo: saved.ammo || 0, armor: saved.armor || 0 });
    if (P.rifle) P.weapon = 'rifle';
  }
  wire(G);
  run(G);
}

// Busted and wasted: one bill, one panel, one respawn place.
function payPanel(G, kind) {
  if (G.screen !== 'play') return;
  leave(G);
  const fee = kind === 'busted' ? K.economy.bustedFee : K.economy.hospitalFee;
  G.E.money = Math.max(0, G.E.money - fee);
  clearWanted(G.PO, G);
  G.screen = kind;
  const el = $(kind + '-fee');
  if (el) el.textContent = 'Fee: $' + fee;
  showPanel(G.H, kind);
  S.jingle(false);
}

function wire(G) {
  const { H, P, E, I } = G;
  const play = (fresh) => {
    if (fresh) clearSave();
    G.screen = 'play';
    hidePanels(H);
    I.lock();
    setBanner(H, 'Vesper runs the Glass Orchid. Meet her there.', 2600);
  };
  $('btn-new').onclick = () => play(true);
  for (const id of ['btn-continue', 'btn-resume', 'btn-next', 'btn-shop-close']) $(id).onclick = () => play(false);
  for (const [id, where] of [['btn-busted', 'station'], ['btn-wasted', 'hospital']]) {
    $(id).onclick = () => {
      G.P.dead = false;
      respawnPlayer(G.P, G, where);
      G.P.hp = K.player.hp * 0.8;
      play(false);
    };
  }
  for (const row of SHOP) {
    const b = H.buyButtons[row.item];
    if (b) b.onclick = () => { buyItem(E, P, row.item, G); H.shopMoney.textContent = 'Cash: $' + E.money; };
  }
}

function nearestCar(G) {
  let best = null, d0 = GRAB;
  const p = G.P.pos;
  for (const c of G.cars.concat(G.traffic)) {
    if (c.wrecked) continue;
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    if (d < d0) { d0 = d; best = c; }
  }
  return best;
}

function seat(G, car) {
  const stolen = car.traffic;
  Object.assign(car, { player: true, occupant: 'player' });
  G.inCar = car;
  G.P.group.visible = false;
  G.W.cam.dist = 8.5;
  engineOn(car.kind);
  const i = G.traffic.indexOf(car);
  if (i >= 0) G.traffic.splice(i, 1);
  if (!G.cars.includes(car)) G.cars.push(car);
  if (stolen) addStars(G.PO, K.wanted.theftOccupied, G);
  if (car.kind === 'police') addStars(G.PO, K.wanted.policeCar, G);
}

function leave(G) {
  const car = G.inCar;
  if (!car) return;
  const { exit } = seatPoints(car);
  G.inCar = null;
  Object.assign(car, { player: false, occupant: null, speed: 0 });
  G.P.pos.x = exit.x;
  G.P.pos.z = exit.z;
  G.P.group.visible = true;
  G.P.group.position.set(exit.x, 0, exit.z);
  G.W.cam.dist = K.player.camDistFoot;
  engineOff();
}

function keys(G) {
  const { I, P, E, H } = G;
  if (I.wasPressed('KeyE')) {
    if (G.inCar) leave(G);
    else { const c = nearestCar(G); if (c) seat(G, c); else toast(H, 'Nothing in reach.'); }
  }
  if (I.wasPressed('KeyF') && !G.inCar) fireWeapon(P, G);
  if (I.wasPressed('KeyQ') && P.rifle) P.weapon = P.weapon === 'rifle' ? 'pistol' : 'rifle';
  if (I.wasPressed('KeyT') && G.inCar) setFares(E, !E.fares, G);
  const vm = G.city.markers.vineMart;
  if (I.wasPressed('KeyB') && !G.inCar && Math.hypot(P.pos.x - vm.x, P.pos.z - vm.z) < 3) {
    G.screen = 'shop';
    H.shopMoney.textContent = 'Cash: $' + E.money;
    showPanel(H, 'shop');
    I.unlock();
  }
  if (I.wasPressed('Escape')) {
    if (G.screen === 'play') { G.screen = 'pause'; showPanel(H, 'pause'); I.unlock(); }
    else if (G.screen === 'pause') { G.screen = 'play'; hidePanels(H); I.lock(); }
  }
}

function tick(G, dt) {
  const { P, PO, M, E, I, W } = G;
  if (G.shot) {
    G.time += dt;
    updateTraffic(G.traffic, W, G, dt);
    updatePeds(G.peds, W, G, dt);
    updateEffects(W, dt);
    if (G.tracer) spawnTracer(G.tracer[0], G.tracer[1]);
    if (G.shot.tick) G.shot.tick(G, dt);
    return;
  }
  if (G.screen !== 'play') return;
  G.time += dt;
  G.alarm = Math.max(0, G.alarm - dt);
  if (G.inCar) {
    const car = G.inCar;
    const th = (I.down('KeyW') ? 1 : 0) - (I.down('KeyS') ? 0.7 : 0);
    const st = (I.down('KeyA') ? -1 : 0) + (I.down('KeyD') ? 1 : 0);
    updateCarDrive(car, th, st, I.down('Space') ? 1 : 0, dt, W, G);
    P.pos.x = car.x;
    P.pos.z = car.z;
    P.yaw = car.heading;
    if (car.wrecked) leave(G);
    else engineUpdate(Math.abs(car.speed) / (car.maxSpeed || 28), dt);
  } else {
    updatePlayerFoot(P, G, I, dt);
    syncRig(P, dt);
  }
  updateTraffic(G.traffic, W, G, dt);
  updatePeds(G.peds, W, G, dt);
  updatePolice(PO, G, I, dt);
  updateMissions(M, G, dt);
  updateFares(E, G, dt);
  updateEffects(W, dt);
  const pick = G.city.pickup;
  if (pick && !G.crate && Math.hypot(P.pos.x - pick.x, P.pos.z - pick.z) < 2) {
    G.crate = true;
    givePickup(P, G, 'rifle');
    setBanner(G.H, 'Rifle: press Q to switch', 2400);
  }
  updateCamera(W, I, { x: P.pos.x, y: 0, z: P.pos.z }, dt);
  G.saveT += dt;
  if (G.saveT >= K.saveEvery) { G.saveT = 0; saveGame(G); }
}

function run(G) {
  let last = performance.now(), acc = 0, n = 0;
  const frame = (now) => {
    try {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps++ < 5) { keys(G); tick(G, STEP); acc -= STEP; }
      if (steps > 5) acc = 0;
      renderFrame(G.W);
      if ((n = (n + 1) % 2) === 0) { updateHUD(G.H, G, dt); drawMinimap(G.H, G); }
      G.I.endFrame();
    } catch (err) { fail(err); return; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function fail(err) {
  const msg = String((err && err.message) || err).slice(0, 100);
  document.title = 'SB-error-' + msg;
  const box = $('booterror');
  if (box) { box.textContent = msg; box.classList.add('show'); }
}

try { boot(); } catch (err) { fail(err); }
