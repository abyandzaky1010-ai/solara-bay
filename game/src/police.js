// Solara Bay — the wanted level and the people who answer it.
// Stars climb with crime, cruisers merge onto the avenues, officers bail out to shoot,
// a roadblock goes up at four, and it all cools off when nobody can see Vesper.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { makeCar } from './car.js';

const WANTED = CONFIG.wanted;
const HEAT = CONFIG.police;
const FOOT = HEAT.foot;
const CRUISER = CONFIG.car.kinds.police;
const LIMIT = CONFIG.world.half;
const SEA = CONFIG.world.sea;

// Numbers this module lives by.
const MAX_STARS = 5;
const SPAWN_NEAR = 60; // m ahead of her a fresh cruiser merges in
const SPAWN_FAR = 80; // m, the far end of that window
const LEAD_TIME = 3; // s of intercept lead once the target is close
const LEAD_NEAR = 40; // m: the lead starts inside this
const RAM_SPEED = 7; // m/s of cruiser speed that counts as a ram
const RAM_DMG = HEAT.car.ram;
const RAM_KNOCK = 6; // m/s she gets shoved to
const BAIL_DIST = 6; // m: a stopped cruiser this close opens its doors
const BAIL_SPEED = 2; // m/s: below this the cruiser counts as stopped
const FOOT_STOP_MIN = 8;
const FOOT_STOP_MAX = 14;
const FOOT_KEEP = 70; // m: further off than this, an officer is relieved
const CMD_DELAY = 1.2; // s before a fresh officer opens fire
const DOWN_HOLD = 12; // s a downed officer stays on the asphalt

// ------------------------------------------------------------------ state

/** The wanted record: stars, the no-sight stopwatch, and everyone on the payroll. */
export function initPolice(W, city, rng) {
  return { stars: 0, noSeeT: 0, seenT: 0, cars: [], foot: [], roadblock: null, roadblockT: 0, W, city, rng, merged: 0, sinceDrop: 0, sinceBail: 0 };
}

const countsFor = (s) => HEAT.perStar[Math.max(1, Math.min(MAX_STARS, s))] || HEAT.perStar[1];
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const arcTo = (from, to) => {
  const d = (to - from) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
};
const retire = (PO, row, key) => {
  PO.W.scene.remove(row.mesh || row.car.mesh);
  const i = PO[key || 'cars'].indexOf(row);
  if (i >= 0) PO[key || 'cars'].splice(i, 1);
};

/** Crime is loud: stars go up, the stopwatch resets, the sirens start. */
export function addStars(PO, n, G) {
  if (!PO || n <= 0) return PO?.stars ?? 0;
  const before = PO.stars | 0;
  PO.stars = Math.min(MAX_STARS, before + Math.max(1, Math.round(n)));
  PO.noSeeT = 0;
  PO.seenT = 0;
  G?.sound?.siren?.(true);
  if (PO.stars !== before) G?.H?.toast?.(PO.stars >= MAX_STARS ? 'Five stars. The whole bay is looking.' : `Wanted: ${PO.stars} star${PO.stars > 1 ? 's' : ''}.`);
  return PO.stars;
}

/** HUD read-out: is anyone actually on her? */
export function wantedPoliced(PO) {
  if (!PO || !PO.stars) return false;
  return PO.cars.some((row) => !row.dead) || PO.foot.some((officer) => !officer.down);
}

/** Wipe the record: the station, the hospital and mission hand-offs call this. */
export function clearPolice(PO, G) {
  if (!PO) return PO;
  for (const row of PO.cars) PO.W.scene.remove(row.car.mesh);
  for (const officer of PO.foot) PO.W.scene.remove(officer.mesh);
  Object.assign(PO, { stars: 0, noSeeT: 0, seenT: 0, cars: [], foot: [], roadblock: null, roadblockT: 0, sinceDrop: 0, sinceBail: 0 });
  G?.sound?.siren?.(false);
  return PO;
}

// ------------------------------------------------------------------ shared maths

