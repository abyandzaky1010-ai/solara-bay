// Pedestrians: fifteen small colourful walkers plus the occasional waiting fare.
// They circle city blocks on the inner sidewalk ring and every leg of their route is a
// corner-to-corner walk along a kerb — nobody jaywalks in Solara Bay. Geometry is
// assembled here so the crowd stays cheap: boxes and one sphere, all with shadows.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';

const WALK_SPEED = CONFIG.peds.speed;   // 1.4 m/s strolling pace
const FLEE_SPEED = CONFIG.peds.flee;    // 5.2 m/s panic run
const FLEE_TIME = 4;                    // seconds of panic per scare
const DOWN_TIME = 20;                   // seconds on the pavement before being recycled
const RING = 1.5;                       // kerb-side offset from the sidewalk edge
const BLOCKS = [-160, -80, 0, 80, 160];
const SCARE_RADIUS = 6;                 // a car this close does the scaring
const SCARE_SPEED = 8;                  // ...if it is going this fast
const FLEE_ALARM_RADIUS = 14;           // a gunshot this close clears the pavement
const HIT_SPEED = 6;                    // a knock this hard puts someone on the floor
const ARM_PIVOT = 0.78;                 // shoulder height on the tiny frame
const CROWD_R = 0.35;                   // keeps walkers from stacking on one spot

/** A box limb; everything on a pedestrian is one of these. */
function limb(w, h, d, hex, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/**
 * Low-poly walker: torso, head, two legs, two arms in a swing group, plus a shoulder
 * pivot per arm so the fare ped can wave and the fighter can flail.
 */
function buildPedBody(rng) {
  const root = new THREE.Group();
  root.name = 'ped';

  const shirt = rng.pick(C.shirt);
  const pants = rng.pick(C.pants);
  const skin = rng.pick(C.skin);
  const scale = rng.range(0.88, 1.1);

  const body = new THREE.Group();
  body.scale.setScalar(scale);
  root.add(body);

  // Torso: a bright shirt box, narrow enough to read as a person from 40 m.
  body.add(limb(0.42, 0.5, 0.26, shirt, 0, 1.06, 0));
  // Hips in trouser colour tie the silhouette together.
  body.add(limb(0.4, 0.14, 0.26, pants, 0, 0.82, 0));

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), material(skin));
  head.position.set(0, 1.45, 0);
  head.castShadow = true;
  body.add(head);

  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, 0.78, 0);
    hip.add(limb(0.15, 0.72, 0.17, pants, 0, -0.36, 0));
    hip.add(limb(0.17, 0.1, 0.26, 0x2b2b2b, 0, -0.72, -0.04));
    body.add(hip);
    legs.push(hip);
  }

  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.28, ARM_PIVOT * 1.2, 0);
    shoulder.add(limb(0.12, 0.44, 0.14, shirt, 0, -0.22, 0));
    shoulder.add(limb(0.11, 0.12, 0.12, skin, 0, -0.46, 0));
    body.add(shoulder);
    arms.push(shoulder);
  }

  return { root, body, legs, arms, scale };
}

/** Four corners of the sidewalk ring around one block, clockwise from the north-west. */
function blockRing(ix, iz) {
  const minX = BLOCKS[ix] + RING;
  const minZ = BLOCKS[iz] + RING;
  const maxX = BLOCKS[ix + 1] - RING;
  const maxZ = BLOCKS[iz + 1] - RING;
  return [
    { x: minX, z: minZ }, // 0 north-west
    { x: maxX, z: minZ }, // 1 north-east
    { x: maxX, z: maxZ }, // 2 south-east
    { x: minX, z: maxZ }, // 3 south-west
  ];
}

/** A single ring appeared at the map edge would fall into the sea, so keep 0..3. */
function pickCorner(rng) {
  const ix = rng.int(0, 3);
  const iz = rng.int(0, 3);
  const ring = blockRing(ix, iz);
  return { ix, iz, ring, corner: rng.int(0, 3) };
}

/**
 * A pedestrian on the pavement. edge holds the current corning-to-corner leg as
 * {from, to} block coordinates; pos is the authoritative ground position.
 */
