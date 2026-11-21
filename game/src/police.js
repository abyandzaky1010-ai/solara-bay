// Solara Bay — the wanted level and the people who enforce it. Cruisers merge out
// of traffic sixty to eighty metres out and ram, officers pour out of a stopped
// car, lightbars cycle on the clock, and four stars puts a roadblock in the road.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { makeCar, updateCarDrive } from './car.js';
import { resolveMove } from './world.js';

const CREW = CONFIG.police.counts;
const FOOT = CONFIG.police.foot;
const CHASE = CONFIG.police.carChase;
const WANTED = CONFIG.wanted;

const EYE_DIST = 40; // "no cop within forty metres" is the whole decay rule
const BLIND_DIST = 15; // inside fifteen metres a cop needs no clear line
const SPAWN_MIN = 60;
const SPAWN_MAX = 80;
const DEPLOY_SPEED = 2; // a cruiser this slow lets an officer out
const DEPLOY_DIST = 6;
const RESPAWN_GAP = 1.6;
const LEAD_SECONDS = 3; // chase aim: where she will be three seconds from now
const FOOT_NEAR = 8; // officers hold this gap...
const FOOT_FAR = 14; // ...or this one
const FOOT_RADIUS = 0.34;
const RAM_WINDOW = 1.6; // fallback if the config ever loses carChase.ram
const DROP_DIST = CHASE.dropDist; // past this a cruiser gives up and vanishes
const ROADBLOCK_GAP = 20;
const ROADBLOCK_AHEAD = 60;
const ROADBLOCK_PASSED = 30;
const FLASH_PERIOD = 0.5;

/* ------------------------------------------------------------------ senses */

/** A straight walk cop to player that stops dead at the first wall. */
function sees(W, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const span = Math.hypot(dx, dz);
  if (span < 0.5) return true;
  const steps = Math.min(18, Math.max(3, Math.round(span / 3)));
  for (let s = 1; s < steps; s++) {
    const px = ax + dx * (s / steps);
    const pz = az + dz * (s / steps);
    for (let i = 0; i < W.colliders.length; i++) {
      const b = W.colliders[i];
      if (px > b.minX && px < b.maxX && pz > b.minZ && pz < b.maxZ) return false;
    }
  }
  return true;
}

/** Seen inside the forty-metre eye with a clear line. Nothing spares a cop that close. */
function spotted(W, ax, az, bx, bz) {
  const d2 = (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
  if (d2 < EYE_DIST * EYE_DIST) return true;
  return d2 < BLIND_DIST * BLIND_DIST || sees(W, ax, az, bx, bz);
}

/** Where the heat aims: the car if she is driving, else her shoulders. */
function playerAnchor(G) {
  const car = G.inCar;
  if (car && !car.wrecked) return { x: car.x, z: car.z, speed: car.speed, heading: car.heading, car };
  const p = (G.P && G.P.pos) || { x: 0, z: 0 };
  return { x: p.x, z: p.z, speed: 0, heading: (G.P && G.P.yaw) || 0, car: null };
}

function near(ax, az, bx, bz, r) {
  return (ax - bx) * (ax - bx) + (az - bz) * (az - bz) <= r * r;
}

function fallbackRng() {
  return {
    next: () => Math.random(),
    range: (a, b) => a + (b - a) * Math.random(),
    int: (a, b) => Math.floor(a + (b - a + 1) * Math.random()),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    chance: (p) => Math.random() < p,
    angle: () => Math.random() * Math.PI * 2,
  };
}

/* --------------------------------------------------------------------- body */

/** An officer: navy shirt, duty belt, dark cap, gun arm out front. */
function buildOfficerMesh() {
  const root = new THREE.Group();
  const navy = material(C.coptrim);
  const trouser = material(0x1d2637);
  const piece = (w, h, d, paint, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), paint);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };

  // Legs and arms hang from pivots so the swing reads around the joint.
  const legs = [];
  const arms = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.2), trouser);
    shin.position.y = -0.36;
    shin.castShadow = true;
    hip.add(shin);
    hip.position.set(side * 0.11, 0.76, 0);
    root.add(hip);
    legs.push(hip);

    const shoulder = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.54, 0.16), navy);
    sleeve.position.y = -0.27;
    sleeve.castShadow = true;
    shoulder.add(sleeve);
    shoulder.position.set(side * 0.29, 1.24, 0);
    root.add(shoulder);
    arms.push(shoulder);
  }
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.3), material(0x33383e));
  gun.position.set(0, -0.56, 0.16);
  arms[1].add(gun);

  piece(0.44, 0.56, 0.26, navy, 0, 1.04, 0);
  piece(0.4, 0.16, 0.25, trouser, 0, 0.76, 0);
  piece(0.46, 0.08, 0.28, material(0xd9dee4), 0, 0.9, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), material(C.skin[2]));
  head.position.y = 1.48;
  head.castShadow = true;
  root.add(head);
  piece(0.33, 0.1, 0.33, navy, 0, 1.62, 0);

  root.userData = { legs, arms };
  return root;
}

