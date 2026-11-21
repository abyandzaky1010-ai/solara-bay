// Ambient traffic: sedans and a pair of cabs looping the street grid on the
// right-hand lane. Each car is owned by one road edge and slides along it by a
// normalised parameter, so it can never leave the graph or cut a corner, and a
// stale one recycles in O(1).

import { CONFIG } from './config.js';
import { C } from './palette.js';
import { makeCar } from './car.js';

const TC = CONFIG.traffic;
const LANE = TC.laneOffset;
const HIT_SPEED = 3;
const BUMP_DAMAGE = 4;
const PAINTS = [C.sedan, 0xc7b9a2, 0x9cbfae, 0xb8a7c9, 0xd8c8b0];

function edgeLength(W, from, to) {
  const a = W.roads.nodes[from];
  const b = W.roads.nodes[to];
  return Math.hypot(b.x - a.x, b.z - a.z) || 1;
}

// Point on an edge at t, pushed into the right-hand lane; ends are inset past
// the junction mouth so nobody parks inside the cross street.
function sideOf(W, from, to, t) {
  const a = W.roads.nodes[from];
  const b = W.roads.nodes[to];
  const len = edgeLength(W, from, to);
  const inset = (CONFIG.world.roadHalf + 2) / len;
  const k = inset + (1 - 2 * inset) * t;
  const fx = (b.x - a.x) / len;
  const fz = (b.z - a.z) / len;
  return { x: a.x + (b.x - a.x) * k + fz * LANE, z: a.z + (b.z - a.z) * k - fx * LANE, heading: Math.atan2(fx, fz) };
}

// Straight 60%, turns 40%; a U-turn only at a dead end.
function pickNextNode(W, from, to, rng) {
  const node = W.roads.nodes[to];
  const back = W.roads.nodes[from];
  const options = node.neighbors.filter((n) => n !== from);
  if (!options.length) return from;
  const ax = back.x - node.x;
  const az = back.z - node.z;
  const backLen = Math.hypot(ax, az) || 1;
  const straight = [];
  const turns = [];
  for (const n of options) {
    const nb = W.roads.nodes[n];
    const dot = ((nb.x - node.x) * ax + (nb.z - node.z) * az) / (edgeLength(W, to, n) * backLen);
    (dot > 0.5 ? straight : turns).push(n);
  }
  const pool = !turns.length || (straight.length && rng.next() < 0.6) ? straight : turns;
  const pick = pool.length ? pool : options;
  return pick[rng.int(0, pick.length - 1)];
}

function placeOnEdge(car, W, rng, from, to, t) {
  const p = sideOf(W, from, to, t);
  Object.assign(car, { edge: { from, to, t }, x: p.x, z: p.z, heading: p.heading, waitClear: 0, steerVis: 0,
    speed: 0, cruise: TC.speed * rng.range(0.82, 1.12) });
  car.mesh.visible = true;
  car.mesh.position.set(p.x, 0, p.z);
  car.mesh.rotation.set(0, p.heading, 0);
}

// Random edge whose midpoint sits 40-84 m from a point (any edge if none fits).
function edgeNearPoint(W, rng, x, z, minDist, maxDist) {
  const edges = [];
  const nodes = W.roads.nodes;
  for (let i = 0; i < nodes.length; i += 1) {
    for (const n of nodes[i].neighbors) {
      if (n < i) continue;
      const d = Math.hypot((nodes[i].x + nodes[n].x) / 2 - x, (nodes[i].z + nodes[n].z) / 2 - z);
      if (d >= minDist && d <= maxDist) edges.push([i, n]);
    }
  }
  const pick = edges.length ? edges[rng.int(0, edges.length - 1)]
    : [rng.int(0, nodes.length - 1), nodes[0].neighbors[0]];
  return rng.chance(0.5) ? pick : [pick[1], pick[0]];
}

export function spawnTraffic(W, rng, count) {
  const list = [];
  const total = Math.max(1, (count | 0) || TC.count);
  for (let i = 0; i < total; i += 1) {
    const kind = i < 2 ? 'taxi' : 'sedan';
    const car = makeCar(kind, 0, 0, 0, kind === 'taxi' ? C.taxi : PAINTS[rng.int(0, PAINTS.length - 1)]);
    Object.assign(car, { occupant: 'npc', traffic: true, rng, honkT: 0 });
    car.mesh.castShadow = true;
    const [from, to] = edgeNearPoint(W, rng, 0, 0, 20, 260);
    placeOnEdge(car, W, rng, from, to, rng.range(0.15, 0.85));
    W.scene.add(car.mesh);
    list.push(car);
  }
  return list;
}

