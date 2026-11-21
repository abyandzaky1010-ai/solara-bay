// Solara Bay — the player body: a blocky low-poly local with a coral shirt and
// sunglasses band, his on-foot control, and both guns. Shared-state changes go
// through named G callbacks (damagePed, damageCop, damageTrafficCar, wasted).
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';
const RADIUS = 0.5;      // shoulder width
const AIM_CLEAR = 1.2;   // aim ray starts past his own chest
const TURN_RATE = 14;    // rad/s toward the camera yaw
const SWING_RATE = 7.4;  // gait frequency per metre travelled
/** Build the character at the city start pad; P.pos is the simulation truth. */
  export function createPlayer(W, city) {
  const start = (city && city.spawns && city.spawns.playerStart) || { x: 0, z: 8 };
  const group = new THREE.Group();
  group.name = 'player';
  const figure = new THREE.Group();
  group.add(figure);
  const skin = C.skin[0];
  const denim = C.pants[0];
  const shirt = C.shirt[0];
  const add = (mesh) => figure.add(mesh);
  add(box(0.72, 0.78, 0.42, shirt, 0.98));   // torso
  add(box(0.66, 0.14, 0.44, 0x232a33, 1.3)); // sunglasses band
  add(box(0.2, 0.14, 0.2, skin, 1.4));       // neck
  add(box(0.46, 0.44, 0.44, skin, 1.56));    // head
  add(box(0.48, 0.16, 0.46, 0xf4f1e4, 1.84)); // cap crown
  add(box(0.5, 0.06, 0.24, 0xf4f1e4, 1.78)).position.z = 0.3; // cap brim
  add(box(0.66, 0.24, 0.4, denim, 0.62));    // hips
  const legL = limb(0.26, 0.58, denim, -0.18, 0.62);
  const legR = limb(0.26, 0.58, denim, 0.18, 0.62);
  const armL = limb(0.18, 0.62, skin, -0.46, 1.3);
  const armR = limb(0.18, 0.62, skin, 0.46, 1.3);
  figure.add(legL.pivot, legR.pivot, armL.pivot, armR.pivot);
  const bootL = shoe(-0.18);
  const bootR = shoe(0.18);
  add(bootL);
  add(bootR);
  // Guns live in the right hand so the arm swing carries them; hidden until aimed.
  const pistol = gun(0.34, 0x2a2f36, 0x4a3527);
  const rifle = gun(0.86, 0x33383f, 0x6b4f35);
  pistol.position.set(0, -0.6, 0.16);
  rifle.position.set(0, -0.56, 0.2);
  armR.pivot.add(pistol, rifle);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, 0.82);
  armR.pivot.add(muzzle);
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  group.position.set(start.x, 0, start.z);
  W.scene.add(group);
  const P = {
    group, figure, pos: { x: start.x, z: start.z }, yaw: 0,
    hp: CONFIG.player.hp, armor: 0, weapon: 'pistol', rifle: false, ammo: 0,
    dead: false, cooldown: 0, aim: false, walkT: 0, radius: RADIUS, speed: 0,
    muzzle, rig: { figure, legL, legR, armL, armR, bootL, bootR, pistol, rifle },
  };
  syncRig(P, 0);
  return P;
  }
  /** A limb hanging from a hip or shoulder pivot, so rotation.x is a real swing. */
  function limb(w, len, hex, x, topY) {
  const pivot = new THREE.Group();
  pivot.position.set(x, topY, 0);
  const seg = box(w, len, w * 0.92, hex, 0);
  seg.position.y = -len / 2;
  pivot.add(seg);
  return { pivot };
  }
  function shoe(x) {
  const m = box(0.28, 0.16, 0.4, 0x3a3f46, 0);
  m.position.set(x, 0.08, 0.07);
  return m;
  }
  /** Pistol or rifle: barrel box, wooden stock, magazine on the long one. */
  function gun(len, hex, gripHex) {
  const g = new THREE.Group();
  g.add(box(0.09, 0.11, len, hex, 0));
  const stock = box(0.09, 0.13, 0.3, gripHex, -0.05);  stock.position.z = -len * 0.5 - 0.1;
  g.add(stock);
  if (len > 0.5) {
    const mag = box(0.08, 0.2, 0.12, 0x22262b, -0.12);
    mag.position.z = 0.1;
    g.add(mag);
  }
  g.visible = false;
  return g;
  }
  function box(w, h, d, hex, y) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex));
  mesh.position.y = y;
  mesh.castShadow = true;
  return mesh;
  }
