// Solara Bay — the people on the pavement. Fifteen low-poly walkers loop the blocks
// on their sidewalks, hop the corner crossings, bolt when a gun goes off or a car
// comes in fast, lie flat when a bumper finds them, and ride quietly in cabs as fares.

import * as THREE from 'three';
import { CONFIG, STEP } from './config.js';
import { C, material } from './palette.js';

const PEDS = CONFIG.peds;
const WALK = PEDS.speed; // 1.4 m/s, a stroll
const FLEE = PEDS.flee; // 5.2 m/s, a sprint with panic in it
const HP = PEDS.hp; // 40
const RESPAWN = PEDS.respawn; // 20 s face down
const HOP = 1.5; // sidewalk centre line off the kerb
const GRID = [-160, -80, 0, 80, 160];
const HALF = CONFIG.world.half;
const FLEE_TIME = 4; // s of running after a scare
const STEP_TIME = STEP; // the fixed tick the loop runs on
const SCARE = 26; // m, how far a gunshot or an alarm is heard
const DANGER = 18; // m, how close a fast car has to be to spook someone
const FAST = 6; // m/s of car speed that counts as fast
const STEP_OFF = 0.6; // m past the crosswalk before turning up the far kerb
const NEAR_LIMIT = 140; // m from the player before a walker is moved on
const SKINS = C.skin;
const SHIRTS = C.shirt;
const PANTS = C.pants;
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]]; // block corners, clockwise from south-west

const tick = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------------ bodies

function chip(parent, w, h, d, hex, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

/** A hung limb: a pivot at the hip or shoulder with one box down from it. */
function swing(parent, x, y, hex, len, thick) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  chip(pivot, thick, len, thick, hex, 0, -len / 2, 0);
  parent.add(pivot);
  return pivot;
}

/** A colourful tiny walker: shirt, trousers, skin, one arm to wave with. */
function buildWalker(rng) {
  const group = new THREE.Group();
  group.name = 'ped';
  const body = new THREE.Group();
  group.add(body);
  const shirt = rng.pick(SHIRTS);
  const pants = rng.pick(PANTS);
  const skin = rng.pick(SKINS);
  chip(body, 0.5, 0.3, 0.3, pants, 0, 0.78, 0);
  chip(body, 0.54, 0.5, 0.32, shirt, 0, 1.12, 0);
  chip(body, 0.3, 0.28, 0.3, skin, 0, 1.51, 0);
  const hat = rng.pick([0xf3e9c8, 0x2b3b55, 0xe07a5f]);
  chip(body, 0.33, 0.09, 0.33, hat, 0, 1.68, 0);
  const armL = swing(body, -0.32, 1.32, skin, 0.6, 0.13);
  const armR = swing(body, 0.32, 1.32, skin, 0.6, 0.13);
  const legL = swing(body, -0.13, 0.68, pants, 0.7, 0.18);
  const legR = swing(body, 0.13, 0.68, pants, 0.7, 0.18);
  return { group, body, armL, armR, legL, legR };
}

/** Where a walker stands on the sidewalk of block corner (cx, cz). */
function cornerSpot(ix, iz, cx, cz) {
  return {
    x: GRID[ix] + cx * (CONFIG.world.roadHalf + HOP),
    z: GRID[iz] + cz * (CONFIG.world.roadHalf + HOP),
  };
}

/** Index slot of a street coordinate, for walking the ring. */
const slot = (v) => {
  const i = GRID.indexOf(v);
  return i < 0 ? 2 : i;
};

/** Build the four-corner ring of a block, anticlockwise, with crosswalks flagged. */
function ringFor(ix, iz, clockwise) {
  const order = clockwise ? [0, 3, 2, 1] : [0, 1, 2, 3];
  const spots = order.map((k) => {
    const [cx, cz] = CORNERS[k];
    return { ...cornerSpot(ix, iz, cx, cz), cx, cz, corner: true };
  });
  return spots;
}

/** The next block over the street, and the corner that faces where we are. */
function crossTo(block, corner) {
  const ix = block.ix + (corner.cx > 0 ? 1 : -1);
  const iz = block.iz + (corner.cz > 0 ? 1 : -1);
  return {
    block: { ix: clamp(ix, 0, GRID.length - 2), iz: clamp(iz, 0, GRID.length - 2) },
    face: { cx: -corner.cx, cz: -corner.cz },
  };
}

