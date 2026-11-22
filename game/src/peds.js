// Solara Bay — pedestrians: small bright walkers who circle the blocks on the pavement,
// run when the street gets loud, fall flat when a car or a bullet finds them,
// and ride quiet in the back of a cab when someone flags them down as a fare.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';

const PEDS = CONFIG.peds;
const WALK = CONFIG.world;
const PITCH = WALK.pitch;
const LIMIT = WALK.half;
const EDGE = WALK.sidewalk; // the pavement band sits right beside the asphalt
const RING = WALK.roadHalf + EDGE / 2; // 4.5 m out: the middle of the footpath
const CORNER_LIFT = 1.5; // the spec's extra metre-and-a-half at every block corner

// Numbers this module lives by.
const CAR_KILL_SPEED = 6; // m/s: faster than this and a walker goes down
const CAR_FLEE_SPEED = 8; // m/s: a car this fast within 6 m scatters the street
const CAR_PANIC = 6; // m
const HIT_RADIUS = 1.25; // m: car body vs walker
const FLEE_TIME = 4; // s of running before they settle
const FLEE_CLEARED = 9; // m from where the scare started counts as clear
const ALARM_RANGE = 22; // m: gunfire and sirens carry about this far
const DOWN_TIME = 20; // s on the ground before they get back up somewhere else
const RECYCLE_NEAR = 45; // m from the player when someone comes back
const STEP = 1 / 60;

// ------------------------------------------------------------------ the walker mesh

// One bright box body on two swinging legs; a shadow under it and a lift for the walk cycle.
function buildWalker(rng) {
  const group = new THREE.Group();
  const skin = material(rng.pick(C.skin));
  const shirt = material(rng.pick(C.shirt));
  const pants = material(rng.pick(C.pants));

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.28), shirt);
  torso.position.y = 1.06;
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.26), pants);
  hips.position.y = 0.68;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.28), skin);
  head.position.y = 1.5;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.3), material(rng.chance(0.5) ? C.beacon : pants.color.getHex()));
  cap.position.y = 1.68;

  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, 0.6, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.56, 0.18), pants);
    leg.position.y = -0.28;
    hip.add(leg);
    group.add(hip);
    return hip;
  });
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.3, 1.26, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.48, 0.15), skin);
    arm.position.y = -0.24;
    shoulder.add(arm);
    group.add(shoulder);
    return shoulder;
  });

  group.add(torso, hips, head, cap);
  group.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return { group, legs, arms, head };
}

// One 8-gon disc lying on the pavement, the cheap version of a contact shadow.
const SHADOW_GEO = new THREE.CircleGeometry(0.45, 8).rotateX(-Math.PI / 2);
function shadowDisc() {
  const disc = new THREE.Mesh(SHADOW_GEO, material(0x2b2f33, { flat: true }));
  disc.material.transparent = true;
  disc.material.opacity = 0.22;
  disc.position.y = 0.02;
  disc.renderOrder = 1;
  return disc;
}

// ------------------------------------------------------------------ the block ring

// Every unwalkable lot, so a corner can be tested instead of guessed.
function collectBlocks(city) {
  return ((city && city.buildings) || []).map((b) => ({
    minX: b.x - b.w / 2,
    maxX: b.x + b.w / 2,
    minZ: b.z - b.d / 2,
    maxZ: b.z + b.d / 2,
  }));
}

function insideAny(blocks, x, z) {
  return blocks.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
}

// The sidewalk ring of the block a point belongs to, as four square corners.
// Blocks are the 68 m lots between streets, so every ring is snapped onto the
// nearest block corner that also lies inside the city: never past ±200.
function blockRing(x, z) {
  const wrap = (v) => ((v % PITCH) + PITCH) % PITCH;
  const step = Math.floor(PITCH / 2); // 40 m: the block half-width
  const snap = (v) => Math.max(-LIMIT + 4, Math.min(LIMIT - 4, Math.round((v - step) / PITCH) * PITCH + step));
  const west = snap(x - wrap(x));
  const south = snap(z - wrap(z));
  const lift = RING + CORNER_LIFT;
  const corners = [
    { x: west + lift, z: south + lift },
    { x: west + PITCH - lift, z: south + lift },
    { x: west + PITCH - lift, z: south + PITCH - lift },
    { x: west + lift, z: south + PITCH - lift },
  ];
  return { corners, west, south, ring: lift };
}

