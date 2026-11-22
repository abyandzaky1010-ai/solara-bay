// Solara Bay — the woman you play: her low-poly body, her boots on the pavement,
// and her two guns. Third person, always: the mouse turns the camera and she
// turns with it, so wherever the lens looks is where the bullets go.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';

const PLAYER = CONFIG.player;
const GUNS = CONFIG.weapons;
const LIMIT = CONFIG.world.half - 1;
const EYE = 1.55; // m, where a bullet leaves her hands
const REACH = 46; // m, the tracer's length where nothing stops it
const PAD = 0.55; // forgiveness on moving targets
const A = Math.PI * 2;

const face = (p, b, h, d, hex, x, y, z) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(b, h, d), material(hex));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  p.add(mesh);
  return mesh;
};

/** A limb hung from a shoulder or hip pivot, so it swings like a pendulum. */
function limb(p, x, y, hex, len, thick) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  face(pivot, thick, len, thick, hex, 0, -len / 2, 0);
  p.add(pivot);
  return pivot;
}

/** Her body: coral shirt, dark trousers, pale head, dark cap, boots, pistol. */
function buildWoman() {
  const group = new THREE.Group();
  group.name = 'vesper';
  const body = new THREE.Group();
  group.add(body);
  const pants = C.pants[0];
  const skin = C.skin[0];
  face(body, 0.62, 0.34, 0.34, pants, 0, 0.86, 0);
  face(body, 0.68, 0.62, 0.36, C.shirt[0], 0, 1.2, 0);
  face(body, 0.3, 0.12, 0.3, skin, 0, 1.52, 0);
  face(body, 0.4, 0.4, 0.4, skin, 0, 1.74, 0);
  face(body, 0.44, 0.1, 0.44, 0x2b2f36, 0, 1.96, 0);
  face(body, 0.36, 0.06, 0.22, 0x23272d, 0, 1.94, -0.26);
  const [armL, armR] = [-0.42, 0.42].map((x, i) => limb(body, x, 1.44, C.skin[i], 0.72, 0.17));
  const [legL, legR] = [-0.16, 0.16].map((x) => limb(body, x, 0.8, pants, 0.8, 0.21));
  // Boots ride on the shin, so the feet tilt with the stride.
  for (const leg of [legL, legR]) limb(leg, 0, -0.78, 0x2a2620, 0.24, 0.23);
  face(armR, 0.08, 0.08, 0.34, 0x22262c, 0, -0.66, -0.16);
  return { group, body, armL, armR, legL, legR };
}

/** Her rifle, parked on the body and shown only while she carries one. */
function showRifle(P, on) {
  if (!P.rifleMesh) {
    P.rifleMesh = face(P.parts.body, 0.09, 0.11, 0.86, 0x332c26, 0.24, 1.4, 0.16);
    face(P.rifleMesh, 0.05, 0.05, 0.5, 0x1a1d21, 0, 0.03, -0.58);
  }
  P.rifleMesh.visible = !!on;
}

/** createPlayer(W, city) → P: her at the city's start point, pistol drawn. */
export function createPlayer(W, city) {
  const parts = buildWoman();
  const start = city?.spawns?.playerStart || { x: 16, z: -8 };
  const P = {
    group: parts.group, parts,
    pos: new THREE.Vector3(start.x, 0, start.z),
    speed: 0, yaw: 0, hp: PLAYER.hp, armor: 0,
    weapon: 'pistol', rifle: false, ammo: 0, rifleMesh: null,
    dead: false, cooldown: 0, aim: false, walkT: 0, seatT: 0, flashT: 0,
    // The flare that lights her hands for three frames after a shot.
    muzzle: new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), new THREE.MeshBasicMaterial({ color: 0xfff0bf })),
  };
  P.muzzle.visible = false;
  P.group.position.set(P.pos.x, 0, P.pos.z);
  P.group.add(P.muzzle);
  if (W?.scene) W.scene.add(P.group);
  return P;
}

// ------------------------------------------------------------------ on foot

/** Seek a heading toward `to` the short way round the circle. */
function turnTo(from, to) {
  const d = (to - from) % A;
  return d > Math.PI ? d - A : d < -Math.PI ? d + A : d;
}

/** Lean the legs and arms around a stride whose phase is walkT. */
function stride(P, swing, run) {
  const { armL, armR, legL, legR, body } = P.parts;
  const s = Math.sin(P.walkT) * swing;
  legL.rotation.x = s;
  legR.rotation.x = -s;
  // Arms counter-swing the legs; a sprint tucks them in and leans her forward.
  armL.rotation.x = -s * (run ? 1.25 : 1);
  armR.rotation.x = s * 0.35;
  body.position.y = Math.abs(Math.cos(P.walkT)) * (run ? 0.07 : 0.04);
  body.rotation.x = run ? 0.12 : 0;
}

