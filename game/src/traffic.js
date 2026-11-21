// Ambient traffic: eleven civilian cars that live on the street graph, always in the
// right-hand lane, braking for whatever crosses their six-metre probe. The cars come
// from car.js (makeCar); this module only owns their route, their nerve and their lane.
import { CONFIG } from './config.js';
import { C } from './palette.js';
import { makeCar, syncCarMesh } from './car.js';

const LANE = CONFIG.traffic.laneOffset;   // 3.2 m right of the travel direction
const CRUISE = CONFIG.traffic.speed;      // 9 m/s target speed
const PROBE = CONFIG.traffic.probeAhead;  // 6 m of clear road required
const BRAKE = 12;                         // deceleration while an obstacle is ahead
const ACCEL = 5;                          // how quickly they get back up to cruise
const CLEAR_WAIT = 1.2;                   // seconds held after the probe goes clear
const RECYCLE_AT = 130;                   // too far from the player to matter
const RECYCLE_MIN = 40;
const RECYCLE_MAX = 60;
const TAXI_SHARE = 2 / 11;                // 2 of the 11 are yellow cabs
const KEEP_RIGHT = 0.6;                   // straight-on 60%, turn 40%
const BODY = 2.0;                         // generous half-length used by the probe
const BUMP_SPEED = 3;                     // closing speed that counts as a knock
const BUMP_DAMAGE = 2;
const HONK_GAP = 4;                       // seconds between honks from one car

/** Road-space heading: car meshes point down -z, so east is -PI/2. */
function faceHeading(dx, dz) {
  return Math.atan2(-dx, -dz);
}

/** Node metadata for "neighbour in this grid direction", or null at the map edge. */
function neighbourAt(nodes, node, sx, sz) {
  const nx = node.ix + sx;
  const nz = node.iz + sz;
  if (nx < 0 || nz < 0 || nx > 4 || nz > 4) return null;
  return nodes[nz * 5 + nx] || null;
}

/** Test whether two grid nodes are one lane apart (adjacent, not the same corner). */
function linked(nodes, a, b) {
  if (!a || !b || a.id === b.id) return false;
  return Math.abs(a.ix - b.ix) + Math.abs(a.iz - b.iz) === 1;
}

/** Where the nose sits for a car part-way along an edge: centre line plus lane offset. */
export function lanePoint(roads, from, to, t) {
  const a = roads.nodes[from];
  const b = roads.nodes[to];
  const dx = Math.sign(b.x - a.x);
  const dz = Math.sign(b.z - a.z);
  // Right of travel: rotate the direction by +90 degrees.
  const rx = -dz;
  const rz = dx;
  return {
    x: a.x + (b.x - a.x) * t + rx * LANE,
    z: a.z + (b.z - a.z) * t + rz * LANE,
    heading: faceHeading(dx, dz),
  };
}

/**
 * Pick the next corner. Straight first, turns after; a U-turn only at a dead end so
 * no car ever drives back up the lane it came down.
 */
function chooseNext(roads, from, to, rng) {
  const here = roads.nodes[to];
  const came = roads.nodes[from];
  const sx = here.ix - came.ix;
  const sz = here.iz - came.iz;

  const straight = neighbourAt(roads.nodes, here, sx, sz);
  const sideA = neighbourAt(roads.nodes, here, -sz, sx);
  const sideB = neighbourAt(roads.nodes, here, sz, -sx);

  if (straight && rng.next() < KEEP_RIGHT) return straight.id;
  const turns = [];
  if (sideA) turns.push(sideA.id);
  if (sideB) turns.push(sideB.id);
  if (turns.length) {
    // Prefer one side over the other so the flow does not flicker between corners.
    return turns.length === 1 ? turns[0] : (rng.chance(0.62) ? turns[0] : turns[1]);
  }
  if (straight) return straight.id;
  return from; // true dead end: the only legal move is back the way it came
}

