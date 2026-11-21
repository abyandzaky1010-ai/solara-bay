// One job: the wanted level and the officers who answer it.
// Stars go up from crimes, chase cars merge onto the grid and ram, foot officers
// bail out of stopped cruisers, shoot tracers, and cuff a bleeding player.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { makeCar, updateCarDrive, syncCarMesh } from './car.js';
import { resolveMove } from './world.js';

const SPAWN_MIN = 60;        // police cars appear this far out...
const SPAWN_MAX = 80;        // ...and no further, so they arrive quickly
const SEE_DIST = 12;         // inside this a cop always has eyes on you
const SEE_RANGE = 40;        // outside it, only a clear sight line counts
const LEAD_CLOSE = 3;        // seconds of player lead the intercept aims at
const RAM_DAMAGE = 10;       // one police-contact hit on the player's car
const RAM_SPEED = 4;         // contact slower than this is a nudge, not a ram
const BAIL_DIST = 6;         // a stopped cruiser is close enough to unload from
const BAIL_SPEED = 2.5;      // "stopped" for the purpose of bailing out
const MAX_FOOT_SLACK = 2;    // extra walkers beyond the table, so patrol has no gaps
const FIRE_RANGE_PAD = 2;    // stay just inside the pistol range before firing
const COMFORT_NEAR = 8;      // officers hold this band instead of hugging you
const COMFORT_FAR = 14;
const ROADBLOCK_EVERY = 20;  // seconds between roadblock attempts
const ROADBLOCK_AHEAD = 60;  // metres down the player's road
const ROADBLOCK_CLEAR = 30;  // pack is forgotten once it is this far behind
const DESPAWN_DIST = 260;    // give up and vanish past this distance
const CHARGE_TIME = 2.2;     // seconds of standing still before an arrest lands
const FLASH_HZ = 6;          // lightbar swaps per second

const FLAT = { flat: true };

// ---------- entrance ----------

/** The wanted state: stars, timers, the two officer pools and roadblock bookkeeping. */
export function initPolice(W, city, rng) {
  const PO = {
    W,
    city,
    rng,
    stars: 0,
    noSeeT: 0,
    seenT: 0,
    cars: [],
    foot: [],
    roadblockT: 0,
    roadblock: null,
    siren: false,
    arrestT: 0,
    lastStars: 0,
  };
  updateSiren(PO, null);
  return PO;
}

/** HUD asks this once a frame: are the streets hot right now? */
export function wantedPoliced(PO) {
  if (!PO) return false;
  if (PO.stars > 0) return true;
  return PO.cars.length > 0 || PO.foot.length > 0;
}

/**
 * Raise the wanted level. Every call resets the "unseen" clock, and once the
 * level is above zero the siren starts and the pursuers arrive on the next step.
 */
export function addStars(PO, n, G) {
  if (!PO) return PO ? PO.stars : 0;
  const before = PO.stars;
  const cap = 5;                       // five stars is the ceiling
  PO.stars = Math.min(cap, (PO.stars || 0) + Math.max(0, Math.round(n || 0)));
  PO.noSeeT = 0;
  PO.seenT = 0;
  if (PO.stars !== before) {
    updateSiren(PO, G);
    if (G && G.hud && G.hud.starsPulse) G.hud.starsPulse();
    if (PO.stars > before && G && G.hud && G.hud.toast && PO.stars === cap) {
      G.hud.toast('Maximum heat: every unit in the bay is on you');
    }
  } else if (PO.stars > 0) {
    updateSiren(PO, G);
  }
  return PO.stars;
}

/** Wipe the wanted level: cruisers roll off, officers stand down, siren dies. */
export function clearWanted(PO, G) {
  if (!PO) return;
  PO.stars = 0;
  PO.noSeeT = 0;
  PO.seenT = 0;
  PO.arrestT = 0;
  updateSiren(PO, G);
  releasePursuers(PO);
}

/** One officer on foot at a spot, with a navy shirt and a peaked cap. */
export function spawnOfficer(PO, W, x, z) {
  const cop = makeOfficer(PO && PO.rng, x, z);
  if (W && W.scene) W.scene.add(cop.mesh);
  if (PO && PO.foot) PO.foot.push(cop);
  return cop;
}

/** Live police cars, for the minimap. */
export function policeBlips(PO) {
  if (!PO) return [];
  return PO.cars.filter((c) => c && !c.wrecked);
}

// ---------- the step ----------

/**
 * Advance the whole law-enforcement picture for one fixed step. Order matters:
 * sight first (so the decay clock is honest), then numbers, then behaviour.
 */
