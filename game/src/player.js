// The person you play: Vesper's runner, a low-poly body of boxes on the
// streets of Solara Bay. This module owns the on-foot body, camera-relative
// movement, the walk cycle and the gun. Money, stars and missions live in the
// systems that call in here through G.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';

const BODY_R = 0.5;      // collision radius against city boxes
const EYE_Y = 1.62;      // where shots leave from
const HANDS_Y = 1.28;
const SHOULDER = 0.34;
const CYCLE = 2.6;       // metres of stride per full leg swing
const MUZZLE_FWD = 0.85;

// ------------------------------------------------------------------ body

function box(w, h, d, hex, shadows = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex));
  m.castShadow = shadows;
  return m;
}

// A limb pivots at the top so it swings like a pendulum from hip or shoulder.
function swung(w, h, d, hex) {
  const pivot = new THREE.Group();
  const bone = box(w, h, d, hex);
  bone.position.y = -h / 2;
  pivot.add(bone);
  return pivot;
}

function buildRig() {
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);

  const shirt = box(0.62, 0.66, 0.38, C.shirt[0]);
  shirt.position.y = 1.32;
  torso.add(shirt);
  const belt = box(0.64, 0.1, 0.4, C.pants[3]);
  belt.position.y = 0.98;
  torso.add(belt);

  // Head, cream cap with a forward brim, dark sunglasses band.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), material(C.skin[0]));
  head.castShadow = true;
  head.position.y = 1.86;
  torso.add(head);
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    material(0xf3e6cf),
  );
  cap.castShadow = true;
  cap.position.y = 1.9;
  torso.add(cap);
  const brim = box(0.26, 0.05, 0.22, 0xf3e6cf);
  brim.position.set(0, 1.9, 0.22);
  torso.add(brim);
  const shades = box(0.36, 0.07, 0.06, 0x1d2430, false);
  shades.position.set(0, 1.85, 0.17);
  torso.add(shades);

  const armL = swung(0.16, 0.58, 0.16, C.skin[0]);
  armL.position.set(-SHOULDER, HANDS_Y + SHOULDER, 0);
  torso.add(armL);
  const armR = swung(0.16, 0.58, 0.16, C.skin[0]);
  armR.position.set(SHOULDER, HANDS_Y + SHOULDER, 0);
  torso.add(armR);

  const legL = swung(0.22, 0.86, 0.24, C.pants[0]);
  legL.position.set(-0.16, 0.94, 0);
  root.add(legL);
  const legR = swung(0.22, 0.86, 0.24, C.pants[1]);
  legR.position.set(0.16, 0.94, 0);
  root.add(legR);
  for (const leg of [legL, legR]) {
    const shoe = box(0.24, 0.12, 0.34, 0x2b2b2b);
    shoe.position.set(0, -0.8, 0.05);
    leg.children[0].add(shoe);
  }

  // Guns hang in the right hand and only show while aiming.
  const pistol = new THREE.Group();
  pistol.add(box(0.08, 0.1, 0.34, 0x2f3338));
  const grip = box(0.07, 0.16, 0.1, 0x3a3f46);
  grip.position.set(0, -0.11, -0.06);
  pistol.add(grip);
  pistol.position.set(0, -0.5, 0.14);
  armR.add(pistol);

  const rifle = new THREE.Group();
  rifle.add(box(0.08, 0.09, 0.86, 0x24282d));
  const stock = box(0.1, 0.14, 0.28, 0x6a4b33);
  stock.position.z = -0.4;
  rifle.add(stock);
  rifle.position.set(0, -0.5, 0.2);
  armR.add(rifle);

  return { root, torso, armL, armR, legL, legR, pistol, rifle };
}

// ------------------------------------------------------------- factories

export function createPlayer(W, city) {
  const rig = buildRig();
  W.scene.add(rig.root);
  const start = (city && city.spawns && city.spawns.playerStart) || { x: 14, z: 20 };

  const P = {
    group: rig.root,
    rig,
    pos: new THREE.Vector3(start.x, 0, start.z),
    x: start.x,
    z: start.z,
    yaw: Math.PI,
    hp: CONFIG.player.hp,
    armor: 0,
    weapon: 'pistol',
    rifle: false,
    ammo: 0,
    dead: false,
    cooldown: 0,
    aim: false,
    walkT: 0,
    stride: 0,
    speed: 0,
    aimPitch: 0,
    muzzle: new THREE.Vector3(),
  };

  syncBody(P);
  return P;
}