// The AABB sweep: both axes, else one, and report the wall.
function sweep(W, pos, r, dx, dz) {
  const solid = (x, z) => W.colliders.some((b) => x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ);
  if (!solid(pos.x + dx, pos.z + dz)) return { x: pos.x + dx, z: pos.z + dz, blocked: false };
  if (!solid(pos.x + dx, pos.z)) return { x: pos.x + dx, z: pos.z, blocked: true };
  if (!solid(pos.x, pos.z + dz)) return { x: pos.x, z: pos.z + dz, blocked: true };
  return { x: pos.x, z: pos.z, blocked: true };
}

// Can a point (x,z) hold a 2.2 m hull without touching a building?
const insideWall = (W, x, z, pad) => W.colliders.some((b) => x + pad > b.minX && x - pad < b.maxX && z + pad > b.minZ && z - pad < b.maxZ);

// A marching XZ ray: cheap line of sight against the boxes, a 4 m step at a time.
const clearShot = (W, a, b) => {
  const steps = Math.ceil((gap(a, b) || 1) / 4);
  for (let i = 1; i < steps; i += 1) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const z = a.z + ((b.z - a.z) * i) / steps;
    if (W.colliders.some((box) => x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ)) return false;
  }
  return true;
};

// The road graph the department was handed, for path lookups.
let PO_ROADS = { nodes: [] };

// A lane-level detour: the nearest junction plus the ones after it, walked breath-first
// over the node list. Drop-through points, so a wedged cruiser can loop a block.
function lanePath(start, end) {
  const { nodes } = PO_ROADS;
  const from = nodes.indexOf(start);
  const to = nodes.indexOf(end);
  if (from < 0 || to < 0) return [];
  const prev = new Map([[from, -1]]);
  const queue = [from];
  while (queue.length && !prev.has(to)) {
    const i = queue.shift();
    for (const j of nodes[i].neighbors) if (!prev.has(j)) (prev.set(j, i), queue.push(j));
  }
  if (!prev.has(to)) return [];
  const out = [];
  for (let i = to; i !== from && i >= 0; i = prev.get(i)) out.unshift(nodes[i]);
  return out;
}

// Time-based strobe: red half a second, blue the other half.
function flashBar(car, dt) {
  const bars = car.mesh.userData.car;
  if (!bars || !bars.barRed) return;
  car.flashT = ((car.flashT || 0) + dt) % 0.6;
  const red = car.flashT < 0.3;
  bars.barRed.material.emissiveIntensity = red ? 1.6 : 0.06;
  bars.barBlue.material.emissiveIntensity = red ? 0.06 : 1.6;
}

// ------------------------------------------------------------------ officers on foot

// One officer's walker: navy shirt and cap, dark trousers, a badge and a pistol arm.
function dressOfficer(rng) {
  const group = new THREE.Group();
  const navy = material(C.coptrim);
  const trousers = material(0x22304a);
  const dark = material(0x151a22);
  const put = (w, h, d, mat, x, y, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  put(0.5, 0.6, 0.3, navy, 0, 1.14);
  put(0.46, 0.1, 0.3, dark, 0, 0.84);
  put(0.1, 0.1, 0.04, material(0xd9c25a, { flat: true }), -0.13, 1.25, 0.16);
  put(0.28, 0.3, 0.28, material(rng.pick(C.skin)), 0, 1.62);
  put(0.31, 0.1, 0.31, navy, 0, 1.81);
  put(0.29, 0.04, 0.12, dark, 0, 1.77, 0.18);
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.12, 0.84, 0);
    hip.add(put(0.17, 0.82, 0.19, trousers, 0, -0.41));
    group.add(hip);
    return hip;
  });
  const arms = [-1, 1].map((side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.3, 1.36, 0);
    shoulder.add(put(0.12, 0.5, 0.14, navy, 0, -0.24));
    group.add(shoulder);
    return shoulder;
  });
  const pistol = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.26), material(0x24282e));
  pistol.position.set(0, -0.5, 0.16);
  arms[1].add(pistol);
  arms[1].rotation.x = -1.25;
  return { group, legs, arms };
}

