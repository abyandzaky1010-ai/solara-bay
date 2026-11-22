// Solara Bay — ambient traffic: eleven cars that only ever know how to drive the grid.
// Each car owns one road edge {from, to, t}; junctions pick the next edge, the lane
// offset keeps them on the right-hand side, and nobody ever leaves the asphalt.

import { CONFIG } from './config.js';
import { C } from './palette.js';
import { makeCar } from './car.js';

const TRAFFIC = CONFIG.traffic;
const LANE = TRAFFIC.laneOffset;
const PITCH = CONFIG.world.pitch;
const LIMIT = CONFIG.world.half;

// Numbers this module lives by.
const RESPAWN_KEEP = 2.5; // s a recycled car waits out of sight before it drives again
const RESPAWN_NEAR = 40; // m from the player, at least
const RESPAWN_FAR = 60; // m from the player, at most
const RECYCLE_DIST = 130; // m; past this a car is pulled back near the player
const CLEAR_DELAY = 1.2; // s of open road before a stopped car rolls on
const BRAKE = 12; // m/s^2 for the obstacle stop
const BUMP_SPEED = 4; // m/s of closing speed that counts as a hit on the player's car
const BUMP_DAMAGE = 6; // hp off the player's car per ambient bump
const BUMP_SHOVE = 3.5; // m/s the bump pulls off the player's speed
const HIT_RANGE = 3.3; // half a lane: cars sharing these two tracks cannot pass each other
const CAR_BODY = 4.6; // m, bumper to bumper: how close behind a stopped car still counts
const TAXI_SHARE = 2 / 11; // exactly two cabs in the opening count of eleven

// ------------------------------------------------------------------ geometry helpers

// Heading that points a car's nose down the edge, given where the next node is.
function headingBetween(a, b) {
  return Math.atan2(b.x - a.x, b.z - a.z);
}

function edgeLength(a, b) {
  return Math.hypot(b.x - a.x, b.z - a.z) || 1;
}

// The right-hand lane centre for an edge travelling from a to b.
function laneCentre(a, b, t) {
  const len = edgeLength(a, b);
  const dx = (b.x - a.x) / len;
  const dz = (b.z - a.z) / len;
  // Right of travel is (dz, -dx) in this x/z plane; sit the car there, not mid-road.
  return { x: a.x + (b.x - a.x) * t + dz * LANE, z: a.z + (b.z - a.z) * t - dx * LANE };
}

// Grid index of a node from world coordinates.
function nodeIndex(W, x, z) {
  return W.roads.nodes.findIndex((n) => Math.abs(n.x - x) < 1 && Math.abs(n.z - z) < 1);
}

// Place a car's mesh record on its lane at the current t.
function placeOnLane(car) {
  const at = laneCentre(car.from, car.to, car.t);
  car.leg = clip(at);
  car.x = car.leg.x;
  car.z = car.leg.z;
  car.heading = headingBetween(car.leg, clip(car.to));
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
}

// Cars must never drive into the bay, so a lane point is pulled back onto dry land.
function clip(p) {
  return { x: Math.min(LIMIT, p.x), z: Math.min(LIMIT, Math.max(-LIMIT, p.z)) };
}

function addToScene(W, car) {
  if (W && W.scene && car.mesh.parent !== W.scene) W.scene.add(car.mesh);
  return car;
}

function distanceToPlayer(G) {
  const me = G.inCar || G.P;
  if (!me) return 0;
  const x = G.inCar ? me.x : me.pos.x;
  const z = G.inCar ? me.z : me.pos.z;
  return { x, z };
}

// ------------------------------------------------------------------ edge choice