function makePed(rng, block, corner) {
  const parts = buildPedBody(rng);
  const ring = block.ring || blockRing(block.ix, block.iz);
  const at = ring[corner % 4];
  const ped = {
    mesh: parts.root,
    parts,
    block: { ix: block.ix, iz: block.iz },
    ring,
    corner: corner % 4,
    pos: { x: at.x, z: at.z },
    edge: { from: corner % 4, to: (corner + 1) % 4 },
    next: (corner + 1) % 4,
    t: 0,
    speed: WALK_SPEED * rng.range(0.85, 1.15),
    hp: CONFIG.peds.hp,
    state: 'walk',
    fleeT: 0,
    fleeX: 0,
    fleeZ: 0,
    downT: 0,
    armT: rng.angle(),
    walkT: rng.angle(),
    yaw: 0,
    fare: false,
    taxi: null,
  };
  parts.root.position.set(ped.pos.x, 0, ped.pos.z);
  return ped;
}

/** How far along a ring edge it is from corner `from` to corner `to`. */
function edgeLength(ring, from, to) {
  const a = ring[from];
  const b = ring[to];
  return Math.abs(b.x - a.x) + Math.abs(b.z - a.z) || 1;
}

/** Start walking toward a chosen corner, optionally a little way along (0..1). */
function beginLeg(ped, rng, startT) {
  const from = ped.corner;
  // Mostly round the block clockwise; now and then back the way we came.
  const to = rng.chance(0.22) ? (from + 3) % 4 : (from + 1) % 4;
  ped.edge = { from, to };
  ped.t = Math.max(0, Math.min(0.92, startT || 0));
  faceAlongEdge(ped);
}

/** Position and heading for the ped's current place on its edge (t in 0..1). */
function faceAlongEdge(ped) {
  const a = ped.ring[ped.edge.from];
  const b = ped.ring[ped.edge.to];
  if (ped.edge.from === ped.edge.to) {
    ped.pos.x = a.x;
    ped.pos.z = a.z;
    return;
  }
  ped.pos.x = a.x + (b.x - a.x) * ped.t;
  ped.pos.z = a.z + (b.z - a.z) * ped.t;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  ped.yaw = Math.atan2(-dx, -dz);
}

/** Point a ped at a fresh block, standing somewhere along one kerb. */
function placePed(ped, rng, nearX, nearZ) {
  const block = pickCorner(rng);
  ped.block = { ix: block.ix, iz: block.iz };
  ped.ring = block.ring;
  ped.corner = block.corner;
  ped.t = 0;
  ped.state = 'walk';
  ped.hp = CONFIG.peds.hp;
  ped.fleeT = 0;
  ped.downT = 0;
  ped.taxi = null;
  ped.fare = false;
  ped.rideT = 0;
  beginLeg(ped, rng, rng.range(0.05, 0.85));
  ped.speed = WALK_SPEED * rng.range(0.85, 1.15);
  ped.parts.root.rotation.set(0, ped.yaw, 0);
  ped.parts.root.position.set(ped.pos.x, 0, ped.pos.z);
  ped.parts.root.visible = true;
  if (nearX != null) ped.lastRecycle = { x: nearX, z: nearZ };
  return ped;
}

/** Build the whole crowd and drop the meshes into the scene. */
export function spawnPeds(W, city, rng, count) {
  const n = count == null ? CONFIG.peds.count : count;
  const scene = city && city.scene ? city.scene : W.scene;
  const peds = [];
  const centre = (city && city.spawns && city.spawns.playerStart) || { x: 0, z: 0 };
  const middle = [{ ix: 1, iz: 1 }, { ix: 2, iz: 1 }, { ix: 1, iz: 2 }, { ix: 2, iz: 2 }];

  for (let i = 0; i < n; i++) {
    // The first few blocks of walkers start downtown so the opening frame has a crowd.
    const block = i < 10
      ? { ix: middle[i % 4].ix, iz: middle[i % 4].iz, ring: blockRing(middle[i % 4].ix, middle[i % 4].iz), corner: rng.int(0, 3) }
      : pickCorner(rng);
    const ped = makePed(rng, block, block.corner);
    beginLeg(ped, rng, rng.range(0.08, 0.82));
    ped.parts.root.position.set(ped.pos.x, 0, ped.pos.z);
    ped.parts.root.rotation.y = ped.yaw;
    scene.add(ped.parts.root);
    peds.push(ped);
  }
  // Keep everything reachable from the player's start: pull strays inward.
  for (let i = 0; i < peds.length; i++) {
    const ped = peds[i];
    if (Math.hypot(ped.pos.x - centre.x, ped.pos.z - centre.z) > 260) placePed(ped, rng, centre.x, centre.z);
  }
  return peds;
}