export function updatePolice(PO, G, I, dt) {
  if (!PO || !G || !dt) return;
  if (G.freezePolice) return;          // demo scenes pose the force by hand
  const P = G.P;
  if (!P || !P.pos) return;

  const px = P.pos.x;
  const pz = P.pos.z;
  const playerCar = G.inCar || null;
  const onFoot = !playerCar && !P.dead;

  if (PO.roadblockT > 0) PO.roadblockT = Math.max(0, PO.roadblockT - dt);

  // Sight and decay run even at zero stars, so a fresh crime starts clean.
  tickSight(PO, G, px, pz, dt);
  tickDecay(PO, G, dt);
  syncSirenState(PO, G);

  maintainMotorPool(PO, G, px, pz);
  maintainWalkingPool(PO, G, px, pz);

  for (let i = 0; i < 4; i++) {
    const car = PO.cars[i];
    if (car) driveCruiser(PO, car, G, dt, px, pz, playerCar);
  }
  for (let i = 0; i < PO.foot.length; i++) walkOfficer(PO, PO.foot[i], G, dt, px, pz, onFoot);

  cullPersuers(PO, G, px, pz);
  tryRoadblock(PO, G, px, pz);
  checkRoadblockCleared(PO, G, px, pz);
  checkArrest(PO, G, px, pz, onFoot, dt);
}

// ---------- vision, decay, siren ----------

/** Is there a clear sight line from (ex,ez) to the player? Walls only, in 2D. */
function hasLineOfSight(W, ex, ez, px, pz) {
  if (!W || !W.colliders) return true;
  const dx = px - ex;
  const dz = pz - ez;
  const boxes = W.colliders;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.h < 2.5) continue;                       // low kerbs do not hide anybody
    const minX = b.minX;
    const maxX = b.maxX;
    const minZ = b.minZ;
    const maxZ = b.maxZ;
    let t0 = 0;
    let t1 = 1;
    // Slab test on the segment, one axis at a time.
    if (Math.abs(dx) < 1e-6) {
      if (ex < minX || ex > maxX) continue;
    } else {
      let a = (minX - ex) / dx;
      let c = (maxX - ex) / dx;
      if (a > c) { const s = a; a = c; c = s; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-6) {
      if (ez < minZ || ez > maxZ) continue;
    } else {
      let a = (minZ - ez) / dz;
      let c = (maxZ - ez) / dz;
      if (a > c) { const s = a; a = c; c = s; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
      if (t0 > t1) continue;
    }
    if (t1 - t0 > 0.02) return false;              // ran through the wall
  }
  return true;
}

/** Nearest living cop and whether it can actually see the player. */
function scanForCops(PO, px, pz) {
  const W = PO.W;
  let nearest = Infinity;
  let seen = false;
  for (let i = 0; i < PO.cars.length; i++) {
    const c = PO.cars[i];
    if (!c || c.wrecked) continue;
    const d = Math.hypot(c.x - px, c.z - pz);
    if (d < nearest) nearest = d;
    if (d > SEE_RANGE) continue;
    if (d < SEE_DIST || hasLineOfSight(W, c.x, c.z, px, pz)) { seen = true; break; }
  }
  if (!seen) {
    for (let i = 0; i < PO.foot.length; i++) {
      const o = PO.foot[i];
      if (!o || o.down) continue;
      const d = Math.hypot(o.x - px, o.z - pz);
      if (d < nearest) nearest = d;
      if (d > SEE_RANGE) continue;
      if (d < SEE_DIST || hasLineOfSight(W, o.x, o.z, px, pz)) { seen = true; break; }
    }
  }
  return { nearest, seen };
}

/** Feed the unseen clock. Any cop that sees you keeps every star in place. */
function tickSight(PO, G, px, pz, dt) {
  const res = scanForCops(PO, px, pz);
  PO.nearest = res.nearest;
  if (res.seen || PO.stars === 0) {
    PO.noSeeT = 0;
    PO.seenT += dt;
    return;
  }
  PO.noSeeT += dt;
  PO.seenT = 0;
}

/** Unseen long enough for the level you are carrying? Drop exactly one star. */
function tickDecay(PO, G, dt) {
  if (PO.stars <= 0) {
    PO.noSeeT = 0;
    if (PO.siren) updateSiren(PO, G);
    return;
  }
  const table = CONFIG.wanted.decay;
  const hold = table[PO.stars] != null ? table[PO.stars] : table[5];
  if (PO.noSeeT < hold) {
    if (PO.stars > PO.lastStars) {
      PO.lastStars = PO.stars;
      updateSiren(PO, G);
    }
    return;
  }
  PO.stars -= 1;
  PO.noSeeT = 0;
  PO.lastStars = PO.stars;
  if (G && G.hud && G.hud.toast) {
    G.hud.toast(PO.stars > 0 ? 'Heat down: ' + PO.stars + ' star' + (PO.stars > 1 ? 's' : '') : 'You lost the cops');
  }
  updateSiren(PO, G);
  if (PO.stars === 0) releasePursuers(PO);
}

