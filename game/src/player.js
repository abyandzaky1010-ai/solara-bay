// The protagonist: a low-poly walker you can see over the shoulder, plus on-foot control
// and the single carried weapon. Geometry lives here; game rules live on G.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';

const BODY_R = 0.5;          // collision radius on foot
const LIMB_SWING = 0.85;     // radians a leg reaches at full sprint
const FLASH_TIME = 0.07;     // muzzle flash lifetime, seconds
const EYE_Y = CONFIG.player.camHeight;

// Scratch vectors kept out of the per-frame allocation path.
const EYE = new THREE.Vector3();
const AIM = new THREE.Vector3();
const SPOT = new THREE.Vector3();
const HEAD = new THREE.Vector3();

/** A plain box with a flat colour; the whole figure is built from these. */
function block(w, h, d, hex, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = false;
  return m;
}

/**
 * Assemble the avatar. Hierarchy: root (feet) -> torso (hip pivot) -> head/arms,
 * plus two independent legs so they can swing against each other. The root group
 * stays at y=0 so the model always stands on the ground plane.
 */
function buildAvatar() {
  const root = new THREE.Group();
  root.name = 'player';

  const shirtHex = C.shirt[0];
  const pantsHex = C.pants[0];
  const skinHex = C.skin[0];

  const torso = new THREE.Group();
  torso.position.y = 0.86;
  root.add(torso);

  // Coral shirt box: the widest read at screenshot distance.
  torso.add(block(0.62, 0.72, 0.36, shirtHex, 0, 0.3, 0));

  // Hips and belt so the two half-tones meet cleanly.
  torso.add(block(0.58, 0.14, 0.34, pantsHex, 0, -0.06, 0));

  const head = block(0.34, 0.34, 0.32, skinHex, 0, 0.86, 0);
  torso.add(head);

  // Cap: crown plus a forward brim so we can tell which way he faces.
  const capHex = 0x27313d;
  torso.add(block(0.36, 0.12, 0.34, capHex, 0, 1.06, 0));
  torso.add(block(0.34, 0.06, 0.16, capHex, 0, 1.01, -0.24));
  // Sunglasses band across the face: a thin dark strip reads as shade, not eyes.
  torso.add(block(0.34, 0.07, 0.06, 0x14181e, 0, 0.9, -0.16));

  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.16, -0.13, 0);
    hip.add(block(0.22, 0.74, 0.24, pantsHex, 0, -0.37, 0));
    hip.add(block(0.24, 0.12, 0.34, 0x2b2b2b, 0, -0.76, -0.05));
    torso.add(hip);
    legs.push(hip);
  }

  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.39, 0.6, 0);
    shoulder.add(block(0.2, 0.52, 0.2, shirtHex, 0, -0.26, 0));
    shoulder.add(block(0.18, 0.16, 0.18, skinHex, 0, -0.6, 0));
    torso.add(shoulder);
    arms.push(shoulder);
  }

  // The pistol: a small dark wedge pointing out of the forward (-z) side.
  const gun = new THREE.Group();
  gun.position.set(-0.4, 0.36, -0.22);
  gun.visible = false;
  gun.add(block(0.09, 0.09, 0.42, 0x2a2f38, 0, 0, -0.16));
  gun.add(block(0.08, 0.2, 0.1, 0x1d2229, 0, -0.1, 0.02));
  torso.add(gun);

  return { root, legs, arms, gun };
}

export function createPlayer(W, city) {
  const avatar = buildAvatar();
  (W.scene || W).add(avatar.root);
  const start = (city && city.spawns && city.spawns.playerStart) || { x: 0, z: 0 };

  const P = {
    kind: 'player',
    group: avatar.root,
    avatar,
    pos: { x: start.x, z: start.z },
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
    speed: 0,
    moving: false,
    spawn: { x: start.x, z: start.z },
    city,
    W,
  };

  avatar.root.position.set(P.pos.x, 0, P.pos.z);
  return P;
}

/** Point the root, flick the limbs. Shared by the on-foot update. */
export function posePlayer(P) {
  const g = P.group;
  g.rotation.y = P.yaw;
  g.position.x = P.pos.x;
  g.position.z = P.pos.z;

  const av = P.avatar;
  if (!av) return;
  av.gun.visible = P.aim && !P.dead;

  if (P.dead) {
    // Lying down: tip the whole figure onto its back.
    g.rotation.x = -Math.PI / 2;
    g.position.y = 0.3;
    return;
  }
  g.rotation.x = 0;
  g.position.y = 0;

  const amp = P.moving ? LIMB_SWING * Math.min(1, 0.35 + P.speed / CONFIG.player.sprint) : 0;
  const swing = Math.sin(P.walkT);

  av.legs[0].rotation.x = swing * amp;
  av.legs[1].rotation.x = -swing * amp;
  // Arms stay raised on the weapon: the character is always in an aiming stance.
  av.arms[0].rotation.x = -1.35;
  av.arms[1].rotation.x = -1.15;
}

/**
 * Camera-relative WASD with sprint, feet planted through resolveMove, facing the
 * camera yaw. The camera looks along (-sin yaw, -cos yaw), so "forward" is that
 * vector and "right" is its perpendicular.
 */
