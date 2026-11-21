// Solara Bay — the player: a small low-poly body, on-foot movement,
// the weapon in her hand and what happens when she gets hit. Third person only.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';

// How far the arm swings at full sprint, in radians, and how fast the cycle runs.
const ARM_SWING = 0.85;
const LEG_SWING = 0.75;
const STRIDE_RATE = 2.3;
const EYE_HEIGHT = 1.55;
const BODY_RADIUS = 0.5;

// Limbs are pivoted groups so the swing rotates around the shoulder or the hip,
// not around the middle of the mesh.
function limb(width, length, depth, paint, jointY) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, length, depth), paint);
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  group.add(mesh);
  group.position.y = jointY;
  return group;
}

function buildCharacterMesh() {
  const root = new THREE.Group();
  const skin = material(C.skin[0]);
  const shirt = material(C.shirt[0]);
  const pants = material(C.pants[0]);

  // Torso: the coral shirt.
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), shirt);
  torso.position.y = 1.16;
  torso.castShadow = true;
  root.add(torso);

  // Hips.
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.26, 0.32), pants);
  hips.position.y = 0.72;
  hips.castShadow = true;
  root.add(hips);

  // Head + a dark sunglasses band across the eyes.
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.32), skin);
  head.position.y = 1.74;
  head.castShadow = true;
  root.add(head);
  const shades = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.1), material(0x1d2226));
  shades.position.set(0, 1.77, 0.17);
  root.add(shades);

  // Short dark hair, worn as a cap of its own.
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.12, 0.35), material(0x30241c));
  hair.position.y = 1.94;
  hair.castShadow = true;
  root.add(hair);

  const armL = limb(0.17, 0.62, 0.17, skin, 1.46);
  armL.position.x = -0.4;
  const armR = limb(0.17, 0.62, 0.17, skin, 1.46);
  armR.position.x = 0.4;
  const legL = limb(0.19, 0.72, 0.2, pants, 0.7);
  legL.position.x = -0.15;
  const legR = limb(0.19, 0.72, 0.2, pants, 0.7);
  legR.position.x = 0.15;
  root.add(armL, armR, legL, legR);

  // Pistol barrel, held in the right hand, pointing along +Z when aimed.
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.34), material(0x3b4148));
  gun.position.set(0.4, 1.2, 0.26);
  root.add(gun);

  return { root, armL, armR, legL, legR, gun };
}

export function createPlayer(W, city) {
  const parts = buildCharacterMesh();
  const start = (city && city.spawns && city.spawns.playerStart) || { x: -40, z: -8 };
  parts.root.position.set(start.x, 0, start.z);
  W.scene.add(parts.root);

  const P = {
    group: parts.root,
    parts,
    pos: { x: start.x, y: 0, z: start.z },
    yaw: 0,
    hp: CONFIG.player.hp,
    armor: 0,
    weapon: 'pistol',
    rifle: false,
    ammo: 0,
    dead: false,
    cooldown: 0,
    aim: false,
    walkT: 0,
    hurtT: 0,
  };
  return P;
}