/** Siren follows the star count; called from here so every path agrees. */
function updateSiren(PO, G) {
  const want = PO.stars > 0;
  PO.siren = want;
  const sound = (G && G.sound) || null;
  if (sound && sound.siren) sound.siren(want);
  for (let i = 0; i < PO.cars.length; i++) {
    const c = PO.cars[i];
    if (c && !c.wrecked) c.sirenOn = want;
  }
}

/** Every step: cruisers that appeared from outside must still get their lights on. */
function syncSirenState(PO, G) {
  const want = PO.stars > 0;
  for (let i = 0; i < PO.cars.length; i++) {
    const c = PO.cars[i];
    if (!c || c.wrecked || c.sirenOn === want) continue;
    c.sirenOn = want;
    const sound = G && G.sound;
    if (sound && sound.siren) sound.siren(want);
  }
  if (PO.siren !== want) {
    PO.siren = want;
    const sound = G && G.sound;
    if (sound && sound.siren) sound.siren(want);
  }
}

/** Zero stars: everything rolls off the field in a hurry. */
function releasePursuers(PO) {
  for (let i = 0; i < PO.cars.length; i++) retireCar(PO, PO.cars[i]);
  for (let i = 0; i < PO.foot.length; i++) retireOfficer(PO, PO.foot[i]);
  PO.cars.length = 0;
  PO.foot.length = 0;
  PO.arrestT = 0;
  removeRoadblock(PO);
}

// ---------- population ----------

function wantedCounts(PO) {
  const table = CONFIG.police.counts;
  if (!table || PO.stars <= 0) return [0, 0];
  const row = table[PO.stars] || table[5] || [0, 0];
  return row;
}

/** Keep exactly the cruisers the star level calls for. */
function maintainMotorPool(PO, G, px, pz) {
  PO.cars = PO.cars.filter((c) => c && !c.wrecked);
  const wantCars = wantedCounts(PO)[0];
  while (PO.cars.length > wantCars) {
    retireCar(PO, PO.cars.pop());
  }
  // Adopt any cruiser that arrived from outside (demo scenes, hand-placed chases):
  // it gets our fields and counts against the quota, so no second wave spawns.
  for (let i = 0; i < PO.cars.length; i++) adoptCruiser(PO.cars[i], PO);
  if (PO.cars.some((c) => c.role !== 'police')) {
    // Foreign cruisers are driven by their own code; do not add ours on top.
    return;
  }
  let tries = 0;
  while (PO.cars.length < wantCars && tries < 8) {
    tries++;
    if (!spawnCruiserNear(PO, G, px, pz)) break;
  }
}

/** Give an outside cruiser the bookkeeping our AI expects. */
function adoptCruiser(car, PO) {
  if (!car || car.role === 'police') return car;
  car.role = 'police';
  car.mode = car.mode || 'chase';
  car.ramCd = car.ramCd || 0;
  car.flashT = car.flashT || 0;
  car.bailed = !!car.bailed;
  car.sirenOn = PO.stars > 0;
  return car;
}

/** Keep as many walkers as the table asks for, allowing a couple of bail-outs. */
function maintainWalkingPool(PO, G, px, pz) {
  PO.foot = PO.foot.filter((o) => o && !o.dead);
  const wantFoot = wantedCounts(PO)[1];
  const cap = wantFoot + MAX_FOOT_SLACK;
  while (PO.foot.length > cap) {
    retireOfficer(PO, PO.foot.pop());
  }
  if (PO.foot.length >= wantFoot) return;
  // Walkers arrive from cruisers: bail the closest stopped one out.
  for (let i = 0; i < PO.cars.length && PO.foot.length < wantFoot; i++) {
    const car = PO.cars[i];
    if (!car || car.wrecked || car.bailed) continue;
    if (Math.abs(car.speed) > BAIL_SPEED) continue;
    if (Math.hypot(car.x - px, car.z - pz) > BAIL_DIST + 2) continue;
    bailOut(PO, car, G, px, pz);
  }
}

// ---------- cruisers ----------