/** Drop the car onto a lane edge that starts at a given node. */
function placeOnEdge(car, roads, from, to, t) {
  car.leg = { from, to, t: t == null ? 0 : t };
  const p = lanePoint(roads, from, to, car.leg.t);
  car.x = p.x;
  car.z = p.z;
  car.heading = p.heading;
  car.speed = CRUISE * 0.6;
  car.waitT = 0;
  car.blockedT = 0;
  syncCarMesh(car);
}

/** Random edge somewhere on the grid, favouring spots that keep the map populated. */
function randomEdge(roads, rng) {
  const links = roads.links;
  const link = links[rng.int(0, links.length - 1)];
  return rng.chance(0.5)
    ? { from: link.a, to: link.b }
    : { from: link.b, to: link.a };
}

function freshCar(W, rng, car, nearX, nearZ) {
  car.kind = car.kind || (rng.chance(TAXI_SHARE) ? 'taxi' : 'sedan');
  const edge = randomEdge(W.roads, rng);
  placeOnEdge(car, W.roads, edge.from, edge.to, rng.range(0.05, 0.9));
}

/**
 * Build the ambient fleet. Positions are spread over the grid near the city centre so
 * the first frame always has traffic in shot.
 */
export function spawnTraffic(W, rng, count) {
  const n = count == null ? CONFIG.traffic.count : count;
  const roads = W.roads;
  const cars = [];
  for (let i = 0; i < n; i++) {
    const isTaxi = i < Math.round(n * TAXI_SHARE);
    const kind = isTaxi ? 'taxi' : 'sedan';
    const paint = isTaxi ? C.taxi : C.sedan;
    const edge = randomEdge(roads, rng);
    const t = (i / n) + rng.range(-0.03, 0.03);
    const at = lanePoint(roads, edge.from, edge.to, Math.max(0.04, Math.min(0.94, t)));
    const car = makeCar(kind, at.x, at.z, at.heading, paint, W);
    car.traffic = true;
    car.leg = { from: edge.from, to: edge.to, t: Math.max(0.04, Math.min(0.94, t)) };
    car.speed = CRUISE * rng.range(0.5, 0.9);
    car.waitT = 0;
    car.blockedT = 0;
    car.bumpT = 0;
    car.honkT = 0;
    car.laneOffset = LANE;
    cars.push(car);
  }
  return cars;
}

/** Player position for range checks; the player's own car counts as "here". */
function eyeOf(G) {
  if (!G) return null;
  if (G.inCar) return { x: G.inCar.x, z: G.inCar.z };
  if (G.P && G.P.pos) return { x: G.P.pos.x, z: G.P.pos.z };
  return null;
}

/**
 * Is anything solid sitting inside the box just in front of this car? Tests the
 * player's cars, other traffic, pedestrians and the player on foot, plus walls.
 */
