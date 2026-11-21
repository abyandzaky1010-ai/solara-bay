// Solara Bay — ambient traffic. Civilian sedans and cabs growl along the road
// graph, keep to the right-hand lane, queue behind whatever is in front,
// brake for people, and get quietly recycled once the player leaves them behind.

import { CONFIG } from './config.js';
import { C } from './palette.js';
import { makeCar } from './car.js';

// Civilian paints, bright enough that a street full of them still reads sunny.
const SEDAN_PAINTS = [C.sedan, 0x6f8fa6, 0x9d6b6b, 0xc9d2e8, 0xe8e4da, 0x5f7f74, 0xb8c4b0];
const TAXI_FRACTION = 2 / CONFIG.traffic.count; // two of the eleven cars are cabs
const WATCH_RANGE = 130; // recycle anything further out than this
const RING_MIN = 40;
const RING_MAX = 60;
const CLEAR_HOLD = 1.2; // seconds of open road before a halted car pulls away again
const SIDE_HALF = 2.4; // half-width of the strip examined in front of the bumper
const CRUISE = CONFIG.traffic.speed;
const BRAKE = 12; // metres per second squared off the throttle

/** Unit direction and length of a graph leg. */
function legAxis(W, leg) {
  const a = W.roads.nodes[leg.from];
  const b = W.roads.nodes[leg.to];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return { dx, dz, len, ux: dx / len, uz: dz / len };
}

/** Where a car sits on the right-hand lane at fraction t of its leg. */
export function lanePoint(W, leg, t) {
  const a = W.roads.nodes[leg.from];
  const v = legAxis(W, leg);
  const off = CONFIG.traffic.laneOffset;
  const s = t < 0 ? 0 : t > 1 ? 1 : t;
  return {
    x: a.x + v.dx * s - v.uz * off,
    z: a.z + v.dz * s + v.ux * off,
    heading: Math.atan2(v.ux, v.uz),
    ux: v.ux,
    uz: v.uz,
  };
}

/** A car body, standing on its lane and registered with the scene. */
function buildCivilian(W, rng, x, z, heading, taxi) {
  const paint = taxi ? C.taxi : rng.pick(SEDAN_PAINTS);
  const car = makeCar(taxi ? 'taxi' : 'sedan', x, z, heading, paint);
  car.occupant = 'npc';
  car.traffic = true;
  car.leg = null;
  car.holdT = 0;
  car.rollT = CLEAR_HOLD;
  W.scene.add(car.mesh);
  return car;
}

/** Put a body onto a leg, snapped to its lane, already facing the right way. */
function snapToLeg(W, car, from, to, t) {
  car.leg = { from, to, t };
  const p = lanePoint(W, car.leg, t);
  car.x = p.x;
  car.z = p.z;
  car.heading = p.heading;
  car.speed = 0;
  car.holdT = 0;
  car.mesh.position.set(p.x, 0, p.z);
  car.mesh.rotation.y = p.heading;
}

/** 11 cars spread over the grid near the middle of the bay, two of them cabs. */
export function spawnTraffic(W, rng, count) {
  const total = count || CONFIG.traffic.count;
  const cabs = Math.max(1, Math.round(total * TAXI_FRACTION));
  const hubs = [];
  for (let i = 0; i < W.roads.nodes.length; i++) {
    const n = W.roads.nodes[i];
    if (n.neighbors.length && Math.hypot(n.x, n.z) <= 165) hubs.push(i);
  }

  const list = [];
  for (let i = 0; i < total && hubs.length; i++) {
    let placed = false;
    for (let tryCount = 0; tryCount < 20 && !placed; tryCount++) {
      const here = rng.pick(hubs);
      const node = W.roads.nodes[here];
      const to = rng.pick(node.neighbors);
      const spot = lanePoint(W, { from: here, to }, rng.range(0.05, 0.9));
      const crowded = list.some((c) => Math.hypot(c.x - spot.x, c.z - spot.z) < 9);
      if (crowded) continue;

      const car = buildCivilian(W, rng, spot.x, spot.z, spot.heading, i < cabs);
      snapToLeg(W, car, here, to, rng.range(0.05, 0.9));
      list.push(car);
      placed = true;
    }
  }
  return list;
}

/** Forward probe: the nearest body sitting in this car's lane, or null. */
function bodyAhead(W, self, G) {
  const p = lanePoint(W, self.leg, self.leg.t);
  const reach = CONFIG.traffic.probeAhead + CONFIG.car.radius;
  let best = null;

  const look = (bx, bz) => {
    const rx = bx - p.x;
    const rz = bz - p.z;
    const ahead = rx * p.ux + rz * p.uz;
    if (ahead < -0.5 || ahead > reach) return;
    if (Math.abs(rx * p.uz - rz * p.ux) > SIDE_HALF) return;
    const gap = ahead - CONFIG.car.radius;
    if (!best || gap < best) best = gap;
  };

  for (const other of (G && G.traffic) || []) {
    if (other && other !== self && !other.wrecked) look(other.x, other.z);
  }
  if (G && !G.inCar && G.P && G.P.pos && !G.P.dead) look(G.P.pos.x, G.P.pos.z);
  for (const ped of (G && G.peds) || []) {
    if (ped && ped.pos && ped.state !== 'down' && ped.state !== 'ride') look(ped.pos.x, ped.pos.z);
  }
  return best;
}