function syncBody(P) {
  P.group.position.set(P.pos.x, P.pos.y, P.pos.z);
  P.group.rotation.y = P.yaw;
  P.x = P.pos.x;
  P.z = P.pos.z;
}

// ----------------------------------------------------------- locomotion

function axis(I, plus, minus) {
  return (I.down(plus) ? 1 : 0) - (I.down(minus) ? 1 : 0);
}

function swingLimbs(P, travelled, dt) {
  const rig = P.rig;
  if (travelled > 0.0005) {
    P.walkT += (travelled / CYCLE) * Math.PI * 2;
    P.stride += travelled;
    if (P.stride > 1.35) P.stride = 0;
  }

  const gait = P.speed > 0.25 ? Math.min(1.1, 0.32 + P.speed / 7) : 0;
  const a = Math.sin(P.walkT) * gait;
  const b = -a;
  const ease = Math.min(1, dt * 16);

  rig.legL.rotation.x += (a - rig.legL.rotation.x) * ease;
  rig.legR.rotation.x += (b - rig.legR.rotation.x) * ease;

  if (P.aim) {
    // Both arms forward, the off hand tucked in to brace the gun.
    rig.armR.rotation.x += (-1.35 - rig.armR.rotation.x) * Math.min(1, dt * 14);
    rig.armL.rotation.x += (-1.15 - rig.armL.rotation.x) * Math.min(1, dt * 14);
    rig.armL.rotation.z += (0.35 - rig.armL.rotation.z) * Math.min(1, dt * 12);
  } else {
    rig.armR.rotation.x += (b * 0.8 - rig.armR.rotation.x) * Math.min(1, dt * 14);
    rig.armL.rotation.x += (a * 0.8 - rig.armL.rotation.x) * Math.min(1, dt * 14);
    rig.armL.rotation.z *= 0.9;
  }

  rig.torso.position.y = gait ? Math.abs(Math.sin(P.walkT)) * 0.05 : 0;
  rig.torso.rotation.x = 0.02 + gait * 0.05;
  rig.pistol.visible = P.aim && !P.rifle;
  rig.rifle.visible = P.aim && P.rifle;
}

export function updatePlayerFoot(P, G, I, dt) {
  const W = G.W;
  if (P.cooldown > 0) P.cooldown = Math.max(0, P.cooldown - dt);
  if (P.dead) {
    syncBody(P);
    return;
  }

  P.aim = true; // third person, pointer locked: aiming is always "on"
  const cam = W.cam || {};
  const face = (typeof cam.yaw === 'number' ? cam.yaw : P.yaw - Math.PI) + Math.PI;
  const flank = face - Math.PI / 2;

  const ahead = axis(I, 'KeyW', 'KeyS') + axis(I, 'ArrowUp', 'ArrowDown');
  const side = axis(I, 'KeyD', 'KeyA') + axis(I, 'ArrowRight', 'ArrowLeft');

  let dx = Math.sin(face) * ahead + Math.sin(flank) * side;
  let dz = Math.cos(face) * ahead + Math.cos(flank) * side;
  const len = Math.hypot(dx, dz);
  const sprint = (I.down('ShiftLeft') || I.down('ShiftRight')) && ahead > 0;
  const top = sprint ? CONFIG.player.sprint : CONFIG.player.walk;

  let stepX = 0;
  let stepZ = 0;
  if (len > 0.001) {
    dx /= len;
    dz /= len;
    P.speed += (top - P.speed) * Math.min(1, dt * 9);
    stepX = dx * P.speed * dt;
    stepZ = dz * P.speed * dt;
  } else {
    P.speed = P.speed < 0.05 + dt * 12 ? 0 : P.speed - dt * 12;
  }

  const moved = resolveMove(W, P.pos.x, P.pos.z, BODY_R, stepX, stepZ);
  P.pos.x = moved.x;
  P.pos.z = moved.z;

  // Run toward where you look; without pointer lock, toward where you go.
  P.yaw = I.locked || len < 0.001 ? face : Math.atan2(dx, dz);
  P.pos.y = 0;
  P.aimPitch = typeof cam.pitch === 'number' ? cam.pitch : 0;

  swingLimbs(P, Math.hypot(stepX, stepZ) * (moved.hit ? 0.35 : 1), dt);
  syncBody(P);
  P.muzzle.set(
    P.pos.x + Math.sin(P.yaw) * MUZZLE_FWD,
    HANDS_Y,
    P.pos.z + Math.cos(P.yaw) * MUZZLE_FWD,
  );
}

