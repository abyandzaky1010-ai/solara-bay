// Solara Bay — ambient traffic. Every car here is an NPC driver glued to the
// street graph: it picks a next intersection at each junction, keeps to the
// right lane and brakes for whatever stands in front of it.

import { CONFIG } from './config.js';
import { C } from './palette.js';
import { makeCar } from './car.js';

const EDGE = CONFIG.world.pitch;
const LANE = CONFIG.traffic.laneOffset;
const CRUISE = CONFIG.traffic.speed;
const PROBE = CONFIG.traffic.probeAhead;
const BRAKE = 12;
const CLEAR_HOLD = 1.2;
const RECYCLE_AT = 130;
const PAINTS = [C.sedan, 0x6f8fa6, 0xb9a37c, 0x9d6b6b, 0x5f7f6a, 0xa8b2bc];

/* ------------------------------------------------------------------ helpers */

/** A point at fraction t of link a→b, pushed right of travel by the lane. */
function lanePoint(W, a, b, t) {
  const na = W.roads.nodes[a];
  const nb = W.roads.nodes[b];
  const dx = nb.x - na.x;
  const dz = nb.z - na.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  // Right of travel in a y-up world is (uz, -ux).
  return { x: na.x + dx * t + uz * LANE, z: na.z + dz * t - ux * LANE, yaw: Math.atan2(-ux, -uz) };
}

/**
 * Next node from `at`, arriving from `origin`: straight 60%, turn 40%, and
 * never the node we came from unless the junction is a dead end.
 */
function chooseNext(W, origin, at, rng) {
  const n = W.roads.nodes[at];
  const back = lanePoint(W, origin, at, 0);
  const fx = -Math.sin(back.yaw);
  const fz = -Math.cos(back.yaw);
  const options = n.neighbors.filter((nb) => nb !== origin);
  if (!options.length) return n.neighbors[0] ?? at;

  let straight = options[0];
  let bestDot = -2;
  for (const nb of options) {
    const p = lanePoint(W, at, nb, 0);
    const dot = -Math.sin(p.yaw) * fx - Math.cos(p.yaw) * fz;
    if (dot > bestDot) { bestDot = dot; straight = nb; }
  }
  if (rng.chance(0.6)) return straight;
  const turns = options.filter((nb) => nb !== straight);
  return turns.length ? rng.pick(turns) : straight;
}

/* -------------------------------------------------------------------- spawn */

/** Seed `count` cars on the grid; exactly two of them are cabs. */
export function spawnTraffic(W, rng, count = CONFIG.traffic.count) {
  const cabs = [rng.int(0, count - 1), rng.int(0, count - 1)];
  const cars = [];
  for (let i = 0; i < count; i++) {
    const kind = cabs.includes(i) ? 'taxi' : 'sedan';
    const car = makeCar(kind, 0, 0, 0, kind === 'taxi' ? C.taxi : rng.pick(PAINTS));
    car.traffic = true;
    car.occupant = 'npc';
    car.slowT = 0;
    car.bumpCool = 0;
    placeOnRandomEdge(W, car, rng, null, null);
    W.scene.add(car.mesh);
    cars.push(car);
  }
  return cars;
}

/** Drop a car on a random edge, ideally inside the 40-60 m ring around anchor. */
function placeOnRandomEdge(W, car, rng, ax, az) {
  const nodes = W.roads.nodes;
  let pick = null;
  for (let tries = 0; tries < 24; tries++) {
    const from = rng.int(0, nodes.length - 1);
    const hub = nodes[from];
    if (!hub.neighbors.length) continue;
    const to = rng.pick(hub.neighbors);
    const t = rng.range(0.2, 0.8);
    const p = lanePoint(W, from, to, t);
    pick = { from, to, t, p };
    if (ax === null) break;
    const d = Math.hypot(p.x - ax, p.z - az);
    if (d >= 40 && d <= 60) break;
  }
  if (!pick) return car;
  car.leg = { from: pick.from, to: pick.to, t: pick.t };
  car.x = pick.p.x;
  car.z = pick.p.z;
  car.heading = pick.p.yaw;
  car.speed = CRUISE * 0.6;
  car.mesh.position.set(car.x, car.mesh.position.y, car.z);
  car.mesh.rotation.y = car.heading;
  return car;
}

/** Lift every car far from `pos` back into the ring around it. */
export function respawnTraffic(list, W, rng, pos) {
  for (const car of list) {
    placeOnRandomEdge(W, car, rng, pos.x, pos.z);
    car.hp = CONFIG.car.hp;
    car.wrecked = false;
    car.slowT = 0;
    car.mesh.visible = true;
  }
  return list;
}

/* ------------------------------------------------------------------- update */