export function respawnTraffic(list, W, rng, pos) {
  const here = pos || { x: 0, z: 0 };
  for (const car of list) {
    if (Math.hypot(car.x - here.x, car.z - here.z) < TC.despawnDist) continue;
    const [from, to] = edgeNearPoint(W, rng, here.x, here.z, 40, 84);
    placeOnEdge(car, W, rng, from, to, rng.range(0.1, 0.9));
  }
}

function bodyPos(body) {
  if (!body) return null;
  return body.pos ? body.pos : (typeof body.x === 'number' ? body : null);
}

// Gap in metres to the nearest solid thing inside the 6 m probe strip ahead of
// the bumper; Infinity when the lane is clear.
function probeLane(car, G) {
  const look = TC.probeAhead;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  let gap = Infinity;
  const test = (p, radius) => {
    const dx = p.x - car.x;
    const dz = p.z - car.z;
    const ahead = dx * fx + dz * fz;
    if (ahead < -radius || ahead > look + radius) return;
    if (Math.abs(dx * fz - dz * fx) > car.radius + radius) return;
    gap = Math.min(gap, Math.max(0, ahead - radius));
  };
  for (const other of G.traffic || []) if (other !== car && !other.wrecked) test(other, other.radius || 1.4);
  for (const other of G.cars || []) if (!other.wrecked && other.mesh && other.mesh.visible) test(other, other.radius || 1.4);
  for (const ped of G.peds || []) {
    if (ped && ped.pos && ped.state !== 'down' && ped.state !== 'ride' && ped.state !== 'wait') {
      test({ x: ped.pos.x, z: ped.pos.z }, 0.6);
    }
  }
  const player = bodyPos(G.P);
  if (player && !G.inCar) test(player, CONFIG.player.radius || 0.55);
  return gap;
}

// Player car nudging a cab: both lose a little paint and the horn complains.
function handlePlayerBump(car, G) {
  const inCar = G.inCar;
  if (!inCar || inCar === car) return;
  const closing = Math.abs(inCar.speed) - Math.abs(car.speed);
  if (closing < HIT_SPEED || Math.hypot(inCar.x - car.x, inCar.z - car.z) > inCar.radius + car.radius + 0.5) return;
  inCar.hp = Math.max(0, inCar.hp - BUMP_DAMAGE);
  inCar.speed *= 0.7;
  car.hp = Math.max(1, car.hp - 2);
  car.speed = Math.max(car.speed, Math.abs(inCar.speed) * 0.4);
  if (G.sound && G.sound.honk) G.sound.honk();
}

export function updateTraffic(list, W, G, dt) {
  if (!list || !list.length || !W || !W.roads) return;
  const here = G || {};
  const player = bodyPos(here.inCar) || bodyPos(here.P) || { x: 0, z: 0 };

  for (const car of list) {
    if (!car.edge || car.wrecked) {
      car.mesh.visible = false;
      continue;
    }
    car.honkT = Math.max(0, (car.honkT || 0) - dt);

    // Brake hard when the bumper is crowded, wait out a clear spell, else
    // creep back up to cruise speed.
    const gap = probeLane(car, here);
    if (gap < TC.probeAhead) {
      car.speed = Math.max(0, Math.min(car.speed, (gap / TC.probeAhead) * 6));
      car.waitClear = TC.clearWait;
    } else if (car.waitClear > 0) {
      car.waitClear = Math.max(0, car.waitClear - dt);
      car.speed = 0;
    } else {
      car.speed = Math.min(car.cruise, car.speed + 9 * dt);
    }

    car.edge.t += (car.speed * dt) / edgeLength(W, car.edge.from, car.edge.to);
    if (car.edge.t >= 1) {
      // Carry the overshoot into the next edge so speed stays even.
      const carry = Math.min(0.4, car.edge.t - 1);
      const next = pickNextNode(W, car.edge.from, car.edge.to, car.rng || here.rng);
      car.edge = { from: car.edge.to, to: next, t: carry };
      car.speed *= 0.82;
    }

    const p = sideOf(W, car.edge.from, car.edge.to, car.edge.t);
    Object.assign(car, { x: p.x, z: p.z, heading: p.heading, steerVis: 0 });
    car.mesh.position.set(p.x, 0, p.z);
    car.mesh.rotation.set(0, p.heading, 0);
    const wheels = car.mesh.userData && car.mesh.userData.wheels;
    if (wheels) for (const w of wheels) w.rotation.x += car.speed * dt * 2.4;

    handlePlayerBump(car, here);

    // Nobody is watching a cab three streets away: recycle it near the player.
    if (Math.hypot(car.x - player.x, car.z - player.z) > TC.despawnDist) {
      respawnTraffic([car], W, car.rng || here.rng, player);
    }
  }
}