/**
 * The fare ped: one extra walker waiting on the kerb, waving. economy.js drives the
 * pick-up; here we only guarantee the pose and the flag.
 */
export function makeFarePed(W, city, rng, nearX, nearZ) {
  const scene = (city && city.scene) || (W && W.scene);
  const ped = makePed(rng, pickCorner(rng), rng.int(0, 3));
  ped.fare = true;
  ped.state = 'wait';
  ped.hp = CONFIG.peds.hp;
  ped.speed = WALK_SPEED;

  if (nearX != null && nearZ != null) {
    const roads = W && W.roads;
    const node = roads ? roads.at(nearX, nearZ) : { x: nearX, z: nearZ };
    // Stand on the kerb near the junction, facing the traffic lane.
    const side = rng.chance(0.5) ? 1 : -1;
    ped.pos.x = node.x + side * (CONFIG.world.roadHalf + RING);
    ped.pos.z = node.z + rng.range(-5, 5);
    ped.yaw = Math.atan2(node.x - ped.pos.x, 0);
  }
  ped.edge = { from: 0, to: 0 };
  ped.parts.root.position.set(ped.pos.x, 0, ped.pos.z);
  ped.parts.root.rotation.set(0, ped.yaw, 0);
  ped.parts.root.visible = true;
  if (scene) scene.add(ped.parts.root);
  return ped;
}

/** Walk the ring: advance along the current corner-to-corner leg, then turn. */
function walkRing(ped, rng, dt) {
  const from = ped.edge.from;
  const to = ped.edge.to;
  if (from === to) {
    beginLeg(ped, rng);
    return;
  }
  const a = ped.ring[from];
  const b = ped.ring[to];
  const len = edgeLength(ped.ring, from, to);
  ped.t += (ped.speed * dt) / len;

  if (ped.t >= 1) {
    // Arrived at the corner: the next leg starts along the kerb or across the road,
    // and always from a corner, so nobody walks into traffic mid-block.
    ped.corner = to;
    ped.edge = { from: to, to: to };
    ped.t = 0;
    ped.pos.x = b.x;
    ped.pos.z = b.z;
    beginLeg(ped, rng, 0);
    return;
  }
  ped.pos.x = a.x + (b.x - a.x) * ped.t;
  ped.pos.z = a.z + (b.z - a.z) * ped.t;
}

/** Face the walk, swing the legs, and push the mesh to match. */
function poseWalkingPed(ped, dt, amp) {
  const av = ped.parts;
  ped.walkT += dt * 6.5;
  const sway = Math.sin(ped.walkT);
  av.legs[0].rotation.x = sway * amp;
  av.legs[1].rotation.x = -sway * amp;
  av.arms[0].rotation.x = -sway * amp * 0.7;
  av.arms[1].rotation.x = sway * amp * 0.7;

  av.root.position.set(ped.pos.x, 0, ped.pos.z);
  av.root.rotation.x = 0;
  av.root.rotation.z = 0;
  av.root.rotation.y = ped.yaw;
}

/**
 * The point a walker is running from: the player who just raised hell close by, or a car
 * that is bearing straight down on them within six metres.
 */
function scareSource(ped, G) {
  if (!G) return null;
  const P = G.P && G.P.pos;
  if (G.alarm && P && !G.inCar) {
    const d = Math.hypot(P.x - ped.pos.x, P.z - ped.pos.z);
    if (d < FLEE_ALARM_RADIUS) return { x: P.x, z: P.z };
  }
  const moving = (G.cars || []).concat(G.traffic || []);
  for (let i = 0; i < moving.length; i++) {
    const car = moving[i];
    if (!car || car.wrecked) continue;
    if (Math.abs(car.speed) < SCARE_SPEED) continue;
    const d = Math.hypot(car.x - ped.pos.x, car.z - ped.pos.z);
    if (d < SCARE_RADIUS && bearingAt(car, ped)) return { x: car.x, z: car.z };
  }
  return null;
}