/* gait */
/** Copy the simulation onto the rig: legs swing by distance walked, arms roll
 * opposite, the right arm rises to shoulder height while aiming so the barrel
 * follows the yaw, and a dead body settles flat. */
export function syncRig(P, dt) {
  const r = P.rig;
  P.group.position.set(P.pos.x, 0, P.pos.z);
  P.group.rotation.y = P.yaw;
  const pace = P.dead ? 0 : Math.max(0, P.speed);
  P.walkT += pace * dt * SWING_RATE;
  const swing = Math.sin(P.walkT) * Math.min(0.95, 0.18 + pace * 0.11);
  r.legL.pivot.rotation.x = swing;
  r.legR.pivot.rotation.x = -swing;
  r.bootL.position.z = 0.07 + swing * 0.18;
  r.bootR.position.z = 0.07 - swing * 0.18;
  const armed = !P.dead && (P.aim || P.cooldown > 0.12);
  const armTarget = armed ? -Math.PI / 2 : -swing * 0.85;
  r.armR.pivot.rotation.x += (armTarget - r.armR.pivot.rotation.x) * 0.45;
  r.armR.pivot.rotation.z -= r.armR.pivot.rotation.z * 0.4;
  r.armL.pivot.rotation.x = -r.armR.pivot.rotation.x * (armed ? 0.25 : 1);
  const show = armed || P.cooldown > 0;
  r.pistol.visible = show && !P.rifle;
  r.rifle.visible = show && P.rifle;
  r.figure.position.y = Math.cos(P.walkT * 2) * 0.03 * Math.min(1, pace * 0.4);
  r.figure.rotation.z = Math.sin(P.walkT) * 0.045 * Math.min(1, pace * 0.35);
  r.figure.rotation.x += ((P.dead ? -1.42 : 0) - r.figure.rotation.x) * 0.3;
  if (P.dead) r.figure.position.y += (0.34 - r.figure.position.y) * 0.3;
}
/* foot control */
/** WASD read in the camera frame, Shift to sprint, body turning toward the
 * camera yaw (which is also where shots go), collisions at radius 0.5. */
export function updatePlayerFoot(P, G, I, dt) {
  const camYaw = (G.W && G.W.cam && G.W.cam.yaw) || 0;
  P.cooldown = Math.max(0, P.cooldown - dt);
  if (P.dead) { P.speed = 0; syncRig(P, dt); return; }
  let fwd = 0, side = 0;
  if (I) {
    if (I.down('KeyW') || I.down('ArrowUp')) fwd += 1;
    if (I.down('KeyS') || I.down('ArrowDown')) fwd -= 1;
    if (I.down('KeyD') || I.down('ArrowRight')) side += 1;
    if (I.down('KeyA') || I.down('ArrowLeft')) side -= 1;
  }
  const sprint = !!(I && (I.down('ShiftLeft') || I.down('ShiftRight')));
  const maxSpeed = sprint ? CONFIG.player.sprint : CONFIG.player.walk;
  const sy = Math.sin(camYaw), cy = Math.cos(camYaw);
  let dx = -sy * fwd + cy * side, dz = -cy * fwd - sy * side;
  const mag = Math.hypot(dx, dz);
  if (mag > 1e-4) { dx /= mag; dz /= mag; } else { dx = 0; dz = 0; }
  const want = mag > 1e-4 ? maxSpeed : 0;
  P.speed = Math.min(maxSpeed, approach(P.speed, want, (want > 0 ? 26 : 34) * dt));
  if (want > 0 && P.speed > 0.01) {
    const step = P.speed * dt, fx = P.pos.x, fz = P.pos.z;
    const moved = resolveMove(G.W, fx, fz, RADIUS, dx * step, dz * step);
    P.pos.x = moved.x; P.pos.z = moved.z;
    // A wall that stops him stops the gait too — no moon-walking on concrete.
    P.speed = Math.hypot(moved.x - fx, moved.z - fz) / Math.max(dt, 1e-4);
  } else if (P.speed < 0.02) P.speed = 0;
  P.yaw = turnToward(P.yaw, camYaw, TURN_RATE * dt);
  P.aim = !!(I && (I.locked || I.aimed));
  syncRig(P, dt);
}
/* shooting */
/** Fire whatever is equipped. Returns {hit, point, kind, target}; kind is
 * 'ped' | 'cop' | 'car' | 'wall' | 'miss'. The nearest blocker wins, so a shot
 * never passes through a wall or a bystander. */
