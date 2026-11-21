// Solara Bay: wanted level and police AI — stars, sirens, roadblocks, cuffs.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { makeCar, updateCarDrive } from './car.js';
import { resolveMove } from './world.js';
import { damagePlayer } from './player.js';

const PCFG = CONFIG.police;
const FOOT = PCFG.foot;
const WANTED = CONFIG.wanted;
const STOPPED = 1.5;
const DOOR_HOP = 6;
const LEAD = 3;
const RAM_SPEED = 7;
const RAM_KNOCK = 5;
const BAIL_HOLD = 2.5;
const KEEP_ON = 30;
const BODY_R = 0.5;
const COP_EYE = 1.4;
const WORLD = { W: null, city: null, rng: null, spawnT: 0 };

export function initPolice(W, city, rng) {
  Object.assign(WORLD, { W, city, rng, spawnT: 0 });
  return { stars: 0, noSeeT: 0, seenT: 0, cars: [], foot: [], roadblock: null, roadblockT: 0 };
}

// HUD: one boolean for "the sirens are live".
export function wantedPoliced(PO) {
  return !!PO && PO.stars > 0;
}

const rand = () => (WORLD.rng ? WORLD.rng.next() : Math.random());
const chance = (p) => rand() < p;
const eye = (G) => (G.inCar ? { x: G.inCar.x, z: G.inCar.z } : { x: G.P?.pos.x ?? 0, z: G.P?.pos.z ?? 0 });
const ahead = (heading) => ({ x: -Math.sin(heading), z: -Math.cos(heading) });

export function addStars(PO, n, G) {
  if (!PO || !n) return PO ? PO.stars : 0;
  const before = PO.stars;
  PO.stars = Math.max(0, Math.min(5, (PO.stars || 0) + n));
  PO.noSeeT = 0;
  PO.seenT = 0;
  G?.sound?.siren?.(PO.stars > 0);
  if (PO.stars > before) G?.onStars?.(PO.stars);
  if (before === 0 && PO.stars > 0) G?.onWantedStart?.();
  return PO.stars;
}

function flashBar(car, dt) {
  car.flashT = (car.flashT || 0) + dt;
  const bar = car.mesh.userData;
  if (!bar.barRed || !bar.barBlue) return;
  const on = Math.floor(car.flashT * 6) % 2 === 0;
  bar.barRed.material = material(on ? C.barRed : 0x40100c, { flat: true });
  bar.barBlue.material = material(on ? 0x16214a : C.barBlue, { flat: true });
}

function wallBetween(W, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  for (let s = 1.2; s < len - 1; s += 1.4) {
    const x = ax + (dx / len) * s;
    const z = az + (dz / len) * s;
    for (const b of W.colliders) if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
  }
  return false;
}