/** Is the walker roughly in front of this car, within its lane cone? */
function bearingAt(car, ped) {
  const fx = -Math.sin(car.heading);
  const fz = -Math.cos(car.heading);
  const dx = ped.pos.x - car.x;
  const dz = ped.pos.z - car.z;
  const ahead = dx * fx + dz * fz;
  const side = Math.abs(dx * -fz + dz * fx);
  return ahead > -1 && side < 2.6;
}

/** Any car body overlapping this walker at speed: knock them down. */
function checkCarHit(ped, G) {
  if (!G || ped.state === 'down') return false;
  const moving = (G.cars || []).concat(G.traffic || []);
  for (let i = 0; i < moving.length; i++) {
    const car = moving[i];
    if (!car) continue;
    const d = Math.hypot(car.x - ped.pos.x, car.z - ped.pos.z);
    if (d > car.radius + CROWD_R) continue;
    if (Math.abs(car.speed) <= HIT_SPEED) continue;
    knockPedDown(ped, G);
    return true;
  }
  return false;
}

/**
 * Fall flat and bleed the hit. A fare ped sent down this way is despawned by
 * economy.js; everybody else gets back up twenty seconds later somewhere else.
 */
export function knockPedDown(ped, G) {
  if (!ped || ped.state === 'down') return ped;
  if (ped.fare) {
    ped.state = 'down';
    ped.downT = DOWN_TIME;
    ped.parts.root.rotation.x = -Math.PI / 2;
    ped.parts.root.position.y = 0.24;
    if (G && G.onPedHit) G.onPedHit(ped);
    return ped;
  }
  ped.state = 'down';
  ped.downT = DOWN_TIME;
  ped.hp = Math.max(0, ped.hp - 34);
  const av = ped.parts;
  av.root.rotation.x = -Math.PI / 2;
  av.root.position.y = 0.24;
  av.legs[0].rotation.x = 0.2;
  av.legs[1].rotation.x = -0.15;
  av.arms[0].rotation.x = -0.6;
  av.arms[1].rotation.x = -0.4;
  if (G && G.onPedHit) G.onPedHit(ped);
  if (G && G.sound && G.sound.crash) G.sound.crash(0.35);
  return ped;
}

/** Bullets that reach a walker hurt them; the wanted level is G's business. */
export function damagePed(ped, amount, G) {
  if (!ped || ped.state === 'down') return ped;
  ped.hp -= amount;
  if (ped.hp <= 0) {
    knockPedDown(ped, G);
    return ped;
  }
  const P = G && G.P && G.P.pos;
  startFlee(ped, { x: P ? P.x : ped.pos.x + 1, z: P ? P.z : ped.pos.z });
  return ped;
}

function startFlee(ped, from) {
  ped.state = 'flee';
  ped.fleeT = FLEE_TIME;
  ped.fleeX = from.x;
  ped.fleeZ = from.z;
}

/** Pushed away from the scare along the kerb, never off into the road. */
function runAway(ped, dt) {
  const dx = ped.pos.x - ped.fleeX;
  const dz = ped.pos.z - ped.fleeZ;
  const len = Math.hypot(dx, dz) || 1;
  const step = FLEE_SPEED * dt;
  ped.pos.x += (dx / len) * step;
  ped.pos.z += (dz / len) * step;
  ped.yaw = Math.atan2(-(dx / len), -(dz / len));

  // Corner of the block they belong to: clamp escapes back onto pavement.
  const ring = ped.ring;
  const lo = Math.min(ring[0].x, ring[2].x);
  const hi = Math.max(ring[0].x, ring[2].x);
  const top = Math.min(ring[0].z, ring[2].z);
  const bottom = Math.max(ring[0].z, ring[2].z);
  ped.pos.x = Math.max(lo - 1, Math.min(hi + 1, ped.pos.x));
  ped.pos.z = Math.max(top - 1, Math.min(bottom + 1, ped.pos.z));
}