export function fireWeapon(P, G) {
  const out = { hit: false, point: { x: 0, y: 0, z: 0 }, kind: null, target: null };
  if (P.dead) return out;
  const w = P.rifle ? CONFIG.weapons.rifle : CONFIG.weapons.pistol;
  if (P.cooldown > 0) return out;
  if (!w.infinite && P.ammo <= 0) { P.cooldown = 0.35; if (G.sound && G.sound.honk) G.sound.honk(0.3); return out; }
  P.cooldown = 1 / w.rate;
  if (!w.infinite) P.ammo = Math.max(0, P.ammo - 1);
  // Direction: camera yaw with the camera pitch folded in, plus config spread.
  const cam = (G.W && G.W.cam) || { yaw: P.yaw, pitch: 0.2 };
  const jit = () => (Math.random() - 0.5) * 2 * w.spread;
  const yaw = cam.yaw + jit(), pitch = (cam.pitch || 0) + jit(), cp = Math.cos(pitch);
  const dir = { x: -Math.sin(yaw) * cp, y: -Math.sin(pitch), z: -Math.cos(yaw) * cp };
  P.group.updateMatrixWorld(true);
  const eye = new THREE.Vector3();
  P.muzzle.getWorldPosition(eye);
  const oy = eye.y > 0.6 ? eye.y : 1.5;
  const sx = P.pos.x + dir.x * AIM_CLEAR, sz = P.pos.z + dir.z * AIM_CLEAR;
  let bestT = wallDistance(G.W, sx, oy, sz, dir, P.rifle ? 120 : 80);
  let kind = 'wall', target = null;
  const test = (x, z, y, r, k, obj) => {
    const t = raySphere(sx, oy, sz, dir, x, y, z, r);
    if (t >= 0 && t < bestT) { bestT = t; kind = k; target = obj; }
  };
  for (const cop of (G.PO && G.PO.foot) || []) {
    if (cop.down || cop.hp <= 0) continue;
    const c = cop.pos || cop;
    test(c.x, c.z, 1.1, 0.75, 'cop', cop);
  }
  for (const ped of G.peds || []) {
    if (ped.state === 'down' || ped.hp <= 0) continue;
    const c = ped.pos || ped;
    test(c.x, c.z, 1.0, 0.7, 'ped', ped);
  }
  for (const car of [...(G.cars || []), ...(G.traffic || [])]) {
    test(car.x, car.z, 0.9, car.radius || CONFIG.car.radius, 'car', car);
  }
  const end = { x: sx + dir.x * bestT, y: oy + dir.y * bestT, z: sz + dir.z * bestT };
  const from = { x: eye.x, y: oy, z: eye.z };
  if (G.effects) {
    if (G.effects.spawnMuzzle) G.effects.spawnMuzzle(from);
    if (G.effects.spawnTracer) G.effects.spawnTracer(from, end);
  }
  if (G.sound && G.sound.shot) G.sound.shot(P.rifle);
  out.point = end;
  if (target) {
    out.hit = true; out.kind = kind; out.target = target;
    if (kind === 'ped') G.damagePed && G.damagePed(target, w.dmg, G);
    else if (kind === 'cop') G.damageCop && G.damageCop(target, w.dmg, G);
    else if (target.player) target.hp -= w.dmg * 0.5;
    else G.damageTrafficCar && G.damageTrafficCar(target, w.dmg, G);
    if (kind === 'car' && G.effects && G.effects.spawnSmokePuff) G.effects.spawnSmokePuff(end, 0.4);
  } else out.kind = 'miss';
  // Gunfire draws every badge in the bay, hit or miss.
  G.alarm = 1; G.alarmX = P.pos.x; G.alarmZ = P.pos.z;
  return out;
}
/** Distance to the nearest building face along the ray, else the range. */
function wallDistance(W, x, y, z, dir, range) {
  let best = range;
  for (const b of (W && W.colliders) || []) {
    if (y > b.h) continue;
    const t = rayBox(x, z, dir.x, dir.z, b);
    if (t >= 0 && t < best) best = t;
  }
  return best;
}
/** Flat slab test; entry distance, or -1 when the ray misses the footprint. */
function rayBox(x, z, dx, dz, b) {
  let tmin = -1e9, tmax = 1e9;
  for (const [o, d, lo, hi] of [[x, dx, b.minX, b.maxX], [z, dz, b.minZ, b.maxZ]]) {
    if (Math.abs(d) < 1e-6) { if (o < lo || o > hi) return -1; continue; }
    let a = (lo - o) / d, c = (hi - o) / d;
    if (a > c) { const s = a; a = c; c = s; }
    tmin = Math.max(tmin, a); tmax = Math.min(tmax, c);
  }
  return tmax < 0 || tmin > tmax ? -1 : Math.max(0, tmin);
}
/** Ray against a target sphere of radius r; entry distance or -1. */
function raySphere(ox, oy, oz, d, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const proj = lx * d.x + ly * d.y + lz * d.z;
  if (proj < 0) return -1;
  const perp = lx * lx + ly * ly + lz * lz - proj * proj;
  return perp > r * r ? -1 : proj - Math.sqrt(Math.max(0, r * r - perp));
}
/* damage */
/** Take a hit: armour soaks 60% until spent, the rest lands on health. Zero
 * health is the game's problem, not this module's — call wasted(). */
