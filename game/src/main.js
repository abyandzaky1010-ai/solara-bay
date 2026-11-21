import { CONFIG as C, STEP } from './config.js';
import { createHUD, updateHUD, drawMinimap, toast, showPanel, hidePanels } from './hud.js';
import { addMoney, buyItem, chargeFee, clearSave, initEconomy, loadGame, saveGame, toggleFareDuty, updateFares } from './economy.js';
import { makeFarePed as rider, spawnPeds, updatePeds as crowd, damagePed as hurt } from './peds.js';
import { engineOff, engineOn, engineUpdate, initSfx, sirenTick, S } from './sfx.js';
import { addStars, clearPolice, initPolice, updatePolice } from './police.js';
import { initMissions, updateMissions, MISSIONS } from './missions.js';
import { initEffects, updateEffects, spawnExplosion } from './render.js';
import { createPlayer, updatePlayerFoot, fireWeapon, damagePlayer, respawnPlayer, givePickup } from './player.js';
import { makeCar, updateCarDrive, seatPoints } from './car.js';
import { initWorld, updateCamera, renderFrame } from './world.js';
import { spawnTraffic, updateTraffic as jams } from './traffic.js';
import { applyShot } from './shots.js';
import { makeRng } from './random.js';
import { createInput } from './input.js';
import { buildCity } from './city.js';

const $ = (id) => document.getElementById(id), len = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const PH = C.player.hp, ST = C.wanted.starsFor, FEE = { busted: ['bustedFee', 'station'], wasted: ['hospitalFee', 'hospital'] };

