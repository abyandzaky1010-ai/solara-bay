// Solara Bay — the heat: wanted level, patrol cars that merge off the grid and
// hunt you, officers who bail out and shoot, and a roadblock at four stars.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';
import { makeCar, updateCarDrive, seatPoints } from './car.js';

const WANTED = CONFIG.wanted;
const FOOT = CONFIG.police.foot;
const CHASE = CONFIG.police.carChase;
const SIGHT = 40;      // patrol radius that counts as "on you"
const BLIND = 12;      // point-blank sight, no line needed
const DOWN_FOR = 14;   // a downed officer stays down, then leaves

/* --------------------------------------------------------------------- mesh */

/** The officer: navy shirt, cap, gun in the right hand, swinging legs. */
function officerMesh() {
  const g = new THREE.Group();
  g.name = 'footcop';
  const shirt = material(C.coptrim);
  const put = (w, h, d, mat, y, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(0, y, z);
    g.add(m);
    return m;
  };
  put(0.48, 0.62, 0.3, shirt, 1.06);
  put(0.5, 0.1, 0.32, material(0x141821), 0.72);
  put(0.28, 0.3, 0.28, material(C.skin[2]), 1.52);
  put(0.32, 0.1, 0.32, shirt, 1.7);
  put(0.36, 0.05, 0.02, material(C.beacon, { flat: true }), 1.16, 0.16);
  const limb = (w, len, mat, x, y) => {
    const geo = new THREE.BoxGeometry(w, len, w * 1.15);
    geo.translate(0, -len / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, 0);
    g.add(m);
    return m;
  };
  const dark = material(0x1d2637);
  const legs = [limb(0.17, 0.74, dark, -0.12, 0.74), limb(0.17, 0.74, dark, 0.12, 0.74)];
  const arms = [limb(0.14, 0.58, shirt, -0.32, 1.32), limb(0.14, 0.58, shirt, 0.32, 1.32)];
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.34), material(0x1b1e24));
  gun.position.set(0, -0.6, -0.12);
  arms[1].add(gun);
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  g.userData.legs = legs;
  g.userData.arms = arms;
  return g;
}

/* ------------------------------------------------------------ state & score */

/** Wanted level, the patrol fleet and the officers on the street. */
export function initPolice(W, city, rng) {
  return { stars: 0, noSeeT: 0, seenT: 0, cars: [], foot: [], roadblockT: 0, roadblock: null, W, city, rng };
}

/** Raise the heat: cap five, reset the blind clock, siren on. */
export function addStars(PO, n, G) {
  if (!PO || !n) return PO ? PO.stars : 0;
  PO.stars = Math.min(5, PO.stars + n);
  PO.noSeeT = 0;
  if (G && G.sound) G.sound.siren(true);
  if (G && G.toast) G.toast(`Wanted: ${PO.stars} star${PO.stars > 1 ? 's' : ''}`);
  return PO.stars;
}

/** Zero stars now — a bust, a respawn or a finished job. */
export function clearWanted(PO, G) {
  if (!PO) return;
  PO.stars = PO.noSeeT = PO.seenT = PO.roadblockT = 0;
  dropAll(PO);
  if (G && G.sound) G.sound.siren(false);
}

/** True while the HUD should draw stars. */
export function wantedPoliced(PO) {
  return !!(PO && PO.stars > 0);
}

/** Shot bookkeeping from main's damageCop: enough damage puts him down. */
export function officerHit(PO, cop, dmg, G) {
  if (!cop || cop.down) return;
  cop.hp -= dmg;
  if (cop.hp > 0) return;
  cop.down = true;
  cop.downT = DOWN_FOR;
  cop.mesh.rotation.x = -Math.PI / 2;
  cop.mesh.position.y = 0.15;
  addStars(PO, WANTED.killCop, G);
  if (G && G.onCopDown) G.onCopDown(cop);
}

/* --------------------------------------------------------------------- maths */

function focus(G) {
  if (G.inCar) return { x: G.inCar.x, z: G.inCar.z, onFoot: false };
  const p = G.P && G.P.pos;
  return p ? { x: p.x, z: p.z, onFoot: true } : null;
}

function wrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Slab test: does the segment a→b cross this collider box? */
function crosses(ax, az, bx, bz, box) {
  let t0 = 0, t1 = 1;
  const d = [bx - ax, bz - az], o = [ax, az];
  const lo = [box.minX, box.minZ], hi = [box.maxX, box.maxZ];
  for (let i = 0; i < 2; i++) {
    if (Math.abs(d[i]) < 1e-6) { if (o[i] < lo[i] || o[i] > hi[i]) return false; continue; }
    let n = (lo[i] - o[i]) / d[i], f = (hi[i] - o[i]) / d[i];
    if (n > f) { const s = n; n = f; f = s; }
    t0 = Math.max(t0, n);
    t1 = Math.min(t1, f);
    if (t0 > t1) return false;
  }
  return true;
}

/** Line of sight from a cop to the player, or simply being in his face. */
function sees(W, cx, cz, from) {
  const d = Math.hypot(from.x - cx, from.z - cz);
  if (d < BLIND) return true;
  if (d > SIGHT) return false;
  for (const b of (W && W.colliders) || []) {
    if (b.h < 1.6) continue;
    if (crosses(cx, cz, from.x, from.z, b)) return false;
  }
  return true;
}

/* ------------------------------------------------------------- spawn & drop */

/** A road point 60-80 m out, where a cruiser can merge in behind the player. */
function pickMerge(PO, from) {
  for (let i = 0; i < 26; i++) {
    const p = PO.W.roads.randomPoint(PO.rng);
    if (Math.hypot(p.x - from.x, p.z - from.z) >= 60) return p;
  }
  return null;
}

function spawnCar(PO, from) {
  const spot = pickMerge(PO, from);
  if (!spot) return null;
  const a = PO.W.roads.nodes[spot.from], b = PO.W.roads.nodes[spot.to];
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const car = makeCar('police', spot.x + (dz / len) * 3.2, spot.z - (dx / len) * 3.2,
    Math.atan2(-dx / len, -dz / len), C.copbody);
  car.siren = true;
  car.ai = { stuck: 0, reverse: 0, ramT: 0 };
  PO.W.scene.add(car.mesh);
  PO.cars.push(car);
  return car;
}

function spawnOfficer(PO, exit) {
  const mesh = officerMesh();
  mesh.position.set(exit.x, 0, exit.z);
  PO.W.scene.add(mesh);
  PO.foot.push({
    mesh, x: exit.x, z: exit.z, heading: 0, hp: FOOT.hp, walkT: 0,
    fireT: 0.5, strafe: PO.rng.chance(0.5) ? 1 : -1, down: false, downT: 0,
  });
}

function dropCar(PO, car) {
  PO.W.scene.remove(car.mesh);
  PO.cars.splice(PO.cars.indexOf(car), 1);
}

function dropCop(PO, cop) {
  PO.W.scene.remove(cop.mesh);
  PO.foot.splice(PO.foot.indexOf(cop), 1);
}

function dropAll(PO) {
  [...PO.cars].forEach((c) => dropCar(PO, c));
  [...PO.foot].forEach((c) => dropCop(PO, c));
  for (const car of (PO.roadblock || { cars: [] }).cars) PO.W.scene.remove(car.mesh);
  PO.roadblock = null;
}

/* ------------------------------------------------------------------ the mix */

