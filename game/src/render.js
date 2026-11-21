// Solara Bay: transient visual effects from one pre-built pool — tracers, muzzle flashes,
// explosion quads, smoke puffs and the red damage vignette. No allocations after init.

import * as THREE from 'three';
import { C } from './palette.js';

const POOL = 96, HURT_MS = 200, QUAD = new THREE.PlaneGeometry(1, 1);
const SPARKS = [0xffd24a, 0xff8a3a, 0xff5a2a, 0x7a3a1e, 0x2b2622];

let pool = null, cursor = 0, hurtTimer = 0;

/** 96 hidden quads, each with its own unlit material. Call once, after the world. */
export function initEffects(W) {
  if (!W?.scene || pool) return pool;
  pool = { items: [] };
  for (let i = 0; i < POOL; i += 1) {
    const material = new THREE.MeshBasicMaterial({ color: C.marker, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(QUAD, material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    W.scene.add(mesh);
    pool.items.push({ mesh, material, alive: false, t: 0, ttl: 1, vel: new THREE.Vector3(), grow: 0, gravity: 0, spin: 0, kind: 'none', peak: 1 });
  }
  return pool;
}

// Next free slot; with all 96 busy the oldest is recycled rather than skipped.
function take(kind, hex, peak) {
  if (!pool) return null;
  const slot = pool.items.find((it) => !it.alive) || pool.items[cursor];
  cursor = (cursor + 1) % POOL;
  Object.assign(slot, { alive: true, t: 0, kind, peak, gravity: 0, spin: 0, grow: 0 });
  slot.vel.set(0, 0, 0);
  slot.material.color.setHex(hex);
  slot.material.opacity = peak;
  slot.mesh.visible = true;
  slot.mesh.rotation.set(0, 0, 0);
  return slot;
}

/** A thin stretched quad from A to B, gone in 60 ms. */export function spawnTracer(a, b) {
  const item = a && b && take('tracer', C.marker, 0.9);
  if (!item) return;
  const dx = b.x - a.x, dy = (b.y || 0) - (a.y || 0), dz = b.z - a.z, len = Math.hypot(dx, dy, dz) || 0.1;
  item.ttl = 0.06;
  item.mesh.position.set((a.x + b.x) / 2, ((a.y || 0) + (b.y || 0)) / 2, (a.z + b.z) / 2);
  item.mesh.scale.set(0.05, len, 1);
  // Lay the quad along the shot: yaw across, then pitch it out of the ground plane.
  item.mesh.rotation.set(Math.PI / 2 - Math.atan2(dy, Math.hypot(dx, dz)), -Math.atan2(dx, dz), 0);
}

/** A four-point flash at the muzzle, gone in 50 ms. */
export function spawnMuzzle(pos) {
  const item = pos && take('muzzle', 0xfff3c4, 0.95);
  if (!item) return;
  item.ttl = 0.05;
  item.grow = 6;
  item.mesh.position.set(pos.x, pos.y || 1.3, pos.z);
  item.mesh.scale.set(0.5, 0.5, 1);
  item.mesh.rotation.y = Math.random() * Math.PI;
}

/** Ten orange and dark quads thrown outward plus a big flash, 0.7 s. */
export function spawnExplosion(pos) {
  const flash = pos && take('flash', 0xffb347, 0.75);
  if (!flash) return;
  flash.ttl = 0.35;
  flash.grow = 16;
  flash.vel.set(0, 1.2, 0);
  flash.mesh.position.set(pos.x, pos.y || 0.8, pos.z);
  flash.mesh.scale.set(2.4, 2.4, 1);
  for (let i = 0; i < 10; i += 1) {
    const spark = take('spark', SPARKS[i % SPARKS.length], 0.9), a = (i / 10) * Math.PI * 2 + 0.4, speed = 6 + Math.random() * 7;
    spark.ttl = 0.7 * (0.5 + Math.random() * 0.5);
    spark.grow = 1.2;
    spark.gravity = 9;
    spark.vel.set(Math.cos(a) * speed, 3 + Math.random() * 5, Math.sin(a) * speed);
    spark.mesh.position.set(pos.x, pos.y || 0.8, pos.z);
    spark.mesh.scale.set(0.9 + Math.random(), 0.9 + Math.random(), 1);
  }
}

/** A slow grey quad that rises and fades over 1.2 s. */
export function spawnSmokePuff(pos) {
  const item = pos && take('smoke', 0x9aa1a8, 0.55);
  if (!item) return;
  item.ttl = 1.2;
  item.grow = 1.1;
  item.gravity = -0.8;
  item.spin = 0.6;
  item.vel.set((Math.random() - 0.5) * 0.6, 1.1 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6);
  item.mesh.position.set(pos.x, pos.y || 0.9, pos.z);
  item.mesh.scale.set(0.7, 0.7, 1);
}

/** Red vignette: the #hud 'hurt' class for 200 ms. */
export function flashDamage() {
  const hud = typeof document !== 'undefined' ? document.getElementById('hud') : null;
  if (!hud) return;
  hud.classList.add('hurt');
  window.clearTimeout(hurtTimer);
  hurtTimer = window.setTimeout(() => hud.classList.remove('hurt'), HURT_MS);
}

/** One fixed step: drift, grow, fall, fade, hide. */
export function updateEffects(W, dt) {
  if (!pool) return;
  for (const item of pool.items) {
    if (!item.alive) continue;
    item.t += dt;
    if (item.t >= item.ttl) {
      Object.assign(item, { alive: false });
      item.mesh.visible = false;
      continue;
    }
    const mesh = item.mesh;
    item.vel.y -= item.gravity * dt;
    mesh.position.x += item.vel.x * dt;
    mesh.position.y += item.vel.y * dt;
    mesh.position.z += item.vel.z * dt;
    // Quads swell as they die; tracers keep their shape and their line.
    if (item.grow) mesh.scale.x = mesh.scale.y = Math.max(0.04, mesh.scale.x + item.grow * dt);
    if (item.spin) mesh.rotation.z += item.spin * dt;
    if (item.kind === 'spark' || item.kind === 'flash') mesh.rotation.x = -Math.PI / 2 + item.t * 2;
    item.material.opacity = Math.max(0, 1 - item.t / item.ttl) * item.peak;
  }
}
