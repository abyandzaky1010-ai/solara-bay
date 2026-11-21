import * as THREE from 'three';
import { makeRng } from './random.js';
import { makeCar } from './car.js';
import { C, material } from './palette.js';
import { showPanel, hidePanels } from './hud.js';
import { addStars } from './police.js';
import { startMission } from './missions.js';
import { spawnTracer, spawnMuzzle } from './render.js';

const NAMES = ['chase', 'city', 'mission', 'start'];

function movePed(p, x, z, yaw) {
  Object.assign(p, { state: 'walk', riding: false, fare: false, hp: 40, fleeT: 0 });
  p.pos.set(x, 0, z);
  p.mesh.position.set(x, 0, z);
  p.mesh.rotation.y = yaw;
  p.mesh.visible = true;
}

function park(G, kind, x, z, h, color) {
  const c = Object.assign(makeCar(kind, x, z, h, color), { occupied: null, player: false, speed: 0, tag: null });
  G.cars.push(c);
  G.W.scene.add(c.mesh);
  return c;
}

function copCar(G, x, z, h) {
  const c = park(G, 'police', x, z, h, C.copbody);
  c.siren = true;
  G.PO.cars.push({ car: c, bailT: 0, dead: false, block: false });
}

function onFoot(G, x, z, yaw) {
  const P = G.P;
  P.yaw = yaw;
  P.group.visible = true;
  P.pos.set(x, 0, z);
  P.group.position.set(x, 0, z);
  P.group.rotation.set(0, yaw, 0);
  G.inCar = null;
}

function cop(G, x, z, yaw) {
  const g = new THREE.Group();
  const put = (w, h, d, hex, px, py) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex));
    m.position.set(px, py, 0);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  put(0.46, 0.86, 0.3, C.coptrim, 0, 1.16);
  put(0.26, 0.28, 0.26, C.skin[1], 0, 1.72);
  const legL = put(0.16, 0.62, 0.18, 0x22304a, -0.11, 0.62);
  const legR = put(0.16, 0.62, 0.18, 0x22304a, 0.11, 0.62);
  const armR = put(0.12, 0.44, 0.14, C.coptrim, 0.29, 1.42);
  armR.rotation.x = -1.3;
  g.userData = { legL, legR, armL: armR, armR };
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
  G.W.scene.add(g);
  const row = { mesh: g, pos: new THREE.Vector3(x, 0, z), yaw, hp: 60, down: false, deadT: 0, alive: true, nextShot: 99, walkT: 0, strafe: 1, strafeT: 2 };
  G.PO.foot.push(row);
  return row;
}

function downedCop(G, x, z) {
  const c = Object.assign(cop(G, x, z, 0.6), { down: true, hp: 0, deadT: 900 });
  c.mesh.rotation.z = Math.PI / 2;
  c.mesh.position.y = 0.3;
}

export function applyShot(name, G) {
  try {
    window.__shotReady = false;
    if (!NAMES.includes(name)) throw new Error('bad');
    G.rng = makeRng(1);
    G.screen = 'play';
    G.PO.stars = 0;
    for (const p of G.peds) if (p.mesh) p.mesh.visible = false;
    hidePanels(G.H);

    if (name === 'chase') {
      const car = G.cars.find((c) => c.tag === 'm1car');
      Object.assign(car, { x: 12, z: 88, heading: 0, speed: 18, wrecked: false, hp: 100, player: true, occupied: null });
      car.mesh.position.set(12, 0, 88);
      car.mesh.rotation.y = 0;
      G.P.group.visible = false;
      G.inCar = car;
      Object.assign(G.W, { yaw: 0, pitch: 0.2 });
      addStars(G.PO, 3, G);
      copCar(G, 24, 100, 0);
      copCar(G, 26, 134, 0);
      G.traffic.forEach((t, i) => {
        Object.assign(t, { x: i % 2 ? 3.2 : -3.2, z: 20 + i * 13, heading: 0, speed: 9, taken: false });
        t.mesh.position.set(t.x, 0, t.z);
        t.mesh.rotation.y = 0;
      });
      [[-4, 92], [2, 96], [-2, 84], [6, 104]].forEach((s, i) => movePed(G.peds[i], s[0], s[1], 0.3 * i));
    } else if (name === 'city') {
      onFoot(G, 30, 6, Math.PI / 2);
      Object.assign(G.W, { yaw: Math.PI, pitch: 0.24 });
      park(G, 'taxi', 44, 9, Math.PI / 2, C.taxi);
      park(G, 'sedan', 58, 4, -Math.PI / 2, C.sedan);
      park(G, 'sport', 20, 9, Math.PI / 2, C.sport);
      [[33, 2], [27, 10], [36, 11], [24, 3], [40, 1], [31, 13]].forEach((s, i) => movePed(G.peds[i], s[0], s[1], 0.7 * i));
      startMission(G.M, G);
    } else if (name === 'mission') {
      const k = G.city.pickup || { x: -41, z: -41 };
      Object.assign(G.P, { rifle: true, ammo: 60, weapon: 'rifle' });
      G.P.rig.rifle.visible = true;
      G.P.rig.gun.visible = false;
      onFoot(G, k.x - 4, k.z + 3, -Math.PI * 0.75);
      Object.assign(G.W, { yaw: Math.PI * 0.75, pitch: 0.26 });
      addStars(G.PO, 2, G);
      const c = cop(G, k.x - 14, k.z + 12, Math.PI * 0.75);
      const from = { x: c.pos.x, y: 1.4, z: c.pos.z };
      spawnMuzzle(from);
      spawnTracer(from, { x: G.P.pos.x, y: 1.3, z: G.P.pos.z });
      copCar(G, -30, -10, Math.PI / 2);
      downedCop(G, k.x + 6, k.z - 5);
      movePed(G.peds[0], -22, -22, 1.2);
    } else {
      G.screen = 'title';
      showPanel(G.H, 'title');
      if (G.H.hud) G.H.hud.classList.add('hidden');
      onFoot(G, -30, 30, 0);
      park(G, 'sport', -40, 20, 0.4, C.sport);
      Object.assign(G.W, { yaw: 0.9, pitch: 0.5 });
      G.W.camPos.set(-78, 30, 46);
      G.W.camera.position.copy(G.W.camPos);
      G.W.camera.lookAt(40, 16, -30);
    }
    return true;
  } catch (err) {
    document.title = `SB-error-${String(err?.message || err).slice(0, 100)}`;
    return false;
  }
}
