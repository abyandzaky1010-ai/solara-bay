// Solara Bay: the player's body, on-foot control, the pistol/rifle, damage, respawn.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';

const PCFG = CONFIG.player;
const EYE = 1.42;
const BODY_R = 0.5;
const HEAD_Y = 1.16;
const FIRE_GAP = 0.12;

function box(w, h, d, hex) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex));
  mesh.castShadow = true;
  return mesh;
}

// Geometry hangs below the pivot so rotation.x swings the limb.
function limb(w, h, d, hex) {
  const geo = new THREE.BoxGeometry(w, h, d).translate(0, -h / 2, 0);
  const mesh = new THREE.Mesh(geo, material(hex));
  mesh.castShadow = true;
  return mesh;
}

function buildCharacter() {
  const group = new THREE.Group();
  const torso = box(0.56, 0.62, 0.32, C.shirt[0]).translateY(1.02);
  const hips = box(0.5, 0.3, 0.3, C.pants[0]).translateY(0.6);
  const head = box(0.34, 0.36, 0.34, C.skin[0]).translateY(HEAD_Y);
  const cap = box(0.36, 0.14, 0.36, C.sport).translateY(HEAD_Y + 0.21);
  const brim = box(0.34, 0.06, 0.2, C.sport).translateZ(-0.26);
  const shades = box(0.36, 0.09, 0.06, C.beacon).translateZ(-0.17);
  brim.position.y = head.position.y - 0.05;
  shades.position.y = head.position.y + 0.04;
  const armL = limb(0.16, 0.58, 0.16, C.shirt[0]).translateX(-0.36).translateY(1.3);
  const armR = limb(0.16, 0.58, 0.16, C.shirt[0]).translateX(0.36).translateY(1.3);
  const legL = limb(0.2, 0.62, 0.22, C.pants[0]).translateX(-0.15).translateY(0.58);
  const legR = limb(0.2, 0.62, 0.22, C.pants[0]).translateX(0.15).translateY(0.58);

  const gun = new THREE.Group();
  gun.add(box(0.07, 0.1, 0.26, 0x2b2f33));
  const grip = box(0.07, 0.16, 0.08, 0x33383d);
  grip.position.set(0, -0.12, 0.07);
  gun.add(grip);
  gun.position.set(0.36, 1.02, -0.3);

  const rifle = new THREE.Group();
  rifle.add(box(0.08, 0.12, 0.9, C.trunk));
  const barrel = box(0.05, 0.05, 0.5, 0x2b2f33);
  barrel.position.set(0, 0.03, -0.62);
  rifle.add(barrel);
  rifle.position.copy(gun.position);
  rifle.position.y += 0.04;
  rifle.visible = false;

  const rig = { torso, head, cap, armL, armR, legL, legR, gun, rifle };
  group.add(torso, hips, head, cap, brim, shades, armL, armR, legL, legR, gun, rifle);
  return { group, rig };
}

export function createPlayer(W, city) {
  const { group, rig } = buildCharacter();
  const start = city?.spawns?.playerStart || { x: -20, z: -18 };
  group.position.set(start.x, 0, start.z);
  W.scene.add(group);
  return {
    group,
    rig,
    pos: new THREE.Vector3(start.x, 0, start.z),
    yaw: 0,
    hp: PCFG.hp,
    armor: 0,
    weapon: 'pistol',
    rifle: false,
    ammo: 0,
    dead: false,
    cooldown: 0,
    aim: false,
    walkT: 0,
    speed: 0,
    hurtT: 0,
  };
}

// Which gun fires: the rifle when owned and loaded with ammo.
function activeWeapon(P) {
  return P.rifle && P.ammo > 0
    ? { name: 'rifle', def: CONFIG.weapons.rifle }
    : { name: 'pistol', def: CONFIG.weapons.pistol };
}

// The rifle shows in hand once owned; an empty one still counts as the held weapon.
function syncWeaponMeshes(P) {
  const rf = P.rifle && P.ammo > 0;
  P.rig.rifle.visible = rf;
  P.rig.gun.visible = !rf;
  P.weapon = rf ? 'rifle' : 'pistol';
}

