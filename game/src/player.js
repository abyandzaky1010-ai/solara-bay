// Solara Bay — Vesper: low-poly body, on-foot steering, bullets and being hurt.
// Her state lives on a plain P record so camera and HUD never touch the scene graph.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';

const { walk: WALK_SPEED, sprint: SPRINT_SPEED, hp: START_HP } = CONFIG.player;
/** Shots leave from shoulder height, not from the boots. */
const EYE = 1.5;
/** How fast her body swivels toward the camera heading, rad/s. */
const TURN_RATE = 14;

// ------------------------------------------------------------------- the body

// A joint group with the limb box hanging under the pivot: rotating the joint swings it.
function limb(hex, w, h, d) {
  const joint = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex));
  mesh.position.y = -h / 2;
  joint.add(mesh);
  joint.userData.mesh = mesh;
  return joint;
}

function block(parent, w, h, d, hex, x, y, z, flat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex, low(flat)));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}
const low = (t) => (t ? { flat: true } : {});

// Coral shirt, dark shorts, white cap and the gold shades everyone remembers.
function dressVesper(group) {
  block(group, 0.65, 0.72, 0.38, C.shirt[0], 0, 1.16, 0); // coral shirt
  block(group, 0.56, 0.3, 0.34, C.pants[0], 0, 0.73, 0); // shorts
  block(group, 0.34, 0.36, 0.34, C.skin[0], 0, 1.76, 0); // head
  block(group, 0.37, 0.13, 0.37, 0xf4f1e6, 0, 1.99, 0); // cap crown
  block(group, 0.36, 0.05, 0.2, 0xf4f1e6, 0, 1.95, 0.25); // cap brim
  block(group, 0.35, 0.07, 0.03, C.beacon, 0, 1.78, 0.18, true); // gold shades

  const arms = [-1, 1].map((side) => {
    const arm = limb(C.shirt[0], 0.17, 0.62, 0.19);
    arm.position.set(side * 0.41, 1.48, 0);
    block(arm, 0.16, 0.16, 0.18, C.skin[0], 0, -0.68, 0); // hand
    group.add(arm);
    return arm;
  });
  const legs = [-1, 1].map((side) => {
    const leg = limb(C.pants[0], 0.21, 0.68, 0.23);
    leg.position.set(side * 0.16, 0.72, 0);
    block(leg, 0.22, 0.1, 0.32, 0xf2efe4, 0, -0.72, 0.04); // shoe
    group.add(leg);
    return leg;
  });
  // Pistol sits in her right hand from frame one; the rifle swap is visual only here.
  const gun = block(arms[1], 0.12, 0.12, 0.5, 0x2f3238, 0, -0.66, 0.26);

  group.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return { arms, legs, gun };
}

/** Raise Vesper on the Glass Orchid pavement and hand back her record. */
export function createPlayer(W, city) {
  const group = new THREE.Group();
  const parts = dressVesper(group);
  const start = (city && city.spawns && city.spawns.playerStart) || { x: 12, z: -14 };
  const P = {
    group,
    parts,
    pos: new THREE.Vector3(start.x, 0, start.z),
    yaw: Math.PI,
    hp: START_HP,
    armor: 0,
    weapon: 'pistol',
    rifle: false,
    ammo: 0,
    dead: false,
    cooldown: 0,
    aim: false,
    walkT: 0,
    speed: 0,
    bob: 0,
    hitFlash: 0,
  };
  group.position.copy(P.pos);
  group.rotation.y = P.yaw;
  W.scene.add(group);
  return P;
}

// ------------------------------------------------------------------- movement

// Shortest signed arc from a to b, so she never spins the long way round.
function shortestArc(from, to) {
  const d = (to - from) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d < -Math.PI ? d + Math.PI * 2 : d;
}