/** Grab a road node 60-80 m out and drop a cruiser there facing the player. */
function spawnCruiserNear(PO, G, px, pz) {
  const roads = PO.W && PO.W.roads;
  if (!roads) return false;
  const nodes = roads.nodes;
  const pool = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const d = Math.hypot(n.x - px, n.z - pz);
    if (d >= SPAWN_MIN && d <= SPAWN_MAX) pool.push(n);
  }
  if (!pool.length) {
    // Nothing in the ring (corner of the map): take the closest node past 45 m.
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const d = Math.hypot(nodes[i].x - px, nodes[i].z - pz);
      if (d > 45 && d < bestD) { bestD = d; best = nodes[i]; }
    }
    if (!best) return false;
    pool.push(best);
  }
  const pick = pool[Math.floor(PO.rng.next() * pool.length) % pool.length];
  const car = spawnCruiser(PO, G, pick.x, pick.z);
  if (!car) return false;
  // Aim the nose at the player and start rolling.
  car.heading = Math.atan2(-(px - pick.x), -(pz - pick.z));
  car.speed = 6;
  car.mode = 'chase';
  syncCarMesh(car);
  PO.cars.push(car);
  return true;
}

/** One marked cruiser, harness on, lightbar live. */
function spawnCruiser(PO, G, x, z) {
  const W = PO.W;
  if (!W || !W.scene) return null;
  const car = makeCar('police', x, z, 0, C.copbody);
  car.occupant = 'npc';
  car.sirenOn = PO.stars > 0;
  car.flashT = PO.rng.next() * 2;
  car.role = 'police';
  car.mode = 'chase';
  car.ramCd = 0;
  car.bailed = false;
  car.block = false;
  car.playerOwned = false;
  W.scene.add(car.mesh);
  return car;
}

/**
 * Arcade pursuit: steer at a lead point on the player's own trajectory, full
 * throttle whenever there is open road, brake only for a sharp turn.
 */
function driveCruiser(PO, car, G, dt, px, pz, playerCar) {
  if (!car || car.wrecked) return;
  car.sirenOn = PO.stars > 0;
  car.flashT = (car.flashT || 0) + dt;
  flashBars(car);
  car.ramCd = Math.max(0, (car.ramCd || 0) - dt);

  // A parked roadblock car just waits, lightbar going.
  if (car.block) {
    car.speed = 0;
    updateCarDrive(car, 0, 0, 1, dt, PO.W, G);
    return;
  }

  const dist = Math.hypot(px - car.x, pz - car.z);

  // Where the player will be in three seconds: a straight-line lead from their
  // heading, shrunk when we are close so the cruiser does not overshoot.
  let tx = px;
  let tz = pz;
  const lead = Math.min(LEAD_CLOSE, dist / 10) * 3;
  if (playerCar) {
    tx += -Math.sin(playerCar.heading) * playerCar.speed * lead;
    tz += -Math.cos(playerCar.heading) * playerCar.speed * lead;
  } else {
    const step = -Math.sin(PO.relYaw || 0) * lead;
    tx += step;
  }

  const want = Math.atan2(-(tx - car.x), -(tz - car.z));
  const turn = wrapAngle(want - car.heading);

  // Steering: full lock when the angle is wide, gentle when lined up.
  const steer = Math.max(-1, Math.min(1, turn * 1.8));
  const speed = Math.abs(car.speed);

  // Slow down for turns and for a player who is station-keeping close by.
  let throttle = 1;
  let brake = 0;
  if (Math.abs(turn) > 1.5 && speed > 9) brake = 1;
  if (dist < 7 && speed > 12) brake = 1;
  if (dist < 4) throttle = 0;

  // Reverse out of a wall or a tangle: nose-blocked and pointed badly.
  if (dist > 12 && speed < 1.5 && Math.abs(turn) > 1.9) {
    updateCarDrive(car, -1, -steer, 0, dt, PO.W, G);
  } else {
    updateCarDrive(car, throttle, steer, brake, dt, PO.W, G);
  }

  // Bail out once we are stopped and the player is right there on foot.
  if (!playerCar && !car.bailed && speed < BAIL_SPEED && dist < BAIL_DIST) {
    bailOut(PO, car, G, px, pz);
  }

  if (playerCar) ramPlayerCar(PO, car, G, playerCar, dist);
}

