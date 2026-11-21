// Pedestrians: small colourful walkers who keep to the pavement ring around
// each block, cross only at corners, scatter when it gets loud and drop flat
// when something hits them. The same body doubles as a taxi fare.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';

const PC = CONFIG.peds;
const RING = CONFIG.world.roadHalf + PC.sidewalkOffset;
const GRID = [-160, -80, 0, 80, 160];
const FLEE_TIME = 4;
const DOWN_TIME = 20;
const CAR_HIT = 6;
const THREAT = 8;

function limb(w, h, d, hex) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex));
  m.castShadow = true;
  return m;
}

// Tiny low-poly walker: trouser block, bright shirt, head, two swinging arms and
// a soft shadow blob, all hanging off one root so the ped moves as a unit.
function buildWalker(rng, shirtHex) {
  const root = new THREE.Group();
  const legs = limb(0.42, 0.72, 0.3, C.pants[rng.int(0, C.pants.length - 1)]);
  legs.position.y = 0.36;
  const chest = limb(0.5, 0.62, 0.34, shirtHex);
  chest.position.y = 1.03;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), material(C.skin[rng.int(0, C.skin.length - 1)]));
  head.position.y = 1.48;
  head.castShadow = true;
  const arms = [-1, 1].map((side) => {
    const arm = limb(0.13, 0.62, 0.14, shirtHex);
    arm.position.set(side * 0.33, 1.06, 0);
    arm.geometry.translate(0, -0.31, 0);
    return arm;
  });
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.34, 10),
    new THREE.MeshBasicMaterial({ color: 0x2c2a26, transparent: true, opacity: 0.22, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  root.add(legs, chest, head, arms[0], arms[1], blob);
  return { root, armL: arms[0], armR: arms[1] };
}

function makePed(W, rng, x, z, yaw) {
  const parts = buildWalker(rng, C.shirt[rng.int(0, C.shirt.length - 1)]);
  parts.root.position.set(x, 0, z);
  parts.root.rotation.y = yaw;
  if (W && W.scene) W.scene.add(parts.root);
  return {
    mesh: parts.root, parts, pos: { x, z }, ring: { ix: 0, iz: 0 }, edge: { from: 0, to: 1 },
    t: 0, speed: PC.speed * rng.range(0.85, 1.2), hp: PC.hp, state: 'walk',
    fleeT: 0, fleeX: 0, fleeZ: 0, downT: 0, swing: rng.angle(), yaw, rng,
  };
}

// ------------------------------------------------------------ ring geometry

// Four pavement corners around one block; ring index mirrors the road grid.
function ringCorners(ix, iz) {
  return [
    { x: GRID[ix] + RING, z: GRID[iz] + RING }, { x: GRID[ix + 1] - RING, z: GRID[iz] + RING },
    { x: GRID[ix + 1] - RING, z: GRID[iz + 1] - RING }, { x: GRID[ix] + RING, z: GRID[iz + 1] - RING },
  ];
}

function cornerOf(ring, c) {
  return ringCorners(ring.ix, ring.iz)[c & 3];
}

function turn(rng) {
  return rng.chance(0.5) ? 1 : 3;
}

// Every (block, corner) pair as a flat list, so nearest-corner searches can
// scan the whole city without nested loops.
const CORNERS = [];
for (let ix = 0; ix < 4; ix += 1) {
  for (let iz = 0; iz < 4; iz += 1) {
    const pts = ringCorners(ix, iz);
    pts.forEach((p, k) => CORNERS.push({ ring: { ix, iz }, k, x: p.x, z: p.z }));
  }
}

function nearestCorner(x, z) {
  let best = CORNERS[0];
  let bestD = Infinity;
  for (const c of CORNERS) {
    const d = Math.hypot(c.x - x, c.z - z);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

// Point along the current ring side, plus the yaw to face along it.
function walkPoint(ped) {
  const a = cornerOf(ped.ring, ped.edge.from);
  const b = cornerOf(ped.ring, ped.edge.to);
  const t = Math.max(0, Math.min(1, ped.t));
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t,
    yaw: Math.atan2(b.x - a.x, b.z - a.z), len: Math.hypot(b.x - a.x, b.z - a.z) || 1 };
}

// Cross the street legally: stay on the pavement, swap to the neighbouring
// block's ring at its nearest corner, then walk on from there.
function crossStreet(ped, corner) {
  const step = corner === 0 ? -1 : 1;
  const ix = corner < 2 ? Math.max(0, Math.min(3, ped.ring.ix + step)) : ped.ring.ix;
  const iz = corner < 2 ? ped.ring.iz : Math.max(0, Math.min(3, ped.ring.iz + step));
  const near = ix === ped.ring.ix && iz === ped.ring.iz ? { k: corner } : nearestCorner(ped.pos.x, ped.pos.z);
  ped.ring = { ix, iz };
  ped.edge = { from: near.k, to: (near.k + turn(ped.rng)) & 3 };
  ped.t = 0;
}

function advanceSide(ped, dt) {
  ped.t += (ped.speed * dt) / walkPoint(ped).len;
  if (ped.t < 1) return;
  ped.t -= 1;
  const at = ped.edge.to;
  if (ped.rng.chance(0.22)) crossStreet(ped, at);
  else ped.edge = { from: at, to: (at + turn(ped.rng)) & 3 };
}

// Place, face, and swing the arms in proportion to speed.
function facePlace(ped, x, z, yaw, speed, dt) {
  ped.pos.x = x;
  ped.pos.z = z;
  ped.yaw = yaw;
  ped.swing += speed * dt * 3.4;
  ped.mesh.position.set(x, 0, z);
  ped.mesh.rotation.y = yaw;
  const s = Math.sin(ped.swing) * Math.min(0.7, 0.12 + speed * 0.09);
  ped.parts.armL.rotation.x = s;
  ped.parts.armR.rotation.x = -s;
}

// ------------------------------------------------------------------- spawn

export function spawnPeds(W, city, rng, count) {
  const list = [];
  const total = Math.max(1, (count | 0) || PC.count);
  for (let i = 0; i < total; i += 1) {
    const ring = { ix: rng.int(0, 3), iz: rng.int(0, 3) };
    const corner = rng.int(0, 3);
    const spot = cornerOf(ring, corner);
    const ped = makePed(W, rng, spot.x, spot.z, rng.angle());
    Object.assign(ped, { ring, edge: { from: corner, to: (corner + turn(rng)) & 3 }, t: rng.range(0.05, 0.6) });
    const p = walkPoint(ped);
    facePlace(ped, p.x, p.z, p.yaw, 0, 0);
    list.push(ped);
  }
  return list;
}

export function makeFarePed(W, city, rng, nearX, nearZ) {
  const spot = nearestCorner(nearX, nearZ);
  const ped = makePed(W, rng, spot.x, spot.z, Math.atan2(nearX - spot.x, nearZ - spot.z));
  Object.assign(ped, { ring: spot.ring, edge: { from: spot.k, to: (spot.k + 1) & 3 }, fare: true, state: 'wait' });
  facePlace(ped, spot.x, spot.z, ped.yaw, 0, 0);
  return ped;
}

// ------------------------------------------------------------------ events

function scare(ped, x, z) {
  if (ped.state === 'down' || ped.state === 'ride') return;
  Object.assign(ped, { state: 'flee', fleeT: FLEE_TIME, fleeX: x, fleeZ: z });
}

function knockDown(ped, G) {
  if (ped.state === 'down') return;
  Object.assign(ped, { state: 'down', hp: 0, downT: DOWN_TIME, fare: false, taxi: null });
  ped.parts.root.rotation.x = -Math.PI / 2;
  ped.parts.root.position.y = 0.2;
  if (G && G.onPedHit) G.onPedHit(ped);
}

// Player gunfire: drop at zero hp, otherwise run for it.
export function damagePed(ped, amount, G) {
  if (!ped || ped.state === 'down') return false;
  ped.hp -= amount;
  if (ped.hp <= 0) {
    knockDown(ped, G);
    return true;
  }
  if (G && G.P) scare(ped, G.P.pos.x, G.P.pos.z);
  if (G && G.sound && G.sound.crash) G.sound.crash(0.3);
  return false;
}

function threatFromCars(ped, G) {
  for (const car of [G.inCar].concat(G.cars || [], G.traffic || [])) {
    if (!car || car.wrecked) continue;
    const d = Math.hypot(car.x - ped.pos.x, car.z - ped.pos.z);
    const speed = Math.abs(car.speed || 0);
    // Contact is tested before panic: a fast bumper beside you is a hit, not a
    // reason to jog away.
    if (speed > CAR_HIT && d < car.radius + 0.75) {
      knockDown(ped, G);
      return true;
    }
    if (d < 6 && speed > THREAT) scare(ped, car.x, car.z);
  }
  return false;
}

// Revive at the block corner farthest from the player, then walk on.
function recyclePed(ped, W, rng, player) {
  let far = CORNERS[0];
  for (const c of CORNERS) {
    if (Math.hypot(c.x - player.x, c.z - player.z) > Math.hypot(far.x - player.x, far.z - player.z)) far = c;
  }
  Object.assign(ped, { ring: far.ring, edge: { from: far.k, to: (far.k + turn(rng)) & 3 },
    t: rng.range(0.05, 0.5), state: 'walk', hp: PC.hp, fare: false, taxi: null, fleeT: 0, swing: 0 });
  ped.parts.root.rotation.set(0, 0, 0);
  ped.parts.root.position.y = 0;
  ped.parts.armL.rotation.x = 0;
  ped.parts.armR.rotation.x = 0;
  ped.mesh.visible = true;
  const p = walkPoint(ped);
  facePlace(ped, p.x, p.z, p.yaw, 0, 0);
  if (W && W.scene && ped.mesh.parent !== W.scene) W.scene.add(ped.mesh);
}

// ------------------------------------------------------------------ update

export function updatePeds(list, W, G, dt) {
  if (!list || !list.length) return;
  const here = G || {};
  const player = here.inCar || (here.P && here.P.pos) || { x: 0, z: 0 };

  for (const ped of list) {
    if (!ped || !ped.parts) continue;

    if (ped.state === 'ride') {
      if (ped.taxi) { ped.pos.x = ped.taxi.x; ped.pos.z = ped.taxi.z; }
      ped.mesh.visible = false;
      continue;
    }
    ped.mesh.visible = true;

    if (ped.state === 'down') {
      ped.downT -= dt;
      if (ped.downT <= 0) recyclePed(ped, W, ped.rng, player);
      continue;
    }

    if (ped.state === 'wait') {
      // Arms up, waving at passing cabs, watching the taxi come in.
      ped.swing += dt * 7;
      ped.parts.armR.rotation.x = -1.9 + Math.sin(ped.swing) * 0.35;
      ped.parts.armL.rotation.x = 0.2;
      ped.yaw = Math.atan2(player.x - ped.pos.x, player.z - ped.pos.z);
      ped.mesh.rotation.y = ped.yaw;
      if (threatFromCars(ped, here)) continue;
      if (here.alarm > 0 && Math.hypot(here.alarmX - ped.pos.x, here.alarmZ - ped.pos.z) < 22) {
        scare(ped, here.alarmX, here.alarmZ);
      } else if (!ped.fare) ped.state = 'walk';
      continue;
    }

    if (ped.state === 'flee') {
      ped.fleeT -= dt;
      const dx = ped.pos.x - ped.fleeX;
      const dz = ped.pos.z - ped.fleeZ;
      const len = Math.hypot(dx, dz) || 1;
      const edge = CONFIG.world.half - 2;
      facePlace(ped,
        Math.max(-edge, Math.min(edge, ped.pos.x + (dx / len) * PC.flee * dt)),
        Math.max(-edge, Math.min(edge, ped.pos.z + (dz / len) * PC.flee * dt)),
        Math.atan2(dx, dz), PC.flee, dt);
      threatFromCars(ped, here);
      if (ped.fleeT <= 0) {
        const c = nearestCorner(ped.pos.x, ped.pos.z);
        Object.assign(ped, { ring: c.ring, edge: { from: c.k, to: (c.k + turn(ped.rng)) & 3 }, t: 0, state: 'walk' });
      }
      continue;
    }

    // Walk: corner to corner round the block.
    if (threatFromCars(ped, here)) continue;
    if (here.alarm > 0 && Math.hypot(here.alarmX - ped.pos.x, here.alarmZ - ped.pos.z) < 26) {
      scare(ped, here.alarmX, here.alarmZ);
    }
    advanceSide(ped, dt);
    const p = walkPoint(ped);
    facePlace(ped, p.x, p.z, p.yaw, ped.speed, dt);
  }
}