// Walk cycle keyed to distance travelled, so it stops dead when she stops.
function animateStride(P, dt) {
  P.walkT += P.speed < 0.1 ? -P.walkT : dt * P.speed * 1.55;
  const swing = Math.min(0.95, P.speed * 0.15);
  const s = Math.sin(P.walkT) * swing;
  const { arms, legs } = P.parts;
  legs[0].rotation.x = s;
  legs[1].rotation.x = -s;
  arms[0].rotation.x = -s * 0.8;
  arms[1].rotation.x = s * 0.4 - 0.5; // gun arm stays half-aimed
  P.bob = Math.abs(Math.sin(P.walkT)) * 0.045 * (P.speed / SPRINT_SPEED);
  P.parts.gun.visible = !P.rifle;
}

/** Push the plain record onto the scene graph. */
export function syncGroup(P) {
  P.group.position.set(P.pos.x, P.pos.y || 0, P.pos.z);
  P.group.rotation.y = P.yaw;
  return P;
}

/**
 * On foot: WASD relative to the camera, Shift to sprint, collision, walk swing,
 * and she always faces where the camera looks.
 */
export function updatePlayerFoot(P, G, I, dt) {
  if (P.dead) {
    P.speed = 0;
    return;
  }
  const W = G.W;
  const fx = (I.down('KeyD') || I.down('ArrowRight') ? 1 : 0) - (I.down('KeyA') || I.down('ArrowLeft') ? 1 : 0);
  const fz = (I.down('KeyW') || I.down('ArrowUp') ? 1 : 0) - (I.down('KeyS') || I.down('ArrowDown') ? 1 : 0);
  const magnitude = Math.min(1, Math.hypot(fx, fz));
  const topSpeed = I.down('ShiftLeft') || I.down('ShiftRight') ? SPRINT_SPEED : WALK_SPEED;

  // The orbit yaw's sin/cos is the direction the camera is looking.
  const heading = W ? W.yaw : P.yaw;
  let moveX = Math.sin(heading) * fz + Math.cos(heading) * fx;
  let moveZ = Math.cos(heading) * fz - Math.sin(heading) * fx;
  const len = Math.hypot(moveX, moveZ) || 1;
  moveX /= len;
  moveZ /= len;


  P.speed += (magnitude * topSpeed - P.speed) * Math.min(1, dt * 12);
  if (P.speed < 0.05) P.speed = 0;

  if (W && magnitude) {
    const moved = resolveMove(W, P.pos.x, P.pos.z, 0.5, moveX * P.speed * dt, moveZ * P.speed * dt);
    P.pos.x = Math.max(-W.half + 1, Math.min(W.half - 1, moved.x));
    P.pos.z = Math.max(-W.half + 1, Math.min(W.half - 1, moved.z));
  }

  P.aim = true;
  P.yaw += shortestArc(P.yaw, heading) * Math.min(1, dt * TURN_RATE);
  animateStride(P, dt);
  syncGroup(P);
}

/** Tick the trigger cooldown and the damage flash. */
export function updatePlayerTimers(P, dt) {
  if (P.cooldown > 0) P.cooldown = Math.max(0, P.cooldown - dt);
  if (P.hitFlash > 0) P.hitFlash = Math.max(0, P.hitFlash - dt);
}

// ------------------------------------------------------------------- shooting

/** The eye, origin of every shot. */
export function eyePoint(P) {
  return { x: P.pos.x, y: (P.pos.y || 0) + EYE, z: P.pos.z };
}

// Slab test: distance along a ray to the box [minX,maxX] x [0,h] x [minZ,maxZ], or -1.
function rayHitsBox(o, d, box, limit) {
  const slab = (p, dd, lo, hi) => {
    if (Math.abs(dd) < 1e-6) return p < lo || p > hi ? null : [-Infinity, Infinity];
    const a = (lo - p) / dd;
    const b = (hi - p) / dd;
    return a < b ? [a, b] : [b, a];
  };
  let near = 0;
  let far = limit;
  for (const seg of [
    slab(o.x, d.x, box.minX, box.maxX),
    slab(o.y, d.y, 0, box.h || 2),
    slab(o.z, d.z, box.minZ, box.maxZ),
  ]) {
    if (!seg) return -1;
    near = Math.max(near, seg[0]);
    far = Math.min(far, seg[1]);
    if (near > far) return -1;
  }
  return near;
}