/** Waving arms for a fare who is waiting for the cab. */
function waveArm(ped, dt) {
  ped.armT += dt * 7;
  const av = ped.parts;
  av.arms[1].rotation.x = -2.2 + Math.sin(ped.armT) * 0.55;
  av.arms[0].rotation.x = -0.1;
  av.legs[0].rotation.x = 0;
  av.legs[1].rotation.x = 0;
  av.root.position.set(ped.pos.x, 0, ped.pos.z);
  av.root.rotation.x = 0;
  av.root.rotation.z = 0;
  av.root.rotation.y = ped.yaw;
  // A tiny bounce so the pose reads as "alive" in a still frame.
  av.root.position.y = Math.abs(Math.sin(ped.armT * 0.5)) * 0.05;
}

/** Riding quietly: hide the pedestrian and mark them for economy.js. */
function rideInTaxi(ped, dt) {
  const taxi = ped.taxi;
  if (!taxi) {
    ped.state = 'wait';
    ped.parts.root.visible = true;
    return;
  }
  ped.parts.root.visible = false;
  ped.pos.x = taxi.x;
  ped.pos.z = taxi.z;
  ped.rideT = (ped.rideT || 0) + dt;
}

/** Bring the body back up after the timer runs out, somewhere else entirely. */
function wakePed(ped, rng, G) {
  const here = G && G.P && G.P.pos ? G.P.pos : { x: 0, z: 0 };
  placePed(ped, rng, here.x, here.z);
  const give = ped.parts.root;
  give.position.set(ped.pos.x, 0, ped.pos.z);
  give.rotation.set(0, ped.yaw, 0);
  give.visible = true;
}

/**
 * One step of the crowd. Walks the block rings, runs from sirens and speeding cars,
 * waves for a cab, lies on the pavement, or rides quietly inside a taxi.
 */
export function updatePeds(list, W, G, dt) {
  if (!list || !list.length) return list;
  const rng = (G && G.rng) || fallbackRng;

  for (let i = 0; i < list.length; i++) {
    const ped = list[i];
    if (!ped || !ped.parts) continue;

    if (ped.state === 'down') {
      ped.downT -= dt;
      if (ped.downT <= 0) wakePed(ped, rng, G);
      continue;
    }

    if (ped.state === 'ride') {
      rideInTaxi(ped, dt);
      continue;
    }

    if (ped.state === 'wait') {
      waveArm(ped, dt);
      // A waiting fare can still be driven at, but never touched by bullets or alarms.
      checkCarHit(ped, G);
      continue;
    }

    if (checkCarHit(ped, G) || ped.state === 'down') continue;

    if (ped.state === 'flee') {
      ped.fleeT -= dt;
      if (ped.fleeT <= 0) {
        ped.state = 'walk';
        beginLeg(ped, rng, 0);
      } else {
        runAway(ped, dt);
        poseWalkingPed(ped, dt, 1.15);
        continue;
      }
    }

    const scare = scareSource(ped, G);
    if (scare) {
      startFlee(ped, scare);
      runAway(ped, dt);
      poseWalkingPed(ped, dt, 1.15);
      continue;
    }

    walkRing(ped, rng, dt);
    poseWalkingPed(ped, dt, 0.5);
  }
  return list;
}

/** Small deterministic stand-in when a caller passes no rng (tests, shots). */
const fallbackRng = {
  next: () => 0.5,
  range: (a, b) => (a + b) / 2,
  int: (a) => a,
  pick: (arr) => arr[0],
  chance: () => false,
  angle: () => 0,
};

/** Nearest walker to a point, used by fares and by hand-to-hand checks. */
export function nearestPed(list, x, z, maxDist) {
  let best = null;
  let bestD = maxDist == null ? Infinity : maxDist;
  for (let i = 0; i < list.length; i++) {
    const ped = list[i];
    if (!ped || ped.state === 'down') continue;
    const d = Math.hypot(ped.pos.x - x, ped.pos.z - z);
    if (d < bestD) { bestD = d; best = ped; }
  }
  return best;
}