/* ------------------------------------------------------------------ staffing */

/** One cruiser on a lane edge sixty to eighty metres out, nose at the player. */
function spawnCruiser(PO, G, at, rng) {
  const W = PO.W;
  const off = CONFIG.traffic.laneOffset;
  const ring = [];
  const spare = [];
  for (let i = 0; i < W.roads.nodes.length; i++) {
    const node = W.roads.nodes[i];
    if (!node.neighbors.length) continue;
    // Measure from where the car will actually stand, not from the junction.
    const next = W.roads.nodes[node.neighbors[rng.int(0, node.neighbors.length - 1)]];
    const t = rng.range(0.2, 0.7);
    const dx = next.x - node.x;
    const dz = next.z - node.z;
    const len = Math.hypot(dx, dz) || 1;
    const x = node.x + dx * t - (dz / len) * off;
    const z = node.z + dz * t + (dx / len) * off;
    const d = Math.hypot(x - at.x, z - at.z);
    const entry = { x, z, d, heading: Math.atan2(at.x - x, at.z - z) };
    if (d >= SPAWN_MIN && d <= SPAWN_MAX) ring.push(entry);
    else if (d >= 45 && d <= 150) spare.push(entry);
  }
  const pool = ring.length ? ring : spare;
  if (!pool.length) return null;

  const spot = pool[rng.int(0, pool.length - 1)];
  const car = makeCar('police', spot.x, spot.z, spot.heading, C.copbody);
  car.occupant = 'npc';
  car.police = true;
  car.siren = true;
  car.ai = { stuck: 0, rev: 0, ramT: 0, deploying: false };
  W.scene.add(car.mesh);
  PO.cars.push(car);
  return car;
}

/** An officer stepping out of a stopped cruiser's door. */
function spawnOfficer(PO, car, rng) {
  const mesh = buildOfficerMesh();
  const side = car.heading + Math.PI / 2;
  const x = car.x + Math.sin(side) * 1.6;
  const z = car.z + Math.cos(side) * 1.6;
  const cop = {
    mesh, x, z, heading: car.heading, hp: FOOT.hp,
    fireT: rng.range(0.3, FOOT.fireEvery), walkT: rng.range(0, 6),
    strafe: rng.chance(0.5) ? 1 : -1, strafeT: rng.range(0.8, 2.2),
    down: false, downT: 0, fromCar: car,
  };
  mesh.position.set(x, 0, z);
  mesh.rotation.y = car.heading;
  car.ai.deploying = true;
  PO.W.scene.add(mesh);
  PO.foot.push(cop);
  return cop;
}

function dropCruiser(PO, car) {
  const i = PO.cars.indexOf(car);
  if (i >= 0) PO.cars.splice(i, 1);
  if (car.mesh.parent) car.mesh.parent.remove(car.mesh);
}

function dropOfficer(PO, cop) {
  const i = PO.foot.indexOf(cop);
  if (i >= 0) PO.foot.splice(i, 1);
  if (cop.mesh.parent) cop.mesh.parent.remove(cop.mesh);
}

/* ------------------------------------------------------------------ driving */