function mergePoint(px, pz) {
  let best = null;
  let bestD = Infinity;
  for (const node of WORLD.W.roads.nodes) {
    for (const p of [{ x: node.x, z: pz + (chance(0.5) ? -1 : 1) * 60 + rand() * 18 }, { x: px + (chance(0.5) ? -1 : 1) * (60 + rand() * 18), z: node.z }]) {
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d < PCFG.spawnMin || d > PCFG.spawnMax + 2 || Math.abs(p.x) > 190 || Math.abs(p.z) > 190) continue;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best || { x: px + 70, z: pz };
}

function addCruiser(PO, at, G, block) {
  const heading = Math.atan2(G.P.pos.x - at.x, G.P.pos.z - at.z) + Math.PI;
  const car = makeCar('police', at.x + 0.5, at.z, heading, C.copbody);
  Object.assign(car, { siren: true, block: !!block });
  WORLD.W.scene.add(car.mesh);
  const row = { car, bailT: 0, dead: false, block: !!block };
  PO.cars.push(row);
  return row;
}

function keepFleet(PO, G, dt) {
  const W = WORLD.W;
  const live = PO.cars.filter((r) => !r.dead);
  if (!PO.stars) {
    PO.cars.forEach((r) => W.scene.remove(r.car.mesh));
    PO.cars.length = 0;
    return;
  }
  const want = (PCFG.counts[PO.stars] || PCFG.counts[1])[0];
  // One cruiser per 1.6 s until the table is met.
  if (live.length < want && (WORLD.spawnT -= dt) <= 0) {
    WORLD.spawnT = 1.6;
    addCruiser(PO, mergePoint(G.P.pos.x, G.P.pos.z), G, false);
  } else if (live.length > want) {
    const p = eye(G);
    const far = live.filter((r) => !r.block).sort((a, b) => Math.hypot(b.car.x - p.x, b.car.z - p.z) - Math.hypot(a.car.x - p.x, a.car.z - p.z))[0];
    if (far) {
      far.dead = true;
      W.scene.remove(far.car.mesh);
    }
  }
  for (const r of live) {
    if (r.block || Math.hypot(r.car.x - G.P.pos.x, r.car.z - G.P.pos.z) < PCFG.spawnMax * 1.6) continue;
    Object.assign(r.car, { ...mergePoint(G.P.pos.x, G.P.pos.z), speed: 0, hp: CONFIG.car.hp, wrecked: false });
  }
}

// Player plus a lead: full throttle, easy through tight corners.
function chaseDrive(row, G, dt) {
  const car = row.car;
  if (car.wrecked) return;
  const t = eye(G);
  const lead = Math.min(LEAD, Math.hypot(t.x - car.x, t.z - car.z) / 6);
  const want = Math.atan2(t.x + (G.P.pos.x - t.x) * lead - car.x, t.z + (G.P.pos.z - t.z) * lead - car.z) + Math.PI - car.heading;
  const off = Math.atan2(Math.sin(want), Math.cos(want));
  updateCarDrive(car, Math.abs(off) > 0.8 ? 0.5 : 1, Math.max(-1, Math.min(1, off * 2)), false, dt, WORLD.W, G);
}

function ram(car, G) {
  const pc = G.inCar && !G.inCar.wrecked ? G.inCar : null;
  const target = pc || (G.P && !G.P.dead ? G.P.pos : null);
  if (!target) return;
  const dx = target.x - car.x;
  const dz = target.z - car.z;
  const d = Math.hypot(dx, dz) || 0.01;
  const closing = Math.abs(car.speed) + (pc ? Math.abs(pc.speed) : 0);
  car.speed *= -0.2;
  if (d > car.radius + (pc ? pc.radius : BODY_R) + 0.35 || closing < RAM_SPEED) return;
  damagePlayer(G.P, pc ? 10 : Math.round(closing * 1.2), G);
  if (pc) Object.assign(pc, { velX: (pc.velX || 0) + (dx / d) * RAM_KNOCK, velZ: (pc.velZ || 0) + (dz / d) * RAM_KNOCK });
  G.sound?.crash?.();
}

function copPart(w, h, d, hex, x, y, swing) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (swing) geo.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(geo, material(hex));
  m.position.set(x, y, 0);
  m.castShadow = true;
  return m;
}

function buildCopMesh() {
  const g = new THREE.Group();
  g.add(copPart(0.46, 0.86, 0.3, C.coptrim, 0, 1.16), copPart(0.36, 0.2, 0.32, 0x9fc3d9, 0, 1.32), copPart(0.26, 0.28, 0.26, C.skin[1], 0, 1.73), copPart(0.3, 0.1, 0.3, C.coptrim, 0, 1.92), copPart(0.07, 0.08, 0.24, 0x23262a, 0.3, 1.28));
  const legL = copPart(0.16, 0.62, 0.18, 0x22304a, -0.11, 0.72, 1);
  const legR = copPart(0.16, 0.62, 0.18, 0x22304a, 0.11, 0.72, 1);
  const armL = copPart(0.12, 0.44, 0.14, C.coptrim, -0.29, 1.52, 1);
  const armR = copPart(0.12, 0.44, 0.14, C.coptrim, 0.29, 1.52, 1);
  g.add(legL, legR, armL, armR);
  g.userData = { legL, legR, armL, armR };
  return g;
}

function spawnFootCop(PO, x, z, yaw) {
  const mesh = buildCopMesh();
  mesh.position.set(x, 0, z);
  mesh.rotation.y = yaw;
  WORLD.W.scene.add(mesh);
  const cop = { mesh, pos: new THREE.Vector3(x, 0, z), yaw, hp: FOOT.hp, down: false, deadT: 0, alive: true,
    nextShot: 0.2 + rand() * (FOOT.fireEvery - 0.2), walkT: 0, strafe: chance(0.5) ? 1 : -1, strafeT: 1.6 + rand() * 2.4 };
  PO.foot.push(cop);
  return cop;
}