/** Contact between a cruiser and the player's car: damage plus a shove. */
function ramPlayerCar(PO, car, G, playerCar, dist) {
  const gap = dist - (car.radius || 1.4) - (playerCar.radius || 1.4);
  if (gap > 0.9) return;
  const closing = Math.abs(car.speed) + Math.abs(playerCar.speed);
  if (closing < RAM_SPEED) return;
  if ((car.ramCd || 0) > 0) return;
  car.ramCd = 0.9;

  playerCar.hp -= RAM_DAMAGE;
  // Knock: both cars part ways, the player is shoved ahead of the cruiser.
  const nx = (playerCar.x - car.x) / Math.max(0.01, dist);
  const nz = (playerCar.z - car.z) / Math.max(0.01, dist);
  const moved = resolveMove(PO.W, playerCar.x, playerCar.z, playerCar.radius, nx * 2.2, nz * 2.2);
  playerCar.x = moved.x;
  playerCar.z = moved.z;
  playerCar.speed *= 0.7;
  syncCarMesh(playerCar);
  car.speed *= 0.6;

  const fx = G.effects || (G.W && G.W.fx);
  if (fx && fx.spark) fx.spark({ x: playerCar.x, y: 0.9, z: playerCar.z });
  if (G.sound && G.sound.crash) G.sound.crash(0.8);
  if (G.sound && G.sound.siren) G.sound.siren(true);
  if (playerCar.hp <= 0) {
    playerCar.hp = 0;
    if (G.onCarExplode && !playerCar.exploded) {
      playerCar.exploded = true;
      G.onCarExplode(playerCar);
    }
  }
}

/** Two emissive boxes alternating red and blue while the siren is on. */
function flashBars(car) {
  const bars = car.mesh && car.mesh.userData && car.mesh.userData.bars;
  if (!bars) return;
  const live = car.sirenOn && !car.wrecked;
  const phase = Math.floor((car.flashT || 0) * FLASH_HZ) % 2;
  bars.red.material.color.setHex(live && phase === 0 ? C.barRed : 0x552022);
  bars.blue.material.color.setHex(live && phase === 1 ? C.barBlue : 0x14204a);
  bars.lit = live ? (phase === 0 ? 'red' : 'blue') : 'off';
}

// ---------- officers on foot ----------

/** A small uniformed walker: navy shirt, dark trousers, cap, pistol arm. */
function makeOfficer(rng, x, z) {
  const r = rng || { next: () => 0.5, range: (a, b) => (a + b) / 2, pick: (a) => a[0] };
  const g = new THREE.Group();
  g.name = 'officer';

  const box = (w, h, d, hex, px, py, pz, opts) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex, opts));
    m.position.set(px, py, pz);
    m.castShadow = true;
    return m;
  };

  g.add(box(0.52, 0.66, 0.3, 0x263a5c, 0, 1.02, 0));
  g.add(box(0.56, 0.12, 0.32, C.coptrim, 0, 1.34, 0, FLAT));   // shoulder band
  g.add(box(0.1, 0.1, 0.1, 0xffd24a, 0.16, 1.2, -0.17, FLAT)); // badge glint
  g.add(box(0.46, 0.34, 0.28, 0x1f2530, 0, 0.52, 0));          // trousers
  g.add(box(0.5, 0.52, 0.28, 0x263a5c, 0, 1.42, 0.0));          // chest height fix

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.28), material(r.pick(C.skin)));
  head.position.set(0, 1.78, 0);
  head.castShadow = true;
  g.add(head);
  g.add(box(0.34, 0.1, 0.34, C.coptrim, 0, 1.94, -0.02, FLAT)); // peaked cap
  g.add(box(0.3, 0.04, 0.16, 0x101820, 0, 1.89, -0.18, FLAT));  // brim

  const legL = box(0.17, 0.5, 0.18, 0x1f2530, -0.13, 0.26, 0);
  const legR = box(0.17, 0.5, 0.18, 0x1f2530, 0.13, 0.26, 0);
  const armL = box(0.14, 0.46, 0.15, 0x263a5c, -0.32, 1.12, 0);
  const armR = box(0.14, 0.46, 0.15, 0x263a5c, 0.32, 1.12, 0);
  // Sidearm held out on the right arm, a stubby dark block.
  const gun = box(0.08, 0.08, 0.26, 0x14171c, 0.32, 0.92, -0.18, FLAT);
  g.add(legL, legR, armL, armR, gun);

  g.position.set(x, 0, z);
  const cop = {
    mesh: g,
    x,
    z,
    // Demo/pose hooks: `pos` mirrors x/z and accepts .set like a free-floating point.
    pos: makeCopPoint(),
    state: 'run',
    fireT: 0,
    downT: 0,
    hp: CONFIG.police.foot.hp,
    yaw: 0,
    runT: 0,
    cool: (rng ? rng.next() : 0.5) * CONFIG.police.foot.fireEvery,
    strafe: rng && rng.chance ? (rng.chance(0.5) ? 1 : -1) : 1,
    strafeT: 0,
    down: false,
    dead: false,
    limbs: { legL, legR, armL, armR, gun },
  };
  cop.pos.bind(cop);
  return cop;
}

