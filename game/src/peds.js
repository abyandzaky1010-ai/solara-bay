// Solara Bay — pedestrians. Small colourful walkers that loop their block on
// the sidewalk ring, run when the bay gets loud, and lie down when a bumper
// finds them. One special ped is the taxi fare: it waits, waves, rides, gone.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { material, C } from './palette.js';

const GRID = [-160, -80, 0, 80, 160];
const HALF = CONFIG.world.roadHalf;
const RING = 1.5;
const WALK_SPEED = CONFIG.peds.speed;
const FLEE_SPEED = CONFIG.peds.flee;
const FLEE_FOR = 4;
const DOWN_FOR = 20;
const HIT_SPEED = 6;
const SHIRTS = [...C.shirt, 0xf0c05a, 0x4fb3a5, 0xe8798a];
const PANTS = [...C.pants, 0x3d4f6a];

/* --------------------------------------------------------------------- mesh */

/** A 1.7 m walker: torso, head, two arms swinging from the shoulder, two legs. */
function buildPedMesh(rng) {
  const g = new THREE.Group();
  g.name = 'ped';
  const shirt = material(rng.pick(SHIRTS));
  const pants = material(rng.pick(PANTS));

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.28), shirt);
  torso.position.y = 1.02;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.28), material(rng.pick(C.skin)));
  head.position.y = 1.47;
  g.add(torso, head);

  const limbs = (list, w, d, y, xs, mat) => list.push(...xs.map((sx) => {
    const geo = new THREE.BoxGeometry(w, d, w * 1.1);
    geo.translate(0, -d / 2, 0); // pivot at the joint, not the middle
    const m = new THREE.Mesh(geo, mat);
    m.position.set(sx, y, 0);
    g.add(m);
    return m;
  }));

  const arms = [];
  const legs = [];
  limbs(arms, 0.13, 0.56, 1.3, [-0.31, 0.31], shirt);
  limbs(legs, 0.17, 0.72, 0.72, [-0.12, 0.12], pants);

  for (const sx of [-0.12, 0.12]) {
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.28), material(0x2a2c30));
    boot.position.set(sx, 0.07, 0.04);
    g.add(boot);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  g.userData.arms = arms;
  g.userData.legs = legs;
  return g;
}

/* ------------------------------------------------------- sidewalk ring maths */