export function damagePlayer(P, amt, G) {
  if (P.dead || amt <= 0) return;
  let left = amt;
  if (P.armor > 0) {
    const soaked = Math.min(P.armor, amt * 0.6);
    P.armor = P.armor - soaked < 0.01 ? 0 : P.armor - soaked;
    left = amt - soaked;
  }
  P.hp -= left;
  if (G.effects && G.effects.flashDamage) G.effects.flashDamage();
  if (P.hp <= 0) { P.hp = 0; P.dead = true; if (G.wasted) G.wasted(); }
}
/** Back on his feet. `where` is a point, a marker name ('hospital', 'station',
 * 'glassOrchid', 'vineMart') or nothing for the start pad. */
export function respawnPlayer(P, G, where) {
  const spot = pickSpawn(G && G.city, where);
  P.pos.x = spot.x; P.pos.z = spot.z;
  P.hp = spot.full ? CONFIG.player.hp : Math.max(30, CONFIG.player.hp * 0.6);
  P.dead = false; P.cooldown = 0.4; P.speed = 0; P.walkT = 0;
  if (spot.yaw !== undefined) P.yaw = spot.yaw;
  P.group.position.set(P.pos.x, 0, P.pos.z);
  P.group.rotation.y = P.yaw;
  P.figure.rotation.x = 0;
  if (G && G.W && G.W.cam) {
    G.W.cam.yaw = P.yaw;
    G.W.cam.target.set(P.pos.x, CONFIG.player.camHeight, P.pos.z);
  }
  syncRig(P, 0);
}
function pickSpawn(city, where) {
  const start = (city && city.spawns && city.spawns.playerStart) || { x: 0, z: 8 };
  const mk = (city && city.markers) || {};
  const base = { x: start.x, z: start.z, full: true };
  if (!where) return base;
  if (typeof where === 'object') {
    return { x: where.x ?? base.x, z: where.z ?? base.z, full: where.full !== false, yaw: where.yaw };
  }
  const near = (m, dz) => (m ? { x: m.x, z: m.z + dz, full: false } : base);
  if (where === 'hospital') return near(mk.hospital, 9);
  if (where === 'station') return near(mk.station, 9);
  if (where === 'glassOrchid') return near(mk.glassOrchid, 8);
  if (where === 'vineMart') return near(mk.vineMart, 8);
  return base;
}
/* pickups */
/** Give the player an item: the park rifle (flag only — the pistol stays
 * equipped), rounds, armour, a medkit or cash. */
export function givePickup(P, G, item) {
  if (!item) return false;
  const kind = typeof item === 'string' ? item : item.item || item.kind;
  const amount = (item && item.amount) || 0;
  const H = G && G.H;
  if (kind === 'rifle') { P.rifle = true; if (P.ammo <= 0) P.ammo = 30; toast(H, 'Rifle in hand'); }
  else if (kind === 'ammo') { const n = amount || CONFIG.weapons.rifle.ammoPerBuy; P.ammo += n; toast(H, `+${n} rounds`); }
  else if (kind === 'armor') { P.armor = Math.min(100, P.armor + (amount || 50)); toast(H, 'Body armour on'); }
  else if (kind === 'medkit') { P.hp = Math.min(CONFIG.player.hp, P.hp + (amount || 45)); toast(H, 'Patched up'); }
  else if (kind === 'cash') {
    const n = amount || 25;
    if (G.addMoney && G.E) G.addMoney(G.E, n, H); else if (G.E) G.E.money += n;
    toast(H, `+$${n}`);
  } else return false;
  if (G.sound && G.sound.chime) G.sound.chime();
  return true;
}
function toast(H, txt) {
  if (!H) return;
  if (H.toast) H.toast(txt);
  else if (H.setBanner) H.setBanner(txt, 1800);
}
/* helpers */
function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}
/** Rotate a toward b the short way, at most maxStep radians. */
function turnToward(a, b, maxStep) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
}