/** One tick of the whole wanted system. */
export function updatePolice(PO, G, I, dt) {
  void I;
  if (!PO || !dt || !PO.W || !G) return;
  const from = focus(G);
  if (!from) return;
  PO.flash = (PO.flash || 0) + dt;

  // Blind clock: any officer seeing you resets it; running it out costs a star.
  if (PO.stars > 0) {
    let seen = false;
    for (const c of [...PO.cars, ...PO.foot]) {
      if (!c.down && !c.wrecked && sees(PO.W, c.x, c.z, from)) { seen = true; break; }
    }
    if (seen) { PO.noSeeT = 0; PO.seenT += dt; }
    else if ((PO.noSeeT += dt) >= (WANTED.decay[PO.stars] ?? 60)) {
      PO.stars -= 1;
      PO.noSeeT = PO.seenT = 0;
      if (G.toast) G.toast(PO.stars ? `Wanted: ${PO.stars} star${PO.stars > 1 ? 's' : ''}` : 'No stars. The bay breathes again.');
      if (!PO.stars && G.sound) G.sound.siren(false);
    }
  }
  if (G.PO === PO && G.sound && G.sound.siren) G.sound.siren(PO.stars > 0);

  // Fleet sizing per star count; crews leave as the level falls.
  const crew = CONFIG.police.perStar[PO.stars] || [0, 0];
  PO.spawnT = Math.max(0, (PO.spawnT || 0) - dt);
  if (PO.stars > 0 && !PO.spawnT && PO.cars.filter((c) => !c.wrecked).length < crew[0]) {
    spawnCar(PO, from);
    PO.spawnT = 1.5;
  }
  for (const car of [...PO.cars]) {
    if (!PO.stars || Math.hypot(car.x - from.x, car.z - from.z) > CHASE.dropDist) dropCar(PO, car);
  }

  // Officers: step out of any stopped cruiser beside the player, up to the table.
  for (const cop of [...PO.foot]) {
    if (!PO.stars || (cop.down && (cop.downT -= dt) <= 0)) dropCop(PO, cop);
  }
  while (PO.stars && PO.foot.length < crew[1]) {
    const parked = PO.cars.find((c) => !c.wrecked && !c.deployed && Math.abs(c.speed) < 2.2
      && Math.hypot(c.x - from.x, c.z - from.z) < 6);
    if (!parked) break;
    parked.deployed = true;
    spawnOfficer(PO, seatPoints(parked).exit);
  }

  for (const car of [...PO.cars]) {
    if (car.wrecked) flashBar(car, PO.flash);
    else chase(PO, car, G, from, dt);
  }
  for (const cop of [...PO.foot]) if (!cop.down) officerStep(PO, cop, G, from, dt);

  const bust = from.onFoot && G.P && !G.P.dead && G.P.hp <= FOOT.arrestHpBelow && G.bust
    && PO.foot.some((c) => !c.down && Math.hypot(c.x - from.x, c.z - from.z) <= FOOT.arrestDist);
  if (bust) G.bust();
  else roadblock(PO, G, from, dt);
}

/* ---------------------------------------------------------------- patrol AI */

/** Cut the corner on a lead position, floor it, and ram on contact. */
function chase(PO, car, G, from, dt) {
  const ai = car.ai;
  const lead = Math.hypot(from.x - car.x, from.z - car.z) < 45 ? 3 : 1.5;
  const pv = G.inCar && !G.inCar.wrecked ? G.inCar : { ...from, speed: 0, heading: 0 };
  const err = wrap(Math.atan2(-(pv.x - Math.sin(pv.heading) * pv.speed * 0.75 * lead - car.x),
    -(pv.z - Math.cos(pv.heading) * pv.speed * 0.75 * lead - car.z)) - car.heading);
  let steer = Math.max(-1, Math.min(1, err * 2.2));
  let throttle = 1;

  if (Math.abs(car.speed) < 2.5 && Math.hypot(from.x - car.x, from.z - car.z) > 12) ai.stuck += dt;
  else ai.stuck = 0;
  if (ai.stuck > 0.9) { ai.reverse = 0.9; ai.stuck = 0; }
  if (ai.reverse > 0) { ai.reverse -= dt; throttle = -1; steer = -steer; }
  else if (Math.abs(err) > 2) throttle = 0.15;

  updateCarDrive(car, throttle, steer, 0, dt, PO.W, G);
  flashBar(car, PO.flash);

  // Ram: into your bumper at speed, the patrol takes ten off and shoves you aside.
  if (ai.ramT > 0) ai.ramT -= dt;
  if (!G.inCar || G.inCar.wrecked || ai.ramT > 0 || Math.abs(car.speed) < 6) return;
  const d = Math.hypot(car.x - G.inCar.x, car.z - G.inCar.z);
  if (d > car.radius + G.inCar.radius + 3.6) return;
  ai.ramT = 0.7;
  G.inCar.hp -= 10;
  const push = resolveMove(PO.W, G.inCar.x, G.inCar.z, G.inCar.radius,
    ((G.inCar.x - car.x) / (d || 1)) * 1.7, ((G.inCar.z - car.z) / (d || 1)) * 1.7);
  G.inCar.x = push.x;
  G.inCar.z = push.z;
  car.speed *= 0.4;
  if (G.sound) G.sound.crash();
}

/* --------------------------------------------------------------- officer AI */

