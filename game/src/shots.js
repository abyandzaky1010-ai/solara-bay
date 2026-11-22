import { makeRng } from './random.js';
import { C } from './palette.js';
import { makeCar, addCarToScene } from './car.js';
import { makeFarePed } from './peds.js';
import { startMission } from './missions.js';
import { updatePolice } from './police.js';
import { spawnMuzzle, spawnTracer } from './render.js';
import { hidePanels, showPanel } from './hud.js';
import { respawnPlayer } from './player.js';

function roll(G, kind, x, z, heading, color, speed) {
  const car = makeCar(kind, x, z, heading, color);
  car.speed = speed || 0;
  car.mesh.position.set(x, 0, z);
  car.mesh.rotation.y = heading;
  return addCarToScene(G.W, car);
}

function driveShot(G, car) {
  Object.assign(car, { player: true, occupant: null, speed: 22 });
  G.inCar = car;
  G.P.pos.set(car.x, 0, car.z);
  G.P.group.visible = false;
  G.W.yaw = car.heading + Math.PI;
  G.W.pitch = 0.26;
  G.I.lock = () => {};
}

const SCENES = {
  chase(G) {
    const coupe = G.m1car;
    Object.assign(coupe, { x: 12, z: 88, heading: 0, hp: 100, wrecked: false, speed: 22 });
    coupe.mesh.position.set(12, 0, 88);
    coupe.mesh.rotation.y = 0;
    driveShot(G, coupe);
    G.PO.stars = 3;
    G.sound.siren(true);
    G.PO.cars.push({ car: roll(G, 'police', 24, 100, 0.1, C.copbody, 14), dead: false });
    G.PO.cars.push({ car: roll(G, 'police', 6, 66, 0.35, C.copbody, 12), dead: false });
    G.traffic.slice(0, 3).forEach((c, i) => {
      const x = 12 + (i % 2 ? -8 : 8);
      const z = 40 + i * 46;
      Object.assign(c, { x, z, heading: i === 2 ? Math.PI : 0, speed: 8 });
      c.mesh.position.set(x, 0, z);
      c.mesh.rotation.y = c.heading;
    });
  },

  city(G, rng) {
    const { P, W, M } = G;
    respawnPlayer(P, G, { x: 30, z: -6 });
    P.yaw = W.yaw = Math.PI * 0.85;
    P.group.position.set(30, 0, -6);
    roll(G, 'taxi', 12, 6, 0, C.taxi, 8);
    roll(G, 'sedan', 34, 6, Math.PI, C.sedan, 6);
    roll(G, 'sedan', -18, 0, Math.PI / 2, 0x6c7f92, 7);
    for (let i = 0; i < 4; i += 1) makeFarePed(W, G.city, rng, 22 + i * 4, -9 - (i % 2) * 1.5);
    M.index = 0;
    startMission(M, G);
    G.objective = { title: 'Wheels for Vesper', text: 'Steal the coral coupe', dist: 60, timer: 0, kind: 'steal' };
  },

  mission(G) {
    const { P, PO, city, W, M } = G;
    const at = city.pickup;
    respawnPlayer(P, G, { x: at.x + 2.5, z: at.z + 2.5 });
    Object.assign(P, { rifle: true, ammo: 60, weapon: 'rifle', yaw: Math.PI * 0.25 });
    W.yaw = Math.PI * 0.25;
    W.pitch = 0.12;
    P.group.position.set(at.x + 2.5, 0, at.z + 2.5);
    PO.stars = 2;
    G.sound.siren(true);
    updatePolice(PO, G, 0.016);
    const coming = PO.foot[0];
    const downed = PO.foot[1];
    if (coming) Object.assign(coming.pos, { x: at.x - 4.5, z: at.z - 4.5 });
    if (downed) {
      Object.assign(downed, { down: true, deadT: 60, hp: 0 });
      Object.assign(downed.pos, { x: at.x + 7.5, z: at.z - 1.5 });
      downed.mesh.rotation.z = Math.PI / 2;
      downed.mesh.position.set(downed.pos.x, 0.3, downed.pos.z);
    }
    spawnMuzzle({ x: at.x - 4.5, y: 1.35, z: at.z - 4.5 });
    spawnTracer({ x: at.x - 4.5, y: 1.35, z: at.z - 4.5 }, { x: at.x + 2.9, y: 1.2, z: at.z + 2.9 });
    const cop = PO.cars[0] && PO.cars[0].car;
    if (cop) {
      Object.assign(cop, { x: city.park.x + 46, z: city.park.z - 40, speed: 8 });
      cop.mesh.position.set(cop.x, 0, cop.z);
    }
    M.index = 1;
    startMission(M, G);
    G.objective = { title: 'Shake the Heat', text: 'Lose the police before the clock runs out', dist: 0, timer: 72, kind: 'evade' };
  },

  start(G) {
    hidePanels(G.H);
    showPanel(G.H, 'title');
    G.screen = 'title';
    G.W.yaw = 2.4;
    G.W.pitch = 0.46;
    const coupe = G.m1car;
    Object.assign(coupe, { x: 2, z: 40, heading: Math.PI, hp: 100, wrecked: false, speed: 0 });
    coupe.mesh.position.set(2, 0, 40);
    coupe.mesh.rotation.y = Math.PI;
  },
};

export function applyShot(name, G) {
  try {
    const scene = name && SCENES[name];
    if (!scene) throw new Error('unknown shot: ' + name);
    scene(G, makeRng(1));
    if (G.screen !== 'title') G.screen = 'play';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__shotReady = true;
      document.title = 'SB-' + name + '-ok';
    }));
    return true;
  } catch (err) {
    document.title = ('SB-error-' + ((err && err.message) || err)).slice(0, 100);
    document.body.appendChild(Object.assign(document.createElement('pre'), { textContent: 'shot failed: ' + ((err && err.message) || err) }));
    return false;
  }
}