// Deterministic small spread, reseeded per shot from her position and the clock.
function spreadSource(P, G) {
  let seed = (0x9e3779b9 ^ Math.floor(P.pos.x * 71 + P.pos.z * 37 + (G.time || 0) * 977)) >>> 0;
  return () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return seed / 4294967296;
  };
}

/**
 * Trace one ray from her eye along the camera heading (plus pitch and spread):
 * nearest body wins, and a wall in the way stops the round. Returns
 * { hit, point, eye, kind:'sky'|'wall'|'ped'|'cop'|'car'|'traffic', target }.
 */
function traceShot(P, G, spread) {
  const rand = spreadSource(P, G);
  const eye = eyePoint(P);
  const yaw = G.W ? G.W.yaw : P.yaw;
  const pitch = G.W ? G.W.pitch : 0;
  const d = {
    x: Math.sin(yaw) * Math.cos(pitch) + (rand() - 0.5) * spread,
    y: -Math.sin(pitch) + (rand() - 0.5) * spread,
    z: Math.cos(yaw) * Math.cos(pitch) + (rand() - 0.5) * spread,
  };
  const inv = 1 / Math.hypot(d.x, d.y, d.z);
  d.x *= inv;
  d.y *= inv;
  d.z *= inv;

  let best = { dist: 120, kind: 'sky', target: null };
  const consider = (list, kind, body) => {
    for (const item of list || []) {
      if (!item || item.dead || item.state === 'down') continue;
      const tx = (item.pos || item).x;
      const tz = (item.pos || item).z;
      const along = (tx - eye.x) * d.x + (0.9 - eye.y) * d.y + (tz - eye.z) * d.z;
      if (along <= 0.5 || along >= best.dist) continue;
      const miss = Math.hypot(tx - eye.x - d.x * along, 0.9 - eye.y - d.y * along, tz - eye.z - d.z * along);
      if (miss <= body) best = { dist: along, kind, target: item };
    }
  };
  consider(G.peds, 'ped', 0.75);
  consider(G.cops, 'cop', 0.8);
  consider(G.cars, 'car', 1.9);
  consider(G.traffic, 'traffic', 1.9);

  // Concrete stops a round short of anything behind it.
  for (const box of (G.W && G.W.colliders) || []) {
    const t = rayHitsBox(eye, d, box, best.dist);
    if (t >= 0 && t < best.dist) best = { dist: t, kind: 'wall', target: null };
  }
  const at = best.dist;
  const point = { x: eye.x + d.x * at, y: eye.y + d.y * at, z: eye.z + d.z * at };
  return { hit: best.kind !== 'sky' && best.kind !== 'wall', kind: best.kind, target: best.target, eye, point };
}

/** Whichever gun is live: the rifle only while it still has rounds. */
function activeWeapon(P) {
  return P.rifle && P.ammo > 0 ? CONFIG.weapons.rifle : CONFIG.weapons.pistol;
}

/** True when the gun can speak this frame. */
export function canFire(P) {
  if (P.dead || P.cooldown > 0) return false;
  return activeWeapon(P).infinite || P.ammo > 0;
}

/**
 * One trigger pull: spend cooldown and ammo, play the sound and the tracer, raise the
 * alarm, and deal the damage through whoever owns the target. Returns the shot info.
 */
export function fireWeapon(P, G) {
  if (!canFire(P)) return { hit: false, point: null, kind: 'dry', target: null };
  const gun = activeWeapon(P);
  P.cooldown = 1 / gun.rate;
  if (!gun.infinite) P.ammo = Math.max(0, P.ammo - 1);

  const shot = traceShot(P, G, gun.spread);
  const fx = G.effects || {};
  G.sound?.shot?.();
  fx.spawnMuzzle?.(shot.eye);
  fx.spawnTracer?.(shot.eye, shot.point);
  // Noise is the point: everyone in earshot starts looking.
  G.alarm = 1;
  G.alarmX = P.pos.x;
  G.alarmZ = P.pos.z;
  if (!shot.hit) return { hit: false, point: shot.point, kind: shot.kind, target: null };

  const t = shot.target;
  if (shot.kind === 'ped' && G.damagePed) G.damagePed(t, gun.dmg);
  else if (shot.kind === 'cop' && G.damageCop) G.damageCop(t, gun.dmg);
  else if (G.damageTrafficCar) G.damageTrafficCar(t, gun.dmg);
  else if (t) t.hp -= gun.dmg;
  return { hit: true, point: shot.point, kind: shot.kind, target: t };
}