export function damageCop(cop, amount, G) { // one officer takes a bullet; two end them
  if (!cop || cop.down) return false;
  cop.hp -= Math.max(1, amount || 1);
  if (cop.hp > 0) return false;
  Object.assign(cop, { down: true, deadT: 14 });
  G?.onCopDown?.(cop);
  return true;
}

function debus(PO, G, dt) {
  if (!G.P || G.P.dead) return;
  const want = (PCFG.counts[PO.stars] || [0, 0])[1];
  const standing = () => PO.foot.filter((c) => c.alive).length;
  const p = G.P.pos;
  for (const r of PO.cars) {
    if (r.dead || r.block || Math.abs(r.car.speed) > STOPPED || Math.hypot(r.car.x - p.x, r.car.z - p.z) > DOOR_HOP) {
      r.bailT = 0;
      continue;
    }
    r.bailT += dt;
    if (r.bailT < BAIL_HOLD || standing() >= want) continue;
    r.bailT = 0;
    const side = chance(0.5) ? 1.5 : -1.5;
    return void spawnFootCop(PO, r.car.x + Math.cos(r.car.heading) * side, r.car.z - Math.sin(r.car.heading) * side, r.car.heading);
  }
}

function walker(cop, G, dt) {
  if (cop.down) {
    Object.assign(cop.mesh.rotation, { z: Math.PI / 2 });
    cop.mesh.position.y = 0.3;
    if ((cop.deadT -= dt) <= 0) {
      cop.alive = false;
      WORLD.W.scene.remove(cop.mesh);
    }
    return;
  }
  const ud = cop.mesh.userData;
  const { x: px, z: pz } = G.P.pos;
  const d = Math.hypot(px - cop.pos.x, pz - cop.pos.z) || 1;
  const nx = (px - cop.pos.x) / d;
  const nz = (pz - cop.pos.z) / d;
  const seen = d <= PCFG.seeDist || (d <= FOOT.range * 1.6 && !wallBetween(WORLD.W, cop.pos.x, cop.pos.z, px, pz));
  // Close in from afar, hold 8-14 m, strafe inside the ring.
  const hold = seen && d <= 14;
  if ((cop.strafeT -= dt) <= 0) Object.assign(cop, { strafeT: 1.6 + rand() * 2.4, strafe: -cop.strafe });
  const bank = hold && d < 8 ? -0.5 : 1;
  const mx = (hold ? (d < 8 ? nx : -nz * cop.strafe) : nx) * bank;
  const mz = (hold ? (d < 8 ? nz : nx * cop.strafe) : nz) * bank;
  const res = resolveMove(WORLD.W, cop.pos.x, cop.pos.z, BODY_R, mx * FOOT.run * (hold ? 0.55 : 1) * dt, mz * FOOT.run * (hold ? 0.55 : 1) * dt);
  cop.pos.x = res.x;
  cop.pos.z = res.z;
  cop.mesh.position.set(res.x, 0, res.z);
  cop.mesh.rotation.set(0, (cop.yaw = Math.atan2(px - cop.pos.x, pz - cop.pos.z) + Math.PI), 0);
  cop.walkT += dt * (hold ? 5 : 12);
  const swing = Math.sin(cop.walkT) * (hold ? 0.25 : 0.8);
  Object.assign(ud.legL.rotation, { x: swing });
  Object.assign(ud.legR.rotation, { x: -swing });
  Object.assign(ud.armL.rotation, { x: -1.3 });
  Object.assign(ud.armR.rotation, { x: -swing * 0.6 });

  cop.nextShot -= dt;
  if (cop.nextShot > 0 || !seen || d > FOOT.range) return;
  cop.nextShot = FOOT.fireEvery * 0.85 + rand() * 0.3;
  const from = { x: res.x + nx * 0.45, y: COP_EYE, z: res.z + nz * 0.45 };
  G.effects?.spawnMuzzle?.(from);
  G.effects?.spawnTracer?.(from, { x: px, y: 1.15, z: pz });
  G.sound?.shot?.();
  if (!wallBetween(WORLD.W, from.x, from.z, px, pz)) {
    damagePlayer(G.P, FOOT.dmgMin + Math.floor(rand() * (FOOT.dmgMax - FOOT.dmgMin + 1)), G);
  }
}

