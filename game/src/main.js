import { CONFIG, STEP } from './config.js';
import { makeRng } from './random.js';
import { createInput } from './input.js';
import { initWorld, updateCamera, renderFrame } from './world.js';
import { buildCity } from './city.js';
import { createPlayer, updatePlayerFoot, updatePlayerTimers, fireWeapon, damagePlayer as hurt, respawnPlayer, stowPlayer, unseatPlayer, givePickup } from './player.js';
import { makeCar, updateCarDrive, canEnterCar, addCarToScene, doorPoint } from './car.js';
import { spawnTraffic, updateTraffic } from './traffic.js';
import { spawnPeds, makeFarePed, updatePeds, damagePed } from './peds.js';
import { initPolice, addStars, updatePolice, damageCop, copShootTargets } from './police.js';
import { initMissions, startMission, updateMissions } from './missions.js';
import { initEconomy, addMoney, chargeFee, buyItem, toggleFareDuty, updateFares, saveGame, loadGame, dueSave } from './economy.js';
import { createHUD, updateHUD, drawMinimap, toast, showPanel as pane, hidePanels as blanks } from './hud.js';
import { initSfx, S, engineOn, engineUpdate, engineOff, siren } from './sfx.js';
import { initEffects, spawnTracer, spawnMuzzle, spawnExplosion, spawnSmokePuff, flashDamage, updateEffects } from './render.js';
import { applyShot } from './shots.js';

const WT = CONFIG.wanted, ECO = CONFIG.economy, KINDS = CONFIG.car.kinds, EL = (i) => document.getElementById(i);
const far = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const close = (G) => (blanks(G.H), (G.screen = "play"), G.I.lock());
const note = (G, t) => toast(G.H, t);

function fail(err) {
  const m = (err && err.message) || String(err);
  document.title = ("SB-error-" + m).slice(0, 100);
  document.body.appendChild(Object.assign(document.createElement("pre"), { textContent: m }));
}

// Busted or wasted: the fee, a clean record, and a ride to the station or the hospital.
function busted(G, k) {
  if (G.screen !== "play") return;
  G.inCar = null;
  engineOff();
  siren(false);
  chargeFee(G.E, k === "busted" ? ECO.bustedFee : ECO.hospitalFee, G.H);
  Object.assign(G.PO, { stars: 0, noSeeT: 0 });
  respawnPlayer(G.P, G, G.city.markers[k === "busted" ? "station" : "hospital"]);
  G.screen = k;
  pane(G.H, k);
  saveGame(G);
}

function nearest(G) {
  const p = G.P.pos;
  return G.cars.concat(G.traffic).filter((c) => c && !c.wrecked && !c.player && far(c, p) < 3.2)
    .sort((a, b) => far(a, p) - far(b, p))[0];
}

function enter(G, car) {
  const steal = car.occupant === "npc";
  if (G.P.dead || !canEnterCar(car, G.P.pos.x, G.P.pos.z)) return;
  car.occupant = null;
  car.player = true;
  G.inCar = car;
  stowPlayer(G.P);
  engineOn(car.kind);
  S.chime();
  if (steal) note(G, "Carjacked. E to step out.");
  if (car.kind === "police") note(G, "Police car taken. E to step out.");
  addStars(G.PO, steal ? WT.theftOccupied : car.kind === "police" ? WT.policeCar : 0, G);
}

function leave(G) {
  const car = G.inCar;
  if (!car) return;
  const s = doorPoint(car, G.W);
  unseatPlayer(G.P, s.x, s.z, s.heading);
  car.player = false;
  G.inCar = null;
  engineOff();
  if (G.E.fares) toggleFareDuty(G.E, G);
}

function shop(G) {
  if (G.inCar || far(G.P.pos, G.city.markers.vineMart) > 3) return note(G, "Vine Mart is on the Meridian kerb.");
  G.screen = "shop";
  pane(G.H, "shop");
  const m = EL("shop-money");
  if (m) m.textContent = `You have $${Math.max(0, Math.round(G.E.money))}.`;
}

function wire(G) {
  const H = G.H, E = G.E, P = G.P, on = (id, fn) => EL(id) && EL(id).addEventListener("click", fn);
  const go = () => close(G), start = () => (close(G), startMission(G.M, G));
  ["btn-resume", "btn-shop-close", "btn-busted", "btn-wasted"].forEach((id) => on(id, go));
  on("btn-new", start);
  on("btn-next-mission", start);
  on("btn-continue", () => {
    const s = loadGame() || {};
    Object.assign(E, { money: s.money || ECO.start });
    Object.assign(P, { rifle: !!s.rifle, ammo: s.ammo | 0, armor: s.armor | 0 });
    G.M.index = Math.min(s.missionIndex | 0, 3);
    go();
  });

  on("btn-save", () => saveGame(G) && toast(H, "Saved."));
  for (const b of document.querySelectorAll("[data-buy]")) b.onclick = () => buyItem(E, P, b.dataset.buy, G);
  EL("app").addEventListener("mousedown", () => G.screen === "play" && !G.inCar && (G.I.locked ? (G.fire = true) : G.I.lock()));
  EL("btn-continue").classList.toggle("hidden", !loadGame());
}

function keys(G) {
  const I = G.I, P = G.P, k = (c) => I.wasPressed(c);
  if (k("KeyE")) G.inCar ? leave(G) : nearest(G) && enter(G, nearest(G));
  if (k("KeyQ")) P.weapon = P.weapon === "rifle" ? "pistol" : "rifle";
  if (k("KeyB") && !G.inCar) shop(G);
  if (k("KeyT")) toggleFareDuty(G.E, G);
  if (!G.inCar && (k("KeyF") || G.fire) && !P.dead) fireWeapon(P, G);
  G.fire = false;
}