/** Lightbar swap on the clock: a stopped cruiser still flashes. */
function flashBar(car, clock) {
  const bars = car.extras && car.extras.bars;
  if (!bars) return;
  car.flashT = clock % FLASH_PERIOD;
  const redOn = car.flashT < FLASH_PERIOD * 0.5;
  bars.redMat.color.setHex(redOn ? C.barRed : 0x521512);
  bars.blueMat.color.setHex(redOn ? 0x182a52 : C.barBlue);
}

/** Cruiser contact at speed: ten damage and a shove, once a window. */
function tryRam(PO, car, G, target, rng) {
  const ai = car.ai;
  if (!target || target.wrecked || ai.ramT > 0 || Math.abs(car.speed) < 6) return;
  const d = Math.hypot(target.x - car.x, target.z - car.z);
  if (d > car.radius + target.radius + 1.4) return;

  target.hp -= 10;
  ai.ramT = CHASE.ram || RAM_WINDOW;
  car.speed *= 0.35;
  const shove = resolveMove(PO.W, target.x, target.z, target.radius,
    ((target.x - car.x) / (d || 1)) * 1.9, ((target.z - car.z) / (d || 1)) * 1.9);
  target.x = shove.x;
  target.z = shove.z;
  target.mesh.position.set(target.x, 0, target.z);
  if (G.sound && G.sound.crash) G.sound.crash();
  if (G.effects && rng.chance(0.6)) {
    G.effects.spawnSmokePuff({ x: (target.x + car.x) / 2, y: 1.1, z: (target.z + car.z) / 2 });
  }
}

/** Full throttle at the intercept, brake when the nose overshoots, ram on contact. */
function driveCruiser(PO, car, G, at, dt, rng) {
  const ai = car.ai;
  const limit = PO.W.half - 14;
  const aimX = Math.max(-limit, Math.min(limit, at.x + Math.sin(at.heading) * at.speed * LEAD_SECONDS));
  const aimZ = Math.max(-limit, Math.min(limit, at.z + Math.cos(at.heading) * at.speed * LEAD_SECONDS));
  let err = Math.atan2(aimX - car.x, aimZ - car.z) - car.heading;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;

  let throttle = 1;
  let brake = 0;
  if (ai.rev > 0) {
    ai.rev -= dt;
    throttle = -1;
  } else if (Math.abs(err) > 1.5 && Math.abs(car.speed) > 12) {
    throttle = 0.2; // swing the nose round instead of ploughing into a block
    brake = 0.5;
  } else if (at.car && Math.abs(car.speed) > 8
    && Math.hypot(aimX - car.x, aimZ - car.z) < at.car.radius + car.radius + 2.5) {
    throttle = 0;
    brake = 1;
  }

  // Held up against a wall or a queue: back out for a moment, then try again.
  if (throttle > 0 && Math.abs(car.speed) < 1.4) ai.stuck += dt;
  else if (Math.abs(car.speed) > 3) ai.stuck = Math.max(0, ai.stuck - dt * 2);
  if (ai.stuck > 1.4) {
    ai.rev = 1.1;
    ai.stuck = 0;
  }

  if (ai.ramT > 0) ai.ramT -= dt;
  const steer = Math.max(-1, Math.min(1, err * (Math.abs(err) > 1.2 ? 1.8 : 1.1)));
  updateCarDrive(car, throttle, steer, brake, dt, PO.W, G);
  flashBar(car, PO.flash);
  tryRam(PO, car, G, at.car, rng);
}

/* ------------------------------------------------------------- officers */

function animateOfficer(cop) {
  const { legs, arms } = cop.mesh.userData;
  if (cop.down) {
    for (const pivot of legs) pivot.rotation.x = 0;
    for (const pivot of arms) pivot.rotation.x = 0;
    return;
  }
  const swing = Math.sin(cop.walkT) * 0.8;
  legs[0].rotation.x = swing;
  legs[1].rotation.x = -swing;
  arms[0].rotation.x = -swing * 0.6;
  arms[1].rotation.x = -1.35 + swing * 0.08; // gun arm level
}