function probeBlocked(car, W, G) {
  if (!G) return false;
  const fx = -Math.sin(car.heading);
  const fz = -Math.cos(car.heading);
  const cx = car.x + fx * PROBE * 0.5;
  const cz = car.z + fz * PROBE * 0.5;
  const halfLong = PROBE * 0.5 + BODY;
  const halfWide = 1.5;

  const inside = (ox, oz, pad) => {
    const dx = ox - cx;
    const dz = oz - cz;
    const along = dx * fx + dz * fz;
    const side = dx * -fz + dz * fx;
    return Math.abs(along) < halfLong + pad && Math.abs(side) < halfWide + pad;
  };

  const fleet = G.cars || [];
  for (let i = 0; i < fleet.length; i++) {
    const other = fleet[i];
    if (!other || other.wrecked || other === G.inCar) continue;
    if (inside(other.x, other.z, CONFIG.car.radius * 0.6)) return true;
  }
  const peers = G.traffic || [];
  for (let i = 0; i < peers.length; i++) {
    const other = peers[i];
    if (!other || other === car || other.wrecked) continue;
    // Overtaking a stopped neighbour is fine; queueing behind it is the real test.
    if (other.speed < 1) {
      const ahead = (other.x - car.x) * fx + (other.z - car.z) * fz;
      const side = (other.x - car.x) * -fz + (other.z - car.z) * fx;
      if (ahead > 0.2 && ahead < BODY + other.radius + 0.8 && Math.abs(side) < 2.2) return true;
      continue;
    }
    // Anything further than a car length and a half ahead has time to clear.
    if (inside(other.x, other.z, 0.4)) return true;
  }
  const crowd = G.peds || [];
  for (let i = 0; i < crowd.length; i++) {
    const ped = crowd[i];
    if (!ped || ped.state === 'down') continue;
    if (inside(ped.pos.x, ped.pos.z, 0.4)) return true;
  }
  const player = G.P;
  if (player && !player.dead) {
    // The player's own car is handled by the bump test; anything on foot is not.
    if (!G.inCar && inside(player.pos.x, player.pos.z, 0.5)) return true;
  }

  // A wall straight ahead: back off and let chooseNext reroute next junction.
  if (W && W.colliders) {
    const nx = car.x + fx * (BODY + 0.6);
    const nz = car.z + fz * (BODY + 0.6);
    for (let i = 0; i < W.colliders.length; i++) {
      const b = W.colliders[i];
      if (nx > b.minX && nx < b.maxX && nz > b.minZ && nz < b.maxZ) return true;
    }
  }
  return false;
}

/** Straight-line distance from a traffic car to a ground point. */
function laneMetres(car, x, z) {
  return Math.hypot(x - car.x, z - car.z);
}

/** Player clipped a traffic car: small paint damage, a honk, and their temper. */
function checkPlayerBump(car, G) {
  if (!G || !G.inCar || car.bumpT > 0) return;
  const mine = G.inCar;
  const gap = laneMetres(car, mine.x, mine.z);
  if (gap > mine.radius + car.radius + 0.6) return;
  const closing = Math.abs(mine.speed) + Math.abs(car.speed);
  if (closing < BUMP_SPEED) return;

  car.bumpT = 1.5;
  car.hp = Math.max(1, car.hp - BUMP_DAMAGE);
  mine.hp = Math.max(1, mine.hp - BUMP_DAMAGE);
  mine.speed *= 0.72;
  car.speed *= 0.6;
  car.honkT = HONK_GAP;
  if (G.sound && G.sound.honk) G.sound.honk();
  if (G.sound && G.sound.crash) G.sound.crash(Math.min(1, closing / 20));
}

/**
 * Move every traffic car one step. Each car walks its edge, asks for the next corner
 * at junctions, brakes for the probe and gets recycled when it drifts too far away.
 */
