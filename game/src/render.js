// Solara Bay — every transient spark in the world: tracers, muzzle flashes,
// explosions and smoke. One clear job, and one rule: nothing allocates at
// runtime. A fixed pool of sprites is built at start-up and recycled forever.

import * as THREE from 'three';

const POOL_SIZE = 96;
const TRACER_TTL = 0.06;
const MUZZLE_TTL = 0.05;
const EXPLOSION_TTL = 0.7;
const SMOKE_TTL = 1.2;
const SHARDS = 10;
const FLASH_TTL = 0.22;
const HURT_CLASS_MS = 200;

// Hot at the core, sooty at the edge.
const FIRE_HOT = 0xfff1b8;
const FIRE_MID = 0xff8a3c;
const FIRE_DARK = 0xb5401c;
const SOOT = 0x2a2624;
const SMOKE = 0x9b968e;
const MUZZLE = 0xffd77a;
const TRACER = 0xfff3c8;

const pool = [];
let quadGeo = null;
let boxGeo = null;
let ready = false;
let hurtUntil = 0;

/* --------------------------------------------------------------------- the pool */

function makeSprite() {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(quadGeo, mat);
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return { mesh, mat, alive: false, t: 0, ttl: 0, grow: 0, gravity: 0, vx: 0, vy: 0, vz: 0 };
}

/** Build the pool into the scene. Idempotent: a second call adds nothing twice. */
export function initEffects(W) {
  if (!W || !W.scene) return { size: 0 };
  if (!ready) {
    quadGeo = new THREE.PlaneGeometry(1, 1);
    boxGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < POOL_SIZE; i++) pool.push(makeSprite());
    ready = true;
  }
  for (const s of pool) if (!s.mesh.parent) W.scene.add(s.mesh);
  return { size: pool.length };
}

/** Claim a dead sprite for ttl seconds; when the pool is dry, recycle the oldest. */
function claim(ttl) {
  let s = null;
  for (let i = 0; i < pool.length; i++) {
    if (!pool[i].alive) {
      s = pool[i];
      break;
    }
    if (!s || pool[i].t > s.t) s = pool[i];
  }
  s.alive = true;
  s.t = 0;
  s.ttl = ttl;
  s.grow = 0;
  s.gravity = 0;
  s.vx = s.vy = s.vz = 0;
  s.mesh.visible = true;
  s.mat.opacity = 1;
  s.mesh.rotation.set(0, 0, 0);
  s.mesh.scale.set(1, 1, 1);
  if (s.mesh.geometry !== quadGeo) s.mesh.geometry = quadGeo;
  return s;
}

/** A square of colour, sized in metres, fading out over its ttl. */
function quad(at, hex, size, ttl, grow) {
  const s = claim(ttl);
  s.mat.color.setHex(hex);
  s.grow = grow || 0;
  s.mesh.position.set(at.x, at.y || 0, at.z);
  s.mesh.scale.set(size, size, 1);
  return s;
}

/* ------------------------------------------------------------------- emitters */

/** A hot line from a muzzle to whatever the round met. */
export function spawnTracer(a, b) {
  if (!ready || !a || !b) return;
  const s = claim(TRACER_TTL);
  s.mesh.geometry = boxGeo;
  s.mat.color.setHex(TRACER);
  s.mat.opacity = 0.95;
  const dx = b.x - a.x, dy = (b.y || 0) - (a.y || 0), dz = b.z - a.z;
  s.mesh.position.set(a.x + dx * 0.5, (a.y || 0) + dy * 0.5, a.z + dz * 0.5);
  s.mesh.scale.set(0.045, 0.045, Math.max(0.4, Math.hypot(dx, dy, dz)));
  s.mesh.rotation.set(0, Math.atan2(dx, dz), 0);
}

/** Two frames of star at the barrel. */
export function spawnMuzzle(pos) {
  if (!ready || !pos) return;
  const s = quad(pos, MUZZLE, 0.5, MUZZLE_TTL, -6);
  s.mesh.position.y = pos.y || 1.2;
  s.mat.opacity = 0.95;
}