// Everything a bullet can hit.
function candidates(G) {
  const out = [];
  for (const p of G.peds || []) {
    if (p && p.state !== 'down' && p.hp > 0) out.push({ x: p.pos.x, z: p.pos.z, r: 0.7, kind: 'ped', target: p });
  }
  for (const c of G.PO?.foot || []) {
    if (c && !c.down && c.hp > 0) out.push({ x: c.pos.x, z: c.pos.z, r: 0.7, kind: 'cop', target: c });
  }
  for (const car of G.traffic || []) out.push({ x: car.x, z: car.z, r: 0.95, kind: 'car', target: car });
  for (const car of G.cars || []) out.push({ x: car.x, z: car.z, r: 0.95, kind: 'car', target: car });
  for (const cop of G.PO?.cars || []) {
    if (cop.mesh) out.push({ x: cop.mesh.position.x, z: cop.mesh.position.z, r: 1.1, kind: 'copcar', target: cop });
  }
  return out;
}

// First wall along a ray, so tracers stop at geometry.
function wallAlong(W, ox, oz, dirX, dirZ, maxD) {
  for (let s = 0.6; s < maxD; s += 0.6) {
    const x = ox + dirX * s;
    const z = oz + dirZ * s;
    for (const b of W.colliders) {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return s;
    }
  }
  return maxD;
}

export function updatePlayerFoot(P, G, I, dt) {
  if (P.cooldown > 0) P.cooldown = Math.max(0, P.cooldown - dt);
  if (P.hurtT > 0) P.hurtT = Math.max(0, P.hurtT - dt);
  if (P.dead || !G || G.screen !== 'play' || G.inCar) return;

  const camYaw = G.W.yaw;
  let ix = 0;
  let iz = 0;
  if (I?.locked) {
    if (I.down('KeyW') || I.down('ArrowUp')) iz -= 1;
    if (I.down('KeyS') || I.down('ArrowDown')) iz += 1;
    if (I.down('KeyA') || I.down('ArrowLeft')) ix -= 1;
    if (I.down('KeyD') || I.down('ArrowRight')) ix += 1;
  }

  const fwdX = -Math.sin(camYaw);
  const fwdZ = -Math.cos(camYaw);
  let mx = fwdX * -iz + Math.cos(camYaw) * ix;
  let mz = fwdZ * -iz - Math.sin(camYaw) * ix;
  const mag = Math.hypot(mx, mz);

  const sprinting = (I.down('ShiftLeft') || I.down('ShiftRight')) && mag > 0;
  const top = (sprinting ? PCFG.sprint : PCFG.walk) * Math.min(1, mag);

  if (mag > 0) {
    mx /= mag;
    mz /= mag;
    P.yaw = Math.atan2(-mx, -mz);
  } else {
    P.yaw = camYaw;
  }

  P.speed += (top - P.speed) * Math.min(1, dt * 12);
  if (P.speed < 0.02) P.speed = 0;

  const step = P.speed * dt;
  if (step > 0.0001) {
    const res = resolveMove(G.W, P.pos.x, P.pos.z, BODY_R, mx * step, mz * step);
    P.pos.x = res.x;
    P.pos.z = res.z;
  }

  // Walk cycle.
  const stride = P.speed / PCFG.walk;
  if (P.speed > 0.1) P.walkT += dt * (2.2 + stride * 4.6);
  const swing = Math.sin(P.walkT * 2) * 0.7 * Math.min(1, stride);
  const bob = Math.abs(Math.sin(P.walkT * 2)) * 0.045 * Math.min(1, stride);
  P.rig.legL.rotation.x = swing;
  P.rig.legR.rotation.x = -swing;
  P.rig.armL.rotation.x = -swing * 0.85;
  P.rig.armR.rotation.x = P.aim ? -1.32 : swing * 0.85;
  P.rig.torso.position.y = 1.02 + bob;
  P.rig.head.position.y = HEAD_Y + bob;
  P.rig.cap.position.y = HEAD_Y + 0.21 + bob;

  P.group.position.set(P.pos.x, 0, P.pos.z);
  P.group.rotation.y = P.yaw;
  P.group.visible = !P.dead;
  syncWeaponMeshes(P);
}