// Camera-relative WASD. The body always faces the way the camera looks, so the
// shoulder view and the aim agree.
export function updatePlayerFoot(P, G, I, dt) {
  if (P.dead) return;
  const walk = CONFIG.player.walk;
  const sprint = CONFIG.player.sprint;
  const view = G && G.W ? G.W.view : null;
  const camYaw = view ? view.yaw : 0;

  // Forward in world space is the direction the camera looks along -Z.
  const fx = -Math.sin(camYaw);
  const fz = -Math.cos(camYaw);
  const rx = -fz;
  const rz = fx;

  let moveX = 0;
  let moveZ = 0;
  if (I) {
    if (I.down('KeyW')) { moveX += fx; moveZ += fz; }
    if (I.down('KeyS')) { moveX -= fx; moveZ -= fz; }
    if (I.down('KeyD')) { moveX += rx; moveZ += rz; }
    if (I.down('KeyA')) { moveX -= rx; moveZ -= rz; }
  }
  const pressing = moveX !== 0 || moveZ !== 0;
  const dash = !!I && (I.down('ShiftLeft') || I.down('ShiftRight'));
  const speed = dash ? sprint : walk;

  if (pressing) {
    const len = Math.hypot(moveX, moveZ) || 1;
    moveX /= len;
    moveZ /= len;
    const step = speed * dt;
    const moved = resolveMove(G.W, P.pos.x, P.pos.z, BODY_RADIUS, moveX * step, moveZ * step);
    P.pos.x = moved.x;
    P.pos.z = moved.z;
    P.walkT += dt * STRIDE_RATE * (speed / walk);
  } else {
    P.walkT += dt * 1.2;
  }

  // Face the camera, unless the aim is already pointing somewhere else this frame.
  P.yaw = camYaw;
  P.aim = !!I && I.locked;

  const swing = pressing ? Math.sin(P.walkT) : Math.sin(P.walkT) * 0.12;
  const amp = pressing ? (dash ? 1 : 0.72) : 0.12;
  P.parts.legL.rotation.x = swing * LEG_SWING * amp;
  P.parts.legR.rotation.x = -swing * LEG_SWING * amp;
  P.parts.armL.rotation.x = -swing * ARM_SWING * amp;
  // The gun arm stays half-raised forward while aiming, or swings when running.
  P.parts.armR.rotation.x = P.aim ? -0.9 + swing * 0.1 : swing * ARM_SWING * amp;
  P.parts.gun.visible = P.aim;

  P.group.position.set(P.pos.x, 0, P.pos.z);
  P.group.rotation.y = P.yaw;

  if (P.cooldown > 0) P.cooldown = Math.max(0, P.cooldown - dt);
  if (P.hurtT > 0) P.hurtT = Math.max(0, P.hurtT - dt);
  P.pos.y = 0;
}

// Eye position and aim direction, shared by the raycast and the tracer.
function aimRay(P, G) {
  const pitch = G && G.W && G.W.view ? G.W.view.pitch : 0;
  const eye = new THREE.Vector3(P.pos.x, EYE_HEIGHT, P.pos.z);
  const dir = new THREE.Vector3(-Math.sin(P.yaw), -Math.sin(pitch), -Math.cos(P.yaw));
  dir.normalize();
  return { eye, dir };
}

// Ray against every target the game keeps. Traffic cars sit on the same list as
// the player's, so shooting someone's sedan counts. Returns the nearest hit.
function raycastTargets(P, G, eye, dir, reach, radius, skippable) {
  let best = null;
  const check = (body, kind, list) => {
    if (!body) return;
    if (skippable && skippable(body)) return;
    if (body.dead || body.state === 'down') return;
    const tx = body.x !== undefined ? body.x : body.pos && body.pos.x;
    const tz = body.z !== undefined ? body.z : body.pos && body.pos.z;
    if (tx === undefined || tz === undefined) return;
    const dx = tx - eye.x;
    const dz = tz - eye.z;
    const along = dx * dir.x + dz * dir.z;
    if (along <= 0 || along > reach) return;
    const side = Math.abs(dx * dir.z - dz * dir.x);
    if (side > radius) return;
    if (!best || along < best.dist) best = { dist: along, kind, target: body, list };
  };

  const traffic = (G && G.traffic) || [];
  for (const car of traffic) check(car, 'traffic', traffic);
  const peds = (G && G.peds) || [];
  for (const ped of peds) check(ped, 'ped', peds);
  const police = G && G.PO;
  const foot = (police && police.foot) || [];
  for (const cop of foot) check(cop, 'cop', foot);
  return best;
}