/** A point that writes through to its officer, so external poses stay in sync. */
function makeCopPoint() {
  let owner = null;
  return {
    x: 0,
    z: 0,
    bind(o) { owner = o; this.x = o.x; this.z = o.z; },
    set(x, _y, z) {
      this.x = x;
      this.z = z == null ? x : z;
      if (owner) { owner.x = this.x; owner.z = this.z; }
      return this;
    },
  };
}

/** Run at the player, settle into the 8-14 m band, and fire on a clock. */
function walkOfficer(PO, o, G, dt, px, pz, onFoot) {
  if (!o) return;
  // A posed corpse from a demo scene: lie there, no AI.
  if (o.state === 'down' || o.down || o.dead) {
    o.down = true;
    o.downT = (o.downT || 0) + dt;
    if (o.downT > 25) { o.dead = true; }
    return;
  }
  const foot = CONFIG.police.foot;
  const dx = px - o.x;
  const dz = pz - o.z;
  const dist = Math.hypot(dx, dz) || 0.001;
  const nx = dx / dist;
  const nz = dz / dist;

  // Face the player, always.
  const wantYaw = Math.atan2(-nx, -nz);
  o.yaw = wrapAngle(o.yaw + wrapAngle(wantYaw - o.yaw) * Math.min(1, dt * 8));

  let mx = 0;
  let mz = 0;
  if (dist > COMFORT_FAR) {
    mx = nx * foot.run;
    mz = nz * foot.run;
  } else if (dist < COMFORT_NEAR) {
    mx = -nx * foot.run * 0.75;
    mz = -nz * foot.run * 0.75;
  } else {
    // In the band: circle a little so a crowd of officers does not stack up.
    o.strafeT = (o.strafeT || 0) + dt;
    if (o.strafeT > 2.4) { o.strafeT = 0; o.strafe *= -1; }
    mx = -nz * foot.run * 0.45 * o.strafe;
    mz = nx * foot.run * 0.45 * o.strafe;
  }

  if (mx || mz) {
    const moved = resolveMove(PO.W, o.x, o.z, 0.42, mx * dt, mz * dt);
    o.x = moved.x;
    o.z = moved.z;
    if (moved.hit) {
      // Slide along the wall a touch so cover does not freeze the pursuit.
      const side = resolveMove(PO.W, o.x, o.z, 0.42, -nz * foot.run * 0.6 * dt, nx * foot.run * 0.6 * dt);
      o.x = side.x;
      o.z = side.z;
    }
  }

  o.runT += dt * (mx || mz ? 9 : 1.5);
  const swing = Math.sin(o.runT) * 0.6;
  o.limbs.legL.rotation.x = swing;
  o.limbs.legR.rotation.x = -swing;
  o.limbs.armL.rotation.x = -swing * 0.7;
  o.limbs.armR.rotation.x = swing * 0.35 - 0.9;       // arm up, aiming

  o.mesh.position.set(o.x, Math.abs(Math.sin(o.runT * 2)) * 0.04, o.z);
  o.mesh.rotation.y = o.yaw;
  o.pos.x = o.x;
  o.pos.z = o.z;
  o.state = 'run';

  // Fire only with a clear line, inside pistol range, and not while chasing far off.
  o.cool -= dt;
  o.fireT = Math.max(0, (o.fireT || 0) - dt);
  const inRange = dist <= foot.range;
  if (o.cool <= 0 && inRange && hasLineOfSight(PO.W, o.x, o.z, px, pz)) {
    o.cool = foot.fireEvery * (0.85 + (PO.rng.next() * 0.3));
    fireAtPlayer(PO, o, G, px, pz);
  }
}

/** Tracer out of the officer's hand, then 8-12 damage on the player. */
function fireAtPlayer(PO, o, G, px, pz) {
  const foot = CONFIG.police.foot;
  const fx = G.effects || (G.W && G.W.fx);
  const from = { x: o.x, y: 1.35, z: o.z };
  const to = { x: px, y: 1.15, z: pz };
  if (fx && fx.tracer) fx.tracer(from, to);
  if (fx && fx.muzzle) fx.muzzle({ x: o.x, y: 1.3, z: o.z }, o.yaw, 0.3);
  if (G.sound && G.sound.shot) G.sound.shot(false);

  const span = foot.dmgMax - foot.dmgMin;
  const dmg = foot.dmgMin + Math.floor(PO.rng.next() * (span + 1));
  if (G.damagePlayer) G.damagePlayer(dmg);
  if (G.hud && G.hud.hurt) G.hud.hurt();
}