// One trigger pull: rate gate, spread, ray cast, damage callbacks, effects.
export function fireWeapon(P, G) {
  if (!P || P.dead || !G || P.cooldown > 0) return { hit: false, point: null, kind: 'none', target: null };
  const { name, def } = activeWeapon(P);
  if (name === 'rifle' && P.ammo <= 0) return { hit: false, point: null, kind: 'empty', target: null };

  P.cooldown = Math.max(FIRE_GAP, 1 / def.rate);
  if (name === 'rifle') P.ammo = Math.max(0, P.ammo - 1);

  const jitter = (Math.random() * 2 - 1) * def.spread;
  const angle = P.yaw + jitter;
  const dirX = -Math.sin(angle);
  const dirZ = -Math.cos(angle);
  const ox = P.pos.x;
  const oz = P.pos.z;
  const range = 70;

  // First target whose perpendicular distance is inside its radius.
  let best = null;
  for (const c of candidates(G)) {
    const rx = c.x - ox;
    const rz = c.z - oz;
    const along = rx * dirX + rz * dirZ;
    if (along <= 0.4 || along > range) continue;
    if (Math.abs(rx * dirZ - rz * dirX) > c.r) continue;
    if (!best || along < best.along) best = { along, c };
  }

  const wall = wallAlong(G.W, ox, oz, dirX, dirZ, range);
  const reach = best && best.along < wall ? best.along : wall;
  const camPitch = Math.max(-0.45, Math.min(0.5, -(G.W.pitch || 0) * 0.35));
  const point = { x: ox + dirX * reach, y: EYE + Math.sin(camPitch) * reach, z: oz + dirZ * reach };

  const muzzle = { x: ox + dirX * 0.6, y: EYE - 0.05, z: oz + dirZ * 0.6 };
  G.effects?.spawnMuzzle(muzzle);
  G.effects?.spawnTracer(muzzle, point);
  G.sound?.shot?.();

  // Gunfire raises the alarm at the shooter.
  G.alarm = 1;
  G.alarmX = ox;
  G.alarmZ = oz;
  P.aim = true;

  if (!best || best.along >= wall) return { hit: false, point, kind: 'miss', target: null };

  const { kind, target } = best.c;
  if (kind === 'ped') G.damagePed?.(target, def.dmg);
  else if (kind === 'cop') G.damageCop?.(target, def.dmg);
  else G.damageTrafficCar?.(target, def.dmg, P.pos);
  return { hit: true, point, kind, target };
}

// Armor soaks 60% per hit until empty, then health takes the rest.
export function damagePlayer(P, amt, G) {
  if (!P || P.dead || amt <= 0) return;
  let incoming = amt;
  if (P.armor > 0) {
    const soaked = incoming * 0.6;
    const absorbed = Math.min(P.armor, soaked);
    P.armor = Math.max(0, P.armor - absorbed);
    incoming -= absorbed;
  }
  P.hp = Math.max(0, P.hp - incoming);
  P.hurtT = 0.35;
  G?.effects?.flashDamage?.();
  if (P.hp <= 0) {
    P.dead = true;
    P.speed = 0;
    G?.wasted?.();
  }
}

export function respawnPlayer(P, G, where) {
  const spot = where || { x: -138, z: 150 };
  P.pos.set(spot.x, 0, spot.z);
  P.group.position.set(spot.x, 0, spot.z);
  P.hp = PCFG.hp;
  P.armor = 0;
  P.dead = false;
  P.cooldown = 0;
  P.speed = 0;
  P.walkT = 0;
  P.yaw = G?.W?.yaw || 0;
  P.group.rotation.y = P.yaw;
  P.group.visible = true;
}

// 'rifle' unlocks the crate gun; cash/ammo/armor top up the player.
export function givePickup(P, G, item) {
  if (!item) return false;
  const name = typeof item === 'string' ? item : item.item || item.kind;
  if (name === 'rifle') {
    P.rifle = true;
    P.rig.rifle.visible = true;
    return true;
  }
  if (name === 'cash' || name === 'money') {
    G?.addMoney?.((typeof item === 'object' && item.amount) || 50);
    return true;
  }
  if (name === 'ammo') {
    P.ammo += CONFIG.weapons.rifle.ammoPerBuy;
    syncWeaponMeshes(P);
    return true;
  }
  if (name === 'armor') {
    P.armor = Math.min(100, P.armor + 50);
    return true;
  }
  return false;
}
