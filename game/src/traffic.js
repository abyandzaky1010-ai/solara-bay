// Solara Bay — ambient traffic. Cabs and sedans crawl the avenue grid in the
// right-hand lane, keep their distance from whatever is in front of them, turn at
// junctions without ever doubling back, and slide off to a far block once they are
// out of the player's world. Every car owns an edge cursor {from, to, t}; the mesh
// is placed from that cursor and nothing else.

import { CONFIG } from './config.js';
import { makeCar, addCarToScene } from './car.js';

const TRAFFIC = CONFIG.traffic;
const LANE = TRAFFIC.laneOffset; // 3.2 m right of the centre line
const CRUISE = TRAFFIC.speed; // 9 m/s
const PROBE = TRAFFIC.probeAhead; // 6 m of road looked at
const SLOW = 12; // m/s² the brakes bite with
const RESUME = TRAFFIC.resumeAfter; // 1.2 s of clear road before rolling on
const TURN = TRAFFIC.turnChance; // 40% of junction exits are turns
const KEEP_NEAR = TRAFFIC.recycleNear; // 90 m: closer than this and it stays
const KEEP_FAR = TRAFFIC.recycleFar; // 130 m: further than this and it leaves
const ARRIVE = 0.98; // fraction of an edge counted as reached
const HONK_COOL = 2.5; // s between two horns from the same car
const SEDANS = [0x8ea3b8, 0xb9c4cc, 0x6c7f92, 0xd7c5a6, 0x7e9a86]; // sober city paint, no two alike

const tick = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * A random edge anywhere on the grid, optionally preferring ones whose midpoint is
 * far from `away` so recycled cars reappear out of sight.
 */
function randomEdge(W, rng, away) {
  const nodes = W.roads.nodes;
  const pairs = W.roads.links.length ? W.roads.links : [];
  const far = [];
  const all = [];
  for (const [a, b] of pairs) {
    const na = nodes[a];
    const nb = nodes[b];
    const mid = { x: (na.x + nb.x) / 2, z: (na.z + nb.z) / 2 };
    all.push([a, b]);
    if (!away || tick(mid, away) > KEEP_NEAR) far.push([a, b]);
  }
  if (!all.length) return null;
  const pool = far.length ? far : all;
  const [from, to] = rng.pick(pool);
  return { from, to, t: rng.next() };
}

/** Lane point at fraction `t` of the edge, right-hand side of the direction of travel. */
function lanePoint(W, edge, t) {
  const a = W.roads.nodes[edge.from];
  const b = W.roads.nodes[edge.to];
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  return {
    x: a.x + (b.x - a.x) * t + uz * LANE, // right of travel is (uz, -ux)
    z: a.z + (b.z - a.z) * t - ux * LANE,
    heading: Math.atan2(ux, uz),
    len,
    ux,
    uz,
  };
}

/** Face and place one car from its edge cursor. */
function pose(W, car) {
  const p = lanePoint(W, car.edge, car.edge.t);
  car.x = p.x;
  car.z = p.z;
  car.heading = p.heading;
  car.edgeLen = p.len;
  car.ux = p.ux;
  car.uz = p.uz;
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.set(0, car.heading, 0);
  return car;
}

/** A fresh ambient car on a random edge; taxi if the roll says so. */
function newAmbientCar(W, rng, away) {
  const edge = randomEdge(W, rng, away) || { from: 0, to: 1, t: 0.5 };
  const kind = rng.chance(0.3) ? 'taxi' : 'sedan';
  const paint = kind === 'taxi' ? undefined : rng.pick(SEDANS);
  const car = makeCar(kind, 0, 0, 0, paint);
  car.traffic = true;
  car.occupant = 'npc';
  car.edge = edge;
  car.speed = CRUISE;
  car.hold = 0;
  car.honkT = 0;
  addCarToScene(W, car);
  return pose(W, car);
}

/** Fixed traffic count: the grid fills up once at boot. */
export function spawnTraffic(W, rng, count = TRAFFIC.count) {
  const cars = [];
  for (let i = 0; i < count; i += 1) cars.push(newAmbientCar(W, rng, { x: 0, z: 0 }));
  return cars;
}

/**
 * RespawnTraffic: scatter cars to random far edges when they have wandered off the
 * player's block, or when a fresh wave is wanted from a given point.
 */
export function respawnTraffic(list, W, rng, pos) {
  const here = pos || { x: 0, z: 0 };
  for (const car of list) {
    if (!car || !rng) continue;
    const edge = randomEdge(W, rng, here);
    if (!edge) continue;
    Object.assign(car, { edge, speed: CRUISE, hold: 0 });
    pose(W, car);
  }
  return list;
}