/** The ring slot of the corner a walker lands on when it steps off a crossing. */
function landSlot(clockwise, cx, cz) {
  const k = CORNERS.findIndex(([x, z]) => x === cx && z === cz);
  const order = clockwise ? [0, 3, 2, 1] : [0, 1, 2, 3];
  return Math.max(0, order.indexOf(k));
}

/** A walker that starts somewhere on the grid's sidewalks. */
function buildPed(W, rng) {
  const parts = buildWalker(rng);
  const ix = rng.int(0, GRID.length - 2);
  const iz = rng.int(0, GRID.length - 2);
  const clockwise = rng.chance(0.5);
  const ring = ringFor(ix, iz, clockwise);
  const at = rng.int(0, ring.length - 1);
  const start = ring[at];
  const ped = {
    mesh: parts.group,
    parts,
    pos: new THREE.Vector3(start.x, 0, start.z),
    block: { ix, iz },
    clockwise,
    wade: at,
    edge: { from: 0, to: 0 },
    target: ring[(at + 1) % ring.length],
    speed: WALK,
    base: WALK,
    hp: HP,
    state: 'walk',
    fleeT: 0,
    yaw: 0,
    walkT: rng.angle(),
    radius: 0.42,
    downT: 0,
    fare: false,
    riding: false,
    taxi: null,
    shadow: null,
  };
  parts.group.position.copy(ped.pos);
  if (W?.scene) W.scene.add(parts.group);
  return ped;
}

/** spawnPeds(W, city, rng, count): the pavement crowd. */
export function spawnPeds(W, city, rng, count = PEDS.count) {
  const peds = [];
  for (let i = 0; i < count; i += 1) peds.push(buildPed(W, rng));
  return peds;
}

/**
 * A fare: a walker planted on a kerb near (x, z) in the 'wait' state, waving.
 * It never wanders; economy.js boards it and drops it off again.
 */
export function makeFarePed(W, city, rng, x, z) {
  const ped = buildPed(W, rng);
  const stop = nearestKerb(W, x, z);
  ped.pos.set(stop.x, 0, stop.z);
  ped.mesh.position.set(stop.x, 0, stop.z);
  ped.state = 'wait';
  ped.fare = true;
  ped.speed = 0;
  ped.yaw = Math.atan2(-x + stop.x || 0.001, -z + stop.z || 0.001);
  ped.mesh.rotation.y = ped.yaw;
  return ped;
}

/** Closest sidewalk centre point to x, z on any of the five avenues. */
function nearestKerb(W, x, z) {
  let best = { x: clamp(x, -HALF, HALF), z: clamp(z, -HALF, HALF) };
  let gap = Infinity;
  const kerb = CONFIG.world.roadHalf + HOP;
  for (const line of GRID) {
    for (const side of [-1, 1]) {
      const along = line + side * kerb; // a pavement line on one axis
      if (along <= -HALF || along >= HALF) continue;
      const asZ = Math.abs(z - along); // this line is an east-west avenue kerb
      const asX = Math.abs(x - along); // …or a north-south one
      if (asZ < gap) { gap = asZ; best = { x: clamp(x, -HALF, HALF), z: along }; }
      if (asX < gap) { gap = asX; best = { x: along, z: clamp(z, -HALF, HALF) }; }
    }
  }
  return best;
}

// ------------------------------------------------------------------ shooting wounds

/** A bullet lands: hp down, panic up, and a dead walker goes flat. */
export function damagePed(ped, amount, G) {
  if (!ped || ped.state === 'down' || ped.riding) return false;
  ped.hp -= Math.max(0, amount || 0);
  if (ped.hp > 0) {
    panic(ped, G?.P?.pos?.x ?? 0, G?.P?.pos?.z ?? 0);
    return false;
  }
  knockDown(ped, G, true);
  return true;
}

// ------------------------------------------------------------------ behaviour

/** Set a walker running from a point for four seconds. */
function panic(ped, originX, originZ) {
  const dx = ped.pos.x - originX;
  const dz = ped.pos.z - originZ;
  const len = Math.hypot(dx, dz) || 1;
  ped.state = 'flee';
  ped.fleeT = FLEE_TIME;
  ped.fleeAway = { x: dx / len, z: dz / len };
  ped.speed = FLEE;
}

