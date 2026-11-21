// Traffic: ambient cars that keep to their own lane of the street grid, give way
// to whatever is ahead, and recycle themselves out of the player's sight.
import { CONFIG } from './config.js';
import { C } from './palette.js';
import { makeCar } from './car.js';

const T = CONFIG.traffic, SIDES = [-1, 1], STRAIGHT = 0.6, DECEL = 12, CLEAR = 1.2, CULL = 130, NEAR = 40, FAR = 60;
const BUMP_SPEED = 3, BUMP_DMG = 4, PAINT = [C.sedan, 0xd7d2c6, 0x6c7f92, 0xb9c3cc, 0xcf9f7a];

// Unit heading along a->b, its right-hand normal, and the edge length.
const axis = (a, b) => {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1, dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
  return { nx: -dz, nz: dx, len };
};

// Point `t` of the way from a to b, `side` lanes off the centre line.
const laneAt = (a, b, side, t) => {
  const s = axis(a, b), off = T.laneOffset * side;
  return { x: a.x + (b.x - a.x) * t + s.nx * off, z: a.z + (b.z - a.z) * t + s.nz * off };
};

// Put the car's x/z where its lane says it is; face it down the edge.
function seat(car) {
  const { from, to, t } = car.edge, p = laneAt(from, to, car.side, t);
  car.x = p.x;
  car.z = p.z;
  car.heading = Math.atan2(from.x - to.x, from.z - to.z);
  car.mesh.position.set(p.x, 0, p.z);
  car.mesh.rotation.y = car.heading;
}

// Board an edge and sit on it.
function board(car, nodes, fromI, toI, side, t) {
  car.edge = { from: nodes[fromI], to: nodes[toI], t };
  car.side = side;
  seat(car);
}

/** The neighbour one step from idx towards (dx,dz), or -1 at a dead end. */
export function nextNodeIn(nodes, idx, dx, dz) {
  const from = nodes[idx];
  if (!from) return -1;
  for (const n of from.neighbors) {
    const to = nodes[n];
    if (Math.sign(to.x - from.x) === Math.sign(dx) && Math.sign(to.z - from.z) === Math.sign(dz)) return n;
  }
  return -1;
}

// Junction: straight six times in ten, else a turn; reverse only at a dead end.
function nextExit(nodes, fromI, toI, rng) {
  const here = nodes[toI], came = nodes[fromI];
  const on = nextNodeIn(nodes, toI, here.x - came.x, here.z - came.z);
  const turns = here.neighbors.filter((n) => n !== fromI && n !== on);
  if (on >= 0 && (rng.chance(STRAIGHT) || !turns.length)) return on;
  return turns.length ? turns[rng.int(0, turns.length - 1)] : on >= 0 ? on : fromI;
}

/** Eleven street cars, two of them taxis, each on its own lane. */
export function spawnTraffic(W, rng, count) {
  const nodes = W.roads.nodes, links = W.roads.links, total = count || T.count, fleet = [];
  for (let i = 0, guard = 0; i < total && guard < 400; guard += 1) {
    const link = links[rng.int(0, links.length - 1)], taxi = i < Math.round(total * (2 / 11));
    const car = makeCar(taxi ? 'taxi' : 'sedan', 0, 0, 0, taxi ? C.taxi : PAINT[i % PAINT.length]);
    Object.assign(car, { traffic: true, occupant: 'npc', yield: 0, bumpT: 0, seat: i, speed: T.speed });
    board(car, nodes, link[0], link[1], SIDES[rng.int(0, 1)], 0.2 + (i / total) * 0.55);
    // Leave room so nobody starts nose to nose.
    if (fleet.some((o) => Math.hypot(o.x - car.x, o.z - car.z) < 10)) continue;
    W.scene.add(car.mesh);
    fleet.push(car);
    i += 1;
  }
  return fleet;
}

// Point `metres` ahead of a car.
const probeAt = (car, metres) => ({ x: car.x - Math.sin(car.heading) * metres, z: car.z - Math.cos(car.heading) * metres });

// A strict fleet order decides who gives way, so two cars can never wait on each other.
const blocks = (car, other) => typeof car.seat !== 'number' || typeof other.seat !== 'number' || car.seat > other.seat;

// The first body at the probe tip, if any.
function inTheWay(W, G, car) {
  const at = probeAt(car, T.probeAhead * 0.8);
  const hit = (o, r) => Math.hypot(o.x - at.x, o.z - at.z) < 1.2 + r && blocks(car, o);
  for (const o of G.traffic || []) if (o !== car && !o.taken && hit(o, 1.4)) return o;
  for (const o of G.cars || []) if (!o.wrecked && hit(o, 1.4)) return o;
  if (G.inCar && hit(G.inCar, 1.4)) return G.inCar;
  if (!G.inCar && G.P && !G.P.dead && hit(G.P.pos, 0.4)) return G.P;
  for (const p of G.peds || []) if (!p.riding && p.state !== 'down' && hit(p.pos, 0.4)) return p;
  for (const b of W.colliders) if (at.x > b.minX && at.x < b.maxX && at.z > b.minZ && at.z < b.maxZ) return b;
  return null;
}