/** One fixed step on foot: camera-relative move, sprint on Shift, stride by speed. */
export function updatePlayerFoot(P, G, I, dt) {
  if (!P || !G || P.dead) return P;
  const k = (code) => !!I?.down?.(code);
  const fwd = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
  const side = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
  const run = (k('ShiftLeft') || k('ShiftRight')) && fwd !== 0;
  if (P.cooldown > 0) P.cooldown = Math.max(0, P.cooldown - dt);
  // Camera-relative: W goes where the lens looks, D goes camera-right.
  const yaw = G.W.yaw ?? 0;
  const mx = Math.sin(yaw) * fwd + Math.cos(yaw) * side;
  const mz = Math.cos(yaw) * fwd - Math.sin(yaw) * side;
  const clamp = (v) => Math.max(-LIMIT, Math.min(LIMIT, v));
  const mag = Math.hypot(mx, mz);
  if (mag > 0.001) {
    const top = run ? PLAYER.sprint : PLAYER.walk;
    P.speed = Math.min(top, P.speed + (top - P.speed) * Math.min(1, dt * 9) + dt * 2);
    const step = (P.speed * dt) / mag;
    const moved = resolveMove(G.W, P.pos.x, P.pos.z, PLAYER.radius, mx * step, mz * step);
    if (moved.hit) P.speed *= 0.7;
    P.pos.set(clamp(moved.x), 0, clamp(moved.z));
  } else P.speed = Math.max(0, P.speed - dt * 16);
  // She faces where the camera looks: aim is the camera, third person only.
  P.yaw += turnTo(P.yaw, yaw) * Math.min(1, dt * (mag > 0.001 ? 12 : 6));
  P.walkT += dt * (P.speed * 2.2 + (P.speed > 0.2 ? 1 : 0));
  stride(P, Math.min(0.95, P.speed / PLAYER.walk) * 0.85, run);
  P.aim = true;
  P.group.position.set(P.pos.x, 0, P.pos.z);
  P.group.rotation.y = P.yaw;
  return P;
}

/** Housekeeping that must run even while she is stowed in a car. */
export function updatePlayerTimers(P, dt) {
  if (!P) return;
  if (P.cooldown > 0) P.cooldown = Math.max(0, P.cooldown - dt);
  if (P.seatT > 0) P.seatT -= dt;
  if (P.flashT > 0 && (P.flashT -= dt) <= 0) P.muzzle.visible = false;
}

// ------------------------------------------------------------------ guns

/** Fire along the aim yaw with spread; damage via G callbacks, tracer via render. */
export function fireWeapon(P, G) {
  if (!P || !G || P.dead || P.cooldown > 0) return null;
  const rifle = P.weapon === 'rifle' && P.rifle && P.ammo > 0;
  const gun = rifle ? GUNS.rifle : GUNS.pistol;
  P.cooldown = 1 / gun.rate;
  if (rifle && --P.ammo <= 0) Object.assign(P, { rifle: false, weapon: 'pistol', ammo: 0 });
  showRifle(P, P.rifle);
  const yaw = (G.W.yaw ?? P.yaw) + (Math.random() - 0.5) * 2 * gun.spread;
  const pitch = (G.W.pitchAngle ?? 0.18) - 0.05;
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize();
  const eye = { x: P.pos.x, y: EYE, z: P.pos.z };
  const hit = traceShot(G, eye, dir, gun.dmg);
  const len = hit ? hit.dist : REACH;
  const end = { x: eye.x + dir.x * len, y: Math.max(0.1, eye.y + dir.y * len), z: eye.z + dir.z * len };
  P.muzzle.position.set(0.42, EYE - 0.29, 0.55);
  P.muzzle.visible = true;
  P.flashT = 0.05;
  G.effects?.spawnMuzzle?.(eye);
  G.effects?.spawnTracer?.(eye, end);
  G.sound?.shot?.();
  // Gunplay wakes the block; pedestrians scatter away from her.
  Object.assign(G, { alarm: 1, alarmX: P.pos.x, alarmZ: P.pos.z });
  return { hit: !!hit, kind: hit ? hit.kind : 'none', target: hit ? hit.target : null, point: end, dist: len, rifle };
}

/** Ray against an upright cylinder — the standing shape of peds, cops and cars. */
function cylinder(eye, dir, t, r) {
  const ox = eye.x - t.x;
  const oz = eye.z - t.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a < 1e-6) return null;
  const b = 2 * (ox * dir.x + oz * dir.z);
  const disc = b * b - 4 * a * (ox * ox + oz * oz - (r + PAD) ** 2);
  if (disc < 0) return null;
  const mid = -b / (2 * a);
  const root = Math.sqrt(disc) / (2 * a);
  const s = mid - root > 0 ? mid - root : mid + root;
  if (s <= 0 || s > REACH) return null;
  const y = eye.y + dir.y * s;
  return y >= t.y0 && y <= t.y1 ? s : null;
}