export function updatePlayerFoot(P, G, I, dt) {
  if (!P || P.dead) {
    P.cooldown = Math.max(0, P.cooldown - dt);
    return;
  }
  const W = G.W || P.W;
  const world = CONFIG.player;

  const ax = I && I.axis ? I.axis() : { x: 0, y: 0 };
  const camYaw = W && isFinite(W.yaw) ? W.yaw : P.yaw;

  // Forward and right on the ground plane for the current camera.
  const fx = -Math.sin(camYaw);
  const fz = -Math.cos(camYaw);
  const rx = -fz;
  const rz = fx;

  let mx = fx * ax.y + rx * ax.x;
  let mz = fz * ax.y + rz * ax.x;
  const mag = Math.hypot(mx, mz);
  P.moving = mag > 0.01;

  const sprint = !!(I && I.sprinting && I.sprinting());
  const top = sprint ? world.sprint : world.walk;
  P.speed = P.moving ? top : 0;

  if (P.moving) {
    mx /= mag;
    mz /= mag;
    const step = top * dt;
    const moved = resolveMove(W, P.pos.x, P.pos.z, BODY_R, mx * step, mz * step);
    P.pos.x = moved.x;
    P.pos.z = moved.z;
    // Walk cycle advances with distance, so speed changes never warp the legs.
    P.walkT += (top / 2.05) * dt * Math.PI;
  } else {
    P.walkT += dt * 0.4;
  }

  // Aim is always on: the body turns to the camera the moment you want to shoot.
  P.aim = true;
  P.yaw = camYaw;

  const half = CONFIG.world.half - 2;
  P.pos.x = Math.max(-half, Math.min(half, P.pos.x));
  P.pos.z = Math.max(-half, Math.min(half, P.pos.z));

  P.cooldown = Math.max(0, P.cooldown - dt);
  posePlayer(P);
}

/** An empty pedestrians array on G is fine; this only skips what is missing. */
function firstHitBox(W, ox, oz, dx, dz, maxT) {
  if (!W || !W.colliders) return maxT;
  let best = maxT;
  const list = W.colliders;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    // Slab test against the ground-projected box.
    let t0 = 0;
    let t1 = best;
    if (Math.abs(dx) < 1e-6) {
      if (ox < b.minX || ox > b.maxX) continue;
    } else {
      let a = (b.minX - ox) / dx;
      let c = (b.maxX - ox) / dx;
      if (a > c) { const s = a; a = c; c = s; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
    }
    if (Math.abs(dz) < 1e-6) {
      if (oz < b.minZ || oz > b.maxZ) continue;
    } else {
      let a = (b.minZ - oz) / dz;
      let c = (b.maxZ - oz) / dz;
      if (a > c) { const s = a; a = c; c = s; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
    }
    if (t0 <= t1 && t0 < best) best = t0;
  }
  return best;
}

/**
 * Fire the carried weapon along the aim ray. Enemy damage goes through the G
 * callbacks so the wanted level, gore flags and death bookkeeping stay in one place.
 */
export function fireWeapon(P, G) {
  const spec = CONFIG.weapons[P.rifle ? 'rifle' : 'pistol'];
  const result = { hit: false, point: { x: 0, y: 1.2, z: 0 }, kind: 'air', target: null };

  if (!P || P.dead) return result;
  if (P.cooldown > 0) return result;
  if (P.rifle && P.ammo <= 0) {
    if (G.sound && G.sound.dry) G.sound.dry();
    P.rifle = false;
    P.cooldown = 0.2;
    return result;
  }

  P.cooldown = 1 / spec.rate;
  if (P.rifle) P.ammo = Math.max(0, P.ammo - 1);

  const W = G.W || P.W;
  const camYaw = W && isFinite(W.yaw) ? W.yaw : P.yaw;
  const pitch = W && isFinite(W.pitch) ? W.pitch : 0.1;

  EYE.set(P.pos.x, EYE_Y, P.pos.z);
  // Spread: two centred random offsets inside a cone of the configured radius.
  const spread = spec.spread;
  const jx = (Math.random() - 0.5) * spread * 2;
  const jy = (Math.random() - 0.5) * spread * 2;
  AIM.set(
    -Math.sin(camYaw) + Math.cos(camYaw) * jx,
    -Math.sin(pitch) + jy,
    -Math.cos(camYaw) - Math.sin(camYaw) * jx,
  ).normalize();

  const range = 120;
  let best = range;
  let hitKind = 'air';
  let hitTarget = null;

  // Nearest person or vehicle along the ray, then clip by walls. People are aimed
  // at chest height with a body-sized sphere; cars use their own footprint radius.
  const scan = (list, kind, cy, r, skip) => {
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o || (skip && skip(o))) continue;
      const at = o.pos || o;
      const t = raySphere(EYE, AIM, at.x, cy, at.z, o.pos ? r : o.radius || CONFIG.car.radius);
      if (t != null && t < best) { best = t; hitKind = kind; hitTarget = o; }
    }
  };
  scan(G.peds || [], 'ped', 1.0, 0.7, (p) => p.state === 'down');
  scan((G.PO && G.PO.foot) || [], 'cop', 1.0, 0.65, (c) => c.down);
  scan((G.cars || []).concat(G.traffic || [], (G.PO && G.PO.cars) || []), 'car', 0.9, 0, (c) => c.wrecked);

  const wallT = firstHitBox(W, P.pos.x, P.pos.z, AIM.x, AIM.z, best);
  if (wallT < best) { best = wallT; hitKind = 'wall'; hitTarget = null; }

  HEAD.set(P.pos.x, EYE_Y, P.pos.z).addScaledVector(AIM, best);
  result.hit = hitKind !== 'air';
  result.kind = hitKind;
  result.target = hitTarget;
  result.point = { x: HEAD.x, y: HEAD.y, z: HEAD.z };

  if (hitKind === 'ped' && G.damagePed) G.damagePed(hitTarget, spec.dmg);
  else if (hitKind === 'cop' && G.damageCop) G.damageCop(hitTarget, spec.dmg);
  else if (hitKind === 'car' && hitTarget) {
    if (G.damageTrafficCar) G.damageTrafficCar(hitTarget, spec.dmg);
    else if (G.damageTraffic) G.damageTraffic(hitTarget, spec.dmg);
  }

  // Shot heard across the block: police heads up, and the alarm origin moves here.
  G.alarm = 1;
  G.alarmX = P.pos.x;
  G.alarmZ = P.pos.z;

  const fx = G.effects || (W && W.fx);
  if (fx) {
    SPOT.set(P.pos.x - Math.sin(P.yaw) * 0.55, 1.32, P.pos.z - Math.cos(P.yaw) * 0.55);
    if (fx.muzzle) fx.muzzle({ x: SPOT.x, y: SPOT.y, z: SPOT.z });
    if (fx.spark) fx.spark({ x: HEAD.x, y: HEAD.y, z: HEAD.z });
    if (fx.tracer) fx.tracer({ x: SPOT.x, y: SPOT.y, z: SPOT.z }, result.point);
    if (fx.flashLight) fx.flashLight(SPOT, FLASH_TIME);
  }
  if (G.sound && G.sound.shot) G.sound.shot(P.rifle);

  return result;
}

