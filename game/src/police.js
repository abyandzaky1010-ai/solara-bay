// One job: the heat. Wanted stars, the patrol cars that hunt you, the uniformed
// officers who bail out and shoot, roadblocks, and the moment the cuffs close.
// Everything here reads G (player, cars, city, sound, callbacks) and writes only
// the police state object PO plus its own meshes on the scene.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { makeCar, updateCarDrive, seatPoints, wreckCar } from './car.js';
import { resolveMove, isOnRoad, snapToLane } from './world.js';
import { damagePlayer } from './player.js';

const WANT = CONFIG.wanted;
const COP = CONFIG.police;
const FOOT = COP.foot;
const CHASE = COP.carChase;
const BLOCK = COP.roadblock;
const MAX_STARS = 5;

const CAR_LIMIT = 6;         // a hard ceiling so a long chase cannot flood the city
const FOOT_LIMIT = 6;
const COP_BODY_R = 0.45;
const COP_DAYLIGHT = WANT.unseenDist;
const HEARING = 12;          // always spotted inside this radius, sight lines or not
const LOS_STEP = 3;          // metres between sight samples
const STRAFE_SPAN = 12;      // radius of the intercept point around the player
const HOLD_FAR = 14;         // officers stop running once inside this belt
const HOLD_NEAR = 8;
const RAM_DAMAGE = 10;
const KNOCK_SIDE = 2.6;
const KNOCK_DRIVE = 0.4;
const FLASH_HALF = 1 / 6;    // lightbar flips twice a second
const LIGHT_HEIGHT = 2.1;
const BLOCK_GONE = 30;       // roadblock is dropped once the player is 30 m past it
const CLOSE_CAR = 6;         // a stopped cruiser this near lets its crew out
const CREW_STOPPED = 1.5;
const COPS_PER_CRUISE = 2;
const SKIN_FALLBACK = 0xd9a066;
const BLOCK_SLOT = 3.4;      // how far apart the two roadblock hulls sit
const BLAZE = { red: 0xff5a4a, blue: 0x5f92ff };

// ------------------------------------------------------------------ helpers

function near(ax, az, bx, bz, r) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz <= r * r;
}

function away(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

// The body the cops chase: the car when the player is driving, else the runner.
function chasedSpot(G) {
  if (G.inCar) return { x: G.inCar.x, z: G.inCar.z, inCar: true };
  const P = G.P;
  if (P && P.pos) return { x: P.pos.x, z: P.pos.z, inCar: false };
  return { x: 0, z: 0, inCar: false };
}

// Where the player will be in a moment: a straight lead along the current
// velocity, so a cruiser aims at the road ahead instead of the bumper.
function aimPoint(G) {
  const now = chasedSpot(G);
  const vel = G.inCar ? G.inCar.speed : (G.P ? G.P.speed : 0);
  const yaw = G.inCar ? G.inCar.heading : (G.P ? G.P.yaw : 0);
  const px = now.x + Math.sin(yaw) * vel * CHASE.lead;
  const pz = now.z + Math.cos(yaw) * vel * CHASE.lead;
  // At close quarters the lead would overshoot: blend back to the real spot.
  const gap = away(now.x, now.z, px, pz);
  if (gap > STRAFE_SPAN) {
    const k = STRAFE_SPAN / gap;
    return { x: now.x + (px - now.x) * k, z: now.z + (pz - now.z) * k };
  }
  return { x: px, z: pz };
}

// Can an officer at (x,z) see the player? Close enough is always seen; farther
// out the sight line is marched through the collider boxes.
function lineOfSight(W, fromX, fromZ, toX, toZ) {
  const span = away(fromX, fromZ, toX, toZ);
  if (span <= HEARING) return true;
  const dx = (toX - fromX) / span;
  const dz = (toZ - fromZ) / span;
  const boxes = (W && W.colliders) || [];
  for (let d = LOS_STEP; d < span - 1; d += LOS_STEP) {
    const x = fromX + dx * d;
    const z = fromZ + dz * d;
    for (let i = 0; i < boxes.length; i += 1) {
      const b = boxes[i];
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && (b.h || 0) > 1.6) return false;
    }
  }
  return true;
}