/** A cruiser unloads: an officer appears at the driver's door. */
function bailOut(PO, car, G, px, pz) {
  if (!car || car.bailed) return;
  const wantFoot = wantedCounts(PO)[1];
  if (PO.foot.length >= wantFoot + MAX_FOOT_SLACK) return;
  car.bailed = true;
  // Driver's door: left side of the body, then step a little toward the player.
  const doorX = car.x + Math.cos(car.heading) * 2.0;
  const doorZ = car.z - Math.sin(car.heading) * 2.0;
  const d = Math.hypot(px - doorX, pz - doorZ) || 1;
  const cop = spawnOfficer(PO, PO.W, doorX + ((px - doorX) / d) * 1.2, doorZ + ((pz - doorZ) / d) * 1.2);
  cop.yaw = Math.atan2(-(px - cop.x), -(pz - cop.z));
  cop.cool = 0.5;
  if (G && G.sound && G.sound.siren) G.sound.siren(true);
  if (G && G.hud && G.hud.toast && Math.random() < 0.35) G.hud.toast('Officers on foot');
}

/**
 * Player bullets land here. An officer folds at zero health, lies down for a
 * few seconds and is swept up by the pool filter. Returns {killed, hp}.
 */
export function hurtCop(cop, amount, G) {
  if (!cop || cop.down) return { killed: false, hp: cop ? cop.hp : 0 };
  cop.hp -= Math.max(0, amount || 0);
  if (cop.hp > 0) return { killed: false, hp: cop.hp };

  cop.hp = 0;
  cop.down = true;
  cop.dead = true;
  if (cop.mesh) {
    cop.mesh.rotation.z = Math.PI / 2;
    cop.mesh.position.y = 0.18;
  }
  const fx = G && (G.effects || (G.W && G.W.fx));
  if (fx && fx.smoke) fx.smoke({ x: cop.x, y: 0.6, z: cop.z });
  if (G && G.onCopDown) G.onCopDown(cop);
  return { killed: true, hp: 0 };
}

/** Put a hittable mesh on a P raycast-free path: distance from a point to a cop. */
export function copDistance(cop, x, z) {
  if (!cop) return Infinity;
  return Math.hypot(cop.x - x, cop.z - z);
}

/** Downed officers are recycled by their own timer, or removed on a star wipe. */
function retireOfficer(PO, o) {
  if (!o) return;
  if (o.mesh && o.mesh.parent) o.mesh.parent.remove(o.mesh);
  o.dead = true;
}

function retireCar(PO, car) {
  if (!car) return;
  car.sirenOn = false;
  if (car.mesh && car.mesh.parent) car.mesh.parent.remove(car.mesh);
  const i = PO.cars.indexOf(car);
  if (i >= 0) PO.cars.splice(i, 1);
}

// ---------- roadblocks ----------

/** Four stars and up: drop two parked cruisers across the road ahead. */
function tryRoadblock(PO, G, px, pz) {
  if (PO.stars < 4) { if (PO.roadblock) removeRoadblock(PO); return; }
  if (PO.roadblockT > 0) return;
  const player = G.inCar;
  const heading = player ? player.heading : (G.P.yaw || G.W.yaw || 0);
  const hx = -Math.sin(heading);
  const hz = -Math.cos(heading);

  // Straight ahead, then snapped sideways onto the nearest avenue.
  const rawX = px + hx * ROADBLOCK_AHEAD;
  const rawZ = pz + hz * ROADBLOCK_AHEAD;
  let ax = rawX;
  let az = rawZ;
  const roads = PO.W && PO.W.roads;
  if (roads && roads.coords) {
    let bx = roads.coords[0];
    let bz = roads.coords[0];
    for (let i = 0; i < roads.coords.length; i++) {
      const s = roads.coords[i];
      if (Math.abs(rawX - s) < Math.abs(rawX - bx)) bx = s;
      if (Math.abs(rawZ - s) < Math.abs(rawZ - bz)) bz = s;
    }
    ax = bx;
    az = bz;
  }
  const half = CONFIG.world.half;
  if (Math.abs(ax) >= half || Math.abs(az) >= half) return;

  // Two cruisers nose-to-nose across the avenue, leaving a narrow gap.
  const across = heading + Math.PI / 2;
  const gap = 3.4;
  const carA = spawnCruiser(PO, G, ax - Math.cos(across) * gap, az + Math.sin(across) * gap);
  const carB = spawnCruiser(PO, G, ax + Math.cos(across) * gap, az - Math.sin(across) * gap);
  if (!carA || !carB) return;
  carA.heading = across;
  carB.heading = across + Math.PI;
  carA.speed = 0;
  carB.speed = 0;
  carA.block = true;
  carB.block = true;
  carA.bailed = true;
  carB.bailed = true;
  carA.sirenOn = true;
  carB.sirenOn = true;
  syncCarMesh(carA);
  syncCarMesh(carB);

  PO.cars.push(carA, carB);
  PO.roadblock = { x: ax, z: az, cars: [carA, carB] };
  PO.roadblockT = ROADBLOCK_EVERY;

  // A couple of officers behind the barricade, guns out.
  const back = { x: Math.sin(heading), z: Math.cos(heading) };
  for (const side of [-1, 1]) {
    const o = spawnOfficer(PO, PO.W, ax + back.x * 3 + Math.cos(across) * gap * 1.4 * side, az + back.z * 3 - Math.sin(across) * gap * 1.4 * side);
    o.yaw = Math.atan2(hx, hz) + Math.PI;
  }
  if (G.hud && G.hud.toast) G.hud.toast('Roadblock ahead');
}