/** Sweep segment vs an upright capsule-ish circle at height cy. */
function raySphere(o, d, cx, cy, cz, r) {
  const ox = o.x - cx;
  const oy = o.y - cy;
  const oz = o.z - cz;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq;
  return t >= 0 ? t : null;
}

/**
 * Take damage. Armour soaks 60% until it runs dry, the remainder flows to health.
 * Hitting zero hands control to G.wasted() once.
 */
export function damagePlayer(P, amt, G) {
  if (!P || P.dead || amt <= 0) return P ? P.hp : 0;

  let left = amt;
  if (P.armor > 0) {
    const soaked = Math.min(P.armor, left * 0.6);
    P.armor = Math.max(0, P.armor - soaked);
    left -= soaked;
  }
  P.hp -= left;

  const fx = G && (G.effects || (G.W && G.W.fx));
  if (fx && fx.flashDamage) fx.flashDamage();

  if (P.hp <= 0) {
    P.hp = 0;
    P.dead = true;
    P.aim = false;
    posePlayer(P);
    if (G && G.wasted) G.wasted();
  }
  return P.hp;
}

/** Put the body back at a known spot, healed, with the board cleared. */
export function respawnPlayer(P, G, where) {
  const spot = where || P.spawn || { x: 0, z: 0 };
  P.pos.x = spot.x;
  P.pos.z = spot.z;
  P.hp = CONFIG.player.hp;
  P.armor = 0;
  P.dead = false;
  P.cooldown = 0;
  P.walkT = 0;
  P.speed = 0;
  P.moving = false;
  P.aim = false;
  if (G && G.W && isFinite(G.W.yaw)) P.yaw = G.W.yaw;
  posePlayer(P);
  return P;
}

/**
 * Pickups: the rifle crate arms the rifle but keeps the pistol as the fallback
 * weapon and leaves the ammo count exactly as the shop left it. Cash and armour
 * route through the economy when it is around.
 */
export function givePickup(P, G, item) {
  if (!P || !item) return false;
  const kind = typeof item === 'string' ? item : item.item || item.kind;

  if (kind === 'rifle') {
    P.rifle = true;
    P.weapon = 'pistol';
    if (G && G.hud) G.hud.toast('Rifle acquired — it now fires in place of the pistol');
    if (G && G.sound && G.sound.chime) G.sound.chime();
    return true;
  }
  if (kind === 'armor') {
    P.armor = Math.min(100, P.armor + 60);
    if (G && G.sound && G.sound.chime) G.sound.chime();
    return true;
  }
  if (kind === 'medkit') {
    P.hp = Math.min(CONFIG.player.hp, P.hp + 50);
    if (G && G.sound && G.sound.chime) G.sound.chime();
    return true;
  }
  if (kind === 'cash' || kind === 'money') {
    const amount = (item && item.amount) || 25;
    if (G && G.E && G.addMoney) G.addMoney(amount);
    return true;
  }
  return false;
}
