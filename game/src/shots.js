import * as THREE from 'three';
import { makeRng } from './random.js';
import { makeCar } from './car.js';
import { makeFarePed } from './peds.js';
import { C } from './palette.js';
import { showPanel, hidePanels } from './hud.js';
import { spawnTracer } from './render.js';

const drop = (l) => { for (const o of l) if (o && o.mesh && o.mesh.parent) o.mesh.parent.remove(o.mesh); l.length = 0; }; const set = (o, d) => Object.assign(o, d);

function swap(G, old, kind, x, z, h, col) {
  if (old && old.mesh && old.mesh.parent) old.mesh.parent.remove(old.mesh);
  const c = makeCar(kind, x, z, h, col); G.W.scene.add(c.mesh);
  return c;
}

function park(G, x, z, yaw, taxi) {
  const c = makeCar(taxi ? 'taxi' : 'sedan', x, z, yaw, taxi ? C.taxi : C.sedan); set(c, { occupant: 'npc', traffic: true, edge: null, speed: 0 });
  G.W.scene.add(c.mesh); G.traffic.push(c);
}

const walker = (G, p) => G.peds.push(set(makeFarePed(G.W, G.city, G.rng, p[0], p[1]), { fare: false, state: 'walk', yaw: p[2] }));

// Officer stub with the rig parts officerStep animates.
function officer(G, x, z, dead) {
  const root = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ color: C.coptrim }), geo = new THREE.BoxGeometry(0.24, 0.6, 0.3); const at = (py, px) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, 0); root.add(m); return m; };
  const legs = [at(0.36, -0.13), at(0.36, 0.13)], torso = at(1.04, 0), armL = at(1.3, -0.34), armR = at(1.3, 0.34); root.position.set(x, 0, z);
  root.rotation.z = dead ? Math.PI / 2 : 0; G.W.scene.add(root);
  return { x, z, pos: { x, z }, yaw: 0, dead: !!dead, hp: dead ? 0 : 60, cool: 0.4, gait: 0, strafe: 1, strafeT: 2, mesh: root, rig: { root, torso, legs, armL, armR } };
}

const PEDS = [[27, 9, -1.2], [33, 10, 1.4], [26, 3, 2.6]];

export function applyShot(name, G) {
  try {
    if (!G) return;
    const { P, W, M, PO, m1Car: m1 } = G, cm = W.cam; const go = G.city.markers.glassOrchid, pk = G.city.pickup || { x: -40, z: -40 };
        const at = (x, z, yaw, camYaw, pitch) => {
      P.pos.set(x, 0, z); P.group.position.set(x, 0, z);
      P.yaw = P.group.rotation.y = yaw; cm.yaw = camYaw;
      cm.pitch = pitch;
    }; hidePanels(G.H);
    set(G, { screen: 'play', inCar: null }); drop(G.traffic);
    drop(G.peds); PO.noSeeT = 0;

    if (name === 'chase') {
      const car = swap(G, m1, 'sport', 12, 88, 0, C.sport); set(car, { player: true, occupant: 'player' });
      set(G, { m1Car: car, inCar: car, cars: [car] }); at(12, 88, 0, Math.PI, 0.28);
      PO.stars = 3; const near = swap(G, PO.cars[0], 'police', 24, 100, 0.8, C.copbody);
      const far = swap(G, PO.cars[1], 'police', -8, 132, 0.6, C.copbody); near.speed = 15;
      far.speed = 18; drop(PO.foot);
      PO.cars = [near, far];
      for (const a of [[7, 116, Math.PI, 1], [-5, 74, 0, 0], [17, 56, 0, 0]]) park(G, ...a);
      G.objective = { title: 'Wheels for Vesper', text: 'shake the heat', dist: 64, timer: 0 };
      M.marker = M.target = go;
    } else if (name === 'city') {
      at(30, 6, -Math.PI / 2, Math.PI * 0.84, 0.24);
      for (const a of [[34, 6, Math.PI / 2, 1], [-2, 6, Math.PI / 2, 0], [22, -2, -Math.PI / 2, 0]]) park(G, ...a);
      PEDS.forEach((p) => walker(G, p)); PO.stars = 0;
      const brief = 'deliver the coupe to the Glass Orchid';
      const m1a = { id: 'm1', title: 'Wheels for Vesper', state: 'deliver', stageIndex: 1, markX: go.x, markZ: go.z, coupe: m1 || null };
      set(M, { index: 0, fail: null, step: brief, marker: go, target: go, active: m1a }); G.objective = { title: 'Wheels for Vesper', text: brief, dist: 38, timer: 0 };
    } else if (name === 'mission') {
      at(pk.x, pk.z, Math.PI * 0.18, Math.PI * 0.58, 0.18); set(P, { rifle: true, weapon: 'rifle', ammo: 60, aim: true });
      PO.stars = 2; const cop = officer(G, pk.x + 10, pk.z + 4, 0);
      const cruiser = swap(G, PO.cars[0], 'police', pk.x + 17, pk.z + 15, 0.75, C.copbody); drop(PO.foot);
      PO.foot = [cop, officer(G, pk.x + 5, pk.z - 7, 1)]; cruiser.speed = 6;
      PO.cars = [cruiser]; spawnTracer({ x: cop.x, y: 1.25, z: cop.z }, { x: pk.x, y: 1.1, z: pk.z });
      const m2a = { id: 'm2', title: 'Shake the Heat', state: 'evade', markX: pk.x, markZ: pk.z, timer: 52 };
      set(M, { index: 1, timer: 52, marker: null, active: m2a }); G.objective = { title: 'Shake the Heat', text: 'get clear of the officers', dist: 12, timer: 52 };
    } else if (name === 'start') {
      G.screen = 'title'; at(pk.x, pk.z, Math.PI * 1.2, Math.PI * 0.7, 0.5);
      showPanel(G.H, 'title');
      if (m1) {
        set(m1, { x: pk.x + 13, z: pk.z + 3, heading: Math.PI * 1.3 }); m1.mesh.position.set(m1.x, 0, m1.z);
        m1.mesh.rotation.y = m1.heading;
      }
      W.camera.position.set(pk.x + 4, 30, pk.z + 46); W.camera.lookAt(70, 14, -70);
    } else throw new Error('unknown shot ' + name);
  } catch (e) {
    document.title = 'SB-error-' + String((e && e.message) || e).slice(0, 100);
  }
}
