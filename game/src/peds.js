// Solara Bay — pedestrians. Small painted walkers who keep to the sidewalks,
// run when the bay gets loud, and get back on their feet twenty seconds later.
// One of them can be a fare: hailing a cab from the kerb, waving that arm.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';

const SIDEWALK_MID = CONFIG.world.roadHalf + CONFIG.world.sidewalk * 0.5; // 1.5 m off the asphalt
const PITCH = CONFIG.world.pitch;
const DOWN_SECONDS = 20;
const FLEE_SECONDS = 4;
const FLEE_TRIGGER = 6; // a car this close and this quick sends a walker running
const CAR_SPEED_TRIGGER = 8;
const HIT_SPEED = 6;
const CAR_SPEED_RUN_OVER = 6;
const NEAR_RANGE = 120; // recycle walkers further out than this
const REVIVE_MIN = 55;
const REVIVE_MAX = 95;
const WALK_CYCLE = 2.6; // radians of arm/leg swing per metre

/* --------------------------------------------------------------------- body */

// One low-poly walker, about 1.7 m tall: boxed torso, round head, swinging limbs.
function buildWalkerMesh(rng, shirtHex, pantsHex, capHex) {
  const root = new THREE.Group();
  const skinHex = rng.pick(C.skin);

  const limb = (w, h, hex, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2), material(hex));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    return mesh;
  };

  // Legs and arms hang from pivot groups so the swing reads as a swing.
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  for (const [pivot, side] of [[legL, -1], [legR, 1]]) {
    const shin = limb(0.19, 0.72, pantsHex, side * 0.11, -0.36, 0);
    pivot.add(shin);
    pivot.position.set(0, 0.78, 0);
    root.add(pivot);
  }

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.56, 0.26), material(shirtHex));
  torso.position.y = 1.06;
  torso.castShadow = true;
  root.add(torso);

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.24), material(pantsHex));
  hips.position.y = 0.78;
  hips.castShadow = true;
  root.add(hips);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.145, 8, 6), material(skinHex));
  head.position.y = 1.5;
  head.castShadow = true;
  root.add(head);

  if (capHex !== null) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.32), material(capHex));
    cap.position.y = 1.63;
    cap.castShadow = true;
    root.add(cap);
  }

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  for (const [pivot, side] of [[armL, -1], [armR, 1]]) {
    const sleeve = limb(0.14, 0.52, shirtHex, 0, -0.26, 0);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.13), material(skinHex));
    hand.position.y = -0.55;
    hand.castShadow = true;
    pivot.add(sleeve, hand);
    pivot.position.set(side * 0.29, 1.26, 0);
    root.add(pivot);
  }

  root.traverse((part) => {
    if (part.isMesh) part.receiveShadow = true;
  });
  return { root, legL, legR, armL, armR };
}

/* ------------------------------------------------------------------- utility */

/** The ring of sidewalk corners that frame one city block. */
function blockRing(bx, bz) {
  const corners = [];
  for (const x of faceLines(bx)) for (const z of faceLines(bz)) corners.push({ x, z });
  return corners;
}

/** Every block corner that actually sits inside the city, park block included. */
function collectCorners(W) {
  const corners = [];
  for (let bx = -160; bx < 160; bx += PITCH) {
    for (let bz = -160; bz < 160; bz += PITCH) {
      if (bx < -W.half + 20 || bz < -W.half + 20) continue;
      const ring = blockRing(bx, bz);
      for (const c of ring) corners.push({ x: c.x, z: c.z });
    }
  }
  return corners;
}

/** A corner other than the one just left, on the same block or across the street. */
function pickCornerNear(W, all, from, rng) {
  const reach = 90;
  for (let i = 0; i < 14; i++) {
    const c = rng.pick(all);
    if (!c) continue;
    const d = Math.hypot(c.x - from.x, c.z - from.z);
    if (d > 12 && d < reach) return c;
  }
  return rng.pick(all);
}

/** Facing that makes the walker look where it is going. */
function headingToward(a, b) {
  return Math.atan2(b.x - a.x, b.z - a.z);
}