export function updateTraffic(list, W, G, dt) {
  if (!list || !list.length || !W || !W.roads) return list;
  const roads = W.roads;
  const here = eyeOf(G);
  const rng = (G && G.rng) || null;

  for (let i = 0; i < list.length; i++) {
    const car = list[i];
    if (!car || car.wrecked) continue;
    const leg = car.leg;
    if (!leg) continue;

    car.bumpT = Math.max(0, (car.bumpT || 0) - dt);
    car.honkT = Math.max(0, (car.honkT || 0) - dt);
    checkPlayerBump(car, G);

    const jammed = probeBlocked(car, W, G);
    if (jammed) {
      car.waitT = CLEAR_WAIT;
      car.blockedT = (car.blockedT || 0) + dt;
      // Stuck for a while behind some parked thing: lean on the horn, then move on.
      if (car.blockedT > 2.5 && car.honkT <= 0) {
        car.honkT = HONK_GAP;
        if (G && G.sound && G.sound.honk) G.sound.honk();
      }
      if (car.blockedT > 9 && rng && here) {
        recycleCar(car, W, rng, here.x, here.z, i);
        continue;
      }
    } else {
      car.waitT = Math.max(0, (car.waitT || 0) - dt);
      car.blockedT = 0;
    }

    const target = jammed || car.waitT > 0 ? 0 : CRUISE;
    if (car.speed < target) car.speed = Math.min(target, car.speed + ACCEL * dt);
    else car.speed = Math.max(target, car.speed - BRAKE * dt);

    const a = roads.nodes[leg.from];
    const b = roads.nodes[leg.to];
    const edgeLen = Math.hypot(b.x - a.x, b.z - a.z) || CONFIG.world.pitch;
    leg.t += (car.speed * dt) / edgeLen;

    if (leg.t >= 1) {
      // Decide the whole junction at once, then hand over to the new edge.
      const from = leg.from;
      const to = leg.to;
      const next = rng ? chooseNext(roads, from, to, rng) : to;
      const legal = !!rng && roads.nodes[next] && linked(roads.nodes, roads.nodes[to], roads.nodes[next]);
      leg.from = to;
      leg.to = legal ? next : to;
      leg.t = 0;
      if (legal) {
        // Recompute the overshoot on the new edge so corners never teleport.
        const p0 = roads.nodes[leg.from];
        const p1 = roads.nodes[leg.to];
        const len = Math.hypot(p1.x - p0.x, p1.z - p0.z) || CONFIG.world.pitch;
        leg.t = Math.min(0.5, (car.speed * dt) / len);
      } else if (rng && here) {
        // Nowhere legal to go from here: take a fresh edge elsewhere on the map.
        freshCar(W, rng, car, here.x, here.z);
        continue;
      } else {
        car.speed = 0;
      }
    }

    const p = lanePoint(roads, leg.from, leg.to, leg.t);
    car.x = p.x;
    car.z = p.z;
    car.heading = p.heading;

    // Wheels turn with ground speed even though the lane carries them.
    const legs = car.mesh && car.mesh.userData && car.mesh.userData.legs;
    if (legs) {
      const roll = car.speed * dt * 3;
      for (let k = 0; k < legs.length; k++) {
        const tyre = legs[k].userData.tyre;
        if (tyre) tyre.rotation.x += roll;
      }
    }
    syncCarMesh(car);

    if (here && rng && laneMetres(car, here.x, here.z) > RECYCLE_AT) {
      recycleCar(car, W, rng, here.x, here.z, i);
    }
  }
  return list;
}

/**
 * Move one car to a random corner 40-60 m from the player, so it slides out of the fog
 * just over the rooftops and arrives like ordinary city noise.
 */
function recycleCar(car, W, rng, px, pz, index) {
  const roads = W.roads;
  const nodes = roads.nodes;
  const slots = [];
  for (let i = 0; i < nodes.length; i++) {
    const d = Math.hypot(nodes[i].x - px, nodes[i].z - pz);
    if (d >= RECYCLE_MIN && d <= RECYCLE_MAX) slots.push(nodes[i]);
  }
  let node;
  if (slots.length) {
    node = slots[rng.int(0, slots.length - 1)];
  } else {
    node = nodes[rng.int(0, nodes.length - 1)];
  }
  const options = node.neighbors || [];
  if (!options.length) {
    freshCar(W, rng, car, px, pz);
    return car;
  }
  const to = options[rng.int(0, options.length - 1)];
  const t = (index || 0) % 2 === 0 ? rng.range(0.35, 0.7) : rng.range(0.6, 0.95);
  placeOnEdge(car, roads, node.id, to, t);
  car.wrecked = false;
  car.hp = CONFIG.car.hp;
  return car;
}

/** Public recycle hook for main and police clean-up passes. */
export function respawnTraffic(list, W, rng, pos) {
  if (!list || !list.length || !W || !W.roads || !pos) return list;
  for (let i = 0; i < list.length; i++) {
    const car = list[i];
    if (!car || car.wrecked) continue;
    recycleCar(car, W, rng, pos.x, pos.z, i);
  }
  return list;
}

/** Leave a lane edge on demand, used when traffic has to be nudged off a roadblock. */
export function parkTrafficAside(car, W, rng) {
  const edge = randomEdge(W.roads, rng);
  placeOnEdge(car, W.roads, edge.from, edge.to, rng.range(0.1, 0.85));
  return car;
}