function ringForStars(stars) {
  return COP.counts[Math.max(1, Math.min(MAX_STARS, stars))] || COP.counts[1];
}

// ------------------------------------------------------------ car spawning

// A road edge with both ends in the 60-80 m ring around the player, ordered so
// the car starts at the far end and drives in toward them.
function approachEdge(W, rng, px, pz) {
  const nodes = (W && W.roads && W.roads.nodes) || [];
  const cx = px + (rng.next() - 0.5) * 30;
  const cz = pz + (rng.next() - 0.5) * 30;

  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    for (const j of a.neighbors) {
      if (j < i) continue;
      const b = nodes[j];
      const d = away((a.x + b.x) / 2, (a.z + b.z) / 2, cx, cz);
      if (d >= CHASE.spawnMin && d <= CHASE.spawnMax && d < bestScore) {
        bestScore = d;
        best = [i, j];
      }
    }
  }

  if (!best) {
    const clear = [];
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i];
      for (const j of a.neighbors) {
        if (j < i) continue;
        const b = nodes[j];
        const line = snapToLane(W, (a.x + b.x) / 2, (a.z + b.z) / 2);
        const d = away(line.x, line.z, px, pz);
        if (d >= CHASE.spawnMin && d <= CHASE.spawnMax) clear.push([i, j]);
      }
    }
    if (!clear.length) return null;
    best = clear[rng.int(0, clear.length - 1)];
  }

  const [i, j] = best;
  const da = away(nodes[i].x, nodes[i].z, px, pz);
  const db = away(nodes[j].x, nodes[j].z, px, pz);
  return da > db ? { from: i, to: j } : { from: j, to: i };
}

function freshCopCar(W, rng) {
  const car = makeCar('police', 0, 0, 0, C.copbody);
  Object.assign(car, { occupant: 'police', sirenOn: true, chase: true, crew: COPS_PER_CRUISE, rng });
  W.scene.add(car.mesh);
  return car;
}

// Drop one cruiser in at the head of an approach edge, nose pointed at the
// player's intercept and throttle already down.
function launchCopCar(PO, G, W, rng) {
  const here = chasedSpot(G);
  const edge = approachEdge(W, rng, here.x, here.z);
  if (!edge) return null;

  const car = freshCopCar(W, rng);
  const startNode = W.roads.nodes[edge.from];
  const lane = snapToLane(W, startNode.x, startNode.z);
  car.x = lane.x + (rng.next() - 0.5) * 1.2;
  car.z = lane.z + (rng.next() - 0.5) * 1.2;

  const aim = aimPoint(G);
  car.heading = Math.atan2(aim.x - car.x, aim.z - car.z);
  car.speed = CONFIG.car.kinds.police.max * 0.28;
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  PO.cars.push(car);
  return car;
}

// ------------------------------------------------------------ foot cops

function unit(w, h, d, hex) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex));
  m.castShadow = true;
  return m;
}

