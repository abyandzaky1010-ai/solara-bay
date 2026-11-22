// Solara Bay — the street's short-lived light: tracers, muzzle flashes, blasts and
// smoke. Pooled sprites with fixed geometry roles: a firefight allocates nothing.

import * as THREE from 'three';
import { C } from './palette.js';

const POOL = 96;
const TTL = { tracer: 0.06, muzzle: 0.05, blast: 0.7, smoke: 1.2 };
const GRAVITY = 9.5;

// One flat quad for every sprite; tracers grow from their own origin along +Z.
const QUAD = new THREE.PlaneGeometry(1, 1);
const STREAK = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);

let pool = [];
let next = 0;
let hurtTimer = 0;

// Unlit and depth-write free: flashes are light, not paint.
const sheet = (hex, opacity, add) => new THREE.MeshBasicMaterial({
  color: hex,
  transparent: true,
  opacity,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
});

/** Build the pool of hidden sprites into the scene. */
export function initEffects(W) {
  pool = [];
  next = 0;
  for (let i = 0; i < POOL; i += 1) {
    const mesh = new THREE.Mesh(QUAD, sheet(0xffffff, 0.5));
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    if (W?.scene) W.scene.add(mesh);
    pool.push({ mesh, streak: false, material: null, alive: false, t: 0, ttl: 0, grow: 1, gravity: 0, peak: 1, baseX: 1, baseY: 1, vel: new THREE.Vector3() });
  }
  return pool;
}

/** The next free sprite of this shape, else the oldest one, re-pointed. */
function take(streak) {
  if (!pool.length) return null;
  for (let i = 0; i < POOL; i += 1) {
    const idx = (next + i) % POOL;
    if (pool[idx].alive) continue;
    next = (idx + 1) % POOL;
    return point(pool[idx], streak);
  }
  const oldest = pool[next];
  next = (next + 1) % POOL;
  return point(oldest, streak);
}

function point(sprite, streak) {
  if (sprite.streak !== streak) {
    sprite.streak = streak;
    sprite.mesh.geometry = streak ? STREAK : QUAD;
  }
  return sprite;
}

/** Wake a sprite: where, what colour, how long, how it moves and grows. */
function arm(sprite, cfg) {
  if (!sprite) return null;
  const { mesh } = sprite;
  const sx = cfg.sx ?? 1;
  const sy = cfg.sy ?? sx;
  if (sprite.material) sprite.material.dispose();
  sprite.material = sheet(cfg.hex, cfg.o, !!cfg.add);
  mesh.material = sprite.material;
  mesh.position.set(cfg.x || 0, cfg.y || 0, cfg.z || 0);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(sx, sy, 1);
  mesh.visible = true;
  Object.assign(sprite, { alive: true, t: 0, ttl: cfg.ttl, grow: cfg.grow ?? 1, gravity: cfg.g ?? 0, peak: cfg.o, baseX: sx, baseY: sy });
  sprite.vel.set(cfg.v?.x || 0, cfg.v?.y || 0, cfg.v?.z || 0);
  return sprite;
}

/** A bullet's path: a bright streak from eye to impact, gone in a blink. */
export function spawnTracer(a, b) {
  if (!a || !b) return null;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const sprite = arm(take(true), { x: a.x, y: a.y, z: a.z, hex: C.beacon, o: 0.95, ttl: TTL.tracer, add: true, sx: 0.06, sy: Math.max(0.5, Math.hypot(dx, dy, dz)) });
  if (!sprite) return null;
  // Yaw about Y, then pitch: the streak lies along a -> b.
  sprite.mesh.rotation.order = 'YXZ';
  sprite.mesh.rotation.y = Math.atan2(dx, dz);
  sprite.mesh.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz));
  return sprite;
}

/** Muzzle flare: wide, hot, already fading. */
export function spawnMuzzle(pos) {
  return pos ? arm(take(false), { x: pos.x, y: pos.y, z: pos.z, hex: 0xfff2c9, o: 1, ttl: TTL.muzzle, grow: 2.2, add: true, sx: 0.5 }) : null;
}

/** A car going up: one flash, ten embers thrown wide and bouncing, smoke behind. */
export function spawnExplosion(pos) {
  if (!pos) return null;
  const y = pos.y ?? 1;
  const flash = arm(take(false), { x: pos.x, y, z: pos.z, hex: 0xffd27a, o: 0.95, ttl: TTL.blast * 0.45, grow: 2.6, add: true, sx: 3.6 });
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2 + i * 0.31;
    const out = 4 + (i % 4) * 1.5;
    arm(take(false), {
      x: pos.x + Math.cos(a) * 0.6,
      y: y + 0.4,
      z: pos.z + Math.sin(a) * 0.6,
      hex: i % 3 === 0 ? 0x3a2a22 : i % 3 === 1 ? 0xff8a3d : 0xffc247,
      o: 0.95,
      ttl: TTL.blast,
      grow: 0.5,
      g: GRAVITY,
      v: { x: Math.cos(a) * out, y: 3 + (i % 3) * 1.6, z: Math.sin(a) * out },
      add: i % 3 !== 0,
      sx: 0.9,
    });
  }
  arm(take(false), { x: pos.x, y: y + 1.2, z: pos.z, hex: 0x8b9299, o: 0.55, ttl: TTL.smoke, grow: 7, v: { y: 1.1 }, sx: 1.8 });
  return flash;
}

/** A tired engine or scuffed tyres: grey, climbing, spreading. */
export function spawnSmokePuff(pos) {
  return pos ? arm(take(false), { x: pos.x, y: (pos.y ?? 0.6) + 0.2, z: pos.z, hex: 0xb6bcc2, o: 0.45, ttl: TTL.smoke, grow: 3.5, v: { y: 0.6 }, sx: 0.8 }) : null;
}

/** The red edge of a bad hit: a class on the HUD for 200 ms. */
export function flashDamage() {
  const hud = typeof document !== 'undefined' ? document.getElementById('hud') : null;
  if (!hud) return;
  hud.classList.add('hurt');
  clearTimeout(hurtTimer);
  hurtTimer = setTimeout(() => hud.classList.remove('hurt'), 200);
}

/** Advance every live sprite: drift, grow, fall, fade; hide it at the end of its life. */
export function updateEffects(W, dt) {
  const step = Math.min(dt || 0, 0.1);
  for (const sp of pool) {
    if (!sp.alive) continue;
    const life = (sp.t += step) / sp.ttl;
    if (life >= 1) {
      sp.alive = false;
      sp.mesh.visible = false;
      continue;
    }
    const { mesh, vel } = sp;
    mesh.position.set(mesh.position.x + vel.x * step, mesh.position.y + vel.y * step, mesh.position.z + vel.z * step);
    if (sp.gravity) {
      vel.y -= sp.gravity * step;
      // Embers settle on the asphalt instead of sinking through it.
      if (mesh.position.y < 0.08) {
        mesh.position.y = 0.08;
        vel.set(vel.x * 0.6, Math.abs(vel.y) * 0.35, vel.z * 0.6);
      }
    }
    if (sp.grow !== 1) {
      const k = 1 + (sp.grow - 1) * Math.min(1, life * 1.5);
      mesh.scale.set(sp.baseX * k, sp.baseY * k, 1);
    }
    sp.material.opacity = sp.peak * (1 - life * life);
  }
  void W;
}