/** Flat on the sidewalk, timer ticking, then recycled somewhere else. */
function knockDown(ped, G, dead) {
  ped.state = 'down';
  ped.downT = RESPAWN;
  ped.speed = 0;
  ped.riding = false;
  ped.mesh.rotation.set(Math.PI / 2.4, ped.yaw, 0);
  ped.mesh.position.set(ped.pos.x, 0.18, ped.pos.z);
  G?.onPedHit?.(ped, dead);
  G?.sound?.crash?.();
}

/** Seek a direction at up to `speed`; animates the walker along the way. */
function walkTo(ped, target, speed, dt) {
  const dx = target.x - ped.pos.x;
  const dz = target.z - ped.pos.z;
  const gap = Math.hypot(dx, dz);
  if (gap < 0.9) return true; // close enough counts as arrived: no jitter on a waypoint
  const step = Math.min(gap, speed * dt);
  ped.pos.x += (dx / gap) * step;
  ped.pos.z += (dz / gap) * step;
  ped.pos.x = clamp(ped.pos.x, -HALF + 1, HALF - 1);
  ped.pos.z = clamp(ped.pos.z, -HALF + 1, HALF - 1);
  ped.yaw = Math.atan2(dx, dz);
  return gap - step < 0.05;
}

/** Run straight away from the scare for this step. */
function fleeAway(ped) {
  const want = { x: ped.pos.x + ped.fleeAway.x * 4, z: ped.pos.z + ped.fleeAway.z * 4 };
  walkTo(ped, want, FLEE, STEP_TIME);
  ped.yaw = Math.atan2(ped.fleeAway.x, ped.fleeAway.z);
}

/** The next leg of the ring: the corner after the one just reached. */
function advanceRing(ped) {
  const ring = ringFor(ped.block.ix, ped.block.iz, ped.clockwise);
  ped.target = ring[(ped.wade + 1) % ring.length];
  return ring;
}

/** Ease the limbs into a stride scaled by how fast the walker is going. */
function anim(ped, dt) {
  const { armL, armR, legL, legR, body } = ped.parts;
  const run = ped.state === 'flee';
  ped.walkT += dt * (run ? 13 : 6) * (ped.speed > 0.05 ? 1 : 0);
  const swing = run ? 0.9 : 0.5;
  const s = Math.sin(ped.walkT) * swing;
  legL.rotation.x = s;
  legR.rotation.x = -s;
  armL.rotation.x = -s;
  armR.rotation.x = ped.state === 'wait' ? -2.2 + Math.sin(ped.walkT * 1.4) * 0.25 : s;
  body.position.y = Math.abs(Math.cos(ped.walkT)) * (run ? 0.06 : 0.03);
  body.rotation.x = run ? 0.16 : 0;
}