// -------------------------------------------------------------- the gun

// March along the ray until a collider box or the road stops it. Bullets live
// one frame, so 1 m steps are plenty.
function wallAlong(W, from, dir, reach) {
  for (let d = 1; d <= reach; d += 1) {
    const x = from.x + dir.x * d;
    const y = from.y + dir.y * d;
    const z = from.z + dir.z * d;
    if (y <= 0.02) return { dist: d, point: new THREE.Vector3(x, 0.02, z) };
    const boxes = W.colliders;
    for (let i = 0; i < boxes.length; i += 1) {
      const b = boxes[i];
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ || y > b.h) continue;
      return { dist: d, point: new THREE.Vector3(x, y, z) };
    }
  }
  return null;
}

// Where the ray first enters a vertical cylinder around a target's position.
function enterCircle(from, dir, tx, tz, r) {
  const ox = tx - from.x;
  const oz = tz - from.z;
  const along = ox * dir.x + oz * dir.z;
  if (along <= 0) return -1;
  const perp = Math.hypot(ox - dir.x * along, oz - dir.z * along);
  if (perp > r) return -1;
  return Math.max(0.4, along - Math.sqrt(Math.max(0, r * r - perp * perp)));
}

function nearestOf(list, from, dir, r, reach) {
  let best = null;
  let bestD = Infinity;
  if (!list) return best;
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    if (!a || a.dead || a.hp <= 0 || a.state === 'down' || a.wrecked) continue;
    const ax = a.pos ? a.pos.x : a.x;
    const az = a.pos ? a.pos.z : a.z;
    const d = enterCircle(from, dir, ax, az, r);
    if (d > 0 && d < bestD && d <= reach) {
      bestD = d;
      best = { actor: a, dist: d, x: ax, z: az };
    }
  }
  return best;
}

