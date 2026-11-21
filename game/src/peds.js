// Pedestrians: colourful walkers on the pavement rings who flee gunfire and speeding
// cars, go down when hit, and one of whom may be waving down a cab.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';

const P = CONFIG.peds, PATH = 1.5, KERB = [6, 74, 86, 154]; // block edges; walkers 1.5 m inside
const DOWN_SECS = 20, FLEE_SECS = 4, HIT_SPEED = 6, FLEE_R = 6, CORNERS = [0, 1, 2, 3], SPOT = [0.1, 0.4, 0.7, 0.95];

// Four runs around one block, one per kerb. A run is {from,to,t,len}: walk t from `from`.
function ringOf(ix, iz) {
  const x0 = KERB[ix] + PATH, x1 = KERB[ix + 1] - PATH;
  const z0 = KERB[iz] + PATH, z1 = KERB[iz + 1] - PATH;
  const c = [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
  return c.map((from, i) => {
    const to = c[(i + 1) % 4];
    return { from, to, t: 0, len: Math.hypot(to.x - from.x, to.z - from.z) };
  });
}

// All four rings of the block grid.
const allRings = () => [0, 1].flatMap((ix) => [0, 1].map((iz) => ringOf(ix, iz)));

// Where a run puts a walker.
const legPoint = (leg) => ({ x: leg.from.x + (leg.to.x - leg.from.x) * leg.t, z: leg.from.z + (leg.to.z - leg.from.z) * leg.t });

// A spot on a ring: which loop, which run, how far along it.
const spotOn = (rng, rings) => {
  const ring = rings[rng.int(0, rings.length - 1)];
  return { ring, leg: { ...ring[rng.int(0, 3)], t: rng.range(0.02, 0.98) } };
};

// A tiny walker: two legs, a shirt, a head, arms that swing.
function buildWalker(rng) {
  const pick = (a) => a[rng.int(0, a.length - 1)];
  const box = (w, h, dd, hex, x, y) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), material(hex));
    m.position.set(x, y, 0);
    m.castShadow = true;
    return m;
  };
  const shirt = pick(C.shirt), pants = pick(C.pants), top = 1.49, rig = {
    legL: box(0.15, 0.34, 0.16, pants, -0.1, 0.17),
    legR: box(0.15, 0.34, 0.16, pants, 0.1, 0.17),
    armL: box(0.11, 0.42, 0.12, shirt, -0.26, 1.05),
    armR: box(0.11, 0.42, 0.12, shirt, 0.26, 1.05),
  };
  const g = new THREE.Group();
  g.add(box(0.44, 1.15, 0.34, shirt, 0, 0.92), box(0.24, 0.24, 0.24, pick(C.skin), 0, top), ...Object.values(rig));
  g.userData = rig;
  return g;
}

// A walker standing on a ring.
function makePed(W, rng, rings) {
  const ped = {
    mesh: buildWalker(rng), pos: new THREE.Vector3(), yaw: 0, hp: P.hp, state: 'walk',
    fleeT: 0, downT: 0, waveT: 0, fare: false, riding: false, taxi: null,
    swing: rng.range(0, 6.28), block: spotOn(rng, rings),
  };
  const at = legPoint(ped.block.leg);
  ped.pos.set(at.x, 0, at.z);
  ped.yaw = Math.atan2(ped.block.leg.from.x - ped.block.leg.to.x, ped.block.leg.from.z - ped.block.leg.to.z);
  stand(ped);
  W.scene.add(ped.mesh);
  return ped;
}

// Put the body where the state says it is.
function stand(ped) {
  ped.mesh.position.set(ped.pos.x, ped.state === 'down' ? 0.3 : 0, ped.pos.z);
  ped.mesh.rotation.y = ped.yaw;
}

/** Fifteen colourful walkers on the pavement rings. */
export function spawnPeds(W, city, rng, count) {
  const rings = allRings(), list = [];
  for (let i = 0; i < (count || P.count); i += 1) list.push(makePed(W, rng, rings));
  return list;
}

/** The rider: a walker on the ring point nearest the cab, waving. */
export function makeFarePed(W, city, rng, nearX, nearZ) {
  const rings = allRings();
  const ped = makePed(W, rng, rings);
  let best = null, bestD = Infinity;
  for (const ring of rings) for (const i of CORNERS) for (const t of SPOT) {
    const leg = { ...ring[i], t }, p = legPoint(leg), d = Math.hypot(p.x - nearX, p.z - nearZ);
    if (d < bestD) { bestD = d; best = { ring, leg }; }
  }
  Object.assign(ped, { fare: true, state: 'wait', block: best });
  const at = legPoint(best.leg);
  ped.pos.set(at.x, 0, at.z);
  ped.yaw = Math.atan2(nearX - ped.pos.x, nearZ - ped.pos.z);
  stand(ped);
  return ped;
}

/** Shoot a pedestrian: a graze sends them running, a fatal hit puts them down. */
export function damagePed(ped, amount, G) {
  if (!ped || ped.state === 'down' || ped.riding) return false;
  ped.hp -= Math.max(1, amount || 1);
  if (ped.hp > 0) return fleeFrom(ped, G?.alarmX, G?.alarmZ), false;
  down(ped, G);
  return true;
}

// Flat on the pavement for 20 s, then up again.
function down(ped, G) {
  Object.assign(ped, { state: 'down', hp: 0, downT: DOWN_SECS, riding: false });
  ped.mesh.rotation.x = -Math.PI / 2;
  stand(ped);
  G?.onPedKilled?.(ped);
  G?.onPedHit?.(ped);
}