/** Distance to a box's front face along the ray, or null when the ray misses. */
function slab(e, d, b, maxT) {
  const lo = [b.minX, 0, b.minZ];
  const hi = [b.maxX, b.h || 20, b.maxZ];
  let near = 0;
  let far = maxT;
  for (const [i, o] of [e.x, e.y, e.z].entries()) {
    const v = [d.x, d.y, d.z][i];
    if (Math.abs(v) < 1e-6) {
      if (o < lo[i] || o > hi[i]) return null;
      continue;
    }
    const t0 = (lo[i] - o) / v;
    const t1 = (hi[i] - o) / v;
    near = Math.max(near, Math.min(t0, t1));
    far = Math.min(far, Math.max(t0, t1));
  }
  return near > 0 && near <= far ? near : null;
}

/** Whatever the ray reaches first, with the damage already handed to G. */
function traceShot(G, eye, dir, dmg) {
  const best = { dist: REACH, kind: 'none', target: null };
  const keep = (t, kind, target) => {
    if (t !== null && t < best.dist) Object.assign(best, { dist: t, kind, target });
  };
  const stand = (x, z, y0, y1, r, kind, target) => keep(cylinder(eye, dir, { x, z, y0, y1 }, r), kind, target);
  for (const ped of G.peds || []) if (ped && ped.state !== 'down' && !ped.riding) stand(ped.pos.x, ped.pos.z, 0, 1.8, ped.radius || 0.42, 'ped', ped);
  for (const o of G.cops || []) {
    const cop = o.cop || o;
    if (cop && !cop.down) stand(cop.pos?.x ?? o.x, cop.pos?.z ?? o.z, 0, 1.9, 0.6, 'cop', cop);
  }
  for (const car of (G.traffic || []).concat(G.cars || [])) if (car && !car.wrecked) stand(car.x, car.z, 0.3, 1.9, car.radius || 1.4, 'car', car);
  for (const b of G.W?.colliders || []) keep(slab(eye, dir, b, best.dist), 'wall', null);
  if (best.kind === 'ped') G.damagePed?.(best.target, dmg, G);
  else if (best.kind === 'cop') G.damageCop?.(best.target, dmg, G);
  else if (best.kind === 'car') G.damageTrafficCar?.(best.target, dmg);
  return best.kind === 'none' ? null : best;
}

// ------------------------------------------------------------------ damage and death

/** Take a hit: armour soaks 60% first, then hp; at zero she is wasted via G. */
export function damagePlayer(P, amount, G) {
  if (!P || P.dead) return 0;
  const hit = Math.max(0, amount || 0);
  const soak = Math.min(P.armor, hit * 0.6);
  P.armor -= soak;
  P.hp = Math.max(0, P.hp - hit + soak);
  G?.effects?.flashDamage?.();
  if (P.hp <= 0) {
    Object.assign(P, { dead: true, speed: 0 });
    P.group.rotation.z = Math.PI / 2;
    G?.wasted?.();
  }
  return hit - soak;
}

/** Put her back on her feet at `where`, whole, armed and facing the old way. */
export function respawnPlayer(P, G, where) {
  if (!P) return P;
  const at = where || { x: 16, z: -8 };
  Object.assign(P, { dead: false, speed: 0, cooldown: 0, seatT: 0, flashT: 0, hp: PLAYER.hp });
  P.pos.set(at.x, 0, at.z);
  P.group.position.set(at.x, 0, at.z);
  P.group.rotation.set(0, P.yaw || 0, 0);
  P.group.visible = true;
  P.parts.body.position.y = 0;
  P.muzzle.visible = false;
  if (G?.W) Object.assign(G.W, { ready: false, yaw: P.yaw || 0 });
}

/** Hide her in a car seat; main owns where the camera goes from there. */
export function stowPlayer(P) {
  if (!P) return;
  P.seatT = Infinity;
  P.speed = 0;
  P.group.visible = false;
}

/** Step her out of the car at x,z facing heading. */
export function unseatPlayer(P, x, z, heading) {
  if (!P) return;
  Object.assign(P, { seatT: 0, speed: 0, yaw: heading });
  P.pos.set(x, 0, z);
  P.group.position.set(x, 0, z);
  P.group.rotation.set(0, heading, 0);
  P.group.visible = true;
}

/** Walk-over pickups: the rifle (no rounds — the shop sells those), armour, health, cash. */
export function givePickup(P, G, item) {
  if (!P || !item) return false;
  if (item === 'rifle') {
    if (P.rifle) return false;
    Object.assign(P, { rifle: true, weapon: 'rifle' });
    showRifle(P, true);
    G?.H?.toast?.('Rifle picked up. Q swaps, ammo at the Vine Mart.');
    G?.sound?.chime?.();
  } else if (item === 'armor') P.armor = CONFIG.economy.armorCap;
  else if (item === 'health') P.hp = PLAYER.hp;
  else if (item === 'cash') G?.addMoney?.(50);
  else return false;
  return true;
}