function freshPed(W, all, rng, x, z, extra) {
  const shirtHex = rng.pick(C.shirt);
  const pantsHex = rng.pick(C.pants);
  const capHex = rng.chance(0.35) ? shirtHex : null;
  const rig = buildWalkerMesh(rng, shirtHex, pantsHex, capHex);
  const start = { x, z };
  const leg = legTo(start, pickCornerNear(W, all, start, rng), all);
  const ped = {
    mesh: rig.root,
    rig,
    pos: { x, z },
    leg,
    heading: headingToward(start, leg.to),
    speed: CONFIG.peds.speed * rng.range(0.85, 1.15),
    hp: CONFIG.peds.hp,
    state: 'walk',
    fleeT: 0,
    downT: 0,
    walkT: rng.range(0, 6),
    hitBy: null,
    fare: false,
    gone: false,
    rideFrom: null,
    destination: null,
    baseSpeed: CONFIG.peds.speed,
  };
  ped.baseSpeed = ped.speed;
  rig.root.position.set(x, 0, z);
  rig.root.rotation.y = ped.heading;
  W.scene.add(rig.root);
  return ped;
}

/* --------------------------------------------------------------------- spawn */

/** The crowd: fifteen walkers spread over sidewalk corners near downtown. */
export function spawnPeds(W, city, rng, count) {
  const total = count || CONFIG.peds.count;
  const corners = collectCorners(W);
  if (!corners.length) return [];
  const list = [];

  // Prefer the blocks around the middle so the player meets people straight away.
  const central = corners.filter((c) => Math.abs(c.x) <= 90 && Math.abs(c.z) <= 90);
  const pool = central.length > 6 ? central : corners;

  for (let i = 0; i < total; i++) {
    let spot = null;
    for (let t = 0; t < 16 && !spot; t++) {
      const c = pool[Math.floor(rng.next() * pool.length)];
      const crowded = list.some((p) => Math.hypot(p.pos.x - c.x, p.pos.z - c.z) < 7);
      if (!crowded) spot = c;
    }
    if (!spot) spot = pool[i % pool.length];
    list.push(freshPed(W, corners, rng, spot.x, spot.z));
  }
  return list;
}

