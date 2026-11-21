// Solara Bay — boot, fixed-step game loop, screen state machine (start / play / pause / busted /
// wasted / mission-done) and the wiring between all systems. Import order follows the dossier's
// reading order: city, vehicles, street life, police, missions, economy first.
import { CFG } from './config.js';
import { mulberry32 } from './random.js';
import { buildCity } from './city.js';
import { makeCar, updatePlayerCar, tryEnterExit, explodeCar } from './car.js';
import { spawnTraffic, updateTraffic } from './traffic.js';
import { spawnPeds, updatePeds } from './peds.js';
import { updatePolice } from './police.js';
import { MISSIONS, updateMissions, startMission } from './missions.js';
import { spawnPickups, updateEconomy } from './economy.js';
import { W, saveGame, loadSave, say, dist } from './world.js';
import { initRender } from './render.js';
import { makePlayer, updatePlayer } from './player.js';
import { initHUD, updateHUD, showStart, hideStart, showOverlay, hideOverlay } from './hud.js';
import { initInput } from './input.js';
import { sfx } from './sfx.js';
import { parseShot, stageShot, installErrorHooks } from './shots.js';

function wireUI() {
  document.getElementById('btnNew').onclick = () => startGame(null);
  document.getElementById('btnContinue').onclick = () => startGame(loadSave());
  document.getElementById('btnResume').onclick = () => { W.mode = 'play'; hideOverlay('pause'); };
  document.getElementById('btnOk').onclick = () => { W.mdone = null; };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (W.mode === 'play') { W.mode = 'pause'; showOverlay('pause'); document.exitPointerLock(); }
      else if (W.mode === 'pause') { W.mode = 'play'; hideOverlay('pause'); }
    }
  });
}

function startGame(save) {
  hideStart();
  W.mode = 'play';
  sfx.unlock();
  if (save) {
    W.money = save.money ?? W.money;
    W.story = save.story ?? 0;
    W.missionIdx = Math.min(save.missionIdx ?? 0, MISSIONS.length);
    if (save.px !== undefined) { W.player.pos.x = save.px; W.player.pos.z = save.pz; }
    say('Save loaded. Welcome back to Solara Bay.');
  } else {
    say('Mara Vox: "You owe me. Run errands, drive the cab, pay me back."');
  }
}

function respawn() {
  const p = W.player;
  p.hp = CFG.playerHp; p.ammo = CFG.mag; p.pool = Math.max(p.pool, 24);
  p.pos.x = W.spot.spawn.x; p.pos.z = W.spot.spawn.z; p.pos.y = 0;
  p.vel = { x: 0, y: 0, z: 0 };
  p.inCar = null;
  p.mesh.visible = true;
  if (W.mode === 'wasted') W.money = Math.max(0, W.money - 100);
  W.wanted = 0; W.arrestT = 0;
  for (const c of W.cars.filter((c) => c.kind === 'police')) W.scene.remove(c.mesh);
  W.cars = W.cars.filter((c) => c.kind !== 'police');
  for (const cop of W.cops) W.scene.remove(cop.mesh);
  W.cops = [];
  W.mode = 'play';
  hideOverlay('busted'); hideOverlay('wasted');
  say('Back on your feet at the clinic.');
}

function update(dt) {
  W.time += dt;
  if (W.mode === 'busted' || W.mode === 'wasted') {
    W.overT += dt;
    if (W.overT > 2.6) respawn();
    return;
  }
  if (W.mode !== 'play') return;
  if (W.pressed.KeyE) {
    if (W.talkTarget && !W.mission && W.missionIdx < MISSIONS.length) startMission(W.missionIdx);
    else tryEnterExit();
  }
  updatePlayer(dt);
  if (W.player.inCar) updatePlayerCar(dt);
  updateTraffic(dt);
  updatePeds(dt);
  updatePolice(dt);
  updateMissions(dt);
  updateEconomy(dt);
  for (const c of W.cars) if (c.dead && c.mesh.parent) W.scene.remove(c.mesh);
  for (let i = W.fx.length - 1; i >= 0; i--) {
    const f = W.fx[i];
    f.t -= dt;
    if (f.kind === 'tracer') f.mesh.material.opacity = Math.max(0, f.t / 0.09);
    else if (f.kind === 'boom') {
      const k = 1 + (0.7 - f.t) * 9;
      f.mesh.scale.set(k, k, k);
      f.mesh.material.opacity = Math.max(0, f.t / 0.7) * 0.9;
    }
    if (f.t <= 0) { W.scene.remove(f.mesh); W.fx.splice(i, 1); }
  }
  const p = W.player;
  W.prompt = '';
  if (!p.inCar) {
    if (W.talkTarget && !W.mission) W.prompt = 'E — talk to Mara Vox';
    else {
      let bd = 3.6;
      for (const c of W.cars) {
        if (c.dead) continue;
        if (dist(p.pos.x, p.pos.z, c.pos.x, c.pos.z) < bd) bd = dist(p.pos.x, p.pos.z, c.pos.x, c.pos.z);
      }
      if (bd < 3.6) W.prompt = 'E — take this car';
    }
    if (W.shopNear) W.prompt = (W.prompt ? W.prompt + '    ' : '') + 'B — Solara Mart';
  } else W.prompt = 'E — hop out';
  W.saveT += dt;
  if (W.saveT > 6) { W.saveT = 0; saveGame(); }
  W.shake = Math.max(0, W.shake - dt * 2.2);
}

let last = performance.now();
let acc = 0;

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (W.shot === 'start') { // slow orbit over the city behind the start screen
    W.time += dt;
    const a = W.time * 0.08 + 1;
    W.camera.position.set(Math.sin(a) * 150, 75, Math.cos(a) * 150);
    W.camera.lookAt(0, 8, 0);
  } else if (W.mode === 'play' && !W.freeze) {
    acc += dt;
    let n = 0;
    while (acc >= CFG.step && n < 5) { update(CFG.step); acc -= CFG.step; n++; }
    if (n === 5) acc = 0;
  }
  if (W.shot) {
    W.steps++;
    if (W.steps > (W.freezeAfter ?? 100)) { W.freeze = true; window.__shotReady = true; }
  }
  updateHUD(dt);
  W.renderer.render(W.scene, W.camera);
  W.clicked = false;
  W.pressed = {};
}

function boot() {
  installErrorHooks();
  const { shot, seed } = parseShot();
  W.seed = seed;
  W.rng = mulberry32(seed ^ 0x9e3779b9);
  W.shot = shot;
  const canvas = document.getElementById('game');
  initRender(canvas);
  initInput(canvas);
  buildCity(mulberry32(seed));
  spawnTraffic(W.rng);
  spawnPeds(W.rng);
  spawnPickups();
  makePlayer();
  initHUD();
  wireUI();
  const save = loadSave();
  if (shot && shot !== 'start') {
    startGame(null);
    stageShot(shot);
  } else {
    showStart(!!save);
  }
  document.body.dataset.boot = 'ok';
  requestAnimationFrame(loop);
}

boot();