/** Run at her, hold 8-14 m, strafe, fire on the beat when the shot is clear. */
function officerTurn(PO, cop, G, at, dt, rng) {
  const dx = at.x - cop.x;
  const dz = at.z - cop.z;
  const d = Math.hypot(dx, dz) || 0.001;
  const ux = dx / d;
  const uz = dz / d;

  cop.strafeT -= dt;
  if (cop.strafeT <= 0) {
    cop.strafeT = rng.range(1, 2.6);
    cop.strafe = rng.chance(0.5) ? 1 : -1;
  }

  // Close in, drift sideways in the firing band, back off if she comes at him.
  let vx;
  let vz;
  if (d > FOOT_FAR) {
    vx = ux;
    vz = uz;
  } else if (d > FOOT_NEAR) {
    vx = ux * 0.35 - uz * cop.strafe * 0.9;
    vz = uz * 0.35 + ux * cop.strafe * 0.9;
  } else {
    vx = -ux * 0.8 - uz * cop.strafe * 0.8;
    vz = -uz * 0.8 + ux * cop.strafe * 0.8;
  }
  const len = Math.hypot(vx, vz) || 1;
  const step = FOOT.run * dt;
  const moved = resolveMove(PO.W, cop.x, cop.z, FOOT_RADIUS, (vx / len) * step, (vz / len) * step);
  cop.x = moved.x;
  cop.z = moved.z;
  cop.walkT += step * 2.6;
  cop.heading = Math.atan2(dx, dz);
  cop.mesh.position.set(cop.x, 0, cop.z);
  cop.mesh.rotation.y = cop.heading;
  animateOfficer(cop);

  cop.fireT -= dt;
  if (cop.fireT > 0 || d > FOOT.range || !sees(PO.W, cop.x, cop.z, at.x, at.z)) return;
  cop.fireT = FOOT.fireEvery;

  const muzzle = { x: cop.x + uz * 0.5, y: 1.3, z: cop.z + uz * 0.5 };
  G.effects && G.effects.spawnMuzzle(muzzle);
  G.effects && G.effects.spawnTracer(muzzle, { x: at.x, y: 1.1, z: at.z });
  G.sound && G.sound.shot && G.sound.shot(false);
  // A shot at the edge of the envelope only lands half the time.
  if (d > FOOT.range * 0.6 && !rng.chance(0.55)) return;
  if (G.damagePlayer) G.damagePlayer(rng.int(FOOT.dmgMin, FOOT.dmgMax));
}

/* ------------------------------------------------------------- roadblock */

/** Two cruisers parked across the avenue sixty metres up the road. */
function setRoadblock(PO, G, at) {
  const fx = Math.sin(at.heading);
  const fz = Math.cos(at.heading);
  const edge = PO.W.half - 16;
  const across = at.heading + Math.PI / 2;
  const ax = Math.abs(fx) > Math.abs(fz); // travelling along x?

  // Snap to the avenue she is on, then walk up it sixty metres, or as far as
  // the map allows. The roads sit on the pitch grid, so snapping is exact.
  const line = Math.round((ax ? at.z : at.x) / CONFIG.world.pitch) * CONFIG.world.pitch;
  const here = ax ? at.x : at.z;
  const dir = ax ? fx : fz;
  let along = here + dir * ROADBLOCK_AHEAD;
  if (Math.abs(along) > edge) {
    along = Math.sign(dir) * edge;
    if (Math.abs(along - here) < 24) {
      PO.roadblockT = 6; // pinned at the edge of town: no room for a block
      return;
    }
  }

  const bx = ax ? along : line;
  const bz = ax ? line : along;
  const cars = [];
  for (const side of [-1, 1]) {
    const car = makeCar('police', bx + Math.sin(across) * 4.4 * side, bz + Math.cos(across) * 4.4 * side, across, C.copbody);
    car.occupant = 'npc';
    car.police = true;
    car.roadblock = true;
    car.ai = { stuck: 0, rev: 0, ramT: 0, deploying: false, hold: true };
    PO.W.scene.add(car.mesh);
    PO.cars.push(car);
    cars.push(car);
  }
  PO.roadblock = { x: bx, z: bz, cars, side: Math.sign(dir) };
  if (G.sound && G.sound.siren) G.sound.siren(true);
  if (G.toast) G.toast('Roadblock ahead.');
}