/** A fare waiting at the kerb beside the cab, hailing it with one arm. */
export function makeFarePed(W, city, rng, nearX, nearZ) {
  const corners = collectCorners(W);
  let best = null;
  let bestD = Infinity;
  for (const c of corners) {
    const d = Math.hypot(c.x - nearX, c.z - nearZ);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  const at = best || { x: nearX + 2.5, z: nearZ + 2.5 };
  const ped = freshPed(W, corners, rng, at.x, at.z, null);
  ped.fare = true;
  ped.state = 'wait';
  ped.speed = 0;
  ped.leg = null;
  ped.heading = headingToward(at, { x: nearX, z: nearZ });
  ped.mesh.rotation.y = ped.heading;
  ped.destination = city && city.markers && city.markers.taxiStand ? city.markers.taxiStand : null;
  return ped;
}

/* ------------------------------------------------------------------ movement */

/** Two sidewalk lines frame every avenue: 1.5 m in from the kerb, 10.5 m out. */
function faceLines(avenue) {
  const near = avenue + SIDEWALK_MID;
  const far = avenue + PITCH - SIDEWALK_MID;
  return [near, far];
}

/** How far a point sits from the USABLE block a walker should be circling. */
function toNearestRing(x, z) {
  const ax = toNearestRingAxis(x, true).d;
  const az = toNearestRingAxis(z, false).d;
  return Math.hypot(ax, az);
}

/** Distance and coordinate of the sidewalk line nearest v (sidewalks frame the blocks). */
/** Distance and coordinate of the sidewalk line nearest v: 1.5 m off each kerb. */
function toNearestRingAxis(v, isX) {
  // Blocks are 68 m usable: their faces sit 34 m either side of every avenue.
  const centre = Math.round(v / PITCH) * PITCH;
  const lo = centre - (PITCH / 2 - SIDEWALK_MID);
  const hi = centre + (PITCH / 2 - SIDEWALK_MID);
  if (Math.abs(v - lo) <= Math.abs(v - hi)) return { v: lo, d: Math.abs(v - lo) };
  return { v: hi, d: Math.abs(v - hi) };
}

/** Snap a point onto the nearest ring line, keeping the other coordinate free. */
function snapToRing(x, z) {
  const rx = toNearestRingAxis(x, true);
  const rz = toNearestRingAxis(z, false);
  if (rx.d < rz.d) return { x: rx.v, z };
  return { x, z: rz.v };
}

/** Lace the path between two corners with sidewalk nodes so no leg cuts a block. */
function routeBetween(from, to, all) {
  const path = [from];
  let cursor = from;
  for (let guard = 0; guard < 10; guard++) {
    const dist = Math.hypot(to.x - cursor.x, to.z - cursor.z);
    if (dist < 6) break;
    const wantX = Math.abs(to.x - cursor.x) >= Math.abs(to.z - cursor.z);
    const hop = wantX
      ? { x: cursor.x + Math.sign(to.x - cursor.x) * Math.min(28, Math.abs(to.x - cursor.x)), z: cursor.z }
      : { x: cursor.x, z: cursor.z + Math.sign(to.z - cursor.z) * Math.min(28, Math.abs(to.z - cursor.z)) };
    let move = hop;
    if (toNearestRing(hop.x, hop.z) > 1) move = snapToRing(hop.x, hop.z);
    if (toNearestRing(move.x, move.z) > 1) {
      // Neither axis led anywhere legal: take the elbow that keeps both feet on a kerb.
      const elbow = pickElbow(cursor, to);
      if (!elbow) break;
      move = elbow;
    }
    if (Math.hypot(move.x - cursor.x, move.z - cursor.z) < 0.2) break;
    cursor = move;
    path.push(cursor);
  }
  path.push(to);
  return path;
}

/** Two-segment route: go out on the line we stand on, come in on the line we need. */
function pickElbow(from, to) {
  const ax = toNearestRingAxis(to.x, true).v;
  const bz = toNearestRingAxis(to.z, false).v;
  const candidates = [{ x: from.x, z: bz }, { x: ax, z: from.z }];
  let best = null;
  for (const c of candidates) {
    if (toNearestRing(c.x, c.z) > 1) continue;
    const cost = Math.hypot(c.x - from.x, c.z - from.z) + Math.hypot(to.x - c.x, to.z - c.z);
    if (!best || cost < best.cost) best = { ...c, cost };
  }
  return best;
}

/** Leg state for a walker heading to a corner: a list of waypoints walked in order. */
function legTo(from, to, all) {
  const path = routeBetween(from, to, all).map((p) => ({ x: p.x, z: p.z }));
  const first = path[1] || path[0] || to;
  return { from: { x: from.x, z: from.z }, to: first, t: 0, path: path.slice(1) };
}

/** Walk a leg's waypoint list, one hop at a time, so nobody steps through a block. */
function stepAlong(ped, dt, rateMul) {
  if (!ped.leg) return;
  ped.arrived = false;
  let budget = Math.max(0.05, ped.speed * rateMul) * dt;
  for (let guard = 0; guard < 4 && budget > 0; guard++) {
    const to = ped.leg.to;
    const dx = to.x - ped.pos.x;
    const dz = to.z - ped.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= budget) {
      ped.pos.x = to.x;
      ped.pos.z = to.z;
      budget -= dist;
      if (!ped.leg.path || !ped.leg.path.length) {
        ped.leg.t = 1;
        ped.arrived = true;
        return;
      }
      const next = ped.leg.path.shift();
      ped.leg.from = to;
      ped.leg.to = next;
      ped.leg.t = 0;
      continue;
    }
    ped.pos.x += (dx / dist) * budget;
    ped.pos.z += (dz / dist) * budget;
    ped.heading = Math.atan2(dx, dz);
    ped.walkT += budget * WALK_CYCLE;
    budget = 0;
  }
}

/** New leg from wherever the walker stands; corner hopping keeps them on sidewalks. */
function nextLeg(W, all, ped, rng) {
  const from = { x: ped.pos.x, z: ped.pos.z };
  ped.leg = legTo(from, pickCornerNear(W, all, from, rng), all);
  ped.arrived = false;
}