// A neighbour of `node` that is not the one we came from; at a dead end, turn around.
function chooseNext(W, node, cameFrom, rng) {
  const options = node.neighbors.filter((j) => j !== cameFrom);
  if (!options.length) return node.neighbors[0] ?? -1;
  const back = inHeading(W, cameFrom, node);
  const straight = options.filter((j) => Math.abs(angleGap(back, inHeading(W, node, j))) < 0.35);
  const turn = options.filter((j) => !straight.includes(j));
  // Straight ahead most of the time, a turn the rest, both picked by the seeded rng.
  if (straight.length && (!turn.length || rng.next() < 0.6)) return rng.pick(straight);
  return rng.pick(turn.length ? turn : options);
}

function inHeading(W, fromIdx, toIdx) {
  const a = W.roads.nodes[fromIdx];
  const b = W.roads.nodes[toIdx];
  return a && b ? headingBetween(a, b) : 0;
}

function angleGap(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ------------------------------------------------------------------ spawning

function spawnOne(W, rng, index, total = TRAFFIC.count) {
  const nodes = W.roads.nodes;
  const links = W.roads.links;
  const [a, b] = links[Math.floor(rng.next() * links.length)];
  const flip = rng.chance(0.5);
  const from = nodes[flip ? b : a];
  const to = nodes[flip ? a : b];
  const kind = index < Math.round(total * TAXI_SHARE) ? 'taxi' : 'sedan';
  const paint = kind === 'taxi' ? C.taxi : rng.pick([C.sedan, 0x6c7f92, 0x9aa88f, 0xc4c9cf, 0x7f8ea0]);

  const car = makeCar(kind, from.x, from.z, 0, paint);
  Object.assign(car, {
    from: { x: from.x, z: from.z },
    to: { x: to.x, z: to.z },
    t: rng.range(0.08, 0.92),
    speedMax: TRAFFIC.speed,
    cruise: TRAFFIC.speed,
    edgeLen: edgeLength(from, to),
    fromIdx: nodeIndex(W, from.x, from.z),
    toIdx: nodeIndex(W, to.x, to.z),
    blocked: 0, // seconds of clear road banked while stopped
    held: false, // whatever is in front of me this frame
    recycleT: 0, // > 0 while parked off-map waiting to come back
    lane: null,
    leg: null,
  });
  // Ambient cars are staffed: taking one is a carjacking.
  car.occupant = 'npc';
  placeOnLane(car);
  return car;
}

/** Eleven cars on random edges, each in its right-hand lane, mesh already in the scene. */
export function spawnTraffic(W, rng, count = TRAFFIC.count) {
  const total = Math.max(0, count | 0);
  const list = [];
  for (let i = 0; i < total; i += 1) list.push(addToScene(W, spawnOne(W, rng, i, total)));
  return list;
}

// Far enough from the player to appear off-camera but close enough to notice.
function farEnough(respawn, me, x, z) {
  const gap = Math.hypot(x - me.x, z - me.z);
  return gap >= RESPAWN_NEAR && gap <= RESPAWN_FAR;
}

// A random edge whose lane centre sits 40-60 m from `pos`; fall back to the farthest node.
function pickFarEdge(W, rng, pos) {
  const nodes = W.roads.nodes;
  const links = W.roads.links;
  for (let tries = 0; tries < 24; tries += 1) {
    const [a, b] = links[Math.floor(rng.next() * links.length)];
    const flip = rng.chance(0.5);
    const from = nodes[flip ? b : a];
    const to = nodes[flip ? a : b];
    const t = rng.range(0.15, 0.85);
    const at = laneCentre(from, to, t);
    if (farEnough(false, pos, at.x, at.z)) return { from, to, t };
  }
  const sorted = [...nodes].sort((p, q) => Math.hypot(q.x - pos.x, q.z - pos.z) - Math.hypot(p.x - pos.x, p.z - pos.z));
  const from = sorted[0];
  return { from, to: nodes[from.neighbors[0]] || from, t: 0.5 };
}

/**
 * Put a car (or the whole list) straight onto a fresh edge 40-60 m from `pos`,
 * facing a direction the player is not looking at when that is possible.
 */
export function respawnTraffic(list, W, rng, pos) {
  const anchor = pos || { x: 0, z: 0 };
  const cars = Array.isArray(list) ? list : [list];
  for (const car of cars) {
    if (!car) continue;
    const edge = pickFarEdge(W, rng, anchor);
    Object.assign(car, { from: { x: edge.from.x, z: edge.from.z }, to: { x: edge.to.x, z: edge.to.z }, t: edge.t });
    car.edgeLen = edgeLength(car.from, car.to);
    car.fromIdx = nodeIndex(W, edge.from.x, edge.from.z);
    car.toIdx = nodeIndex(W, edge.to.x, edge.to.z);
    Object.assign(car, { speed: 0, blocked: CLEAR_DELAY, held: false, recycleT: 0 });
    placeOnLane(car);
    car.mesh.visible = true;
  }
  return cars;
}

// ------------------------------------------------------------------ the obstacle probe

// Anything solid on the road within `probe` metres of a car's nose, on its own side.
function obstacleAhead(car, W, G, probe) {
  const head = car.heading;
  const fx = Math.sin(head);
  const fz = Math.cos(head);
  const spot = car.leg || car;
  const candidates = (G.traffic || []).concat(G.cars || []);
  if (G.P && !G.inCar && G.P.pos) candidates.push({ pos: G.P.pos, player: true });

  for (const other of candidates) {
    if (!other || other === car || other === G.inCar || other.wrecked) continue;
    const at = other.pos || other;
    // A player record without coordinates can never stand in a lane.
    if (typeof at.x !== 'number' || typeof at.z !== 'number') continue;
    const ox = at.x - spot.x;
    const oz = at.z - spot.z;
    const ahead = ox * fx + oz * fz;
    // A walker only stops the lane when it is really in it, not on the far kerb.
    if (other.pos) {
      if (ahead > probe || ahead < -0.7 || Math.abs(ox * fz - oz * fx) > 0.6) continue;
      return other;
    }
    // Cars: same lane, close enough, and genuinely in front of me.
    const front = (other.x - car.x) * fx + (other.z - car.z) * fz;
    const sideways = Math.abs((other.x - car.x) * fz - (other.z - car.z) * fx);
    if (sideways < HIT_RANGE && front > 0.5 && front <= probe + CAR_BODY && laneOrder(car, other) === 1) return other;
  }
  return null;
}

// ------------------------------------------------------------------ a car that just drove on

// Hand the car to the next edge around the junction it reached.
function takeJunction(W, car, rng) {
  const node = W.roads.nodes[car.toIdx] ?? { neighbors: [], x: car.to.x, z: car.to.z };
  const cameFrom = car.fromIdx;
  const nextIdx = chooseNext(W, node, cameFrom, rng);
  const target = W.roads.nodes[nextIdx] || node;
  Object.assign(car, {
    from: { x: node.x, z: node.z },
    to: { x: target.x, z: target.z },
    fromIdx: car.toIdx,
    toIdx: nextIdx,
    viaIdx: cameFrom, // which arm it arrived by: traffic sorting out a junction compares this
    t: 0,
  });
  car.edgeLen = PITCH;
  placeOnLane(car);
}

// The lane two cars share only when they want the same square of asphalt next.
// At a junction that means the same exit, and the heading checks catch the rest:
// two cars on one road keep the same facing, a turning car does not.
function laneOrder(car, other) {
  const sameRoad = car.fromIdx === other.fromIdx && car.toIdx === other.toIdx;
  const sameExit = car.toIdx === other.toIdx;
  const aligned = Math.abs(Math.cos(other.heading - car.heading)) > 0.9;
  if (sameRoad || (sameExit && aligned)) return 1;
  const nearby = car.toIdx === other.fromIdx || other.toIdx === car.fromIdx;
  return nearby && aligned ? 2 : 0;
}

// ------------------------------------------------------------------ the player's car

// A player-driven car overlapping our nose while we still have momentum: a nudge, a honk.
function bumpPlayer(car, G, dt) {
  car.bumpCool = Math.max(0, (car.bumpCool || 0) - dt);
  const cab = G.inCar;
  if (!cab || cab === car) return;
  const gap = Math.hypot(cab.x - car.x, cab.z - car.z);
  if (gap > CONFIG.car.radius * 2 || Math.abs(cab.speed) < BUMP_SPEED || car.bumpCool > 0) return;
  car.hp = Math.max(0, car.hp - 2);
  cab.hp = Math.max(0, cab.hp - BUMP_DAMAGE);
  cab.speed *= 0.72;
  if (cab.speed > BUMP_SHOVE) cab.speed -= BUMP_SHOVE;
  // The nudge gives the cab a little push, so the two bodies part cleanly.
  const push = 1 / Math.max(0.5, gap);
  car.x += (car.x - cab.x) * push;
  car.z += (car.z - cab.z) * push;
  G.sound?.honk?.();
  G.effects?.spawnSmokePuff?.({ x: cab.x, y: 1, z: cab.z });
  car.bumpCool = 1.4;
}

// ------------------------------------------------------------------ the frame

/** One tick for every ambient car: drive the edge, stop for what is ahead, recycle when far. */
export function updateTraffic(list, W, G, dt) {
  if (!list || !W) return list;
  const me = distanceToPlayer(G);
  const step = Math.min(dt, 0.1);

  for (const car of list) {
    if (!car) continue;

    // A recycled car waits a moment out of sight, then slips back in near the player.
    if (car.recycleT > 0) {
      car.recycleT -= step;
      if (car.recycleT <= 0) {
        car.recycleT = 0;
        respawnTraffic([car], W, G.rng || fallbackRng, me);
      }
      continue;
    }

    // Too far anyway: back to the kerbs near the player.
    if (Math.hypot(car.x - me.x, car.z - me.z) > RECYCLE_DIST) {
      car.mesh.visible = false;
      car.recycleT = RESPAWN_KEEP;
      continue;
    }

    // The obstacle test runs before the move so a stopped car never creeps forward.
    car.held = !!blockedByPlayerCar(car, G) || !!obstacleAhead(car, W, G, TRAFFIC.probeAhead);
    if (car.held) {
      car.blocked = 0;
      car.speed = Math.max(0, car.speed - BRAKE * step);
    } else {
      car.blocked += step;
      if (car.blocked >= CLEAR_DELAY) car.speed = Math.min(car.speedMax, car.speed + 7 * step);
      else car.speed = 0;
    }

    // Advance along the edge at cruise speed.
    const travel = (car.speed * step) / (car.edgeLen || PITCH);
    car.t += travel;
    while (car.t >= 1) {
      car.t -= 1;
      takeJunction(W, car, G.rng || fallbackRng);
    }
    placeOnLane(car);
    car.mesh.visible = true;

    bumpPlayer(car, G, step);
  }
  return list;
}

// Keep a shared rng even if the game object arrives without one.
const fallbackRng = (() => {
  let s = 0x51e11;
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  return { next, pick: (a) => a[Math.floor(next() * a.length)], chance: (p) => next() < p, range: (a, b) => a + (b - a) * next() };
})();

// ------------------------------------------------------------------ the player's car

// The player's car is a road user like any other: it stops the lane when it is
// parked or creeping in it, and a real collision is handled by bumpPlayer below.
function blockedByPlayerCar(car, G) {
  const cab = G.inCar;
  if (!cab || Math.abs(cab.speed) > 1.5) return false;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const ahead = (cab.x - car.x) * fx + (cab.z - car.z) * fz;
  const side = Math.abs((cab.x - car.x) * fz - (cab.z - car.z) * fx);
  return ahead > 0.2 && ahead < TRAFFIC.probeAhead + 2 && side < 1.6;
}

/** A car cut by the police chase or a mission: drop it back on the grid. */
export function resetTraffic(list, W, rng, pos) {
  return respawnTraffic(list, W, rng, pos);
}