/* -------------------------------------------------------------------- API */

export function initPolice(W, city, rng) {
  return {
    W,
    city,
    rng: rng || fallbackRng(),
    stars: 0,
    noSeeT: 0,
    seenT: 0,
    cars: [],
    foot: [],
    roadblock: null,
    roadblockT: 0,
    spawnT: 0,
    flash: 0,
  };
}

/** Raise the heat. Capped at five; a new star resets the clock and the siren. */
export function addStars(PO, n, G) {
  if (!PO || !n || n <= 0) return PO ? PO.stars : 0;
  const before = PO.stars;
  PO.stars = Math.min(5, PO.stars + n);
  PO.noSeeT = 0;
  PO.seenT = 0;
  if (G && G.sound && G.sound.siren) G.sound.siren(true);
  if (PO.stars > before && G && G.toast) {
    G.toast(PO.stars >= 5 ? 'Wanted: five stars. The whole bay is looking.' : `Wanted: ${PO.stars} star${PO.stars > 1 ? 's' : ''}`);
  }
  return PO.stars;
}

/** Everything back to calm: after a bust, a hospital trip, or a cleared job. */
export function clearWanted(PO, G) {
  if (!PO) return;
  PO.stars = 0;
  PO.noSeeT = 0;
  PO.seenT = 0;
  PO.roadblockT = 0;
  for (const car of [...PO.cars]) {
    if (car.roadblock || car.wrecked) dropCruiser(PO, car);
    else car.siren = false;
  }
  for (const cop of [...PO.foot]) dropOfficer(PO, cop);
  PO.roadblock = null;
  if (G && G.sound && G.sound.siren) G.sound.siren(false);
}

/** For the HUD: is the bay actively looking for her? */
export function wantedPoliced(PO) {
  return !!(PO && PO.stars > 0);
}

/** A bullet found an officer. Sixty points of cop is two pistol rounds. */
export function officerHit(PO, cop, dmg, G) {
  if (!PO || !cop || cop.down) return false;
  cop.hp -= dmg;
  if (cop.hp > 0) return true;
  cop.hp = 0;
  cop.down = true;
  cop.downT = 0;
  cop.mesh.rotation.x = -Math.PI / 2;
  cop.mesh.position.y = 0.16;
  if (G) {
    if (G.onCopDown) G.onCopDown(cop);
    if (G.sound && G.sound.chime) G.sound.chime();
  }
  return false;
}