/** Run in, hold 8-14 m, strafe, and fire on cadence while the shot is clear. */
function officerStep(PO, cop, G, from, dt) {
  const dx = from.x - cop.x, dz = from.z - cop.z;
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d, uz = dz / d;
  let vx = 0, vz = 0;
  if (d > 14) { vx = ux * FOOT.run; vz = uz * FOOT.run; }
  else if (d < 8) { vx = -ux * FOOT.run * 0.5; vz = -uz * FOOT.run * 0.5; }
  else {
    vx = -uz * cop.strafe * 1.8;
    vz = ux * cop.strafe * 1.8;
    if (PO.rng.chance(dt * 0.4)) cop.strafe *= -1;
  }
  const moved = resolveMove(PO.W, cop.x, cop.z, 0.34, vx * dt, vz * dt);
  const stepped = Math.hypot(moved.x - cop.x, moved.z - cop.z) / Math.max(dt, 1e-4);
  cop.x = moved.x;
  cop.z = moved.z;
  cop.walkT += dt * (stepped > 1 ? 11 : 2);
  cop.heading += wrap(Math.atan2(dx, dz) + Math.PI - cop.heading) * Math.min(1, 8 * dt);
  cop.mesh.position.set(cop.x, Math.abs(Math.sin(cop.walkT)) * 0.05, cop.z);
  cop.mesh.rotation.y = cop.heading;

  const swing = Math.sin(cop.walkT) * (stepped > 1 ? 0.7 : 0.12);
  const { legs, arms } = cop.mesh.userData;
  legs[0].rotation.x = swing;
  legs[1].rotation.x = -swing;
  arms[0].rotation.x = -swing * 0.6;

  cop.fireT -= dt;
  if (cop.fireT > 0 || d >= FOOT.range || !sees(PO.W, cop.x, cop.z, from)) return;
  cop.fireT = FOOT.fireEvery;
  const a = { x: cop.x + Math.sin(cop.heading) * -0.4, y: 1.35, z: cop.z + Math.cos(cop.heading) * -0.4 };
  if (G.effects) {
    if (G.effects.spawnMuzzle) G.effects.spawnMuzzle(a);
    if (G.effects.spawnTracer) G.effects.spawnTracer(a, { x: from.x, y: 1.05, z: from.z });
  }
  if (G.sound) G.sound.shot(false);
  if (G.alarm !== undefined) { G.alarm = 1; G.alarmX = cop.x; G.alarmZ = cop.z; }
  const dmg = PO.rng.int(FOOT.dmgMin, FOOT.dmgMax);
  if (G.damagePlayer) G.damagePlayer(dmg, 'police');
  else if ((G.P.hp -= dmg) <= 0 && G.wasted) G.wasted();
}

/* --------------------------------------------------------------- roadblock */

/** Four stars and up: two cruisers broadside, 60 m down your heading. */
function roadblock(PO, G, from, dt) {
  PO.roadblockT = Math.max(0, PO.roadblockT - dt);
  const want = CONFIG.police.roadblockStars;
  if (PO.roadblock) {
    const rb = PO.roadblock;
    const past = (from.x - rb.x) * rb.ux + (from.z - rb.z) * rb.uz;
    if (PO.stars < want || past > 30) {
      for (const car of rb.cars) dropCar(PO, car);
      PO.roadblock = null;
    }
  }
  if (PO.stars < want || PO.roadblock || PO.roadblockT > 0) return;

  const heading = G.inCar ? G.inCar.heading : (G.P && G.P.yaw) || 0;
  const ux = -Math.sin(heading), uz = -Math.cos(heading);
  const x = from.x + ux * 60, z = from.z + uz * 60;
  if (Math.abs(x) > PO.W.half - 8 || Math.abs(z) > PO.W.half - 8) { PO.roadblockT = 4; return; }

  const cars = [-3.1, 3.1].map((side) => {
    const car = makeCar('police', x - uz * side, z + ux * side, heading + Math.PI / 2, C.copbody);
    car.siren = true;
    car.ai = { stuck: 0, reverse: 0, ramT: 0 };
    PO.W.scene.add(car.mesh);
    PO.cars.push(car);
    return car;
  });
  PO.roadblock = { x, z, ux, uz, cars };
  PO.roadblockT = CONFIG.police.roadblockEvery;
  if (G.sound) G.sound.siren(true);
}

/** Red/blue swap on the lightbar; the meshes come from car.js's police build. */
function flashBar(car, t) {
  const bars = car.mesh.userData.bars || [];
  if (!bars.length) return;
  const lit = Math.floor(t * 6) % 2 === 0;
  bars[0].mesh.material = lit ? bars[0].hot : bars[0].cold;
  bars[1].mesh.material = lit ? bars[1].cold : bars[1].hot;
}
