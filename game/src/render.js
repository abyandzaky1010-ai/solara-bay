// Solara Bay — transient effects: tracers, muzzle flashes, explosions and smoke.
// Everything is pooled at boot so a firefight never allocates a mesh.

import * as THREE from 'three';
import { C } from './palette.js';

const POOL_SIZE = 96;
const TRACER_TTL = 0.06;
const MUZZLE_TTL = 0.05;
const BLAST_TTL = 0.7;
const SMOKE_TTL = 1.2;
const DEBRIS_TTL = 0.55;
const HURT_MS = 200;

// Quad orientation helper: planes are built flat on XZ and billboarded by the
// update pass, which is cheap and keeps every sprite readable from any angle.
const QUAD = new THREE.PlaneGeometry(1, 1);

const FX = {
  ready: false,
  scene: null,
  pool: [],
  cursor: 0,
  hurtTimer: null,
};

/** Allocate the sprite pool once; safe to call twice. */
export function initEffects(W) {
  if (!W || !W.scene) return FX;
  if (FX.ready) return FX;
  FX.scene = W.scene;

  for (let i = 0; i < POOL_SIZE; i++) {
    const material = new THREE.MeshBasicMaterial({
      color: C.marker,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    const mesh = new THREE.Mesh(QUAD, material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    W.scene.add(mesh);
    FX.pool.push({
      mesh,
      material,
      alive: false,
      kind: 'quad',
      t: 0,
      ttl: 1,
      vel: new THREE.Vector3(),
      grow: 0,
      gravity: 0,
      startOpacity: 1,
      spin: 0,
      lift: 0,
    });
  }
  FX.ready = true;
  return FX;
}

/** Take the next free sprite, stealing the oldest one if the pool is full. */
function take() {
  for (let i = 0; i < POOL_SIZE; i++) {
    const slot = FX.pool[(FX.cursor + i) % POOL_SIZE];
    if (!slot.alive) {
      FX.cursor = (FX.cursor + i + 1) % POOL_SIZE;
      slot.alive = true;
      slot.mesh.visible = true;
      return slot;
    }
  }
  const slot = FX.pool[FX.cursor];
  FX.cursor = (FX.cursor + 1) % POOL_SIZE;
  slot.alive = true;
  slot.mesh.visible = true;
  return slot;
}

function retire(slot) {
  slot.alive = false;
  slot.mesh.visible = false;
}

/**
 * Fire a thin box between two points. aa/bb are optional {x,y,z} object or
 * vector; missing y defaults to chest height.
 */
export function spawnTracer(a, b) {
  if (!FX.ready || !a || !b) return;
  const ax = a.x;
  const ay = a.y === undefined ? 1.3 : a.y;
  const az = a.z;
  const bx = b.x;
  const by = b.y === undefined ? 1.1 : b.y;
  const bz = b.z;

  const slot = take();
  slot.kind = 'tracer';
  slot.t = 0;
  slot.ttl = TRACER_TTL;
  slot.vel.set(0, 0, 0);
  slot.gravity = 0;
  slot.grow = 0;
  slot.opacity0 = 0.95;
  slot.spin = 0;

  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.max(0.4, Math.hypot(dx, dy, dz));

  slot.material.color.setHex(C.roadline);
  slot.material.opacity = 0.95;
  slot.mesh.rotation.set(0, 0, 0);
  slot.mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(dx / len, dy / len, dz / len),
  );
  slot.mesh.scale.set(0.045, 0.045, len);
  slot.mesh.position.set(ax + dx / 2, ay + dy / 2, az + dz / 2);
}

/** Small hot quad at the barrel; reads as the flash in a screenshot. */
export function spawnMuzzle(pos) {
  if (!FX.ready || !pos) return;
  const slot = take();
  slot.kind = 'quad';
  slot.t = 0;
  slot.ttl = MUZZLE_TTL;
  slot.vel.set(0, 0, 0);
  slot.gravity = 0;
  slot.grow = 9;
  slot.opacity0 = 1;
  slot.material.color.setHex(0xfff0b0);
  slot.material.opacity = 1;
  slot.mesh.position.set(pos.x, pos.y === undefined ? 1.35 : pos.y, pos.z);
  slot.mesh.scale.setScalar(0.55);
  billboard(slot.mesh);
}

/** Ten debris quads plus one white-hot flash. */
export function spawnExplosion(pos) {
  if (!FX.ready || !pos) return;
  const px = pos.x;
  const py = pos.y === undefined ? 1.0 : pos.y;
  const pz = pos.z;

  for (let i = 0; i < 10; i++) {
    const slot = take();
    slot.kind = 'debris';
    slot.t = 0;
    slot.ttl = BLAST_TTL * (0.55 + Math.random() * 0.45);
    const ang = (i / 10) * Math.PI * 2 + Math.random() * 0.25;
    const spd = 3 + Math.random() * 7;
    slot.vel.set(Math.cos(ang) * spd, 2 + Math.random() * 5, Math.sin(ang) * spd);
    slot.gravity = 12;
    slot.grow = 0.6;
    slot.opacity0 = 0.9;
    const heat = i % 3;
    slot.material.color.setHex(heat === 0 ? 0xffd27a : heat === 1 ? 0xff7a2a : 0x4a3a30);
    slot.material.opacity = 0.9;
    slot.mesh.position.set(px, py, pz);
    slot.mesh.scale.setScalar(0.6 + Math.random() * 0.7);
    billboard(slot.mesh);
  }

  const flash = take();
  flash.kind = 'quad';
  flash.t = 0;
  flash.ttl = BLAST_TTL;
  flash.vel.set(0, 1.2, 0);
  flash.gravity = -0.6;
  flash.grow = 16;
  flash.opacity0 = 0.95;
  flash.material.color.setHex(0xfff2c2);
  flash.material.opacity = 0.95;
  flash.mesh.position.set(px, py + 0.6, pz);
  flash.mesh.scale.setScalar(1.2);
  billboard(flash.mesh);
}

/** Grey puff that drifts up and thins out (car smoke, bullet dust). */
export function spawnSmokePuff(pos) {
  if (!FX.ready || !pos) return;
  const slot = take();
  slot.kind = 'quad';
  slot.t = 0;
  slot.ttl = SMOKE_TTL;
  slot.vel.set((Math.random() - 0.5) * 0.7, 0.55 + Math.random() * 0.5, (Math.random() - 0.5) * 0.7);
  slot.gravity = -0.1;
  slot.grow = 2.4;
  slot.opacity0 = 0.42;
  slot.material.color.setHex(0x9aa3ab);
  slot.material.opacity = 0.42;
  slot.mesh.position.set(pos.x, pos.y === undefined ? 1.0 : pos.y, pos.z);
  slot.mesh.scale.setScalar(0.7);
  billboard(slot.mesh);
}

/** Red edge flash: one class toggle, cleared by a timer. */
export function flashDamage() {
  if (typeof document === 'undefined') return;
  const hud = document.getElementById('hud');
  if (!hud) return;
  hud.classList.remove('hurt');
  // Restart the CSS animation even when hits land a frame apart.
  void hud.offsetWidth;
  hud.classList.add('hurt');
  if (FX.hurtTimer !== null) clearTimeout(FX.hurtTimer);
  FX.hurtTimer = setTimeout(() => {
    hud.classList.remove('hurt');
    FX.hurtTimer = null;
  }, HURT_MS);
}

function billboard(mesh) {
  // Orientation is settled per frame in billboardTo(); quads start camera-facing.
  mesh.rotation.set(0, 0, 0);
}

/** Advance every live sprite: move, grow, fade, retire. */
export function updateEffects(W, dt) {
  if (!FX.ready) return;
  const cam = W && W.camera ? W.camera : null;
  for (let i = 0; i < POOL_SIZE; i++) {
    const slot = FX.pool[i];
    if (!slot.alive) continue;
    slot.t += dt;
    const k = slot.t / slot.ttl;
    if (k >= 1) { retire(slot); continue; }

    const m = slot.mesh;
    slot.vel.y -= slot.gravity * dt;
    m.position.x += slot.vel.x * dt;
    m.position.y += slot.vel.y * dt;
    m.position.z += slot.vel.z * dt;
    if (slot.gravity > 0 && m.position.y < 0.12) {
      m.position.y = 0.12;
      slot.vel.y = Math.abs(slot.vel.y) * 0.25;
      slot.vel.x *= 0.7;
      slot.vel.z *= 0.7;
    }
    if (slot.grow) m.scale.multiplyScalar(1 + slot.grow * dt);

    if (slot.kind !== 'tracer') billboardTo(m, cam);
    slot.material.opacity = slot.opacity0 * (1 - k) * (1 - k * 0.2);
  }
}

/** Flat quads square up to the camera so they never vanish edge-on. */
function billboardTo(mesh, cam) {
  if (cam) mesh.lookAt(cam.position.x, cam.position.y, cam.position.z);
}