// Field kit: drawn, lit, on the list. The mesh carries the crew flag for the HUD.
function spawnOfficer(PO, x, z, yaw) {
  const parts = dressOfficer(PO.rng);
  parts.group.position.set(x, 0, z);
  parts.group.rotation.y = yaw;
  parts.group.userData.cop = true;
  PO.W.scene.add(parts.group);
  const officer = { mesh: parts.group, parts, pos: new THREE.Vector3(x, 0, z), yaw, hp: FOOT.hp, down: false, deadT: 0, walkT: 0, strafeT: PO.rng.range(1.4, 3), strafe: PO.rng.chance(0.5) ? 1 : -1, cooldown: CMD_DELAY };
  PO.foot.push(officer);
  return officer;
}

// What Vesper's bullets can trace to.
const copTargets = (PO) => PO.foot.filter((o) => !o.down).map((o) => ({ x: o.pos.x, z: o.pos.z, y: 1.1, cop: o, radius: 0.6 }));

/** The player's bullet lands: an officer drops and the street earns three stars. */
export function damageCop(PO, officer, amount, G) {
  // The firing trace may hand over the wrapper or the officer itself; take either.
  const cop = officer?.cop || officer;
  if (!PO || !cop?.mesh) return false;
  const target = cop;
  if (target.down || !PO.foot.includes(target)) return false;
  target.hp -= amount || 0;
  if (target.hp > 0) return false;
  Object.assign(target, { down: true, deadT: DOWN_HOLD });
  target.mesh.rotation.z = Math.PI / 2;
  target.mesh.position.y = 0.3;
  addStars(PO, WANTED.killCop, G);
  return true;
}

// ------------------------------------------------------------------ cruisers

function buildCruiser(PO, x, z, heading) {
  const car = makeCar('police', x, z, heading, C.copbody);
  Object.assign(car, { occupant: 'npc', siren: true, block: false, stuckT: 0, stuck: false });
  car.retarget = 0;
  PO_ROADS = PO.W.roads;
  PO.W.scene.add(car.mesh);
  const row = { car, dead: false, block: false };
  PO.cars.push(row);
  return row;
}

// A junction or lane point SPAWN_NEAR..SPAWN_FAR off her, clear of walls.
function chooseMergeSpot(PO, at) {
  const { W, rng } = PO;
  const pool = W.roads.nodes.filter((n) => gap(n, at) > 30).sort((a, b) => gap(a, at) - gap(b, at)).slice(0, 8);
  for (let i = 0; i < 14; i += 1) {
    const node = pool.length && i % 2 === 0 ? rng.pick(pool) : null;
    const x = clamp(node ? node.x : at.x + rng.range(-70, 70), SEA + 8, LIMIT - 8);
    const z = clamp(node ? node.z : at.z + rng.range(-70, 70), -LIMIT + 8, LIMIT - 8);
    const d = Math.hypot(x - at.x, z - at.z);
    if (d >= SPAWN_NEAR && d <= SPAWN_FAR && !insideWall(W, x, z, 2.2)) return { x, z };
  }
  return null;
}

// Bring one cruiser on, one junction further in, so it rolls toward her.
function mergeCruiser(PO, at) {
  const spot = chooseMergeSpot(PO, at);
  if (!spot) return null;
  const node = PO.W.roads.at(spot.x, spot.z);
  return buildCruiser(PO, node.x, node.z, Math.atan2(at.x - node.x, at.z - node.z));
}

// Her path, three seconds ahead: the point the cruiser steers for.
function interceptPoint(G, at) {
  const me = G.inCar && !G.inCar.wrecked ? G.inCar : null;
  return me ? { x: at.x + Math.sin(me.heading) * me.speed * LEAD_TIME, z: at.z + Math.cos(me.heading) * me.speed * LEAD_TIME } : at;
}