/** Advance every ambient car: cruise, turn at junctions, brake for obstacles. */
export function updateTraffic(list, W, G, dt) {
  const rng = (G && G.rng) || null;
  const focus = playerPoint(G);
  for (const car of list) {
    if (!car || car.wrecked) continue;
    car.leg = car.leg || { from: 0, to: 0, t: 0 };
    car.bumpCool = Math.max(0, car.bumpCool - dt);

    if (focus && Math.hypot(car.x - focus.x, car.z - focus.z) > RECYCLE_AT) {
      placeOnRandomEdge(W, car, rng || localRng(car), focus.x, focus.z);
      continue;
    }

    if (blockedAhead(car, G, focus)) {
      car.slowT = CLEAR_HOLD;
      car.speed = Math.max(0, car.speed - BRAKE * dt);
    } else if (car.slowT > 0) {
      car.slowT -= dt;
      car.speed = Math.max(0, car.speed - BRAKE * dt);
    } else if (car.speed < CRUISE) {
      car.speed = Math.min(CRUISE, car.speed + 4 * dt);
    }

    driveAlongEdge(car, W, dt, rng);
    bumpPlayerCar(car, G);

    const wheels = car.mesh.userData.wheels || [];
    car.wheelSpin = (car.wheelSpin || 0) + car.speed * dt * 2.4;
    for (const w of wheels) w.mesh.rotation.x = car.wheelSpin;
  }
}

/** The player's ground position, on foot or driving. */
function playerPoint(G) {
  if (!G) return null;
  if (G.inCar) return { x: G.inCar.x, z: G.inCar.z };
  return G.P && G.P.pos ? { x: G.P.pos.x, z: G.P.pos.z } : null;
}

/** Cover the leg, hop to the next one on arrival, ease the heading round. */
function driveAlongEdge(car, W, dt, rng) {
  const leg = car.leg;
  leg.t += (car.speed / EDGE) * dt;
  while (leg.t >= 1) {
    leg.t -= 1;
    const prev = leg.from;
    leg.from = leg.to;
    leg.to = chooseNext(W, prev, leg.from, rng || localRng(car));
  }
  const p = lanePoint(W, leg.from, leg.to, leg.t);
  car.x = p.x;
  car.z = p.z;
  let diff = p.yaw - car.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  car.heading += diff * Math.min(1, 9 * dt);
  car.mesh.position.set(car.x, car.mesh.position.y, car.z);
  car.mesh.rotation.y = car.heading;
}

/** Does anything fill the 6 m box ahead of this bumper? */
function blockedAhead(car, G, focus) {
  const px = car.x - Math.sin(car.heading) * (PROBE + 2.2);
  const pz = car.z - Math.cos(car.heading) * (PROBE + 2.2);
  const near = (x, z, r) => Math.abs(x - px) < r && Math.abs(z - pz) < r;

  for (const o of (G && G.traffic) || []) {
    if (o !== car && o && !o.wrecked && near(o.x, o.z, 3.1) && inFront(car, o.x, o.z)) return true;
  }
  if (G && G.inCar && near(G.inCar.x, G.inCar.z, 3.4)) return true;
  for (const o of (G && G.cars) || []) {
    if (o && !o.wrecked && o !== G.inCar && near(o.x, o.z, 3.4)) return true;
  }
  if (focus && !G.inCar && Math.hypot(focus.x - px, focus.z - pz) < PROBE
    && inFront(car, focus.x, focus.z)) return true;
  for (const ped of (G && G.peds) || []) {
    if (ped && ped.state !== 'down' && ped.pos
      && Math.hypot(ped.pos.x - px, ped.pos.z - pz) < PROBE && inFront(car, ped.pos.x, ped.pos.z)) return true;
  }
  return false;
}

/** Forward half-plane test, so a car beside us is never "ahead". */
function inFront(car, x, z) {
  return (x - car.x) * -Math.sin(car.heading) + (z - car.z) * -Math.cos(car.heading) > 0.4;
}

/** Contact with the player's car: a little damage on both, then the horn. */
function bumpPlayerCar(car, G) {
  const target = G && G.inCar;
  if (!target || car.bumpCool > 0) return;
  if (Math.hypot(target.x - car.x, target.z - car.z) > target.radius + car.radius + 0.4) return;
  if (Math.abs(target.speed) + car.speed < 2) return;
  car.bumpCool = 1.5;
  target.hp -= 4;
  car.hp -= 3;
  car.speed *= 0.5;
  if (G.sound && G.sound.honk) G.sound.honk();
}

/** Small positional generator for calls made without a shared rng. */
function localRng(car) {
  let s = (((car.x * 73856093) ^ (car.z * 19349663)) >>> 0) || 1;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}