/** One fixed step for every walker on the streets. */
export function updatePeds(list, W, G, dt) {
  if (!Array.isArray(list) || !list.length) return list;
  const me = G?.inCar || G?.P?.pos;
  const alarm = G?.alarm > 0 ? { x: G.alarmX ?? 0, z: G.alarmZ ?? 0 } : null;

  for (const ped of list) {
    if (!ped?.mesh) continue;

    if (ped.riding) {
      const cab = ped.taxi;
      if (cab) ped.pos.set(cab.x, 0, cab.z);
      continue;
    }

    if (ped.state === 'down') {
      ped.downT -= dt;
      if (ped.downT <= 0) revive(ped, G);
      continue;
    }

    // A gunshot close by, an alarm, or a car bearing down: all reasons to run.
    const car = fastestCarNear(ped, G);
    if (alarm && tick(ped.pos, alarm) < SCARE && ped.state !== 'flee') panic(ped, alarm.x, alarm.z);
    else if (car && car.speed > FAST && tick(ped.pos, car) < DANGER && ped.state !== 'flee') panic(ped, car.x, car.z);
    else if (car && !ped.fare && tick(ped.pos, car) < 2.4 && Math.abs(car.speed) > FAST) {
      knockDown(ped, G, false);
      continue;
    }

    if (ped.state === 'flee') {
      ped.fleeT -= dt;
      ped.speed = FLEE;
      fleeAway(ped);
      if (ped.fleeT <= 0) {
        // Back on the pavement: rejoin the ring the walker is standing beside.
        ped.state = 'walk';
        ped.speed = WALK;
        ped.clockwise = !ped.clockwise;
        ped.block = { ix: clamp(slot(nearestStreet(ped.pos.x)), 0, GRID.length - 2), iz: clamp(slot(nearestStreet(ped.pos.z)), 0, GRID.length - 2) };
        const spots = ringFor(ped.block.ix, ped.block.iz, ped.clockwise);
        const land = spots.reduce((best, s) => (tick(s, ped.pos) < tick(best, ped.pos) ? s : best), spots[0]);
        ped.wade = spots.indexOf(land);
        ped.pos.set(land.x, 0, land.z);
        advanceRing(ped);
      }
    } else if (ped.state === 'wait') {
      ped.speed = 0;
    } else {
      ped.speed = WALK;
      if (!ped.target) advanceRing(ped);
      if (walkTo(ped, ped.target, WALK, dt)) {
        if (ped.target.corner) {
          // Reached a corner: cross to the block opposite, touching down on its face.
          const over = crossTo(ped.block, ped.target);
          ped.block = over.block;
          const spots = ringFor(ped.block.ix, ped.block.iz, ped.clockwise);
          const land = spots[landSlot(ped.clockwise, over.face.cx, over.face.cz)];
          ped.pos.set(land.x + over.face.cx * STEP_OFF, 0, land.z + over.face.cz * STEP_OFF);
          ped.wade = spots.indexOf(land);
        } else ped.wade = (ped.wade + 1) % 4;
        advanceRing(ped);
      }
    }

    // Keep the crowd around the player; wanderers are moved to the nearest block.
    if (me && tick(ped.pos, me) > NEAR_LIMIT && !ped.fare) {
      const near = W.roads.at(me.x, me.z);
      ped.block = { ix: clamp(near.ix, 0, GRID.length - 2), iz: clamp(near.iz, 0, GRID.length - 2) };
      ped.clockwise = !ped.clockwise;
      const spots = ringFor(ped.block.ix, ped.block.iz, ped.clockwise);
      ped.wade = 0;
      ped.target = spots[0];
      ped.pos.set(spots[1].x, 0, spots[1].z);
    }

    ped.mesh.position.set(ped.pos.x, 0, ped.pos.z);
    ped.mesh.rotation.set(0, ped.yaw, 0);
    anim(ped, dt);
  }
  return list;
}

/** Nearest road coordinate to a value (the grid that surrounds it). */
function nearestStreet(v) {
  return GRID.reduce((best, g) => (Math.abs(v - g) < Math.abs(v - best) ? g : best), GRID[0]);
}

/** The quickest moving vehicle within spooking distance, or null. */
function fastestCarNear(ped, G) {
  let best = null;
  const look = (car) => {
    if (!car || car.wrecked) return;
    if (ped.taxi === car) return;
    const gap = tick(ped.pos, car);
    if (gap > DANGER + 4) return;
    if (!best || Math.abs(car.speed) > Math.abs(best.speed)) best = car;
  };
  for (const car of G?.traffic || []) look(car);
  for (const car of G?.cars || []) look(car);
  const mine = G?.inCar;
  if (mine) look(mine);
  return best;
}

/** Stand a downed walker back up on a different block after the timer runs out. */
function revive(ped, G) {
  const rng = G?.rng;
  const ix = rng ? rng.int(0, GRID.length - 2) : 1;
  const iz = rng ? rng.int(0, GRID.length - 2) : 1;
  const flip = rng ? rng.chance(0.5) : false;
  const spots = ringFor(ix, iz, flip);
  const at = rng ? rng.int(0, spots.length - 1) : 0;
  Object.assign(ped, {
    hp: HP, state: 'walk', speed: WALK, downT: 0, fleeT: 0, riding: false, taxi: null, fare: false,
    block: { ix, iz }, clockwise: flip, wade: at,
  });
  ped.pos.set(spots[at].x, 0, spots[at].z);
  ped.mesh.visible = true;
  ped.mesh.rotation.set(0, ped.yaw, 0);
  ped.mesh.position.copy(ped.pos);
  advanceRing(ped);
  anim(ped, 0);
}