// One cruiser's frame: steer at the intercept on the road graph, full throttle, ram on contact.
function driveCruiser(PO, G, row, dt, at) {
  const car = row.car;
  const aim = interceptPoint(G, at);
  row.retarget -= dt;
  if (!row.targetXY || gap(row.targetXY, aim) > 10 || row.retarget <= 0) {
    const there = PO.W.roads.at(aim.x, aim.z);
    Object.assign(row, { targetXY: { x: there.x, z: there.z }, path: row.stuck ? lanePath(PO.W.roads.at(car.x, car.z), there) : null, retarget: 1.5 });
  }
  while (row.path && row.path.length && gap(car, row.path[0]) < 7) row.path.shift();
  const goal = gap(car, aim) < LEAD_NEAR ? aim : row.path && row.path.length ? row.path[0] : row.targetXY;
  const steer = clamp(arcTo(car.heading, Math.atan2(goal.x - car.x, goal.z - car.z)) * 2.1, -1, 1);

  car.speed = Math.min(CRUISER.max, car.speed + CRUISER.accel * dt);
  car.heading += steer * CRUISER.turn * Math.min(1, car.speed / 5) * dt;
  car.steerVis = steer;
  const moved = sweep(PO.W, car, car.radius, Math.sin(car.heading) * car.speed * dt, Math.cos(car.heading) * car.speed * dt);
  Object.assign(car, { x: clamp(moved.x, -LIMIT, LIMIT), z: clamp(moved.z, -LIMIT, LIMIT) });
  if (moved.blocked) car.speed = Math.max(1.5, car.speed * 0.55);
  row.stuckT = moved.blocked ? row.stuckT + dt : 0;
  row.stuck = row.stuckT > 1.2;
  car.wheelT += car.speed * dt * 1.6;
  for (const wheel of car.mesh.userData.car.wheels) wheel.rotation.x = car.wheelT;
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  flashBar(car, dt);

  // Ram: her hull takes ten points and a shove along the cruiser's nose.
  const me = G.inCar;
  if (!me || me.wrecked || car.speed < RAM_SPEED || gap(car, me) > car.radius + me.radius + 0.4) return;
  me.hp -= RAM_DMG;
  me.speed = Math.min(RAM_KNOCK, Math.abs(me.speed) + Math.abs(Math.sin(car.heading) * car.speed * 0.35)) * Math.sign(me.speed || 1);
  car.speed *= 0.6;
  G.sound?.crash?.();
  G.effects?.flashDamage?.();
  if (me.hp <= 0) (Object.assign(me, { hp: 0, wrecked: true }), G.explodeCar?.(me), G.effects?.spawnExplosion?.({ x: me.x, y: 1, z: me.z }));
}

// ------------------------------------------------------------------ roadblock

// Two cruisers parked across the lane HEAT.roadblockAhead ahead, once per HEAT.roadblockEvery.
function raiseRoadblock(PO, G) {
  const heading = G.inCar && !G.inCar.wrecked ? G.inCar.heading : G.P.yaw || 0;
  const fwd = { x: Math.sin(heading), z: Math.cos(heading) };
  const right = { x: fwd.z, z: -fwd.x };
  const at = { x: G.P.pos.x + fwd.x * HEAT.roadblockAhead, z: G.P.pos.z + fwd.z * HEAT.roadblockAhead };
  if (Math.abs(at.x) > LIMIT - 20 || Math.abs(at.z) > LIMIT - 20) return;
  const rows = [-3.2, 3.2].map((side) => {
    const row = buildCruiser(PO, at.x + right.x * side, at.z + right.z * side, heading + Math.PI / 2);
    row.block = true;
    row.car.block = true;
    return row;
  });
  Object.assign(PO, { roadblock: { x: at.x, z: at.z, rows }, roadblockT: HEAT.roadblockEvery });
}

// ------------------------------------------------------------------ head count

// Match the table for this star level; roadblocks ride on top while the heat lasts.
function trimToTable(PO) {
  const [maxCars, maxFoot] = countsFor(PO.stars || 1);
  let patrol = PO.cars.filter((row) => !row.block).length;
  for (let i = PO.cars.length - 1; i >= 0 && patrol > Math.max(0, maxCars); i -= 1) {
    if (PO.cars[i].block) continue;
    retire(PO, PO.cars[i]);
    patrol -= 1;
  }
  if ((PO.stars | 0) < 4 && PO.roadblock) {
    for (const row of PO.roadblock.rows) if (PO.cars.includes(row)) retire(PO, row);
    Object.assign(PO, { roadblock: null, roadblockT: 0 });
  }
  const standing = PO.foot.filter((officer) => !officer.down);
  while (standing.length > maxFoot) retire(PO, standing.shift(), 'foot');
}

// ------------------------------------------------------------------ the frame

/** A cop who can see her this frame keeps the stars warm. */
const anyOfficerSees = (PO, at) => PO.cars.some((row) => sees(PO, row.car, at)) || PO.foot.some((officer) => !officer.down && sees(PO, officer.pos, at));