/** A car goes up: one white core, ten shards of fire and soot, one rising cloud. */
export function spawnExplosion(pos) {
  if (!ready || !pos) return;
  const y = pos.y !== undefined ? pos.y : 1;
  quad({ x: pos.x, y: y + 1.2, z: pos.z }, FIRE_HOT, 7, FLASH_TTL, 3.5);

  for (let i = 0; i < SHARDS; i++) {
    const a = (i / SHARDS) * Math.PI * 2 + Math.random() * 0.5;
    const hex = i % 3 === 0 ? SOOT : i % 2 === 0 ? FIRE_MID : FIRE_DARK;
    const shard = quad({ x: pos.x, y: y + 0.8, z: pos.z }, hex, 1.3 + Math.random() * 1.5, EXPLOSION_TTL, 0.6);
    shard.vx = Math.cos(a) * (5 + Math.random() * 9);
    shard.vy = 4 + Math.random() * 7;
    shard.vz = Math.sin(a) * (5 + Math.random() * 9);
    shard.gravity = 16;
  }

  const cloud = quad({ x: pos.x, y: y + 2.2, z: pos.z }, SMOKE, 6, EXPLOSION_TTL, 1.4);
  cloud.vy = 1.4;
}

/** One slow grey breath, for smoking engines and tired bumpers. */
export function spawnSmokePuff(pos) {
  if (!ready || !pos) return;
  const s = quad(pos, SMOKE, 1.6, SMOKE_TTL, 1.8);
  s.mesh.position.y = (pos.y || 1) + 0.4;
  s.vy = 1.5;
  s.vx = (Math.random() - 0.5) * 0.6;
  s.vz = (Math.random() - 0.5) * 0.6;
  s.mat.opacity = 0.5;
}

/* ------------------------------------------------------------------- vignette */

/** Flash the red edge of the screen for a moment: the CSS already knows 'hurt'. */
export function flashDamage() {
  const hud = typeof document !== 'undefined' ? document.getElementById('hud') : null;
  if (!hud) return;
  hud.classList.remove('hurt');
  void hud.offsetWidth; // restart the fade on back-to-back hits
  hud.classList.add('hurt');
  hurtUntil = Date.now() + HURT_CLASS_MS;
}

/** Age the vignette class out; safe to call every frame. */
export function updateHurtFx() {
  if (!hurtUntil || Date.now() < hurtUntil) return;
  hurtUntil = 0;
  const hud = typeof document !== 'undefined' ? document.getElementById('hud') : null;
  if (hud) hud.classList.remove('hurt');
}

/* ----------------------------------------------------------------------- tick */

/** Move, grow and fade every live sprite; hide the ones whose time is up. */
export function updateEffects(ignored, dt) {
  if (!ready) return;
  const step = Math.min(dt || 0, 0.1);
  for (const s of pool) {
    if (!s.alive) continue;
    s.t += step;
    if (s.t >= s.ttl) {
      s.alive = false;
      s.mesh.visible = false;
      s.mat.opacity = 0;
      continue;
    }
    const p = s.mesh.position;
    if (s.gravity) s.vy -= s.gravity * step;
    p.x += s.vx * step;
    p.y += s.vy * step;
    p.z += s.vz * step;
    if (p.y < 0.05) {
      p.y = 0.05;
      if (s.gravity) s.vy *= -0.3;
      s.vx *= 0.7;
      s.vz *= 0.7;
    }
    if (s.grow) s.mesh.scale.multiplyScalar(Math.max(0.05, 1 + s.grow * step));
    s.mat.opacity = (1 - s.t / s.ttl) ** 2;
  }
  updateHurtFx();
}

/** How many sprites are burning right now (debug and shot harness). */
export function effectStats() {
  let live = 0;
  for (const s of pool) if (s.alive) live++;
  return { live, size: pool.length };
}