// Small uniformed walker: navy shirt and cap, grey trousers, a bare head with a
// visor, two legs that swing from the hip. Root origin sits on the pavement.
function buildOfficer(rng) {
  const root = new THREE.Group();
  const skin = C.skin[rng.int(0, C.skin.length - 1)] || SKIN_FALLBACK;
  const navy = C.coptrim;

  const legs = [-1, 1].map((side) => {
    const leg = unit(0.2, 0.72, 0.22, 0x4b5563);
    leg.position.set(side * 0.13, 0.36, 0);
    leg.geometry.translate(0, -0.36, 0);
    leg.position.y = 0.72;
    root.add(leg);
    return leg;
  });

  const torso = new THREE.Group();
  root.add(torso);
  torso.add(unit(0.52, 0.62, 0.32, navy)).position.y = 1.04;
  const badge = unit(0.1, 0.1, 0.04, C.beacon);
  badge.position.set(-0.13, 1.16, 0.17);
  torso.add(badge);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), material(skin));
  head.position.y = 1.51;
  head.castShadow = true;
  torso.add(head);
  const cap = unit(0.32, 0.1, 0.32, navy);
  cap.position.y = 1.66;
  torso.add(cap);
  const visor = unit(0.3, 0.04, 0.16, 0x1f2733);
  visor.position.set(0, 1.62, 0.2);
  torso.add(visor);

  const arms = [-1, 1].map((side) => {
    const arm = unit(0.14, 0.56, 0.15, navy);
    arm.geometry.translate(0, -0.28, 0);
    arm.position.set(side * 0.34, 1.3, 0);
    torso.add(arm);
    return arm;
  });
  const gun = unit(0.07, 0.09, 0.3, 0x23272c);
  gun.position.set(0, -0.56, 0.16);
  arms[1].add(gun);

  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.32, 10),
    new THREE.MeshBasicMaterial({ color: 0x2c2a26, transparent: true, opacity: 0.2, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.04;
  root.add(blob);

  return { root, torso, armL: arms[0], armR: arms[1], legs };
}

function officerAt(W, rng, x, z, yaw) {
  const rig = buildOfficer(rng);
  rig.root.position.set(x, 0, z);
  rig.root.rotation.y = yaw;
  W.scene.add(rig.root);
  return {
    mesh: rig.root,
    rig,
    pos: { x, z },
    x,
    z,
    yaw,
    hp: FOOT.hp,
    dead: false,
    cool: rng.range(0.2, FOOT.fireEvery),
    swing: rng.angle(),
    gait: 0,
    strafe: rng.chance(0.5) ? 1 : -1,
    strafeT: rng.range(1.4, 3.2),
    from: null,
  };
}

// The driver's door of a cruiser standing still beside the player: one officer
// steps out and joins the fight.
function bailOut(PO, G, W, rng, car) {
  if (car.crew <= 0 || car.wrecked) return null;
  const door = seatPoints(car);
  const rig = officerAt(W, rng, door.x, door.z, car.heading);
  rig.from = car;
  car.crew -= 1;
  PO.foot.push(rig);
  if (G.sound && G.sound.door) G.sound.door();
  return rig;
}

// ---------------------------------------------------------------- the PO

export function initPolice(W, city, rng) {
  return {
    stars: 0,
    noSeeT: 0,
    seenT: 0,
    cars: [],
    foot: [],
    roadblock: null,
    roadblockT: 0,
    clock: 0,
    rng: rng || null,
    city: city || null,
    W: W || null,
    table: [0, 0],
  };
}

export function addStars(PO, n, G) {
  if (!PO || !(n > 0)) return PO ? PO.stars : 0;
  PO.noSeeT = 0;
  PO.seenT = 0;
  PO.stars = Math.min(MAX_STARS, (PO.stars || 0) + Math.round(n));
  if (G && G.sound && G.sound.siren) G.sound.siren(true);
  return PO.stars;
}

export function wantedDecay(PO) {
  return PO && PO.stars > 0 ? WANT.decay[PO.stars] || 0 : 0;
}

// ------------------------------------------------------- star bookkeeping

function clearStars(PO, G) {
  if (PO.stars !== 0) PO.stars = 0;
  PO.noSeeT = 0;
  if (G.sound && G.sound.siren) G.sound.siren(false);
}

// One star falls at a time; the same cop walks back into sight and the clock
// sits at zero until they break the line again.
function tickWanted(PO, G, dt) {
  if (PO.stars <= 0) {
    PO.noSeeT = 0;
    return;
  }
  const here = chasedSpot(G);
  const watch = WANT.unseenDist;
  let spotted = false;
  // Only officers in the 40 m net count: a cruiser across the city is not a
  // witness. Inside that net a clear sight line (or 12 m of pure hearing) holds
  // the heat on.
  for (const car of PO.cars) {
    if (car.wrecked) continue;
    if (away(car.x, car.z, here.x, here.z) > watch) continue;
    if (lineOfSight(G.W, car.x, car.z, here.x, here.z)) { spotted = true; break; }
  }
  if (!spotted) {
    for (const cop of PO.foot) {
      if (cop.dead) continue;
      if (away(cop.pos.x, cop.pos.z, here.x, here.z) > watch) continue;
      if (lineOfSight(G.W, cop.pos.x, cop.pos.z, here.x, here.z)) { spotted = true; break; }
    }
  }

  if (spotted) {
    PO.seenT += dt;
    if (PO.seenT > 0.4) PO.noSeeT = 0;
    return;
  }

  PO.noSeeT += dt;
  const window = WANT.decay[PO.stars] || 0;
  if (PO.noSeeT >= window) {
    PO.noSeeT = 0;
    PO.stars -= 1;
    if (PO.stars <= 0) {
      clearStars(PO, G);
      if (G.toast) G.toast('Heat off');
    } else if (G.toast) {
      G.toast(PO.stars + '');
    }
  }
}

// ------------------------------------------------------------ fleet tables

function keepCars(PO, G, W, want) {
  while (PO.cars.length < want && PO.cars.length < CAR_LIMIT) {
    if (!launchCopCar(PO, G, W, PO.rng)) break;
  }
  for (let i = PO.cars.length - 1; i >= 0 && PO.cars.length > want; i -= 1) {
    const car = PO.cars[i];
    if (car.player || car.occupant === 'player') continue;
    // Keep the two hulls holding a roadblock until the block itself is dropped.
    if (car.blocked) continue;
    if (car.mesh && car.mesh.parent) car.mesh.parent.remove(car.mesh);
    PO.cars.splice(i, 1);
  }
}

function keepFoot(PO, G, want) {
  for (let i = PO.foot.length - 1; i >= 0 && PO.foot.length > want; i -= 1) {
    const cop = PO.foot[i];
    if (cop.mesh && cop.mesh.parent) cop.mesh.parent.remove(cop.mesh);
    PO.foot.splice(i, 1);
  }
}

function retireCop(PO, cop) {
  if (cop.mesh && cop.mesh.parent) cop.mesh.parent.remove(cop.mesh);
  const at = PO.foot.indexOf(cop);
  if (at >= 0) PO.foot.splice(at, 1);
}

// --------------------------------------------------------------- cop cars

// Arcade drive one frame: full throttle at an intercept point, steering from
// the heading error, handbrake when the target sits behind the nose.
function driveCopCar(car, G, W, dt) {
  const aim = aimPoint(G);
  const want = Math.atan2(aim.x - car.x, aim.z - car.z);
  let turn = want - car.heading;
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;

  const steer = Math.max(-1, Math.min(1, turn * 2.1));
  const behind = Math.abs(turn) > 1.9 && Math.abs(car.speed) < 5;
  const throttle = behind ? -0.55 : 1;

  updateCarDrive(car, throttle, steer, false, dt, W, G);

  // A cruiser that tried to drive through a wall is nudged back onto the tarmac.
  if (!isOnRoad(W, car.x, car.z)) {
    const lane = snapToLane(W, car.x, car.z);
    const back = away(car.x, car.z, lane.x, lane.z);
    if (back > 9) {
      car.x = lane.x;
      car.z = lane.z;
      car.speed *= 0.5;
    }
  }
}

// Rear-ending whoever is on the road: damage plus a shove, once per contact.
function ramTarget(car, G) {
  const target = G.inCar;
  if (!target || target === car || car.wrecked) return;
  const strike = Math.abs(car.speed);
  if (strike < CHASE.ram) return;
  const gap = away(car.x, car.z, target.x, target.z);
  if (gap > car.radius + target.radius + 0.9) return;

  target.hp = Math.max(0, target.hp - RAM_DAMAGE);
  const shove = Math.atan2(target.x - car.x, target.z - car.z);
  const nx = target.x + Math.sin(shove) * KNOCK_SIDE;
  const nz = target.z + Math.cos(shove) * KNOCK_SIDE;
  const pushed = resolveMove(G.W, target.x, target.z, target.radius, nx - target.x, nz - target.z);
  target.x = pushed.x;
  target.z = pushed.z;
  target.heading += (shove - target.heading) * KNOCK_DRIVE;
  if (G.P) G.P.pos.set(target.x, 0, target.z);
  target.speed *= 0.7;
  car.speed *= 0.55;

  if (G.effects && G.effects.spawnSpark) G.effects.spawnSpark({ x: (car.x + target.x) / 2, y: 1, z: (car.z + target.z) / 2 });
  if (G.sound && G.sound.crash) G.sound.crash(0.9);
  if (target.hp <= 0) wreckCar(target, G);
}

// Struck-with-a-baton patrol car: doors open and the crew runs out.
function callOutCrew(PO, G, W, rng, car) {
  if (!(car.speed < CREW_STOPPED)) return;
  if (G.inCar) return;
  const here = PO.foot.length;
  if (here >= FOOT_LIMIT || here >= ringForStars(PO.stars)[1] + 1) return;
  if (!near(car.x, car.z, G.P.pos.x, G.P.pos.z, CLOSE_CAR)) return;
  bailOut(PO, G, W, rng, car);
}

function handleCruiser(PO, G, W, rng, car, dt) {
  if (car.wrecked) {
    car.speed = 0;
    return;
  }
  if (car.occupant === 'player' || car.player) return;
  if (car.blocked) return; // parked across the road, lights doing the work

  driveCopCar(car, G, W, dt);
  ramTarget(car, G);
  callOutCrew(PO, G, W, rng, car);
}

// --------------------------------------------------------------- foot AI

// One officer: run at the runner, hold 8-14 m, sidestep, and fire on a beat.
function officerStep(PO, G, cop, dt) {
  const W = G.W;
  const P = G.P;
  if (cop.dead) {
    cop.rig.root.rotation.z = Math.PI / 2;
    return;
  }

  const gap = away(cop.pos.x, cop.pos.z, P.pos.x, P.pos.z);
  const face = Math.atan2(P.pos.x - cop.pos.x, P.pos.z - cop.pos.z);
  let vx = 0;
  let vz = 0;

  if (gap > STRAFE_SPAN) {
    vx = Math.sin(face) * FOOT.run;
    vz = Math.cos(face) * FOOT.run;
  } else if (gap > HOLD_NEAR) {
    // Between 8 and 14 m: close the last stretch at a trot, then hold still
    // and let the gun do the talking.
    const trim = gap > HOLD_FAR ? 1 : 0.55;
    vx = Math.sin(face) * FOOT.run * trim;
    vz = Math.cos(face) * FOOT.run * trim;
  } else {
    cop.strafeT -= dt;
    if (cop.strafeT <= 0) {
      cop.strafe *= -1;
      cop.strafeT = 1.6 + (PO.rng ? PO.rng.next() * 2 : 1);
    }
    vx = Math.cos(face) * cop.strafe * 1.8;
    vz = -Math.sin(face) * cop.strafe * 1.8;
  }

  if (vx || vz) {
    const moved = resolveMove(W, cop.pos.x, cop.pos.z, COP_BODY_R, vx * dt, vz * dt);
    const walked = away(moved.x, moved.z, cop.pos.x, cop.pos.z);
    cop.pos.x = moved.x;
    cop.pos.z = moved.z;
    cop.gait += walked * 3.2;
  }

  const speedNow = Math.hypot(vx, vz);
  const bob = Math.sin(cop.gait) * Math.min(0.75, 0.14 + speedNow * 0.08);
  cop.rig.legs[0].rotation.x = bob;
  cop.rig.legs[1].rotation.x = -bob;
  cop.rig.armL.rotation.x = -bob;
  cop.rig.armR.rotation.x = bob;
  cop.yaw = face;
  cop.mesh.position.set(cop.pos.x, 0, cop.pos.z);
  cop.mesh.rotation.set(0, face, 0);

  // Gunfire: sight line first, a beat between shots.
  cop.cool -= dt;
  if (cop.cool > 0 || gap > FOOT.range || P.dead) return;
  if (!lineOfSight(W, cop.pos.x, cop.pos.z, P.pos.x, P.pos.z)) return;
  cop.cool = FOOT.fireEvery;

  const muzzle = { x: cop.pos.x, y: 1.25, z: cop.pos.z };
  const chest = { x: P.pos.x, y: 1.1, z: P.pos.z };
  if (G.effects) {
    if (G.effects.tracer) G.effects.tracer(muzzle, chest);
    else if (G.effects.spawnTracer) G.effects.spawnTracer(muzzle, chest);
    if (G.effects.spawnMuzzle) G.effects.spawnMuzzle(muzzle);
  }
  if (G.sound && G.sound.shot) G.sound.shot(false);

  const round = FOOT.dmgMin + Math.floor((PO.rng ? PO.rng.next() : Math.random()) * (FOOT.dmgMax - FOOT.dmgMin + 1));
  if (G.damagePlayer) G.damagePlayer(Math.min(FOOT.dmgMax, round));
  else damagePlayer(P, Math.min(FOOT.dmgMax, round), G);
}

// Cuffs: a nearly-empty runner beside an officer, on foot, is done for.
function checkArrest(PO, G) {
  const P = G.P;
  if (!P || P.dead || G.inCar) return;
  if (P.hp > FOOT.arrestHpBelow) return;
  for (const cop of PO.foot) {
    if (cop.dead) continue;
    if (near(cop.pos.x, cop.pos.z, P.pos.x, P.pos.z, FOOT.arrestDist)) {
      if (G.bust) G.bust();
      return;
    }
  }
}

// ----------------------------------------------------------------- blocks

// Two cruisers nosed together across the road a little ahead of the player's
// heading, lights on and noses angled out so a gap has to be found.
function raiseRoadblock(PO, G, W, rng) {
  const here = chasedSpot(G);
  const heading = G.inCar ? G.inCar.heading : (G.P ? G.P.yaw : 0);
  const aheadX = here.x + Math.sin(heading) * BLOCK.ahead;
  const aheadZ = here.z + Math.cos(heading) * BLOCK.ahead;
  const lane = snapToLane(W, aheadX, aheadZ);
  // Which way does the road run at the block? East-west roads turn the cruisers
  // ninety degrees so their noses sit across the traffic.
  const eastWest = Math.abs(lane.x - here.x) < Math.abs(lane.z - here.z);
  const across = eastWest ? Math.PI / 2 : 0;
  // Unit vectors: along the road, and sideways across it.
  const along = eastWest ? { x: 1, z: 0 } : { x: 0, z: 1 };
  const side = eastWest ? { x: 0, z: 1 } : { x: 1, z: 0 };
  const posts = [];

  for (const dir of [-1, 1]) {
    const car = freshCopCar(W, rng);
    const off = BLOCK_SLOT * dir;
    car.x = lane.x + along.x * off;
    car.z = lane.z + along.z * off;
    car.heading = across + dir * 0.2;
    car.speed = 0;
    car.crew = 0;
    car.blocked = true;
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    PO.cars.push(car);
    posts.push(car);
  }

  PO.roadblock = { x: lane.x, z: lane.z, cars: posts, heading };
  if (G.toast) G.toast('Roadblock ahead');
}

function dropRoadblock(PO, G) {
  const block = PO.roadblock;
  if (!block) return;
  for (const car of block.cars) {
    if (car.player || car.occupant === 'player') continue;
    const at = PO.cars.indexOf(car);
    if (at >= 0) PO.cars.splice(at, 1);
    if (car.mesh && car.mesh.parent) car.mesh.parent.remove(car.mesh);
  }
  PO.roadblock = null;
}

// Once the player is 30 m past it, the block goes away.
function tickRoadblock(PO, G, dt) {
  const block = PO.roadblock;
  if (!block) return;
  if (PO.stars < BLOCK.minStars) {
    dropRoadblock(PO, G);
    return;
  }
  const here = chasedSpot(G);
  // Signed distance past the block along the player's heading: positive once
  // they are through it, so the 30 m test is a single number.
  const fx = Math.sin(block.heading);
  const fz = Math.cos(block.heading);
  const past = (here.x - block.x) * fx + (here.z - block.z) * fz;
  if (past > BLOCK_GONE) dropRoadblock(PO, G);
}

function roadblockDue(PO, G, dt) {
  PO.roadblockT = Math.max(0, PO.roadblockT - dt);
  if (PO.stars < BLOCK.minStars || PO.roadblock || PO.roadblockT > 0) return;
  if (!G.W || !G.W.roads) return;
  raiseRoadblock(PO, G, G.W, PO.rng);
  PO.roadblockT = BLOCK.every;
}

// ------------------------------------------------------------------ step

export function updatePolice(PO, G, I, dt) {
  if (!PO || !G || !G.W) return;
  const W = G.W;
  const rng = PO.rng || G.rng;
  if (!PO.rng) PO.rng = rng;
  PO.clock += dt;

  tickWanted(PO, G, dt);
  const table = ringForStars(PO.stars);
  PO.table = table;
  const here = chasedSpot(G);

  if (PO.stars > 0) {
    keepCars(PO, G, W, table[0]);
    keepFoot(PO, G, table[1]);
  } else {
    // Heat off: nobody new joins, but the cops on the street finish their walk.
    keepCars(PO, G, W, 0);
  }

  for (let i = PO.cars.length - 1; i >= 0; i -= 1) {
    const car = PO.cars[i];
    if (!car) continue;
    const far = away(car.x, car.z, here.x, here.z);
    if (car.player || car.occupant === 'player') {
      handleCruiser(PO, G, W, rng, car, dt);
      continue;
    }
    if (PO.stars === 0 || far > CHASE.dropDist) {
      PO.cars.splice(i, 1);
      if (car.mesh && car.mesh.parent) car.mesh.parent.remove(car.mesh);
      continue;
    }
    handleCruiser(PO, G, W, rng, car, dt);
  }

  for (let i = PO.foot.length - 1; i >= 0; i -= 1) {
    const cop = PO.foot[i];
    const gone = !cop || cop.dead || PO.stars === 0;
    if (gone) {
      if (cop) retireCop(PO, cop);
      continue;
    }
    officerStep(PO, G, cop, dt);
  }

  checkArrest(PO, G);
  roadblockDue(PO, G, dt);
  tickRoadblock(PO, G, dt);

  // The lightbar is flipped here for cruisers nobody drives this frame (parked
  // roadblock cars, fresh spawns); car.js owns it while a car is being driven.
  const flip = Math.floor(PO.clock / FLASH_HALF) % 2;
  const on = PO.stars > 0;
  for (const car of PO.cars) {
    const ud = car.mesh && car.mesh.userData;
    if (!ud || !ud.barRed) continue;
    // While a cruiser is being driven, updateCarDrive in car.js already owns
    // the lightbar; only parked hulls get flashed from here.
    const driven = !car.blocked && !car.wrecked && car.occupant !== 'player' && !car.player;
    if (driven) continue;
    ud.barRed.material = barShade(BLAZE.red, on && flip === 0);
    ud.barBlue.material = barShade(BLAZE.blue, on && flip === 1);
  }
}

const glazeCache = new Map();

function barShade(hex, lit) {
  const key = hex + (lit ? ':on' : ':off');
  let m = glazeCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: lit ? hex : new THREE.Color(hex).multiplyScalar(0.22).getHex() });
    glazeCache.set(key, m);
  }
  return m;
}

export function wantedPoliced(PO) {
  return !!(PO && PO.stars > 0);
}