// 40 m of open air, or 12 m of anything at all.
function sees(PO, pos, at) {
  const d = gap(pos, at);
  return d <= HEAT.seeRange && (d < 12 || clearShot(PO.W, pos, at));
}

// One officer on foot: close in, hold 8..14 m, strafe, fire every FOOT.fireEvery.
function walkOfficer(PO, G, officer, at, d, dt) {
  const los = clearShot(PO.W, officer.pos, at);
  const want = Math.atan2(at.x - officer.pos.x, at.z - officer.pos.z);
  officer.strafeT -= dt;
  if (officer.strafeT <= 0) (officer.strafe *= -1), (officer.strafeT = PO.rng.range(1.4, 3));
  const charge = d > FOOT_STOP_MIN ? 1 : d < FOOT_STOP_MAX - 8 ? -0.6 : 0;
  const side = d < FOOT.range ? officer.strafe * 0.45 : 0;
  const dx = Math.sin(want) * charge - Math.cos(want) * side;
  const dz = Math.cos(want) * charge + Math.sin(want) * side;
  const stepLen = (FOOT.run * dt) / Math.max(1, Math.hypot(dx, dz));
  const moved = sweep(PO.W, officer.pos, 0.4, dx * stepLen, dz * stepLen);
  const spot = moved.blocked ? sweep(PO.W, officer.pos, 0.4, -dz * stepLen, dx * stepLen) : moved;
  officer.pos.x = spot.x;
  officer.pos.z = spot.z;
  officer.yaw += arcTo(officer.yaw, want) * Math.min(1, dt * 10);
  officer.walkT += dt * (charge > 0 ? 9 : 3.5);
  const swing = Math.sin(officer.walkT) * (charge > 0 ? 0.6 : 0.15);
  officer.parts.legs[0].rotation.x = swing;
  officer.parts.legs[1].rotation.x = -swing;
  officer.mesh.position.set(officer.pos.x, 0, officer.pos.z);
  officer.mesh.rotation.y = officer.yaw;

  // Fire: muzzle, tracer, then 8..12 points off her.
  officer.cooldown -= dt;
  if (d < FOOT.range && los && officer.cooldown <= 0 && !G.P.dead) {
    officer.cooldown = FOOT.fireEvery;
    const from = { x: officer.pos.x, y: 1.45, z: officer.pos.z };
    G.effects?.spawnMuzzle?.(from);
    G.effects?.spawnTracer?.(from, { x: at.x, y: 1.2, z: at.z });
    G.sound?.shot?.();
    Object.assign(G, { alarm: 1, alarmX: from.x, alarmZ: from.z });
    G.damagePlayer?.(PO.rng.int(FOOT.dmgMin, FOOT.dmgMax));
  }
}