// A driven car bumping a street car: a dent and a cabbie's horn.
function graze(car, G) {
  const hit = G.inCar;
  if (!hit || car.bumpT > 0 || Math.hypot(hit.x - car.x, hit.z - car.z) > 4.2 || Math.abs(hit.speed) < BUMP_SPEED) return;
  car.bumpT = 2.5;
  car.hp = Math.max(0, car.hp - BUMP_DMG);
  G.damageTrafficCar?.(car, BUMP_DMG);
  G.sound?.honk?.();
}

// One car, one fixed step: give way, roll, turn at the junction, follow the lane.
function drive(car, W, G, dt) {
  const nodes = W.roads.nodes;
  car.yield = car.wrecked || inTheWay(W, G, car) ? CLEAR : Math.max(0, car.yield - dt);
  car.speed += Math.max(-DECEL * 1.5 * dt, Math.min(DECEL * dt, (car.yield > 0 ? 0 : T.speed) - car.speed));
  car.bumpT = Math.max(0, car.bumpT - dt);

  car.edge.t += (car.speed * dt) / axis(car.edge.from, car.edge.to).len;
  if (car.edge.t >= 1) {
    // Past the junction: turn, and carry the momentum over on the new edge.
    const over = Math.min(0.9, car.edge.t - 1), fromI = nodes.indexOf(car.edge.from), toI = nodes.indexOf(car.edge.to);
    board(car, nodes, toI, nextExit(nodes, fromI, toI, G.rng || STILL), car.side, over);
  } else {
    seat(car);
  }
  for (const w of car.mesh.userData.wheels || []) w.rotation.x -= (car.speed * dt) / 0.34;
  graze(car, G);
}

const STILL = { chance: () => false, int: () => 0 };

// A car the player has taken over leaves the fleet; its slot re-seeds out of sight.
function handOver(cars, W, G, at) {
  for (const car of cars) {
    if (!car.taken && !car.player) continue;
    car.mesh.visible = false;
    respawnTraffic(cars, W, G.rng, at, car);
  }
}

/** Roll the fleet one step and recycle whatever the player has left behind. */
export function updateTraffic(list, W, G, dt) {
  if (!list || !list.length) return;
  // Distance is measured from the driven car, or from the player on foot.
  const where = G.inCar || G.P?.pos || { x: 0, z: 0 };
  const at = { x: where.x ?? where.pos.x, z: where.z ?? where.pos.z };
  handOver(list, W, G, at);
  for (const car of list) {
    if (car.taken || car.player) continue;
    drive(car, W, G, dt);
    if (Math.hypot(car.x - at.x, car.z - at.z) > CULL) respawnTraffic(list, W, G.rng, at, car);
  }
}

// Node closest to a point 50 m out along `spin`, if the 40-60 m ring is empty.
function ringNode(nodes, at, spin) {
  const x = at.x + Math.cos(spin) * 50, z = at.z + Math.sin(spin) * 50;
  let best = 0, bestD = Infinity;
  nodes.forEach((n, i) => {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

// A spot past the junction mouth that no other car already sits on.
function freeLane(nodes, fromI, toI, side, fleet) {
  const taken = (p) => fleet.some((o) => Math.hypot(o.x - p.x, o.z - p.z) < 9);
  return [0.35, 0.5, 0.2, 0.65, 0.8].find((t) => !taken(laneAt(nodes[fromI], nodes[toI], side, t))) ?? 0.45;
}

/** Move one car, or all of them, onto a road 40-60 m out. */
export function respawnTraffic(list, W, rng, pos, only) {
  const nodes = W.roads.nodes, at = pos || { x: 0, z: 0 }, spin = rng.angle ? rng.angle() : rng.range(0, 6.283);
  // Junctions in the band, the one facing least towards the player first.
  const ring = nodes.map((n, i) => ({ i, d: Math.hypot(n.x - at.x, n.z - at.z), turn: Math.abs(Math.atan2(n.z - at.z, n.x - at.x) - spin) }))
    .filter((n) => n.d >= NEAR && n.d <= FAR).sort((a, b) => a.turn - b.turn);
  for (const car of only ? [only] : list || []) {
    if (!car) continue;
    const fromI = ring.length ? ring[rng.int(0, Math.min(4, ring.length - 1))].i : ringNode(nodes, at, spin);
    const toI = nodes[fromI].neighbors[rng.int(0, nodes[fromI].neighbors.length - 1)];
    const side = SIDES[rng.int(0, 1)];
    board(car, nodes, fromI, toI, side, freeLane(nodes, fromI, toI, side, list || []));
    Object.assign(car, { speed: T.speed, yield: 0, bumpT: 0, hp: CONFIG.car.hp, wrecked: false, taken: false, player: false });
  }
}