/** Past the barricade by 30 m? Tear it down so it is not litter. */
function checkRoadblockCleared(PO, G, px, pz) {
  const rb = PO.roadblock;
  if (!rb) return;
  const d = Math.hypot(px - rb.x, pz - rb.z);
  if (d < ROADBLOCK_CLEAR) return;
  // Only once the player is beyond it, not merely far away.
  const player = G.inCar;
  const heading = player ? player.heading : (G.P.yaw || 0);
  const hx = -Math.sin(heading);
  const hz = -Math.cos(heading);
  const along = (px - rb.x) * hx + (pz - rb.z) * hz;
  if (along > 0 || d > 90) removeRoadblock(PO);
}

function removeRoadblock(PO) {
  if (!PO.roadblock) return;
  for (const car of PO.roadblock.cars) retireCar(PO, car);
  const keep = PO.foot.filter((o) => o && Math.hypot(o.x - PO.roadblock.x, o.z - PO.roadblock.z) > 8);
  for (let i = 0; i < PO.foot.length; i++) {
    const o = PO.foot[i];
    if (keep.indexOf(o) < 0) retireOfficer(PO, o);
  }
  PO.foot = keep;
  PO.roadblock = null;
}

// ---------- arrest ----------

/** Cuffed: on foot, bleeding, and an officer is within arm's reach. */
function checkArrest(PO, G, px, pz, onFoot, dt) {
  if (!onFoot || !G.P || PO.stars <= 0) { PO.arrestT = 0; return; }
  const foot = CONFIG.police.foot;
  let close = false;
  for (let i = 0; i < PO.foot.length; i++) {
    const o = PO.foot[i];
    if (!o || o.down) continue;
    if (Math.hypot(o.x - px, o.z - pz) <= foot.arrestDist) { close = true; break; }
  }
  if (!close) {
    // A cruiser door also counts as an arrest.
    for (let i = 0; i < PO.cars.length; i++) {
      const c = PO.cars[i];
      if (c && !c.wrecked && Math.abs(c.speed) < 2 && Math.hypot(c.x - px, c.z - pz) <= foot.arrestDist) { close = true; break; }
    }
  }
  if (!close) { PO.arrestT = 0; return; }

  if (G.P.hp <= foot.arrestHpBelow) {
    PO.arrestT += dt;
    if (PO.arrestT >= CHARGE_TIME) {
      PO.arrestT = 0;
      if (G.bust) G.bust();
    }
  }
}

// ---------- housekeeping ----------

/** Drop anything that has wandered out of the story or off the map. */
function cullPersuers(PO, G, px, pz) {
  const half = CONFIG.world.half;
  for (let i = PO.cars.length - 1; i >= 0; i--) {
    const c = PO.cars[i];
    if (!c) { PO.cars.splice(i, 1); continue; }
    if (c.wrecked) { continue; }
    const d = Math.hypot(c.x - px, c.z - pz);
    if (d > DESPAWN_DIST && !c.block) PO.cars.splice(i, 1);
  }
  for (let i = PO.foot.length - 1; i >= 0; i--) {
    const o = PO.foot[i];
    if (!o) { PO.foot.splice(i, 1); continue; }
    if (o.dead) { PO.foot.splice(i, 1); continue; }
    if (Math.abs(o.x) > half + 6 || Math.abs(o.z) > half + 6) retireOfficer(PO, o);
  }
}

/** Smallest signed angle between two yaws. */
function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