/** Junction choice: straight on 60% of the time, otherwise any exit bar the one behind. */
function pickExit(W, leg, rng) {
  const node = W.roads.nodes[leg.to];
  if (!node || !node.neighbors.length) return null;
  const v = legAxis(W, leg);
  const straight = [];
  const others = [];
  for (const n of node.neighbors) {
    if (n === leg.from) continue;
    const target = W.roads.nodes[n];
    const dot = (target.x - node.x) * v.ux + (target.z - node.z) * v.uz;
    if (dot > 0.5) straight.push(n);
    else others.push(n);
  }
  if (straight.length && (rng.chance(0.6) || !others.length)) return rng.pick(straight);
  if (others.length) return rng.pick(others);
  return leg.from; // dead end: the only honest way out is back
}

/** Drop a car onto an edge 40-60 m from the player. Returns false if no corner fits. */
function recycleFar(W, rng, car, pos) {
  const ring = [];
  for (let i = 0; i < W.roads.nodes.length; i++) {
    const n = W.roads.nodes[i];
    if (!n.neighbors.length) continue;
    const d = Math.hypot(n.x - pos.x, n.z - pos.z);
    if (d >= RING_MIN && d <= RING_MAX) ring.push(i);
  }
  if (!ring.length) return false;
  const from = rng.pick(ring);
  snapToLeg(W, car, from, rng.pick(W.roads.nodes[from].neighbors), rng.range(0.15, 0.6));
  return true;
}

/** Public: pull every straggler back in around the player's position. */
export function respawnTraffic(list, W, rng, pos) {
  if (!list || !W || !pos) return;
  const source = rng || fallbackRng;
  for (const car of list) {
    if (!car || car.wrecked) continue;
    if (Math.hypot(car.x - pos.x, car.z - pos.z) > WATCH_RANGE) recycleFar(W, source, car, pos);
  }
}

/** Bumper contact: the cab takes a light knock, the horn complains. */
function graze(car, G, closing) {
  car.hp = Math.max(0, car.hp - Math.min(12, closing * 1.5));
  car.speed *= 0.2;
  car.holdT = 0;
  if (G && G.sound && G.sound.honk) G.sound.honk();
}

/** One tick of the whole loop. Cars that belong to a screenshot keep their place. */
export function updateTraffic(list, W, G, dt) {
  if (!list || !W || !W.roads) return;
  const rng = (G && G.rng) || fallbackRng;
  const playerCar = G && G.inCar;
  const focus = (G && G.P && G.P.pos) || (playerCar ? playerCar : null);

  for (const car of list) {
    if (!car || car.wrecked) continue;
    if (!car.leg || car.leg.from === undefined) continue; // posed by a screenshot

    const gap = bodyAhead(W, car, G);
    const blocked = gap !== null && gap < CONFIG.traffic.probeAhead;
    if (blocked) {
      car.holdT += dt;
      car.rollT = 0;
    } else {
      // Road is open again: a stopped car needs 1.2 s of clear lane before it rolls.
      car.rollT = Math.min(CLEAR_HOLD, car.rollT + dt);
      if (car.rollT >= CLEAR_HOLD) car.holdT = 0;
    }

    // A bump from the player's car does real, if small, damage.
    if (playerCar && playerCar !== car) {
      const near = Math.hypot(car.x - playerCar.x, car.z - playerCar.z) < CONFIG.car.radius * 2 + 0.4;
      const closing = Math.abs(playerCar.speed) - Math.abs(car.speed);
      if (near && closing > 3.5) graze(car, G, closing); // civilian cars grind on
    }

    // Speed control: creep up to the gap, or roll on at cruise once the road clears.
    let target = CRUISE;
    if (blocked) target = Math.max(0, Math.min(CRUISE, (gap - 0.8) * 2));
    if (car.rollT < CLEAR_HOLD) target = 0;

    const was = car.speed;
    if (car.speed < target) car.speed = Math.min(target, car.speed + 3.2 * dt);
    else car.speed = Math.max(target, car.speed - BRAKE * dt);
    if (car.speed < 0.04) car.speed = 0;

    // Roll along the edge on this tick's average speed; a junction hands the car
    // to its next leg, straight on most of the time.
    const dist = (was + car.speed) * 0.5 * dt;
    const span = legAxis(W, car.leg).len || CONFIG.world.pitch;
    car.leg.t += dist / span;
    if (car.leg.t >= 1) {
      const next = pickExit(W, car.leg, rng);
      const overflow = Math.min(car.leg.t - 1, 0.5);
      if (next === null || next === car.leg.from) {
        car.speed *= 0.3; // a dead end: ease off and wait for the leg to reopen
        car.leg.t = 1;
      } else {
        car.leg = { from: car.leg.to, to: next, t: overflow };
      }
    }

    const spot = lanePoint(W, car.leg, car.leg.t);
    car.x = spot.x;
    car.z = spot.z;
    car.heading = spot.heading;
    car.steer = 0;
    car.mesh.position.set(spot.x, 0, spot.z);
    car.mesh.rotation.y = spot.heading;

    // Turn the tyres so a stopped queue still looks alive.
    const wheels = (car.extras && car.extras.wheels) || [];
    for (let w = 0; w < wheels.length; w++) wheels[w].rotation.x -= car.speed * dt / 0.42;

    if (focus && Math.hypot(car.x - focus.x, car.z - focus.z) > WATCH_RANGE) {
      recycleFar(W, rng, car, focus);
    }
  }
}

// Used only if a caller forgets to hand over the seeded generator.
const fallbackRng = {
  next: () => Math.random(),
  range: (a, b) => a + (b - a) * Math.random(),
  int: (a, b) => Math.floor(a + (b - a + 1) * Math.random()),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  chance: (p) => Math.random() < p,
  angle: () => Math.random() * Math.PI * 2,
};