export function fireWeapon(P, G) {
  const miss = { hit: false, point: null, kind: 'none', target: null };
  if (!P || P.dead) return miss;
  if (P.cooldown > 0) return { ...miss, kind: 'wait' };

  const spec = P.rifle ? CONFIG.weapons.rifle : CONFIG.weapons.pistol;
  if (P.rifle) {
    if (P.ammo <= 0) {
      P.cooldown = 0.3;
      if (G.sound && G.sound.dry) G.sound.dry();
      return { ...miss, kind: 'empty' };
    }
    P.ammo -= 1;
  }
  P.cooldown = 1 / spec.rate;
  if (G.sound && G.sound.shot) G.sound.shot(P.rifle);

  const W = G.W;
  const pitch = (W && W.cam && typeof W.cam.pitch === 'number') ? W.cam.pitch : P.aimPitch || 0;
  const spread = spec.spread * (P.speed > 5 ? 2 : 1);
  const yaw = P.yaw + (Math.random() - 0.5) * spread;
  const tilt = pitch + (Math.random() - 0.5) * spread;
  const eye = new THREE.Vector3(P.pos.x + Math.sin(P.yaw) * 0.4, EYE_Y, P.pos.z + Math.cos(P.yaw) * 0.4);
  const dir = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(tilt),
    -Math.sin(tilt),
    Math.cos(yaw) * Math.cos(tilt),
  ).normalize();

  const reach = P.rifle ? 90 : 55;
  const wall = wallAlong(W, eye, dir, reach);
  const cover = wall ? wall.dist : reach;

  const cop = nearestOf(G.PO && G.PO.foot, eye, dir, 0.6, cover);
  const ped = nearestOf(G.peds, eye, dir, 0.55, cover);
  const car = nearestOf(G.cars, eye, dir, 1.6, cover);

  // Everyone hears it; shots always pull the city's attention to the shooter.
  G.alarm = 1;
  G.alarmX = P.pos.x;
  G.alarmZ = P.pos.z;

  let shot = null;
  let kind = 'none';
  if (cop && (!ped || cop.dist <= ped.dist)) {
    shot = cop;
    kind = 'cop';
  } else if (ped) {
    shot = ped;
    kind = 'ped';
  } else if (car) {
    shot = car;
    kind = 'car';
  }

  const point = shot ? new THREE.Vector3(shot.x, 1.05, shot.z) : (wall ? wall.point : eye.clone().addScaledVector(dir, reach));

  if (G.effects) {
    if (G.effects.spawnMuzzle) G.effects.spawnMuzzle(eye);
    if (G.effects.spawnTracer) G.effects.spawnTracer(eye, point);
  }

  if (!shot) return { hit: false, point, kind: wall ? 'wall' : 'air', target: null };

  const target = shot.actor;
  if (kind === 'cop') {
    target.hp -= spec.dmg;
    if (G.damageCop) G.damageCop(target, spec.dmg);
    if (target.hp <= 0 && G.onCopDown) G.onCopDown(target);
  } else if (kind === 'ped') {
    target.hp -= spec.dmg;
    const killed = target.hp <= 0;
    if (G.damagePed) G.damagePed(target, spec.dmg, killed);
    if (killed && G.onPedKilled) G.onPedKilled(target);
  } else if (G.damageTrafficCar) {
    G.damageTrafficCar(target, spec.dmg);
  }

  return { hit: true, point, kind, target, dmg: spec.dmg };
}

// ----------------------------------------------------------------- harm

// Armour soaks sixty percent of the hit, health carries the rest.
export function damagePlayer(P, amt, G) {
  if (!P || P.dead || !(amt > 0)) return P.hp;
  if (P.armor > 0) {
    const soaked = Math.min(P.armor, amt * 0.6);
    P.armor -= soaked;
    P.hp -= amt - soaked;
  } else {
    P.hp -= amt;
  }
  if (P.hp < 0) P.hp = 0;
  if (G && G.effects && G.effects.flashDamage) G.effects.flashDamage();
  if (P.hp === 0 && !P.dead) {
    P.dead = true;
    P.speed = 0;
    P.group.rotation.z = Math.PI / 2; // flat on the pavement
    P.group.position.y = 0.35;
    if (G && G.wasted) G.wasted();
  }
  return P.hp;
}

export function respawnPlayer(P, G, where) {
  const spot = where || { x: 14, z: 20 };
  P.pos.set(spot.x, 0, spot.z);
  P.hp = CONFIG.player.hp;
  P.armor = 0;
  P.dead = false;
  P.cooldown = 0;
  P.speed = 0;
  P.walkT = 0;
  P.stride = 0;
  P.aim = false;
  P.group.rotation.z = 0;
  P.group.position.y = 0;
  P.rig.torso.rotation.x = 0;
  syncBody(P);
  if (G) {
    G.alarm = 0;
    G.alarmX = spot.x;
    G.alarmZ = spot.z;
  }
}

// -------------------------------------------------------------- pickups

// 'rifle' hands over the long gun and leaves the ammo count alone; the rest
// top up a stat and toast.
export function givePickup(P, G, item) {
  if (item === 'rifle') {
    P.rifle = true;
    if (G && G.toast) G.toast('Rifle acquired');
    return true;
  }
  if (item === 'armor') {
    P.armor = Math.min(CONFIG.economy.armorCap, P.armor + 50);
    if (G && G.toast) G.toast('Armor strapped on');
    return true;
  }
  if (item === 'medkit') {
    P.hp = Math.min(CONFIG.player.hp, P.hp + 50);
    if (G && G.toast) G.toast('Health restored');
    return true;
  }
  return false;
}