// Sprint away from a point for 4 s, then stroll again.
function fleeFrom(ped, x, z) {
  const dx = ped.pos.x - (x ?? ped.pos.x), dz = ped.pos.z - (z ?? ped.pos.z), d = Math.hypot(dx, dz) || 1;
  Object.assign(ped, { state: 'flee', fleeT: FLEE_SECS, fleeX: ped.pos.x + (dx / d) * 8, fleeZ: ped.pos.z + (dz / d) * 8 });
  return true;
}

// Stroll this run, then step onto the next at the pavement corner.
function walkRing(ped, dt) {
  const leg = ped.block.leg;
  leg.t += (P.speed * dt) / (leg.len || 1);
  // A walker changes run only at a corner, so it never cuts across a block.
  if (leg.t >= 1) ped.block.leg = { ...ped.block.ring[(ped.block.ring.indexOf(leg) + 1) % 4], t: 0 };
  const at = legPoint(ped.block.leg);
  ped.pos.set(at.x, 0, at.z);
  ped.yaw = Math.atan2(at.x - ped.block.leg.to.x, at.z - ped.block.leg.to.z);
}

// Run straight for the escape point; a fleeing walker may cross the road.
function runAway(ped, dt) {
  const dx = ped.fleeX - ped.pos.x, dz = ped.fleeZ - ped.pos.z, d = Math.hypot(dx, dz) || 1, step = P.flee * dt;
  ped.pos.x = Math.max(-192, Math.min(192, ped.pos.x + (dx / d) * step));
  ped.pos.z = Math.max(-192, Math.min(192, ped.pos.z + (dz / d) * step));
  ped.yaw = Math.atan2(-dx, -dz);
  ped.fleeT -= dt;
  if (ped.fleeT <= 0) ped.state = 'walk';
}

// Limbs: a walk cycle, a wave for the fare, still when down.
function animate(ped, dt) {
  const { legL, legR, armL, armR } = ped.mesh.userData;
  if (ped.state === 'down') return;
  if (ped.state === 'wait' || ped.state === 'ride') {
    ped.waveT += dt * 6;
    armR.rotation.z = 1.1 + Math.sin(ped.waveT) * 0.5;
    armL.rotation.z = Math.sin(ped.waveT) * 0.08;
    legL.rotation.x = 0;
    legR.rotation.x = 0;
    return;
  }
  ped.swing += dt * (ped.state === 'flee' ? 11 : 7);
  const s = Math.sin(ped.swing) * 0.5;
  legL.rotation.set(s, 0, 0);
  legR.rotation.set(-s, 0, 0);
  armL.rotation.set(-s * 0.9, 0, 0);
  armR.rotation.set(s * 0.9, 0, 0);
}

// A car over 6 m/s driving over this walker puts them down.
const runOver = (ped, G) => [...(G.cars || []), ...(G.traffic || []), ...(G.inCar ? [G.inCar] : [])]
  .some((c) => c && !c.wrecked && Math.abs(c.speed) > HIT_SPEED && Math.hypot(c.x - ped.pos.x, c.z - ped.pos.z) < c.radius + 0.5);

/** Walk, flee, go down, get up again, and ride along once a fare is picked up. */
export function updatePeds(list, W, G, dt) {
  if (!list || !list.length) return;
  const where = G.inCar || G.P?.pos || { x: 0, z: 0 };
  const at = { x: where.x ?? 0, z: where.z ?? 0 };
  for (const ped of list) {
    if (!ped) continue;
    // A rider sits inside the cab: hidden, following the car that booked them.
    if (ped.riding) {
      if (ped.taxi) ped.pos.set(ped.taxi.x, 0, ped.taxi.z);
      ped.mesh.visible = false;
      continue;
    }
    ped.mesh.visible = true;
    if (ped.state === 'down') {
      ped.downT -= dt;
      if (ped.downT <= 0) recycle(ped, G, at);
      continue;
    }
    if (ped.state === 'wait') {
      if (ped.taxi) Object.assign(ped, { state: 'ride', riding: true });
    } else if (runOver(ped, G)) {
      down(ped, G);
    } else if (ped.state === 'walk' && G.alarm > 0 && Math.hypot(ped.pos.x - G.alarmX, ped.pos.z - G.alarmZ) < FLEE_R * 2) {
      fleeFrom(ped, G.alarmX, G.alarmZ);
    } else if (ped.state === 'flee') {
      runAway(ped, dt);
    } else if (ped.state === 'walk') {
      walkRing(ped, dt);
    }
    if (ped.mesh.rotation.x) ped.mesh.rotation.x = 0;
    animate(ped, dt);
    stand(ped);
  }
}

// Up again on the ring, clear of the player if a free stretch allows.
function recycle(ped, G, at) {
  const ring = ped.block.ring, rng = G.rng || { int: () => 0, range: () => 0.5 };
  const spot = () => ({ ...ring[rng.int(0, 3)], t: rng.range(0.05, 0.95) });
  let leg = spot(), p = legPoint(leg);
  for (let i = 0; i < 12 && Math.hypot(p.x - at.x, p.z - at.z) < 45; i += 1) p = legPoint(leg = spot());
  Object.assign(ped, { block: { ring, leg }, state: ped.fare ? 'wait' : 'walk', hp: P.hp, downT: 0 });
  ped.pos.set(p.x, 0, p.z);
  ped.mesh.rotation.x = 0;
  stand(ped);
}