/** Swing the limbs: a walk cycle on 'walk', a hard panic on 'flee', a wave on 'wait'. */
function animateLimbs(ped, dt, extra) {
  const rig = ped.rig;
  if (!rig) return;
  if (ped.state === 'down') {
    rig.legL.rotation.x = 0;
    rig.legR.rotation.x = 0;
    rig.armL.rotation.z = 0.3;
    rig.armR.rotation.z = -0.3;
    return;
  }
  if (ped.state === 'wait') {
    // Hailing: one arm up and waving, the other hanging loose.
    rig.armR.rotation.x = 0;
    rig.armR.rotation.z = -2.4 + Math.sin((extra || 0) * 7) * 0.28;
    rig.armL.rotation.z = 0.05;
    rig.legL.rotation.x = 0;
    rig.legR.rotation.x = 0;
    return;
  }
  const swing = Math.sin(ped.walkT) * (ped.state === 'flee' ? 0.95 : 0.62);
  rig.legL.rotation.x = swing;
  rig.legR.rotation.x = -swing;
  rig.armL.rotation.x = -swing * 0.85;
  rig.armR.rotation.x = swing * 0.85;
  rig.armL.rotation.z = 0.04;
  rig.armR.rotation.z = -0.04;
}

/** Drop a walker flat and let everyone nearby decide to run. */
function layOut(ped) {
  ped.state = 'down';
  ped.downT = DOWN_SECONDS;
  ped.speed = 0;
  ped.mesh.rotation.x = -Math.PI / 2;
  ped.mesh.position.y = 0.2;
}

/** Public so player.js can knock a ped out with a bullet. */
export function knockDown(ped, G, cause) {
  if (!ped || ped.state === 'down' || ped.gone) return;
  ped.hitBy = cause || 'shot';
  ped.hp = 0;
  layOut(ped);
  if (G && G.onPedHit) G.onPedHit(ped, ped.hitBy);
  if (G && G.sound && G.sound.chime && cause === 'shot') G.sound.chime();
}

/* --------------------------------------------------------------------- tick */

/** Is a car close and fast enough to make this walker bolt? */
function dangerNear(ped, G) {
  const bodies = [];
  if (G && G.inCar) bodies.push(G.inCar);
  for (const c of (G && G.cars) || []) bodies.push(c);
  for (const c of (G && G.traffic) || []) bodies.push(c);
  for (const c of bodies) {
    if (!c || c.wrecked) continue;
    const d = Math.hypot(c.x - ped.pos.x, c.z - ped.pos.z);
    if (d < FLEE_TRIGGER && Math.abs(c.speed || 0) > CAR_SPEED_TRIGGER) return c;
  }
  return null;
}

/** A car running someone over at speed. */
function rammedBy(ped, G) {
  const bodies = [];
  if (G && G.inCar) bodies.push(G.inCar);
  for (const c of (G && G.cars) || []) bodies.push(c);
  for (const c of (G && G.traffic) || []) bodies.push(c);
  for (const c of bodies) {
    if (!c || c.wrecked) continue;
    const d = Math.hypot(c.x - ped.pos.x, c.z - ped.pos.z);
    if (d < CONFIG.car.radius + 0.5 && Math.abs(c.speed || 0) > HIT_SPEED) return c;
  }
  return null;
}

/** Run from the nearest threat; when there is none, pick a fresh corner to hide at. */
function fleeStep(ped, all, W, rng, threat, dt) {
  ped.speed = CONFIG.peds.flee;
  if (threat) {
    // Sprint straight away from whatever is about to hit them; nobody stops for kerbs.
    ped.leg = { from: { x: ped.pos.x, z: ped.pos.z }, to: { x: threat.x, z: threat.z }, flee: true, t: 0 };
  } else if (ped.leg && ped.leg.flee) {
    // Already running, no threat in sight: just burn down the flee timer in place.
    ped.walkT += ped.speed * dt * WALK_CYCLE * 1.4;
    return;
  } else if (!ped.leg) {
    nextLeg(W, all, ped, rng);
  }
  stepAlong(ped, dt, 1);
}