function raiseRoadblock(PO, G) {
  const p = eye(G);
  const heading = G.inCar ? G.inCar.heading : G.P?.yaw || 0;
  const look = ahead(heading);
  const x = p.x + look.x * PCFG.roadblockAhead;
  const z = p.z + look.z * PCFG.roadblockAhead;
  const across = Math.abs(look.x) > Math.abs(look.z);
  const rows = [-2, 2].map((s, i) => {
    const row = addCruiser(PO, across ? { x, z: z + s } : { x: x + s, z }, G, true);
    Object.assign(row.car, { heading: (across ? 0 : Math.PI / 2) + i * 0.2, speed: 0 });
    row.car.mesh.rotation.y = row.car.heading;
    return row;
  });
  PO.roadblock = { x, z, look, rows };
  PO.roadblockT = PCFG.roadblockEvery;
}

function retireRoadblock(PO, G) {
  const rb = PO.roadblock;
  if (!rb) return;
  const p = eye(G);
  if ((p.x - rb.x) * rb.look.x + (p.z - rb.z) * rb.look.z < KEEP_ON) return;
  for (const r of rb.rows) {
    r.dead = true;
    WORLD.W.scene.remove(r.car.mesh);
  }
  PO.roadblock = null;
  PO.cars = PO.cars.filter((r) => !r.dead);
}

function outOfSight(PO, G) {
  const p = eye(G);
  const near = (x, z) => Math.hypot(x - p.x, z - p.z) < PCFG.loseSightDist;
  if (PO.cars.some((r) => !r.dead && (near(r.car.x, r.car.z) || !wallBetween(WORLD.W, r.car.x, r.car.z, p.x, p.z)))) return false;
  return !PO.foot.some((c) => c.alive && !c.down && near(c.pos.x, c.pos.z));
}

function decayStars(PO, G, dt) {
  if (!PO.stars) return;
  if (!outOfSight(PO, G)) return Object.assign(PO, { noSeeT: 0, seenT: PO.seenT + dt });
  PO.noSeeT += dt;
  if (PO.noSeeT < (WANTED.decay[PO.stars] || WANTED.decay[1])) return;
  PO.stars -= 1;
  PO.noSeeT = 0;
  if (PO.stars === 0) G.sound?.siren?.(false);
  G?.onStars?.(PO.stars);
}

function checkArrest(PO, G) {
  const P = G.P;
  if (!P || P.dead || G.inCar || P.hp > FOOT.arrestHpBelow) return;
  // On foot, nearly out of health, an officer or a stopped cruiser within reach: the cuffs.
  const at = (o) => Math.hypot(o.x - P.pos.x, o.z - P.pos.z) < FOOT.arrestDist;
  if (PO.foot.some((c) => c.alive && !c.down && at(c.pos)) || PO.cars.some((r) => !r.dead && Math.abs(r.car.speed) < STOPPED && at(r.car))) G.bust?.();
}

export function updatePolice(PO, G, dt) {
  if (!PO || !G || !WORLD.W || (G.screen && G.screen !== 'play')) return;
  decayStars(PO, G, dt);
  keepFleet(PO, G, dt);
  for (const r of PO.cars) {
    if (r.dead) continue;
    flashBar(r.car, dt);
    if (r.block) continue;
    chaseDrive(r, G, dt);
    ram(r.car, G);
  }
  if (!G.inCar) debus(PO, G, dt);
  for (const c of PO.foot) walker(c, G, dt);
  if (PO.foot.some((c) => !c.alive)) PO.foot = PO.foot.filter((c) => c.alive);
  retireRoadblock(PO, G);
  if (PO.stars >= 4) {
    PO.roadblockT = Math.max(0, (PO.roadblockT || 0) - dt);
    if (!PO.roadblock && PO.roadblockT <= 0 && Math.abs(G.inCar ? G.inCar.speed : 0) > 2) raiseRoadblock(PO, G);
  }
  checkArrest(PO, G);
  if (PO.stars > 0) G.sound?.siren?.(true);
}

export function clearPolice(PO, G) {
  if (!PO) return;
  for (const r of PO.cars) if (r?.car?.mesh) WORLD.W?.scene.remove(r.car.mesh);
  for (const c of PO.foot) if (c?.mesh) WORLD.W?.scene.remove(c.mesh);
  Object.assign(PO, { stars: 0, noSeeT: 0, seenT: 0, cars: [], foot: [], roadblock: null, roadblockT: 0 });
  G?.sound?.siren?.(false);
}