/** Is there anything solid inside the probe box in front of `car`? */
function obstacleAhead(car, W, G) {
  const noseX = car.x + car.ux * (car.radius + 0.6);
  const noseZ = car.z + car.uz * (car.radius + 0.6);
  const reach = PROBE + car.radius;
  const solid = (x, z, r) => {
    const dx = x - noseX;
    const dz = z - noseZ;
    const along = dx * car.ux + dz * car.uz;
    const side = Math.abs(dx * car.uz - dz * car.ux);
    return along > -r && along < reach && side < 1.5;
  };

  const player = G?.P;
  if (player && !player.dead && !G.inCar && solid(player.pos.x, player.pos.z, 0.5)) return 'player';
  for (const other of G?.traffic || []) {
    if (other && other !== car && !other.wrecked && solid(other.x, other.z, other.radius || 1.4)) return 'traffic';
  }
  for (const parked of G?.cars || []) {
    if (parked && parked !== car && !parked.wrecked && solid(parked.x, parked.z, parked.radius || 1.4)) return 'traffic';
  }
  for (const row of G?.PO?.cars || []) {
    const cop = row.car || row;
    if (cop && !cop.wrecked && solid(cop.x, cop.z, cop.radius || 1.4)) return 'traffic';
  }
  return null;
}

/**
 * The next node after `cur` when `prev → cur` is spent: straight first (60% of the
 * time it can), a left or right else, never back the way it came.
 */
function nextNode(W, prev, cur, rng) {
  const node = W.roads.nodes[cur];
  const came = prev >= 0 ? W.roads.nodes[prev] : null;
  const options = node.neighbors.filter((n) => n !== prev);
  if (!options.length) return prev >= 0 ? prev : node.neighbors[0];
  if (came) {
    const straight = options.find((n) => Math.sign(W.roads.nodes[n].x - node.x) === Math.sign(node.x - came.x)
      && Math.sign(W.roads.nodes[n].z - node.z) === Math.sign(node.z - came.z));
    if (straight !== undefined && rng.next() > TURN) return straight;
  }
  return rng.pick(options);
}

/** A touch on the player's car: nudged, dented, and the horn goes off. */
function bumpPlayer(car, G) {
  const mine = G.inCar;
  if (!mine || mine.wrecked) return;
  if (car.speed < 3) return;
  mine.speed *= 0.85;
  mine.hp = Math.max(1, mine.hp - 2);
  G.effects?.spawnSmokePuff?.({ x: mine.x, y: 0.8, z: mine.z });
  if ((car.honkT || 0) <= 0) {
    car.honkT = HONK_COOL;
    G.sound?.honk?.();
  }
}

/** One fixed step for the whole convoy. */
export function updateTraffic(list, W, G, dt) {
  if (!Array.isArray(list) || !list.length) return list;
  const rng = G?.rng;
  const me = G?.inCar || G?.P?.pos;
  for (const car of list) {
    if (!car || !car.edge) continue;
    car.honkT = Math.max(0, (car.honkT || 0) - dt);

    // Distance keeping: brake hard for the block ahead, wait, then ease away.
    const blocked = obstacleAhead(car, W, G);
    if (blocked || car.hold > 0) {
      car.hold = blocked ? RESUME : Math.max(0, car.hold - dt);
      car.speed = Math.max(0, car.speed - SLOW * dt);
    } else car.speed = Math.min(CRUISE, car.speed + CRUISE * 0.6 * dt);

    // Bumper to bumper with the player's ride: a dent, a shove, a horn.
    if (G?.inCar && tick(car, G.inCar) < car.radius + G.inCar.radius + 0.2) bumpPlayer(car, G);

    // Advance the cursor; at the far end pick the exit out of the junction.
    if (car.edgeLen > 0) car.edge.t += (car.speed * dt) / car.edgeLen;
    if (car.edge.t >= ARRIVE) {
      const arrived = car.edge.to;
      const over = Math.max(0, car.edge.t - ARRIVE);
      const exit = rng ? nextNode(W, car.edge.from, arrived, rng) : W.roads.nodes[arrived].neighbors[0];
      car.edge = { from: arrived, to: exit, t: Math.min(0.4, over) };
    }
    pose(W, car);

    // Off the player's block for good: recycle onto a distant edge.
    if (me && rng && tick(car, me) > KEEP_FAR) {
      const edge = randomEdge(W, rng, me);
      if (edge) {
        car.edge = edge;
        Object.assign(car, { speed: CRUISE, hold: 0 });
        pose(W, car);
      }
    }
  }
  return list;
}

/** One idling car placed on the avenue nearest a point — the screenshot shooter. */
export function parkTraffic(W, x, z, kind = 'sedan', color) {
  const node = W.roads.at(x, z);
  const straight = W.roads.nodes[node.neighbors[0]] || node;
  const car = makeCar(kind, 0, 0, 0, color);
  car.traffic = true;
  car.occupant = 'npc';
  car.edge = { from: W.roads.nodes.indexOf(node), to: W.roads.nodes.indexOf(straight), t: 0.5 };
  car.speed = 0;
  car.hold = 0;
  car.honkT = 0;
  addCarToScene(W, car);
  return pose(W, car);
}
