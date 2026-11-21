// Solara Bay — the four ?shot= demo scenes.

import * as THREE from 'three';
import { makeRng } from './random.js';
import { C, material } from './palette.js';
import { makeCar } from './car.js';
import { addStars } from './police.js';
import { startMission } from './missions.js';
import { spawnTracer, spawnMuzzle } from './render.js';
import { showPanel, hidePanels } from './hud.js';

const N = Math.PI, E = Math.PI / 2;

function put(W, x, z, kind, h = N, paint = C.sedan) {
  const car = makeCar(kind, x, z, h, paint);
  car.occupant = 'npc';
  W.scene.add(car.mesh);
  return car;
}

function lanes(G) {
  for (const c of G.traffic) G.W.scene.remove(c.mesh);
  G.traffic.length = 0;
}

function stand(G, x, z, h, cam, at) {
  const { P } = G;
  Object.assign(P, { pos: { x, z }, yaw: h });
  P.group.position.set(x, 0, z);
  P.group.rotation.set(0, h, 0);
  P.group.visible = true;
  G.W.cam.dist = 5.5;
  G.W.camera.position.fromArray(cam);
  G.W.camera.lookAt(at[0], at[1], at[2]);
}

function chase(G) {
  const car = G.m1Car;
  if (!car) throw new Error('no m1 coupe');
  Object.assign(car, { x: 12, z: 88, heading: N, speed: 12, player: true });
  car.mesh.position.set(12, 0.09, 88);
  car.mesh.rotation.y = N;
  G.inCar = car;
  Object.assign(G.P, { pos: { x: 12, z: 88 }, yaw: N });
  G.P.group.visible = false;
  G.W.cam.dist = 8.5;
  G.W.camera.position.set(16, 6.2, 101);
  G.W.camera.lookAt(12, 1.2, 62);
  for (const [x, z] of [[24, 89], [16, 104]]) {
    const c = put(G.W, x, z, 'police', N, C.copbody);
    Object.assign(c, { siren: true, speed: 10, ai: { stuck: 0, reverse: 0, ramT: 1.8 } });
    G.PO.cars.push(c);
  }
  addStars(G.PO, 3, G);
  G.PO.spawnT = 4;
  for (const [z, kind, paint] of [[118, 'sedan', C.sedan], [92, 'taxi', C.taxi], [76, 'sedan', 0x6f8fa6]]) {
    G.traffic.push(put(G.W, -23, z, kind, N, paint));
  }
}

function city(G) {
  lanes(G);
  G.peds.slice(0, 4).forEach((p, i) => {
    Object.assign(p, { state: 'walk', leg: null, heading: N, pos: { x: 34 + (i % 2) * 4, z: 14 + (i > 1 ? 5 : 0) } });
    p.mesh.position.set(p.pos.x, 0, p.pos.z);
  });
  stand(G, 30, 16, N, [24, 5.2, 26], [34, 1.4, 6]);
  G.traffic.push(put(G.W, 33, 2, 'taxi', N, C.taxi), put(G.W, 27, -4, 'sedan', N, 0x9d6b6b));
  G.PO.stars = 0;
  startMission(G.M, G, { force: true });
  G.objective = { title: 'Wheels for Vesper', text: 'steal the coral coupe', dist: 0 };
}

function mission(G) {
  const c = G.city.pickup;
  lanes(G);
  Object.assign(G.P, { rifle: true, weapon: 'rifle', ammo: 60 });
  stand(G, c.x - 2, c.z + 2, N, [c.x - 1.6, 5.0, c.z + 9], [c.x + 2, 1.2, c.z - 12]);
  const cruiser = Object.assign(put(G.W, c.x + 9, c.z - 13, 'police', E, C.copbody), { siren: true, ai: { stuck: 0, reverse: 0, ramT: 0 } });
  addStars(G.PO, 2, G);
  G.PO.spawnT = 5;
  G.PO.cars.push(cruiser);
  G.PO.foot.length = 0;
  for (const [x, z, down] of [[c.x + 4, c.z - 9, 0], [c.x - 5, c.z - 4, 1]]) {
    const g = new THREE.Group();
    const b = (w, h, hex, y, dz = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.66), material(hex));
      m.position.set(0, y, dz); g.add(m); return m;
    };
    b(0.5, down ? 0.32 : 0.7, C.copbody, down ? 0.2 : 1.05);
    b(0.3, 0.3, C.skin[2], down ? 0.2 : 1.55, down ? -0.95 : 0);
    const legs = [b(0.17, 0.74, 0x1d2637, 0.74, -0.12), b(0.17, 0.74, 0x1d2637, 0.74, 0.12)];
    const arms = [b(0.14, 0.58, C.copbody, 1.05, -0.32), b(0.14, 0.58, C.copbody, 1.05, 0.32)];
    g.userData = { legs, arms };
    g.position.set(x, 0, z);
    G.W.scene.add(g);
    G.PO.foot.push({ mesh: g, x, z, heading: N, hp: 60, walkT: 0, fireT: 0.4, strafe: 1, down });
    if (!down) {
      spawnMuzzle({ x, y: 1.35, z: z + 0.4 });
      G.tracer = [{ x, y: 1.35, z }, { x: G.P.pos.x, y: 1.1, z: G.P.pos.z }];
      spawnTracer(G.tracer[0], G.tracer[1]);
    }
  }
}

function start(G) {
  const c = G.city.pickup;
  lanes(G);
  G.P.group.visible = false;
  const car = G.m1Car;
  if (car) {
    Object.assign(car, { x: c.x - 8, z: c.z + 2, heading: N });
    car.mesh.position.set(c.x - 8, 0.09, c.z + 2);
    car.mesh.rotation.y = N;
  }
  G.PO.stars = 0;
  showPanel(G.H, 'title');
  return { tick: orbit, orbit: { a: 3.6, x: c.x, z: c.z } };
}

function orbit(G, dt) {
  const o = G.shot.orbit;
  o.a += dt * 0.06;
  G.W.camera.position.set(o.x - 4 + Math.sin(o.a) * 3, 13, o.z + 22);
  G.W.camera.lookAt(o.x + 8, 3, o.z - 18);
}

const SCENES = { chase, city, mission, start };
export function applyShot(name, G) {
  try {
    if (G.shot) return;
    const scene = SCENES[name];
    if (!scene) {
      document.title = 'SB-error-bad-shot-' + name;
      return;
    }
    if (name !== 'start') { G.screen = 'play'; hidePanels(G.H); }
    G.shot = { name, ...(scene(G) || {}) };
    G.rng = makeRng(1);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.__shotReady = true;
      document.title = 'SB-' + name + '-ok';
    }));
  } catch (err) {
    document.title = 'SB-error-' + String((err && err.message) || err).slice(0, 80);
  }
}