/** One fixed step of the whole department. */
export function updatePolice(PO, G, dt) {
  if (!PO || !G?.P) return PO;
  const P = G.P;
  const inCar = G.inCar && !G.inCar.wrecked ? G.inCar : null;
  const at = inCar ? { x: inCar.x, z: inCar.z } : { x: P.pos.x, z: P.pos.z };
  PO.sinceDrop += dt;
  PO.sinceBail += dt;
  PO.roadblockT = Math.max(0, PO.roadblockT - dt);

  if (!PO.stars) {
    if (PO.cars.length || PO.foot.length) trimToTable(PO);
    return PO;
  }

  // The stopwatch: lose sight and the stars bleed off one at a time.
  if (anyOfficerSees(PO, at)) {
    PO.noSeeT = 0;
    PO.seenT = 0;
  } else {
    PO.seenT += dt;
    PO.noSeeT += dt;
    if (PO.noSeeT >= (WANTED.decay[PO.stars] ?? WANTED.decay[1])) {
      Object.assign(PO, { noSeeT: 0, seenT: 0, stars: PO.stars - 1 });
      G.H?.toast?.(PO.stars ? 'Lost one star. Keep moving.' : 'The heat is off.');
      if (!PO.stars) {
        G.sound?.siren?.(false);
        trimToTable(PO);
        return PO;
      }
    }
  }

  // Fill the gaps in the head count.
  const [wantCars, wantFoot] = countsFor(PO.stars);
  if (PO.cars.filter((row) => !row.block && !row.dead).length < wantCars && PO.sinceDrop > 2.2) {
    PO.sinceDrop = 0;
    mergeCruiser(PO, at);
  }
  const onFoot = PO.foot.filter((officer) => !officer.down);
  if (onFoot.length < wantFoot && PO.sinceBail > 3) {
    PO.sinceBail = 0;
    const near = PO.cars.filter((row) => !row.dead && !row.block && !row.car.wrecked).sort((a, b) => gap(a.car, at) - gap(b.car, at))[0];
    if (near) {
      const c = near.car;
      const x = c.x + Math.cos(c.heading) * (2.2 + onFoot.length * 0.8);
      const z = c.z - Math.sin(c.heading) * (2.2 + onFoot.length * 0.8);
      if (!insideWall(PO.W, x, z, 1)) spawnOfficer(PO, clamp(x, -LIMIT, LIMIT), clamp(z, -LIMIT, LIMIT), c.heading);
    }
  }

  // Roadblock at four and five stars, once per HEAT.roadblockEvery.
  if (PO.stars >= 4 && !PO.roadblock && PO.roadblockT <= 0 && Math.abs(inCar ? inCar.speed : P.speed || 0) > 2) {
    raiseRoadblock(PO, G);
    G.H?.toast?.('Roadblock ahead. Find another way round.');
  }

  // Cruisers: drive, or park across the road and let the officers out.
  for (let i = PO.cars.length - 1; i >= 0; i -= 1) {
    const row = PO.cars[i];
    const car = row.car;
    if (!car || row.dead || car.wrecked) {
      if (car) PO.W.scene.remove(car.mesh);
      PO.cars.splice(i, 1);
      continue;
    }
    const d = gap(car, at);
    if (row.block) {
      flashBar(car, dt);
      car.speed = 0;
      if (d > 30) {
        PO.W.scene.remove(car.mesh);
        PO.cars.splice(i, 1);
        if (PO.roadblock?.rows.includes(row)) {
          PO.roadblock = null;
          PO.roadblockT = HEAT.roadblockEvery;
        }
      }
      continue;
    }
    if (d > HEAT.car.dropDist) {
      retire(PO, row);
      continue;
    }
    driveCruiser(PO, G, row, dt, at);
    // Bail-out: her on foot, a stopped cruiser within 6 m.
    const standing = PO.foot.filter((officer) => !officer.down).length;
    if (!inCar && standing < wantFoot && d < BAIL_DIST && Math.abs(car.speed) < BAIL_SPEED && PO.sinceBail > 1.5) {
      PO.sinceBail = 0;
      spawnOfficer(PO, clamp(car.x + Math.cos(car.heading) * 2.2, -LIMIT, LIMIT), clamp(car.z - Math.sin(car.heading) * 2.2, -LIMIT, LIMIT), car.heading);
    }
  }
  trimToTable(PO);

  // Officers on foot: close in, hold 8..14 m, strafe, fire every FOOT.fireEvery.
  const eyeTarget = at;
  for (let i = PO.foot.length - 1; i >= 0; i -= 1) {
    const officer = PO.foot[i];
    officer.deadT -= dt;
    const d = gap(officer.pos, eyeTarget);
    // Downed officers stay a while, then leave; walking ones are relieved if she outruns them.
    if (officer.down) {
      if (officer.deadT > 0) continue;
      retire(PO, officer, 'foot');
      continue;
    }
    if (d > FOOT_KEEP || !PO.stars) {
      retire(PO, officer, 'foot');
      continue;
    }
    walkOfficer(PO, G, officer, eyeTarget, d, dt);

    // Cuffs: on foot, nearly done, and an officer inside arm's reach.
    if (!inCar && !P.dead && P.hp <= FOOT.arrestHpBelow && d <= FOOT.arrestDist) {
      Object.assign(PO, { stars: 0, noSeeT: 0 });
      G.sound?.siren?.(false);
      G.bust?.();
      break;
    }
  }
  return PO;
}

/** What the player's gun can hit: for the firing trace in main. */
export function copShootTargets(PO) {
  return copTargets(PO);
}
