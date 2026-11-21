// One job: the flashes. Tracers, muzzle blooms, explosions, smoke and the red
// vignette when you get hit. Every quad is built once at boot and recycled, so a
// firefight on Meridian avenue allocates nothing.
import * as THREE from 'three';

const POOL_SIZE = 96;
const TRACER_TTL = 0.06;
const MUZZLE_TTL = 0.05;
const DEBRIS_TTL = 0.7;
const FLASH_TTL = 0.42;
const SMOKE_TTL = 1.2;
const SPARK_TTL = 0.14;
const DEBRIS_COUNT = 10;
const HURT_MS = 200;
const FIRE = [0xffd24a, 0xff9a3a, 0xff6a2a, 0xd94a1e, 0x8a3a18];
const SMOKE_HEX = 0xb8b3a8;

let pool = null;      // { scene, items, cursor }
let hudRoot = null;   // #hud, for the hurt vignette

/** One pooled quad plus the state it needs to play its short life. */
function makeSlot(scene, geometry) {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false;
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    mesh, material, alive: false, t: 0, ttl: 1,
    vx: 0, vy: 0, vz: 0,   // velocity, metres/second
    grav: 0,               // downward pull for debris
    grow: 1,               // final scale multiplier at ttl
    fade: 1,               // starting opacity
    flat: true,            // lying on the ground plane, or upright
    spin: 0,
    size: 1,
  };
}

/** Build the pool and register it on W. Called once from main. */
export function initEffects(W) {
  const scene = W && W.scene ? W.scene : W;
  const quad = new THREE.PlaneGeometry(1, 1);
  const items = [];
  for (let i = 0; i < POOL_SIZE; i++) items.push(makeSlot(scene, quad));
  pool = { scene, items, cursor: 0 };
  if (typeof document !== 'undefined') hudRoot = document.getElementById('hud');
  if (W) W.fx = pool;
  return pool;
}

/** Next free slot, or the round-robin victim when the pool is full. */
function take(ttl) {
  if (!pool) return null;
  const items = pool.items;
  let slot = null;
  for (let i = 0; i < items.length; i++) {
    const idx = (pool.cursor + i) % items.length;
    if (!items[idx].alive) { slot = items[idx]; pool.cursor = idx; break; }
  }
  if (!slot) { slot = items[pool.cursor]; }
  pool.cursor = (pool.cursor + 1) % items.length;
  slot.alive = true;
  slot.t = 0;
  slot.ttl = ttl;
  slot.mesh.visible = true;
  return slot;
}

/** Lay a quad flat on the ground plane at a spot, with a size, colour and twist. */
function placeFlat(slot, x, y, z, size, hex, opacity, rotY) {
  const m = slot.mesh;
  m.position.set(x, y, z);
  m.rotation.set(-Math.PI / 2, 0, rotY || 0);
  m.scale.set(size, size, 1);
  slot.material.color.setHex(hex);
  slot.material.opacity = opacity;
  slot.size = size;
  slot.flat = true;
}

// ---------- effects ----------

/** A bullet's path: a hair-thin quad stretched from a to b, gone in a blink. */
export function spawnTracer(a, b) {
  const slot = take(TRACER_TTL);
  if (!slot || !a || !b) return;
  const ay = a.y == null ? 1.2 : a.y;
  const dy = (b.y == null ? 1.2 : b.y) - ay;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 0.01;
  const m = slot.mesh;
  m.position.set(a.x + dx / 2, ay + dy / 2, a.z + dz / 2);
  m.rotation.set(0, Math.atan2(dx, dz) - Math.PI / 2, -Math.atan2(dy, Math.hypot(dx, dz)));
  m.scale.set(0.07, len, 1);
  slot.material.color.setHex(0xfff4c4);
  slot.material.opacity = 0.9;
  slot.flat = false;
  slot.size = len;
  slot.grow = 1;
  slot.vx = slot.vy = slot.vz = 0;
  slot.grav = 0;
  slot.spin = 0;
  slot.fade = 1;
}

/** Muzzle bloom: a warm quad just off the barrel. */
export function spawnMuzzle(pos) {
  const slot = take(MUZZLE_TTL);
  if (!slot || !pos) return;
  placeFlat(slot, pos.x, pos.y == null ? 1.25 : pos.y, pos.z + 0.02, 0.9, 0xfff0b0, 0.95, Math.random() * 3);
  slot.grow = 1.9;
  slot.vx = slot.vy = slot.vz = 0;
  slot.grav = 0;
  slot.fade = 1;
}

