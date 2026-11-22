import * as THREE from 'three';
import { makeRng } from './random.js';
import { makeCar, addCarToScene } from './car.js';
import { stowPlayer, givePickup } from './player.js';
import { makeFarePed } from './peds.js';
import { startMission } from './missions.js';
import { addStars } from './police.js';
import { hidePanels } from './hud.js';
import { resumeSfx } from './sfx.js';
const NAMES = 'chase city mission start'.split(' ');
const snap = (g, yaw, pitch) => { g.W.yaw = yaw, (g.W.pitchAngle = pitch), (g.W.ready = 0); };
const put = (G, kind, x, z, h, color) => addCarToScene(G.W, Object.assign(makeCar(kind, x, z, h, color), { occupant: 'npc' }));
const crew = (G, c) => (Object.assign(c, { police: 1, siren: 1, aiOwned: 1 }), G.PO.cars.push({ car: c, dead: 0, ramCool: 0, dropped: 1, parked: 1, stuckT: 0 }), c);
const parkMid = (G) => { const b = G.city.park.bounds; return [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2]; };
function stand(G, rng, x, z, yaw) {
  const p = Object.assign(makeFarePed(G.W, G.city, rng, x, z), { state: 'wait', speed: 0 });
  p.pos.set(x, 0, z), p.mesh.position.set(x, 0, z), (p.mesh.rotation.y = yaw), G.peds.push(p);
}
function drive(G, car, sp) {
  Object.assign(car, { player: 1, occupant: null, aiOwned: 0, speed: sp }), (G.inCar = car), G.P.pos.set(car.x, 0, car.z), stowPlayer(G.P);
}
/** chase — the sport in its Meridian lane, three stars, cruisers ahead of it. */
function chase(G, rng) {
  snap(G, Math.PI, 0.2);
  const car = put(G, 'sport', 6.4, -99, Math.PI, 0xd94f4f);
  G.cars.push(car), drive(G, car, 0);
  addStars(G.PO, 3, G), (G.PO.spawnT = 1e9);
  G.PO.foot.push({ mesh: new THREE.Group(), legs: [0, 1].map(() => new THREE.Object3D()), pos: new THREE.Vector3(9.6, 0, -1e4), hp: 60, yaw: 0, walkT: 0, cool: 1e9, strafe: 1, strafeT: 1e9 });
  for (const d of [12, 20]) G.cars.push(crew(G, put(G, 'police', 6.4, -99 - d, Math.PI, 0xeef2f5)));
  for (const d of [26, 34]) G.traffic.push(Object.assign(put(G, 'sedan', -6.4, -99 - d, 0, 0x8ea3b8), { edgeLen: 1 }));
  for (const x of [10.6, 11.6]) stand(G, rng, x, -93, Math.PI);
}
/** city — mid-crossing on the m1 car's street: traffic, peds, banner, beacon. */
function city(G, rng) {
  const p = G.P, px = G.m1car.x, pz = G.m1car.z + 20;
  p.pos.set(px, 0, pz), p.group.position.set(px, 0, pz), (p.yaw = Math.PI);
  snap(G, Math.PI, 0.48);
  const p1 = put(G, 'sedan', 2.9, 53, -Math.PI / 2, 0x8ea3b8), p2 = put(G, 'taxi', 5.1, 40, Math.PI / 2, 0xf7c948);
  (p1.speed = p2.speed = 0), G.cars.push(p1, p2), G.traffic.push(p1, p2);
  [[-2, -3], [-4, -5], [11, -3], [13, -5]].forEach(([x, y]) => stand(G, rng, x, pz + y, Math.PI));
  startMission(G.M, G);
}
const navy = new THREE.MeshLambertMaterial({ color: 0x2b3b55 });
function officer(G, x, z) {
  const g = makeFarePed(G.W, G.city, makeRng(7), x, z).mesh;
  g.traverse((o) => o.isMesh && (o.material = navy)), g.position.set(x, 0.3, z), g.rotation.set(1.57, 0.6, 0);
  G.peds.push({ mesh: g, pos: new THREE.Vector3(x, 0, z), state: 'down', downT: 99, hp: 0, riding: 0, fare: 0 });
}
/** mission — Verde Park, rifle, two stars, a cop firing, one down. */
function mission(G, rng) {
  const [cx, cz] = parkMid(G), cop = G.PO.foot[0];
  G.P.pos.set(cx + 2, 0, cz + 8), G.P.group.position.set(cx + 2, 0, cz + 8), snap(G, 0, 0.16);
  givePickup(G.P, G, 'rifle'), (G.P.ammo = 60), (G.P.weapon = 'rifle');
  G.PO.stars = 2, G.PO.noSeeT = 0, G.PO.spawnT = 1e9;
  if (cop) cop.pos.set(cx - 10, 0, cz + 4), (cop.cool = 0), (cop.strafeT = 9);
  G.cars.push(crew(G, put(G, 'police', cx - 24, cz + 12, Math.PI / 2, 0xeef2f5)));
  officer(G, cx + 9, cz - 2);
  stand(G, rng, cx - 16, cz + 16, Math.PI), stand(G, rng, cx + 16, cz + 18, Math.PI);
}
/** start — title card over the park: sport car and a cruiser in frame. */
function start(G) {
  const [cx, cz] = parkMid(G), car = G.cars.find((c) => c.kind === 'sport');
  if (car) {
    Object.assign(car, { x: cx + 3, z: cz + 2 });
    car.mesh.position.set(car.x, 0, car.z);
    G.cars.push(Object.assign(put(G, 'police', cx + 12, cz + 4, Math.PI, 0xeef2f5), { speed: 0 }));
  }
  G.P.pos.set(cx - 1, 0, cz + 13), G.P.group.position.set(cx - 1, 0, cz + 13);
  snap(G, Math.PI, 0.26);
}
/** applyShot(name, G): lay out a scene, then arm window.__shotReady. */
export function applyShot(name, G) {
  if (!G || !NAMES.includes(name)) {    document.title = 'SB-error-' + (name || 'none');
    return false;
  }
  const rng = makeRng(1);
  G.shot = name, (G.screen = name === 'start' ? 'title' : 'play');
  hidePanels(G.H), document.getElementById('title')?.classList.toggle('on', name === 'start');
  if (name === 'start') resumeSfx();
  if (name === 'chase') chase(G, rng);
  else if (name === 'city') city(G, rng);
  else if (name === 'mission') mission(G, rng);
  else start(G);
  document.title = 'SB-' + name + '-ok';
  window.__shotReady = false;
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__shotReady = true; }));
  return true;
}
export default applyShot;