/** One tick: decay, staffing, car AI, officers, arrest, roadblock. */
export function updatePolice(PO, G, I, dt) {
  if (!PO || !PO.W || !G || !dt) return;
  const W = PO.W;
  const rng = PO.rng;
  const at = playerAnchor(G);
  const onFoot = !G.inCar;
  PO.flash += dt;

  if (G.P && G.P.dead) {
    for (const car of PO.cars) flashBar(car, PO.flash);
    return;
  }

  // --- decay: nobody in sight for the star's timer, and one comes off.
  if (PO.stars > 0) {
    let seen = false;
    for (const car of PO.cars) if (!car.wrecked && spotted(W, car.x, car.z, at.x, at.z)) seen = true;
    if (!seen) for (const cop of PO.foot) if (!cop.down && spotted(W, cop.x, cop.z, at.x, at.z)) seen = true;
    if (seen) {
      PO.noSeeT = 0;
      PO.seenT += dt;
    } else {
      PO.seenT = 0;
      PO.noSeeT += dt;
      if (PO.noSeeT >= (WANTED.decay[PO.stars] || 60)) {
        PO.stars = Math.max(0, PO.stars - 1);
        PO.noSeeT = 0;
        if (G.sound && G.sound.siren && PO.stars === 0) G.sound.siren(false);
        if (G.toast) G.toast(PO.stars ? `Wanted: ${PO.stars} star${PO.stars > 1 ? 's' : ''}` : 'No stars. The bay breathes again.');
      }
    }
  } else {
    PO.noSeeT = 0;
    PO.seenT = 0;
  }

  const crew = CREW[PO.stars] || [0, 0];

  // --- staffing down: spare cruisers, strays and cleared wrecks go first.
  // A roadblock cruiser is not part of the chase crew, so it never eats the quota.
  let cruisers = 0;
  for (const car of [...PO.cars]) {
    if (car.wrecked) {
      car.wreckT = (car.wreckT || 0) + dt;
      if (car.wreckT > 12) dropCruiser(PO, car);
      else flashBar(car, PO.flash);
    } else if (car.roadblock) {
      flashBar(car, PO.flash);
    } else if (cruisers < crew[0] && Math.hypot(car.x - at.x, car.z - at.z) <= DROP_DIST) {
      cruisers += 1;
    } else {
      dropCruiser(PO, car);
    }
  }
  let upright = 0;
  for (const cop of [...PO.foot]) {
    if (cop.down) {
      cop.downT += dt;
      if (cop.downT > 6 || PO.stars === 0) dropOfficer(PO, cop);
    } else if (upright < crew[1] && Math.hypot(cop.x - at.x, cop.z - at.z) <= DROP_DIST) {
      upright += 1;
    } else {
      dropOfficer(PO, cop);
    }
  }

  // --- staffing up: one fresh cruiser at a time, then officers from parked cars.
  PO.spawnT = Math.max(0, PO.spawnT - dt);
  if (PO.stars > 0 && PO.spawnT === 0 && cruisers < crew[0]) {
    spawnCruiser(PO, G, at, rng);
    PO.spawnT = RESPAWN_GAP;
  }
  if (PO.stars > 0 && upright < crew[1]) {
    const parked = PO.cars.find((c) => !c.wrecked && !c.roadblock && !c.ai.deploying
      && Math.abs(c.speed) < DEPLOY_SPEED && near(c.x, c.z, at.x, at.z, DEPLOY_DIST + 8));
    if (parked) spawnOfficer(PO, parked, rng);
  }

  // --- cruisers drive at the intercept; roadblock cars hold their ground.
  for (const car of PO.cars) {
    if (car.wrecked) continue;
    const away = Math.hypot(car.x - at.x, car.z - at.z);
    if (car.ai.hold) {
      if (Math.abs(car.speed) > 0.2) updateCarDrive(car, 0, 0, 1, dt, W, G);
      flashBar(car, PO.flash);
    } else if (away > SPAWN_MAX + 20) {
      updateCarDrive(car, away > 140 ? 1 : 0.55, 0, 0, dt, W, G); // still merging in
      flashBar(car, PO.flash);
    } else {
      driveCruiser(PO, car, G, at, dt, rng);
    }
  }

  // --- officers.
  for (const cop of PO.foot) if (!cop.down) officerTurn(PO, cop, G, at, dt, rng);

  // --- arrest: on foot, hurt, and an officer within arm's reach.
  if (onFoot && !G.P.dead && G.P.hp <= FOOT.arrestHpBelow && G.bust) {
    for (const cop of PO.foot) {
      if (!cop.down && near(cop.x, cop.z, at.x, at.z, FOOT.arrestDist)) {
        G.bust();
        break;
      }
    }
  }

  // --- roadblock: four stars up, once every twenty seconds, dropped once passed.
  // `setRoadblock` can decline near the map edge, so it charges a cooldown itself.
  const rb = PO.roadblock;
  if (rb) {
    const ax = Math.abs(Math.sin(at.heading)) > Math.abs(Math.cos(at.heading));
    const past = ax ? (at.x - rb.x) * rb.side : (at.z - rb.z) * rb.side;
    const spent = rb.cars.every((c) => c.wrecked || PO.cars.indexOf(c) === -1);
    if (spent || PO.stars < 4 || past > ROADBLOCK_PASSED) {
      for (const car of rb.cars) dropCruiser(PO, car);
      PO.roadblock = null;
      PO.roadblockT = ROADBLOCK_GAP;
    }
  } else {
    PO.roadblockT = Math.max(0, PO.roadblockT - dt);
    if (PO.stars >= 4 && PO.roadblockT === 0) setRoadblock(PO, G, at);
  }

  if (G.PO === PO && G.sound && G.sound.siren) G.sound.siren(PO.stars > 0);
}
