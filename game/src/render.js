// Transient visuals: muzzle flashes, tracers, explosions, smoke, sparks.
// One pool of 96 planes built at init, so a firefight allocates nothing.

import * as THREE from 'three';
import { C } from './palette.js';

const POOL = 96;
const FLASH_TTL = 0.05;
const TRACER_TTL = 0.06;
const BLAST_TTL = 0.7;
const SMOKE_TTL = 1.2;
const SPARK_TTL = 0.35;
const BLAST = [0xffd24a, 0xff9a3c, 0xff6a2a, 0xd94f2a, 0x5c4a3a];
const SMOKE = [0xbfc4c8, 0x9aa1a6, 0x7f868c];

let quad = null;            // shared unit plane, scaled by every sprite
let W = null;               // the one world the spawn calls draw into
const mats = new Map();

function shade(hex) {
  let m = mats.get(hex);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.9, depthWrite: false });
    mats.set(hex, m);
  }
  return m;
}

// Wake a dead sprite, or take over the oldest when the pool is full.
function take() {
  let pick = W.fx.sprites[0], oldest = -1;
  for (const s of W.fx.sprites) {
    if (!s.alive) { pick = s; break; }
    if (s.t > oldest) { oldest = s.t; pick = s; }
  }
  Object.assign(pick, { alive: true, t: 0, vx: 0, vy: 0, vz: 0, grow: 1, gravity: 0, kind: 'sprite' });
  pick.mesh.visible = true;
  return pick;
}

function show(s, pos, size, ttl) {
  s.mesh.position.set(pos.x || 0, pos.y || 0, pos.z || 0);
  s.mesh.scale.set(size, size, 1);
  Object.assign(s, { base: size, ttl, t: 0, alive: true });
  s.mesh.visible = true;
}

function puff(pos, size, ttl, hex) {
  const s = take();
  s.mesh.geometry = quad;
  s.mesh.material = shade(hex);
  show(s, pos, size, ttl);
  return s;
}

export function initEffects(world) {
  if (!world) return null;
  if (world.fx) return world.fx;
  if (!quad) quad = new THREE.PlaneGeometry(1, 1);
  const fx = {
    sprites: [],
    tracerGeo: new THREE.BoxGeometry(1, 1, 1),
    tracerMat: new THREE.MeshBasicMaterial({ color: C.sun, transparent: true, opacity: 0.9, depthWrite: false }),
  };
  for (let i = 0; i < POOL; i += 1) {
    const mesh = new THREE.Mesh(quad, shade(0xffffff));
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    world.scene.add(mesh);
    fx.sprites.push({ mesh, alive: false, t: 0, ttl: 1, base: 1, kind: 'sprite' });
  }
  world.fx = fx;
  if (world.yaw === undefined) world.yaw = Math.PI;      // shot-mode framing
  if (world.pitch === undefined) world.pitch = 0.34;
  W = world;
  return fx;
}

// The spawn calls take no world in the contract: use the bound one.
const AXIS = new THREE.Vector3(0, 0, 1);

export function spawnTracer(a, b) {
  if (!W || !a || !b) return;
  const s = take();
  const len = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  const far = len.length() || 1;
  s.mesh.geometry = W.fx.tracerGeo;
  s.mesh.material = W.fx.tracerMat;
  s.mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  s.mesh.quaternion.setFromUnitVectors(AXIS, len.divideScalar(far));
  s.mesh.scale.set(0.05, 0.05, far);
  Object.assign(s, { kind: 'tracer', base: 1, ttl: TRACER_TTL, t: 0, alive: true });
  s.mesh.visible = true;
}

export function spawnMuzzle(pos) {
  if (!W || !pos) return;
  puff({ x: pos.x, y: pos.y, z: pos.z }, 0.55, FLASH_TTL, 0xfff4c8).grow = 2.6;
}

export function spawnExplosion(pos) {
  if (!W || !pos) return;
  const x = pos.x, y = pos.y || 1, z = pos.z;
  puff({ x, y: y + 0.6, z }, 3.4, BLAST_TTL * 0.45, 0xfff4c8).grow = 2.2;
  for (let i = 0; i < 10; i += 1) {
    const a = i * 0.63;
    const s = puff({ x, y: y + 0.4, z }, 0.8 + (i % 3) * 0.4, BLAST_TTL, BLAST[i % BLAST.length]);
    Object.assign(s, {
      vx: Math.cos(a) * (3 + (i % 4)), vz: Math.sin(a) * (3 + (i % 5)), vy: 2.5 + (i % 6), gravity: 9, grow: 1.6,
    });
  }
}

export function spawnSmokePuff(pos) {
  if (!W || !pos) return;
  const s = puff({ x: pos.x, y: pos.y || 0.8, z: pos.z }, 0.7, SMOKE_TTL, SMOKE[(Math.random() * 3) | 0]);
  Object.assign(s, { vy: 1.1, vx: 0.25, vz: -0.2, grow: 2.4 });
}

export function spawnSpark(pos) {
  if (!W || !pos) return;
  for (let i = 0; i < 4; i += 1) {
    const s = puff({ x: pos.x, y: pos.y || 1, z: pos.z }, 0.18, SPARK_TTL, i % 2 ? 0xfff4c8 : 0xffb347);
    Object.assign(s, { vx: (i - 1.5) * 2.4, vy: 1.5 + i, vz: (1.5 - i) * 2, gravity: 12, grow: 0.6 });
  }
}

let hurtTimer = 0;

/** Red vignette on the HUD for 200 ms. */
export function flashDamage() {
  const hud = typeof document !== 'undefined' && document.getElementById('hud');
  if (!hud) return;
  hud.classList.add('hurt');
  if (!hurtTimer) hurtTimer = setTimeout(() => hud.classList.remove('hurt'), 200);
}

export function updateEffects(world, dt) {
  const fx = world && world.fx;
  if (!fx) return;
  const step = Math.min(0.1, Math.max(0, Number(dt) || 0));
  const cam = world.camera ? world.camera.position : null;
  for (const s of fx.sprites) {
    if (!s.alive) continue;
    s.t += step;
    const m = s.mesh;
    if (s.t >= s.ttl) {
      Object.assign(s, { alive: false, kind: 'sprite' });
      m.visible = false;
      continue;
    }
    if (s.kind === 'tracer') continue;
    s.vy -= s.gravity * step;
    m.position.x += s.vx * step;
    m.position.y += s.vy * step;
    m.position.z += s.vz * step;
    if (m.position.y < 0.15) {
      m.position.y = 0.15;
      s.vy = Math.abs(s.vy) * 0.3;
    }
    const k = s.t / s.ttl;
    const size = s.base * (1 + (s.grow - 1) * k);
    m.scale.set(size, size, 1);
    if (cam) m.rotation.y = Math.atan2(cam.x - m.position.x, cam.z - m.position.z);
    m.material.transparent = true;
    m.material.opacity = 0.9 * (1 - k * k);
  }
}