/** One tick of every walker. Expects a graph of sidewalk corners built from W. */
export function updatePeds(list, W, G, dt) {
  if (!list || !W) return;
  const rng = (G && G.rng) || plainRng;
  const corners = collectCorners(W);
  const player = G && G.P && G.P.pos;
  const alarm = G && G.alarm > 0 ? { x: G.alarmX, z: G.alarmZ } : null;
  const clock = (G && G.time) || 0;

  for (const ped of list) {
    if (!ped || ped.gone) continue;

    if (ped.state === 'ride') {
      // A passenger: invisible, carried by the cab, gone when the meter settles.
      ped.mesh.visible = false;
      continue;
    }

    if (ped.state === 'down') {
      ped.downT -= dt;
      animateLimbs(ped, dt, clock);
      if (ped.downT <= 0) {
        // Back on their feet, well away from wherever they fell.
        ped.mesh.rotation.x = 0;
        ped.mesh.position.y = 0;
        ped.state = 'walk';
        ped.hp = CONFIG.peds.hp;
        ped.hitBy = null;
        ped.speed = ped.baseSpeed;
        ped.leg = null;
        const d = REVIVE_MIN + rng.next() * (REVIVE_MAX - REVIVE_MIN);
        const a = rng.angle();
        const anchor = player || ped.pos;
        const far = pickCornerNear(W, corners, { x: anchor.x + Math.cos(a) * d, z: anchor.z + Math.sin(a) * d }, rng);
        ped.pos.x = far.x;
        ped.pos.z = far.z;
        ped.mesh.position.set(far.x, 0, far.z);
        continue;
      }
      ped.mesh.position.set(ped.pos.x, ped.mesh.position.y, ped.pos.z);
      continue;
    }

    if (ped.state === 'wait') {
      // Hailing a cab: stand still, wave, face the cab if the player is driving one.
      animateLimbs(ped, dt, clock + ped.pos.x * 0.1);
      if (G && G.inCar && G.inCar.kind === 'taxi') {
        ped.heading = headingToward(ped.pos, { x: G.inCar.x, z: G.inCar.z });
        ped.mesh.rotation.y = ped.heading;
      }
      if (!ped.fare) ped.state = 'walk'; // a stray waiting walker rejoins the flow
      continue;
    }

    const runner = dangerNear(ped, G);
    if (runner && ped.state !== 'flee') {
      ped.state = 'flee';
      ped.fleeT = FLEE_SECONDS;
    } else if (alarm && ped.state === 'walk' && Math.hypot(alarm.x - ped.pos.x, alarm.z - ped.pos.z) < 22) {
      ped.state = 'flee';
      ped.fleeT = FLEE_SECONDS;
    }

    if (ped.state === 'flee') {
      ped.fleeT -= dt;
      fleeStep(ped, corners, { alarmAt: alarm }, rng, runner, dt);
      if (ped.fleeT <= 0 && !runner) {
        ped.state = 'walk';
        ped.speed = ped.baseSpeed;
        ped.leg = null;
      }
    } else {
      ped.speed = ped.baseSpeed;
      if (!ped.leg || ped.arrived) {
        nextLeg(W, corners, ped, rng);
      }
      stepAlong(ped, dt, 1);
    }

    // A car through the crowd: down they go, and the bay remembers.
    const rammer = rammedBy(ped, G);
    if (rammer && !(G && G.inCar === rammer && Math.abs(rammer.speed) < CAR_SPEED_RUN_OVER)) {
      knockDown(ped, G, 'car');
      if (G && G.sound && G.sound.crash && rammer === (G && G.inCar)) G.sound.crash();
    }

    ped.mesh.position.set(ped.pos.x, 0, ped.pos.z);
    ped.mesh.rotation.y = ped.heading;
    animateLimbs(ped, dt, clock);

    // Loitering far away: hop the walker back toward the player's neighbourhood.
    if (player && Math.hypot(ped.pos.x - player.x, ped.pos.z - player.z) > NEAR_RANGE) {
      const d = REVIVE_MIN + rng.next() * (REVIVE_MAX - REVIVE_MIN);
      const a = rng.angle();
      const c = pickCornerNear(W, corners, { x: player.x + Math.cos(a) * d, z: player.z + Math.sin(a) * d }, rng);
      ped.pos.x = c.x;
      ped.pos.z = c.z;
      ped.leg = null;
      ped.mesh.position.set(c.x, 0, c.z);
    }
  }
}

/** A fare has been dropped off: the walker vanishes at the kerb. */
export function fareDropped(ped) {
  if (!ped) return;
  ped.gone = true;
  ped.state = 'walk';
  ped.mesh.visible = false;
  if (ped.mesh.parent) ped.mesh.parent.remove(ped.mesh);
}

// Used only if a caller forgets to hand over the seeded generator.
const plainRng = {
  next: () => Math.random(),
  range: (a, b) => a + (b - a) * Math.random(),
  int: (a, b) => Math.floor(a + (b - a + 1) * Math.random()),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  chance: (p) => Math.random() < p,
  angle: () => Math.random() * Math.PI * 2,
};