/** Can an NPC at `to` be seen from `from` without a building in the way? */
export function lineOfSight(W, from, to) {
  const eye = { x: from.x, y: 1.4, z: from.z };
  const dx = to.x - from.x;
  const dy = -0.5;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const d = { x: dx / len, y: dy / len, z: dz / len };
  return !W.colliders.some((box) => {
    const t = rayHitsBox(eye, d, box, len);
    return t >= 0 && t < len - 0.4;
  });
}

// ------------------------------------------------------------------- damage

/**
 * Incoming hurt: vest armour soaks 60% of every hit until it is spent, the rest
 * goes to her. Under zero the bay collects her and the caller decides where she wakes.
 */
export function damagePlayer(P, amt, G) {
  if (P.dead || amt <= 0) return { absorbed: 0, taken: 0 };
  let incoming = amt;
  let absorbed = 0;
  if (P.armor > 0) {
    absorbed = Math.min(P.armor, incoming * 0.6);
    P.armor -= absorbed;
    incoming -= absorbed;
  }
  P.hp -= incoming;
  P.hitFlash = 0.25;
  G?.effects?.flashDamage?.();
  if (P.hp <= 0) {
    P.hp = 0;
    P.dead = true;
    P.speed = 0;
    P.cooldown = 0;
    G?.wasted?.();
  }
  return { absorbed, taken: incoming };
}

/** Patch her up at a clinic or from a medkit. */
export function healPlayer(P, amount, cap = START_HP) {
  P.hp = Math.min(cap, P.hp + amount);
  return P.hp;
}

/** Stand her back up, full health, guns and armour kept, at `where` or her start. */
export function respawnPlayer(P, G, where) {
  const spot = where || (G && G.city && G.city.spawns && G.city.spawns.playerStart) || { x: 12, z: -14 };
  P.pos.set(spot.x, 0, spot.z);
  P.yaw = spot.heading !== undefined ? spot.heading : Math.PI;
  Object.assign(P, { hp: START_HP, dead: false, cooldown: 0, speed: 0, walkT: 0, hitFlash: 0, aim: false });
  P.group.rotation.set(0, P.yaw, 0);
  P.group.visible = true;
  P.parts.gun.visible = !P.rifle;
  syncGroup(P);
  if (G) {
    G.alarm = 0;
    if (G.W) {
      G.W.yaw = P.yaw;
      G.W.pitch = 0.32;
    }
  }
  return P;
}

/** Hide her body while she is behind a steering wheel. */
export function stowPlayer(P) {
  P.group.visible = false;
  P.speed = 0;
}

/** Put her back on her feet beside a car. */
export function unseatPlayer(P, x, z, heading) {
  P.pos.set(x, 0, z);
  if (heading !== undefined) P.yaw = heading;
  P.group.visible = true;
  syncGroup(P);
}

// ------------------------------------------------------------------- pickups

/**
 * Something free off the street: the Verde Park rifle crate (gun plus starter rounds),
 * cash, vest armour, or a medkit. Returns a short label for the HUD.
 */
export function givePickup(P, G, item) {
  if (item === 'rifle') {
    const fresh = !P.rifle;
    P.rifle = true;
    if (fresh) {
      P.ammo += CONFIG.weapons.rifle.ammoPerBuy;
      G?.sound?.chime?.();
      G?.H?.toast?.('Rifle picked up — 60 rounds');
    }
    return 'rifle';
  }
  if (item === 'cash') {
    G?.addMoney?.(G.E, 120, G.H);
    return 'cash';
  }
  if (item === 'armor') {
    P.armor = Math.min(START_HP, P.armor + 50);
    return 'armor';
  }
  if (item === 'medkit') {
    healPlayer(P, 50);
    return 'medkit';
  }
  return 'nothing';
}