export function fireWeapon(P, G) {
  const cfg = CONFIG.weapons[P.weapon] || CONFIG.weapons.pistol;
  if (!G || P.dead || P.cooldown > 0) return { hit: false };

  // A rifle has to be fed; the pistol never runs dry.
  if (!cfg.infinite) {
    if (P.ammo <= 0) {
      if (G.sound && G.sound.click) G.sound.click();
      P.cooldown = 0.35;
      return { hit: false };
    }
    P.ammo -= 1;
  }
  P.cooldown = 1 / cfg.rate;

  const { eye, dir } = aimRay(P, G);
  // Spread: a small random wobble on the aim, tighter for the pistol.
  const jitter = cfg.spread;
  dir.x += (Math.random() * 2 - 1) * jitter;
  dir.y += (Math.random() * 2 - 1) * jitter;
  dir.z += (Math.random() * 2 - 1) * jitter;
  dir.normalize();

  const muzzle = new THREE.Vector3(
    eye.x + dir.x * 0.6,
    eye.y - 0.12 + dir.y * 0.6,
    eye.z + dir.z * 0.6,
  );

  if (G.sound && G.sound.shot) G.sound.shot();

  const reach = P.weapon === 'rifle' ? 90 : 60;
  const hit = raycastTargets(P, G, eye, dir, reach, 0.85, (body) => body.player);
  const end = hit
    ? new THREE.Vector3(eye.x + dir.x * hit.dist, eye.y + dir.y * hit.dist, eye.z + dir.z * hit.dist)
    : new THREE.Vector3(eye.x + dir.x * reach, eye.y + dir.y * reach, eye.z + dir.z * reach);

  if (G.effects) {
    G.effects.spawnMuzzle(muzzle);
    G.effects.spawnTracer(muzzle, end);
  }

  // Gunfire is loud: the neighbourhood pricks up its ears wherever you are.
  G.alarm = 1;
  G.alarmX = P.pos.x;
  G.alarmZ = P.pos.z;

  if (!hit) return { hit: false, point: end, kind: null, target: null };

  if (hit.kind === 'ped') {
    const ped = hit.target;
    ped.hp = (ped.hp || CONFIG.peds.hp) - cfg.dmg;
    const killed = ped.hp <= 0;
    ped.state = killed ? 'down' : 'flee';
    ped.fleeT = 4;
    ped.hitBy = 'shot';
    if (G.damagePed) G.damagePed(ped, cfg.dmg, killed);
    if (killed && G.onPedKill) G.onPedKill(ped);
  } else if (hit.kind === 'cop') {
    if (G.damageCop) G.damageCop(hit.target, cfg.dmg);
  } else if (hit.kind === 'traffic') {
    if (G.damageTrafficCar) G.damageTrafficCar(hit.target, cfg.dmg);
  }

  return { hit: true, point: end, kind: hit.kind, target: hit.target };
}

export function damagePlayer(P, amt, G) {
  if (P.dead || amt <= 0) return;
  let rest = amt;
  if (P.armor > 0) {
    const soaked = Math.min(P.armor, amt * 0.6);
    P.armor = Math.max(0, P.armor - soaked);
    rest = amt - soaked;
  }
  P.hp = Math.max(0, P.hp - rest);
  P.hurtT = 0.2;
  if (G && G.effects && G.effects.flashDamage) G.effects.flashDamage();
  if (P.hp <= 0 && !P.dead) {
    P.dead = true;
    if (G && G.wasted) G.wasted();
  }
}

export function respawnPlayer(P, G, where) {
  const spot = where || (G && G.city && G.city.places && G.city.places.hospital) || { x: -40, z: -8 };
  P.pos.x = spot.x;
  P.pos.z = spot.z;
  P.pos.y = 0;
  P.hp = CONFIG.player.hp;
  P.dead = false;
  P.cooldown = 0;
  P.walkT = 0;
  P.hurtT = 0;
  if (P.armor < 0) P.armor = 0;
  P.group.visible = true;
  P.group.position.set(P.pos.x, 0, P.pos.z);
  P.group.rotation.set(0, P.yaw, 0);
  P.parts.armL.rotation.x = 0;
  P.parts.armR.rotation.x = 0;
  P.parts.legL.rotation.x = 0;
  P.parts.legR.rotation.x = 0;
  if (G && G.W && G.W.view) G.W.view.ready = false;
}

// Pickups from the crate in Verde Park (or the shop) flow through here.
export function givePickup(P, G, item) {
  if (!item) return;
  const kind = typeof item === 'string' ? item : item.kind || item.type;
  if (kind === 'rifle') {
    P.rifle = true;
    P.weapon = 'rifle';
  } else if (kind === 'ammo') {
    P.ammo += CONFIG.weapons.rifle.ammoPerBuy;
  } else if (kind === 'armor') {
    P.armor = Math.min(100, P.armor + 100);
  } else if (kind === 'medkit' || kind === 'health') {
    P.hp = Math.min(CONFIG.player.hp, P.hp + 60);
  }
}