function world(G, dt) {
  const I = G.I, P = G.P, c = G.inCar, d = (a, b) => (I.down(a) || I.down(b) ? 1 : 0);
  if (c) {
    updateCarDrive(c, d("KeyW", "ArrowUp"), d("KeyD", "ArrowRight") - d("KeyA", "ArrowLeft"), d("Space"), dt, G.W, G);
    engineUpdate(Math.min(1, Math.abs(c.speed) / (KINDS[c.kind] || KINDS.sedan).max), dt);
    if (c.wrecked) leave(G);
  } else updatePlayerFoot(P, G, I, dt);
  updatePlayerTimers(P, dt);
  updateTraffic(G.traffic, G.W, G, dt) || updatePeds(G.peds, G.W, G, dt);
  G.cops = copShootTargets(G.PO);
  updatePolice(G.PO, G, dt) || updateMissions(G.M, G, dt);
  updateFares(G.E, G, dt);
  updateEffects(G.W, dt) || dueSave(G.E, G, dt);
}

function frame(G, dt) {
  const I = G.I, c = G.inCar;
  if (G.screen === "play") {
    G.acc += Math.min(dt, 0.2);
    for (G.steps = 0; G.acc >= STEP && G.steps < 5; G.steps += 1) G.acc -= STEP, keys(G), world(G, STEP);
    if (G.steps === 5) G.acc = 0;
  }
  updateCamera(G.W, I, c ? { x: c.x, y: 1.4, z: c.z, dist: 7.2 } : { x: G.P.pos.x, y: 1.6, z: G.P.pos.z, dist: CONFIG.player.camDistFoot }, dt);
  renderFrame(G.W);
  updateHUD(G.H, G, dt);
  G.hf = (G.hf || 0) + 1;
  if (G.hf % 2 === 0) drawMinimap(G.H, G);
  I.endFrame();
}

function boot() {
  const q = new URLSearchParams(location.search), shot = q.get("shot"), rng = makeRng(Number(q.get("seed")) || 1337);
  const canvas = EL("app").appendChild(document.createElement("canvas"));
  const W = initWorld(canvas), city = buildCity(W, rng), P = createPlayer(W, city);
  const cars = city.spawns.carParks.map((k) => addCarToScene(W, makeCar(k.kind, k.x, k.z, k.heading, k.color)));
  const traffic = spawnTraffic(W, rng, 11), peds = spawnPeds(W, city, rng, 15);
  const PO = initPolice(W, city, rng), M = initMissions(), E = initEconomy(loadGame()), H = createHUD();
  initSfx();
  initEffects(W);
  const I = createInput(canvas);
  const G = {
    W, city, P, cars, m1car: cars[5], traffic, peds, PO, M, H, I, rng, E, sound: { ...S, siren, engineOn, engineUpdate, engineOff },
    addMoney: (n) => addMoney(E, n, H), shot: shot || null, screen: "title", inCar: null, alarm: 0, acc: 0, fire: false, objective: null,
    effects: { spawnTracer, spawnMuzzle, spawnExplosion, spawnSmokePuff, flashDamage },
  };
  const law = (n) => addStars(PO, n, G);
  G.damagePlayer = (n) => hurt(P, n, G);
  G.damagePed = (p, n) => damagePed(p, n, G);
  G.damageCop = (o, n) => damageCop(PO, o, n, G);
  G.damageTrafficCar = (c, n) => { c.hp -= n; c.hp <= 0 && G.explodeCar(c); };
  G.spawnFare = (x, z) => peds[peds.push(makeFarePed(W, city, rng, x, z)) - 1];
  G.onPedHit = (p, dead) => {
    if (!p || p.fare) return;
    law(dead ? WT.killPed : WT.hitPed);
    if (!dead) return;
    G.kills = (G.kills || []).concat(G.time).filter((t) => G.time - t <= WT.rampageWindow);
    if (G.kills.length >= WT.rampageKills) { G.kills = []; law(1); }
  };
  G.explodeCar = (c) => {
    if (!c) return;
    Object.assign(c, { wrecked: true, hp: 0, speed: 0 });
    spawnExplosion({ x: c.x, y: 1, z: c.z });
    S.explode();
    for (const t of peds.concat(PO.foot)) if (!t.down && far(t.pos, c) < 6) damagePed(t, 999, G) || damageCop(PO, t, 999, G);
    if (!G.inCar && far(P.pos, c) < 8) hurt(P, 40, G);
  };
  G.missionComplete = (reward, story) => (
    G.addMoney(reward), story && (EL("complete-story").textContent = story), (G.screen = "complete"), pane(H, "complete"), saveGame(G)
  );
  G.bust = () => busted(G, "busted");
  G.wasted = () => busted(G, "wasted");
  wire(G);

  window.addEventListener("keydown", (e) => {
    const k = e.code;
    if (k !== "Escape" && k !== "KeyR") return;
    if (G.screen === "pause") return close(G);
    if (k === "KeyR") return G.screen !== "play" && close(G);
    G.screen = "pause";
    pane(H, "pause");
    document.exitPointerLock();
  });

  city.pickup && far(P.pos, city.pickup) < 2 && givePickup(P, G, "rifle");
  if (shot) applyShot(shot, G);

  let t0 = performance.now();
  const tick = (now) => {
    try { frame(G, Math.min(0.1, (now - t0) / 1000)); t0 = now; } catch (err) { return fail(err); }
    requestAnimationFrame(tick);
  };
  frame(G, 1 / 60);
  requestAnimationFrame(tick);
}

try { boot(); } catch (err) { fail(err); }