// Which ring side (0..3) a point lies nearest, and how far along it.
function nearestSide(corners, x, z) {
  let best = { side: 0, t: 0, d: Infinity };
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % 4];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len));
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d < best.d) best = { side: i, t, d };
  });
  return best;
}

// A ring point, corners included: side index plus how far along that side (0..1).
function ringPoint(ring, side, t) {
  const a = ring.corners[side % 4];
  const b = ring.corners[(side + 1) % 4];
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

// Continue around the ring: carry straight on past the corner, or turn the block.
// A corner is the only place a walker may cross a street, so turns pivot there.
function nextLeg(ring, ped, rng) {
  const corner = ((ped.side + (ped.dir > 0 ? 1 : 0)) % 4 + 4) % 4;
  const turn = rng.chance(0.4) ? (rng.chance(0.5) ? 1 : -1) : 0;
  const side = ((corner + turn) % 4 + 4) % 4;
  const from = ringPoint(ring, side, ped.dir > 0 ? 0 : 1);
  const to = ringPoint(ring, side, ped.dir > 0 ? 1 : 0);
  ped.edge = { from, to, t: 0 };
  ped.length = Math.max(0.4, Math.hypot(to.x - from.x, to.z - from.z));
  ped.side = side;
}

// ------------------------------------------------------------------ pedestrians

function seedPed(rng, x, z, blocks) {
  const ring = blockRing(Math.max(-LIMIT + 12, Math.min(LIMIT - 12, x)), Math.max(-LIMIT + 12, Math.min(LIMIT - 12, z)));
  // Stand clear of any lot, even if the block maths lands short.
  let side = 0;
  let t = rng.next();
  let spot = ringPoint(ring, side, t);
  for (let tries = 0; tries < 4 && insideAny(blocks, spot.x, spot.z); tries += 1) {
    side = rng.int(0, 3);
    t = rng.next();
    spot = ringPoint(ring, side, t);
  }
  const body = buildWalker(rng);
  const ped = {
    mesh: body.group,
    body,
    pos: new THREE.Vector3(spot.x, 0, spot.z),
    yaw: rng.angle(),
    speed: 0,
    baseSpeed: PEDS.speed * rng.range(0.85, 1.15),
    hp: PEDS.hp,
    state: 'walk',
    fleeT: 0,
    fleeX: 0,
    fleeZ: 0,
    downT: 0,
    hitCooldown: 0,
    walkT: rng.angle(),
    ring,
    side,
    dir: rng.chance(0.5) ? 1 : -1,
    edge: { from: spot, to: spot, t: 0 },
    length: 1,
    fare: false,
    riding: false,
    taxi: null,
    shadow: shadowDisc(),
  };
  nextLeg(ring, ped, rng);
  // Start part-way along the leg (between the corners, never on the road).
  const spot2 = ringPoint(ring, ped.side, (ped.edge.t = rng.range(0.15, 0.85)));
  ped.pos.set(spot2.x, 0, spot2.z);
  ped.blocks = blocks;
  syncPed(ped);
  return ped;
}

// Mesh follows the record: honoured by every state.
function syncPed(ped) {
  ped.mesh.position.copy(ped.pos);
  ped.mesh.rotation.y = ped.yaw;
  ped.shadow.position.set(ped.pos.x, 0.02, ped.pos.z);
}

function addToScene(W, ped) {
  if (W && W.scene) {
    W.scene.add(ped.mesh);
    W.scene.add(ped.shadow);
  }
  return ped;
}

/** Fifteen colourful walkers, each already strolling a block ring. */
export function spawnPeds(W, city, rng, count = PEDS.count) {
  const blocks = collectBlocks(city);
  const list = [];
  for (let i = 0; i < count; i += 1) {
    // Spread them across the grid, with a hand on the seeded dice.
    const x = rng.range(-LIMIT + 20, LIMIT - 20);
    const z = rng.range(-LIMIT + 20, LIMIT - 20);
    list.push(addToScene(W, seedPed(rng, x, z, blocks)));
  }
  return list;
}

/**
 * A waiting fare: same walker, flagged `fare: true`, standing on the kerb nearest
 * (nearX, nearZ) and waving its arm until somebody stops a cab.
 */
export function makeFarePed(W, city, rng, nearX, nearZ) {
  const blocks = collectBlocks(city);
  const ped = addToScene(W, seedPed(rng, nearX ?? 0, nearZ ?? 0, blocks));
  // Snap onto the footpath corner closest to the call-out spot.
  const corner = ped.ring.corners.reduce((best, c) =>
    Math.hypot(c.x - nearX, c.z - nearZ) < Math.hypot(best.x - nearX, best.z - nearZ) ? c : best,
  );
  ped.pos.set(corner.x, 0, corner.z + 0.6);
  Object.assign(ped, { fare: true, state: 'wait', speed: 0, riding: false, taxi: null });
  syncPed(ped);
  return ped;
}

// ------------------------------------------------------------------ states

function fall(ped) {
  ped.state = 'down';
  ped.hp = 0;
  ped.speed = 0;
  ped.downT = DOWN_TIME;
  // Flat on the pavement: pitched over about its own feet, arms out.
  ped.mesh.rotation.x = -Math.PI / 2;
  ped.mesh.rotation.z = 0.12;
  ped.body.arms[0].rotation.z = 0.9;
  ped.body.arms[1].rotation.z = -0.9;
  ped.shadow.scale.setScalar(1.25);
}

function standUp(ped) {
  ped.hp = PEDS.hp;
  ped.state = 'walk';
  ped.downT = 0;
  ped.mesh.rotation.x = 0;
  ped.mesh.rotation.z = 0;
  ped.mesh.rotation.y = ped.yaw;
  ped.body.arms[0].rotation.z = 0;
  ped.body.arms[1].rotation.z = 0;
  ped.shadow.scale.setScalar(1);
  ped.hitCooldown = 1.5;
}

function startle(ped, ax, az, source) {
  if (ped.state === 'down' || ped.riding) return false;
  if (ped.state === 'flee' && ped.fleeT > FLEE_TIME - 0.6) return false; // already bolting
  ped.state = 'flee';
  ped.fleeT = FLEE_TIME;
  ped.fleeFromX = ped.pos.x;
  ped.fleeFromZ = ped.pos.z;
  const away = Math.hypot(ped.pos.x - ax, ped.pos.z - az) || 1;
  ped.fleeX = (ped.pos.x - ax) / away;
  ped.fleeZ = (ped.pos.z - az) / away;
  // Never run into a lot: turn the dodge along the kerb instead.
  if (insideAny(ped.blocks || [], ped.pos.x + ped.fleeX * 2, ped.pos.z + ped.fleeZ * 2)) {
    const [fx, fz] = [ped.fleeX, ped.fleeZ];
    ped.fleeX = Math.abs(fx) > Math.abs(fz) ? 0 : fz;
    ped.fleeZ = Math.abs(fx) > Math.abs(fz) ? fx : 0;
  }
  ped.source = source || null;
  return true;
}

// Walk the current leg; at its end, take the corner and pick the next side.
function walkLeg(ped, dt, rng) {
  const span = ped.edge.from;
  const end = ped.edge.to;
  const len = Math.hypot(end.x - span.x, end.z - span.z) || 1;
  ped.edge.t = Math.min(1, ped.edge.t + (ped.speed * dt) / len);
  ped.pos.x = span.x + (end.x - span.x) * ped.edge.t;
  ped.pos.z = span.z + (end.z - span.z) * ped.edge.t;
  ped.yaw = Math.atan2(end.x - span.x, end.z - span.z);
  if (ped.edge.t >= 1) nextLeg(ped.ring, ped, rng);
}

// Legs swing with distance; the wave is only for fares.
function animatePed(ped, dt) {
  ped.walkT += ped.speed > 0.05 ? dt * (3.4 + ped.speed * 1.5) : 0;
  const swing = Math.min(0.8, ped.speed * 0.16);
  const s = Math.sin(ped.walkT) * swing;
  ped.body.legs[0].rotation.x = s;
  ped.body.legs[1].rotation.x = -s;
  const wave = ped.fare && (ped.state === 'wait' || ped.state === 'flee') ? Math.sin(ped.walkT * 3 + 1) * 0.7 - 2.2 : 0;
  ped.body.arms[0].rotation.x = -s * 0.7;
  ped.body.arms[1].rotation.x = ped.fare ? wave : s * 0.7;
  ped.riding = ped.state === 'ride';
}

// A small hop for the walk cycle, only while walking normally.
function bobPed(ped) {
  const style = ped.state === 'walk' ? Math.abs(Math.sin(ped.walkT)) * 0.04 : 0;
  ped.mesh.position.y = style;
}

// ------------------------------------------------------------------ hazards

// Any car body close enough to flatten someone.
function carHits(ped, G) {
  const cars = (G.traffic || []).concat(G.cars || [], G.inCar ? [G.inCar] : []);
  for (const car of cars) {
    if (!car || car === ped.taxi || car.wrecked) continue;
    if (Math.abs(car.speed || 0) <= CAR_KILL_SPEED) continue;
    if (Math.hypot(car.x - ped.pos.x, car.z - ped.pos.z) <= HIT_RADIUS) return car;
  }
  return null;
}

// A speeding car within 6 m: everyone on that kerb starts running.
function carStartles(ped, G) {
  const cars = (G.traffic || []).concat(G.cars || [], G.inCar ? [G.inCar] : []);
  for (const car of cars) {
    if (!car || car === ped.taxi || car.wrecked) continue;
    if (Math.abs(car.speed || 0) <= CAR_FLEE_SPEED) continue;
    if (Math.hypot(car.x - ped.pos.x, car.z - ped.pos.z) <= CAR_PANIC) return car;
  }
  return null;
}

/** Bullet or blast damage from anywhere: 40 hp of walker, then they go down. */
export function damagePed(ped, amount, G) {
  if (!ped || ped.state === 'down') return false;
  ped.hp -= amount;
  if (ped.hp > 0) {
    // Still standing: they run, away from whoever pulled the trigger.
    const fromX = G?.inCar ? G.inCar.x : G?.P?.pos.x ?? ped.pos.x - 1;
    const fromZ = G?.inCar ? G.inCar.z : G?.P?.pos.z ?? ped.pos.z - 1;
    startle(ped, fromX, fromZ, 'shot');
    return false;
  }
  fall(ped);
  G?.onPedHit?.(ped, true);
  return true;
}

// ------------------------------------------------------------------ the frame

// Someone who has been gone a while comes back onto a ring well away from the player.
function recyclePed(ped, W, rng, me) {
  let ring = null;
  let side = 0;
  let at = null;
  for (let tries = 0; tries < 8; tries += 1) {
    const x = Math.max(-LIMIT + RECYCLE_SPAN, Math.min(LIMIT - RECYCLE_SPAN, me.x + rng.range(-RECYCLE_NEAR, RECYCLE_NEAR)));
    const z = Math.max(-LIMIT + RECYCLE_SPAN, Math.min(LIMIT - RECYCLE_SPAN, me.z + rng.range(-RECYCLE_NEAR, RECYCLE_NEAR)));
    ring = blockRing(x, z);
    side = rng.int(0, 3);
    at = ringPoint(ring, side, rng.range(0.2, 0.8));
    if (Math.hypot(at.x - me.x, at.z - me.z) > RECYCLE_NEAR * 0.4) break;
  }
  standUp(ped);
  Object.assign(ped, { ring, side, dir: rng.chance(0.5) ? 1 : -1, taxi: null, riding: false, fare: false, blocks: null });
  ped.pos.set(at.x, 0, at.z);
  nextLeg(ring, ped, rng);
  ped.edge.t = rng.next();
  ped.mesh.visible = true;
  ped.shadow.visible = true;
  syncPed(ped);
}

const RECYCLE_SPAN = 30;

/** One tick for the crowd: stroll, scatter, lie down, get back up, ride a fare home. */
export function updatePeds(list, W, G, dt) {
  if (!list || !list.length) return list;
  const rng = G.rng || localRng;
  const blocks = G.pedBlocks || (G.pedBlocks = collectBlocks(G.city));
  const me = G.inCar ? { x: G.inCar.x, z: G.inCar.z } : { x: G.P?.pos.x ?? 0, z: G.P?.pos.z ?? 0 };
  const alarmOn = (G.alarm || 0) > 0;
  const alarmAt = { x: G.alarmX ?? me.x, z: G.alarmZ ?? me.z };
  const step = Math.min(dt, 0.1);

  for (const ped of list) {
    if (!ped) continue;
    ped.blocks = blocks;

    if (ped.state === 'ride') {
      // Silent in the back of the cab until economy.js ends the fare and drops the flag.
      if (ped.fare) {
        if (ped.taxi) ped.pos.set(ped.taxi.x + 0.2, 0, ped.taxi.z);
        ped.mesh.visible = false;
        ped.shadow.visible = false;
      } else {
        recyclePed(ped, W, rng, me);
      }
      continue;
    }

    if (ped.state === 'down') {
      ped.downT -= step;
      if (ped.downT <= 0) recyclePed(ped, W, rng, me);
      continue;
    }

    if (ped.hitCooldown > 0) ped.hitCooldown -= step;

    // Hazards first: a car body flattens a walker, and the caller writes the wanted stars.
    if (carHits(ped, G)) {
      fall(ped);
      G.onPedHit?.(ped, false);
      continue;
    }

    if (ped.state === 'wait') {
      // Hailing a cab: one arm up and swinging, planted on the kerb.
      ped.speed = 0;
      ped.walkT += step * 2;
      ped.body.arms[1].rotation.x = Math.sin(ped.walkT * 3) * 0.55 - 2.1;
      ped.body.legs[0].rotation.x = 0;
      ped.body.legs[1].rotation.x = 0;
      bobPed(ped);
      syncPed(ped);
      continue;
    }

    // Panic spreads: nearby gunfire, or a speeding car within six metres.
    const scare = carStartles(ped, G);
    if (alarmOn && Math.hypot(ped.pos.x - alarmAt.x, ped.pos.z - alarmAt.z) < ALARM_RANGE) {
      startle(ped, alarmAt.x, alarmAt.z, 'alarm');
    } else if (scare) {
      startle(ped, scare.x, scare.z, 'car');
    }

    if (ped.state === 'flee') {
      ped.fleeT -= step;
      const safe = fleeRun(ped, step, W);
      if (safe || ped.fleeT <= 0) {
        // Out of breath: fall back into a stroll from the nearest kerb ring.
        ped.state = 'walk';
        ped.speed = ped.baseSpeed;
        if (W) snapBackToRing(ped, blocks);
      }
    } else {
      ped.speed = ped.baseSpeed;
      if (W) walkLeg(ped, step, rng);
    }

    animatePed(ped, step);
    bobPed(ped);
    syncPed(ped);
  }
  return list;
}

// Run in the flee direction off the pavement and into the street; a wall stops the sprint.
function fleeRun(ped, dt, W) {
  const speed = PEDS.flee;
  const dx = ped.fleeX * speed * dt;
  const dz = ped.fleeZ * speed * dt;
  const moved = W && W.colliders ? resolveMove(W, ped.pos.x, ped.pos.z, 0.4, dx, dz) : { x: ped.pos.x + dx, z: ped.pos.z + dz };
  const next = clampToCity(moved.x, moved.z);
  ped.pos.x = next.x;
  ped.pos.z = next.z;
  ped.yaw = Math.atan2(ped.fleeX, ped.fleeZ);
  ped.speed = speed;
  // Away and clear, or up against a wall: either way the sprint is over.
  const away = Math.hypot(ped.pos.x - ped.fleeFromX, ped.pos.z - ped.fleeFromZ);
  if (moved.hit) ped.fleeT = Math.min(ped.fleeT, 0);
  return away > FLEE_CLEARED;
}

function clampToCity(x, z) {
  return { x: Math.max(-LIMIT + 4, Math.min(LIMIT - 4, x)), z: Math.max(-LIMIT + 4, Math.min(LIMIT - 4, z)) };
}

// After a scare they rejoin the ring of the block they stopped in, never inside a lot.
function snapBackToRing(ped, blocks) {
  const ring = blockRing(ped.pos.x, ped.pos.z);
  const near = nearestSide(ring.corners, ped.pos.x, ped.pos.z);
  let side = near.side;
  let t = near.t;
  let point = ringPoint(ring, side, t);
  for (let tries = 0; tries < 4 && insideAny(blocks, point.x, point.z); tries += 1) {
    side = (side + 1) % 4;
    t = 0.5;
    point = ringPoint(ring, side, t);
  }
  Object.assign(ped, { ring, side, dir: t > 0.5 ? 1 : -1 });
  ped.pos.set(point.x, 0, point.z);
  nextLeg(ring, ped, localRng);
}

// A local rng keeps this module usable before the game object exists.
const localRng = (() => {
  let s = 0x0badf00d;
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  return { next, int: (a, b) => a + Math.floor(next() * (b - a + 1)), range: (a, b) => a + (b - a) * next(), pick: (a) => a[Math.floor(next() * a.length)], chance: (p) => next() < p, angle: () => next() * Math.PI * 2 };
})();

/** People inside a radius, for explosions and mission clean-up. */
export function pedsNear(list, x, z, radius) {
  return (list || []).filter((p) => p && p.state !== 'down' && Math.hypot(p.pos.x - x, p.pos.z - z) <= radius);
}

export { STEP as PED_STEP };