/** Four corners of a block, inset 1.5 m so walkers stay on the sidewalk. */
function blockRing(ix, iz) {
  const x0 = GRID[ix] + HALF + RING;
  const x1 = GRID[ix + 1] - HALF - RING;
  const z0 = GRID[iz] + HALF + RING;
  const z1 = GRID[iz + 1] - HALF - RING;
  return [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
}

/** A random corner-to-corner leg on a random block. */
function randomLeg(rng) {
  const ix = rng.int(0, GRID.length - 2);
  const iz = rng.int(0, GRID.length - 2);
  const from = rng.int(0, 3);
  return { ix, iz, from, to: (from + (rng.chance(0.5) ? 1 : 3)) % 4, t: 0 };
}

function legPoints(leg) {
  const ring = blockRing(leg.ix, leg.iz);
  return { a: ring[leg.from], b: ring[leg.to] };
}

/* ---------------------------------------------------------------- spawning */

/** Populate the sidewalks; walkers only ever change blocks at a corner. */
export function spawnPeds(W, city, rng, count = CONFIG.peds.count) {
  void city;
  const peds = [];
  for (let i = 0; i < count; i++) {
    const ped = makeWalker(rng);
    ped.leg = randomLeg(rng);
    ped.leg.t = rng.range(0, 1);
    placeOnLeg(ped);
    W.scene.add(ped.mesh);
    peds.push(ped);
  }
  return peds;
}

function makeWalker(rng) {
  return {
    mesh: buildPedMesh(rng),
    pos: { x: 0, z: 0 },
    leg: null,
    speed: WALK_SPEED * rng.range(0.85, 1.15),
    hp: CONFIG.peds.hp,
    state: 'walk',
    fleeT: 0,
    downT: 0,
    walkT: rng.range(0, 6),
    heading: 0,
    alive: true,
    fare: false,
  };
}

function placeOnLeg(ped) {
  const { a, b } = legPoints(ped.leg);
  const t = Math.max(0, Math.min(1, ped.leg.t));
  ped.pos.x = a.x + (b.x - a.x) * t;
  ped.pos.z = a.z + (b.z - a.z) * t;
  ped.heading = Math.atan2(b.x - a.x, b.z - a.z);
  ped.mesh.position.set(ped.pos.x, 0, ped.pos.z);
  ped.mesh.rotation.y = ped.heading + Math.PI; // the model faces -z
}

/* --------------------------------------------------------------- the fare */

/** The taxi fare: stands on the nearest corner to (nearX,nearZ) and waves. */
export function makeFarePed(W, city, rng, nearX, nearZ) {
  void city;
  const ped = makeWalker(rng);
  ped.fare = true;
  ped.state = 'wait';
  ped.waveT = rng.range(0, 2);

  let spot = null;
  let bestD = Infinity;
  for (let ix = 0; ix < GRID.length - 1; ix++) {
    for (let iz = 0; iz < GRID.length - 1; iz++) {
      for (const c of blockRing(ix, iz)) {
        const d = Math.hypot(c.x - nearX, c.z - nearZ);
        if (d < bestD) { bestD = d; spot = c; }
      }
    }
  }
  ped.pos.x = spot ? spot.x : nearX;
  ped.pos.z = spot ? spot.z : nearZ;
  ped.heading = Math.atan2(W.roads.at(ped.pos.x, ped.pos.z).x - ped.pos.x,
    W.roads.at(ped.pos.x, ped.pos.z).z - ped.pos.z);
  ped.mesh.position.set(ped.pos.x, 0, ped.pos.z);
  ped.mesh.rotation.y = ped.heading + Math.PI;
  W.scene.add(ped.mesh);
  return ped;
}

/** Destination reached: the passenger is out and the ped leaves the world. */
export function fareDropped(ped) {
  if (!ped) return;
  ped.state = 'walk';
  ped.fare = false;
  ped.mesh.visible = false;
  ped.downT = -1;
  ped.gone = true;
}

/* ------------------------------------------------------------------- update */

/** Walk, flee, lie down, or ride. Ped-vs-car contact is caught right here. */
export function updatePeds(list, W, G, dt) {
  const car = G && G.inCar;
  for (const ped of list) {
    if (!ped || ped.gone) continue;
    if (ped.state === 'ride') { rideInTaxi(ped, G); continue; }
    if (ped.state === 'down') { updateDown(ped, W, G, dt); continue; }

    if (ped.state === 'walk' && spooked(ped, G, car)) {
      ped.state = 'flee';
      ped.fleeT = FLEE_FOR;
    }
    if (ped.state === 'wait') waveArm(ped, dt);
    else if (ped.state === 'flee') {
      ped.fleeT -= dt;
      if (ped.fleeT <= 0) ped.state = 'walk';
      stepFleeing(ped, G, dt);
    } else if (ped.leg) walkTheRing(ped, dt);

    if (ped.state === 'walk' || ped.state === 'flee') swingLimbs(ped, dt, WALK_SPEED);
    else restLimbs(ped, dt);

    ped.mesh.position.set(ped.pos.x, ped.mesh.position.y, ped.pos.z);
    ped.mesh.rotation.y = ped.heading + Math.PI;
    bumpIntoPed(ped, car, G);
  }
}

/** Corner-to-corner on the block ring; on arrival turn onto the next side. */
function walkTheRing(ped, dt) {
  const { a, b } = legPoints(ped.leg);
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  ped.leg.t += (ped.speed / len) * dt;
  if (ped.leg.t >= 1) {
    ped.leg.from = ped.leg.to;
    ped.leg.t = 0;
    ped.leg.to = (ped.leg.to + 1) % 4;
  }
  placeOnLeg(ped);
}

/** Run straight away from the alarm, or from the speeding car that spooked us. */
function stepFleeing(ped, G, dt) {
  const car = G && G.inCar;
  const closeCar = car && Math.hypot(car.x - ped.pos.x, car.z - ped.pos.z) < 10;
  const from = closeCar ? car : (G && G.alarm ? { x: G.alarmX ?? 0, z: G.alarmZ ?? 0 } : null);
  if (!from) return;
  let dx = ped.pos.x - from.x;
  let dz = ped.pos.z - from.z;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d;
  dz /= d;
  const lim = CONFIG.world.half - 12;
  ped.pos.x = Math.max(-lim, Math.min(lim, ped.pos.x + dx * FLEE_SPEED * dt));
  ped.pos.z = Math.max(-lim, Math.min(lim, ped.pos.z + dz * FLEE_SPEED * dt));
  ped.heading = Math.atan2(dx, dz);
  ped.leg = null; // the block ring is abandoned while running
}

function spooked(ped, G, car) {
  if (G && G.alarm && Math.hypot((G.alarmX ?? 0) - ped.pos.x, (G.alarmZ ?? 0) - ped.pos.z) < 26) return true;
  return !!(car && Math.abs(car.speed || 0) > 8 && Math.hypot(car.x - ped.pos.x, car.z - ped.pos.z) < 6);
}

function bumpIntoPed(ped, car, G) {
  if (!car || Math.abs(car.speed || 0) < HIT_SPEED) return;
  if (Math.hypot(car.x - ped.pos.x, car.z - ped.pos.z) > car.radius + 0.6) return;
  knockDown(ped, G, 'car');
}

/** Shared entry for cars, bullets and blast damage. */
export function knockDown(ped, G, cause = 'hit') {
  if (!ped || ped.state === 'down' || ped.state === 'ride') return;
  ped.state = 'down';
  ped.downT = DOWN_FOR;
  ped.alive = false;
  ped.hp = 0;
  ped.leg = null;
  ped.mesh.rotation.x = -Math.PI / 2; // flat on the pavement
  ped.mesh.position.y = 0.12;
  if (G && G.onPedHit) G.onPedHit(ped, cause);
}

function updateDown(ped, W, G, dt) {
  ped.downT -= dt;
  if (ped.downT > 0) return;
  // Get up at the corner farthest from the player, as if nothing happened.
  const here = (G && G.P && G.P.pos) || { x: 0, z: 0 };
  let spot = { x: 0, z: 0 };
  let bestD = -1;
  for (let ix = 0; ix < GRID.length - 1; ix++) {
    for (let iz = 0; iz < GRID.length - 1; iz++) {
      for (const c of blockRing(ix, iz)) {
        const d = Math.hypot(c.x - here.x, c.z - here.z);
        if (d > bestD) { bestD = d; spot = c; }
      }
    }
  }
  void W;
  ped.leg = randomLeg(localRng(ped));
  ped.leg.t = 0;
  ped.pos.x = spot.x;
  ped.pos.z = spot.z;
  ped.state = 'walk';
  ped.alive = true;
  ped.hp = CONFIG.peds.hp;
  ped.mesh.rotation.x = 0;
  ped.mesh.position.y = 0;
  placeOnLeg(ped);
}

/** Rides silently in the cab; without a cab it simply walks away. */
function rideInTaxi(ped, G) {
  const car = G && G.inCar;
  if (!car) { ped.state = 'walk'; ped.mesh.visible = true; return; }
  ped.pos.x = car.x;
  ped.pos.z = car.z;
  ped.mesh.visible = false;
}

/* -------------------------------------------------------------------- anims */

function swingLimbs(ped, dt, speed) {
  ped.walkT += dt * (speed > 3 ? 11 : 6.5);
  const a = Math.sin(ped.walkT) * 0.6;
  const { arms, legs } = ped.mesh.userData;
  arms[0].rotation.x = a;
  arms[1].rotation.x = -a;
  legs[0].rotation.x = -a;
  legs[1].rotation.x = a;
  ped.mesh.position.y = Math.abs(Math.sin(ped.walkT)) * 0.04;
}

function restLimbs(ped, dt) {
  const { arms, legs } = ped.mesh.userData;
  for (const limb of [...arms, ...legs]) limb.rotation.x *= Math.max(0, 1 - dt * 8);
}

/** Arm up, waving for the cab. */
function waveArm(ped, dt) {
  ped.waveT += dt;
  const arm = ped.mesh.userData.arms[1];
  arm.rotation.x = -2.5 + Math.sin(ped.waveT * 7) * 0.5;
  arm.rotation.z = 0.3;
}

/* ------------------------------------------------------------------ helpers */

function localRng(ped) {
  let s = (((ped.pos.x * 374761393) ^ (ped.pos.z * 668265263)) >>> 0) || 7;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}