function boot() {
  const q = new URLSearchParams(location.search), shot = q.get('shot');
  const W = initWorld($('app').appendChild(document.createElement('canvas'))), rng = makeRng(Number(q.get('seed')) || 1337), city = buildCity(W, rng);
  const P = createPlayer(W, city), I = createInput(W.renderer.domElement), H = createHUD();
  initEffects(W), initSfx();
  const cars = city.spawns.carParks.map((s, i) => {
    const c = Object.assign(makeCar(s.kind, s.x, s.z, i * 0.7, s.color), { tag: s.tag || null, occupied: null, player: false });
    W.scene.add(c.mesh);
    return c;
  });
  const traffic = spawnTraffic(W, rng, C.traffic.count), peds = spawnPeds(W, city, rng, C.peds.count);
  const PO = initPolice(W, city, rng), M = initMissions(), E = initEconomy(loadGame()), m1 = cars.find((c) => c.tag === 'm1car');
  const G = { W, city, P, cars, traffic, peds, PO, M, E, H, I, rng, m1car: m1, screen: 'title', inCar: null, alarm: 0, alarmX: 0, alarmZ: 0, time: 0, saveT: 0, shot, sound: S };
  let rifle = P.rifle, fire = false;
  const star = (n) => addStars(PO, n, G);

  const show = (id) => (G.screen = id, showPanel(H, id), I.unlock());
  const play = () => (hidePanels(H), show('play'), I.lock());
  const title = () => (show('title'), $('btn-continue').classList.toggle('hide', !loadGame()));

  const leaveCar = (car) => car && ((car.player = false), (G.inCar = null), engineOff(), P.group.position.copy(P.pos.set(car.x + 2.2, 0, car.z)));
  const nearest = () => [...cars, ...traffic].reduce((b, c) => (!c.wrecked && len(c, P.pos) < 3.2 && (!b || len(c, P.pos) < len(b, P.pos)) ? c : b), null);
  const steal = (car) => {
    if (!car) return;
    if (traffic.includes(car)) traffic.splice(traffic.indexOf(car), 1), cars.push(car);
    if (car.occupied === 'npc') star(ST.theftOccupied), peds.push(Object.assign(rider(W, city, rng, car.x, car.z), { fare: false, state: 'flee', fleeT: 5, fleeX: car.x + 7, fleeZ: car.z + 7 }));
    if (car.kind === 'police') star(ST.policeCar);
    Object.assign(car, { occupied: null, player: true, speed: 0 }, P, { dead: false }), (P.group.visible = false);
    G.inCar = car, engineOn(car.kind);
  };
  const boom = (car) => {
    Object.assign(car, { wrecked: true, speed: 0 }), spawnExplosion({ x: car.x, y: 1, z: car.z }), S.explode();
    for (const p of peds) if (p.state !== 'down' && len(p.pos, car) < 6) hurt(p, 100, G);
    if (G.inCar === car) leaveCar(car), damagePlayer(P, 45, G);
    if (car === m1 && M.active) M.active = null;
  };

  Object.assign(G, {
    effects: { spawnExplosion }, toast: (t) => toast(H, t), addMoney: (n) => addMoney(E, n, H), addStars: star, boom, stolen: steal,
    damagePed: (p, a) => (Object.assign(G, { alarm: 1 }), hurt(p, a, G)),
    spawnFare: (x, z) => peds[peds.push(rider(W, city, rng, x, z)) - 1],
    damageTrafficCar: (c, a) => c && (c.hp -= a) <= 0 && !c.wrecked && boom(c),
    damageCop: (c, a) => (!c || c.down ? false : (G.alarm = 1, (c.hp -= a) > 0 ? false : (Object.assign(c, { down: true, deadT: 14 }), star(ST.killCop), true))),
    bust: () => G.screen === 'play' && show('busted'),
    wasted: () => G.screen === 'play' && show('wasted'),
    missionComplete: (r, t) => (addMoney(E, r, H), S.jingle(true), saveGame(G), $('complete-story').textContent = t, $('complete-reward').textContent = `$${r}`, show('complete')),
    engine: { update: (v) => engineUpdate(v, STEP), on: engineOn, off: engineOff, sputter: () => S.crash() },
  });

  const on = (id, fn) => $(id).addEventListener('click', (e) => (e.stopPropagation(), fn()));
  const fresh = () => (clearSave(),
    Object.assign(E, { money: C.economy.start, fares: false, fareState: null }, P, { rifle: false, ammo: 0, armor: 0, hp: PH, dead: false }, M, { index: 0, active: null, retries: 0, lastPrompt: -1 }), play());
  const resume = () => {
    const v = loadGame() || {};
    Object.assign(E, { money: v.money ?? E.money }, P, { rifle: !!v.rifle, ammo: v.ammo | 0, armor: v.armor | 0 }), (M.index = Math.min(v.missionIndex || 0, MISSIONS.length - 1)), play();
  };
  const fine = (k) => (chargeFee(E, C.economy[FEE[k][0]], H), leaveCar(G.inCar), respawnPlayer(P, G, city.markers[FEE[k][1]]), clearPolice(PO, G), play());

  on('btn-new', fresh), on('btn-continue', resume), on('btn-resume', play), on('btn-next', play), on('btn-quit', () => (saveGame(G), title())), on('btn-shop-close', play), on('btn-busted-ok', () => fine('busted')), on('btn-wasted-ok', () => fine('wasted'));
  for (const b of document.querySelectorAll('[data-buy]')) b.addEventListener('click', () => buyItem(E, P, b.dataset.buy, G));
  const cvs = W.renderer.domElement.addEventListener;
  cvs('click', () => G.screen === 'play' && I.lock()), cvs('mousedown', () => (fire = true)), window.addEventListener('mouseup', () => (fire = false));
  shot ? applyShot(shot, G) : title();

  const step = (dt) => {
    G.time += dt, (G.alarm = Math.max(0, G.alarm - dt));
    const k = I.wasPressed.bind(I), hd = I.down.bind(I), car = G.inCar;
    if (G.screen === 'play') {
      if (car) {
        const ax = (a, b) => (hd(a) || hd(b) ? 1 : 0), sp = (updateCarDrive(car, ax('KeyW', 'ArrowUp') - ax('KeyS', 'ArrowDown'), ax('KeyA', 'ArrowLeft') - ax('KeyD', 'ArrowRight'), hd('Space'), dt, W, G), seatPoints(car));
        engineUpdate(Math.min(1, Math.abs(car.speed) / C.car.kinds[car.kind].max)), (car.siren = PO.stars > 0);
        P.pos.set(sp.x, 0, sp.z);
      } else updatePlayerFoot(P, G, I, dt);
      jams(traffic, W, G, dt), crowd(peds, W, G, dt), updatePolice(PO, G, dt), updateMissions(M, G, dt), updateFares(E, G, dt);
      if (!rifle && city.pickup && len(P.pos, city.pickup) < 2) rifle = givePickup(P, G, 'rifle') && toast(H, 'Rifle.');
      if (k('Escape')) show('pause');
      else if (k('KeyE')) (car ? leaveCar(car) : steal(nearest()));
      if (!car && (k('KeyF') || fire)) fireWeapon(P, G);
      if (k('KeyT')) toggleFareDuty(E, G);
      if (k('KeyB') && !car && len(P.pos, city.markers.vineMart) < 3) show('shop');
      if (M.active?.stage === 'steal' && len(P.pos, m1) < 4) steal(m1);
      if (G.time - G.saveT > 10) saveGame(G), (G.saveT = G.time);
    } else if (G.screen === 'title') k('Enter') && (loadGame() ? resume() : fresh());
    else if (k('Escape') || k('Enter') || k('Space')) (['pause', 'complete', 'shop'].includes(G.screen) ? play() : fine(G.screen));
    sirenTick(dt), updateEffects(W, dt), (fire = false);
  };

  let acc = 0, last = performance.now(), f = 0;
  const fc = { x: 0, z: 0 }, frame = (now) => {
    const dt = Math.min(0.25, (now - last) / 1000), car = G.inCar, n = Math.min(5, Math.floor((acc += dt) / STEP));
    last = now, (acc -= n * STEP);
    for (let i = 0; i < n; i += 1) step(STEP);
    Object.assign(fc, car ? { x: car.x, z: car.z, y: 1.4, height: 3.2, dist: 8.5 } : { x: P.pos.x, z: P.pos.z, y: 1.6, height: C.player.camHeight, dist: C.player.camDistFoot });
    if (G.screen === 'title') {
      W.camPos.set(-40 + Math.cos((W.yaw += dt * 0.1)) * 96, 34, -40 + Math.sin(W.yaw) * 96);
      W.camera.position.copy(W.camPos);
      W.camera.lookAt(60, 16, 60);
    } else updateCamera(W, G.screen === 'play' ? I : null, fc, dt);
    renderFrame(W), (f += 1);
    if (f % 2 === 0) updateHUD(H, G, dt), drawMinimap(H, G);
    I.endFrame();
    if (shot && f === 3) window.__shotReady = true, (document.title = `SB-${shot}-ok`);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

try {
  boot();
} catch (err) {
  const m = `boot: ${err?.message || err}`;
  document.title = `SB-error-${m.slice(0, 100)}`;
  if ($('app')) $('app').textContent = m;
}