/** A car going up: ten fire quads thrown out with gravity, plus one wide flash. */
export function spawnExplosion(pos) {
  if (!pos) return;
  const y = pos.y == null ? 1 : pos.y;
  for (let i = 0; i < DEBRIS_COUNT; i++) {
    const slot = take(DEBRIS_TTL);
    if (!slot) continue;
    const angle = (i / DEBRIS_COUNT) * Math.PI * 2 + Math.random() * 0.4;
    const speed = 5 + Math.random() * 7;
    placeFlat(slot, pos.x, y, pos.z, 1.1 + Math.random() * 1.7, FIRE[i % FIRE.length], 0.95, angle);
    slot.grow = 1.5;
    slot.vx = Math.cos(angle) * speed;
    slot.vz = Math.sin(angle) * speed;
    slot.vy = 3 + Math.random() * 5;
    slot.grav = 9;
    slot.spin = (Math.random() - 0.5) * 6;
    slot.fade = 0.85;
  }
  const flash = take(FLASH_TTL);
  if (!flash) return;
  placeFlat(flash, pos.x, y + 0.4, pos.z, 2.5, 0xfff1c0, 1, 0);
  flash.grow = 3.4;
  flash.vx = flash.vz = 0;
  flash.vy = 2.2;
  flash.grav = 0;
  flash.spin = 0;
  flash.fade = 1;
}

/** A grey puff that drifts up and thins: wreck smoke, spinning tyres, a downed cop. */
export function spawnSmokePuff(pos) {
  const slot = take(SMOKE_TTL);
  if (!slot || !pos) return;
  const m = slot.mesh;
  m.position.set(pos.x + (Math.random() - 0.5) * 0.6, pos.y == null ? 1 : pos.y, pos.z + (Math.random() - 0.5) * 0.6);
  m.rotation.set(0, 0, 0);
  const size = 1.2 + Math.random() * 0.8;
  m.scale.set(size, size, 1);
  slot.material.color.setHex(SMOKE_HEX);
  slot.material.opacity = 0.42;
  slot.size = size;
  slot.flat = false;
  slot.grow = 2.1;
  slot.vx = (Math.random() - 0.5) * 0.8;
  slot.vz = (Math.random() - 0.5) * 0.8;
  slot.vy = 1.4;
  slot.grav = 0;
  slot.spin = 0;
  slot.fade = 1;
}

/** Short bright spark at an impact or a wall scrape. */
export function spawnSpark(pos) {
  const slot = take(SPARK_TTL);
  if (!slot || !pos) return;
  placeFlat(slot, pos.x, pos.y == null ? 1 : pos.y, pos.z, 0.5, 0xffe9a8, 0.9, Math.random() * 3);
  slot.grow = 1.6;
  slot.vx = slot.vy = slot.vz = 0;
  slot.grav = 0;
  slot.fade = 1;
}

/** Red vignette on the HUD for a fifth of a second. */
export function flashDamage() {
  if (typeof document === 'undefined') return;
  if (!hudRoot) hudRoot = document.getElementById('hud');
  if (!hudRoot) return;
  hudRoot.classList.add('damage');
  clearTimeout(flashDamage.timer);
  flashDamage.timer = setTimeout(() => {
    if (hudRoot) hudRoot.classList.remove('damage');
  }, HURT_MS);
}

// ---------- the step ----------

/** Advance every live sprite; hide it once its ttl runs out. */
export function updateEffects(W, dt) {
  const P = pool || (W && W.fx);
  if (!P || !dt) return;
  const items = P.items;
  for (let i = 0; i < items.length; i++) {
    const slot = items[i];
    if (!slot.alive) continue;
    slot.t += dt;
    const k = slot.t / slot.ttl;
    if (k >= 1) {
      slot.alive = false;
      slot.mesh.visible = false;
      slot.material.opacity = 0;
      continue;
    }
    const m = slot.mesh;
    m.position.x += slot.vx * dt;
    m.position.z += slot.vz * dt;
    m.position.y += slot.vy * dt;
    if (slot.grav) slot.vy -= slot.grav * dt;
    if (slot.spin && slot.flat) m.rotation.z += slot.spin * dt;

    // Grow while fading; a tracer keeps its length and only loses opacity.
    const s = slot.size * (1 + (slot.grow - 1) * k);
    if (slot.flat) m.scale.set(s, s, 1);
    else if (slot.grow > 1) m.scale.set(s, s, 1);
    slot.material.opacity = Math.max(0, slot.fade * (1 - k * k));
  }
}

/** How many sprites are live, for the pause screen and the debug HUD. */
export function liveEffects() {
  if (!pool) return 0;
  let n = 0;
  for (let i = 0; i < pool.items.length; i++) if (pool.items[i].alive) n++;
  return n;
}
