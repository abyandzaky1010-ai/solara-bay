// Solara Bay — transient effects: bullet lines, muzzle bloom, fireballs, engine
// smoke. One fixed pool of flat quads, built once and reused.

import * as THREE from 'three';

const POOL = 96; // quads shared by every effect
const DRAG = 2.4; // per second on thrown particles
const QUAD = new THREE.PlaneGeometry(1, 1);
const UP = new THREE.Vector3(0, 1, 0);
// Life, size, growth per second, opacity, colour, atmospheric (face the camera).
const KIND = {
  tracer: [0.06, 0.09, 0, 0.9, 0xfff1b8, false],
  muzzle: [0.06, 0.55, 1.6, 1, 0xffe6a0, true],
  fire: [0.42, 2.6, 5.2, 0.95, 0xff8a3d, true],
  smoke: [1.1, 0.9, 2, 0.5, 0x6f6f6f, true],
};

let pool = null;
let next = 0;
let hitT = 0;

/** A dormant quad with its own material. */
function blank() {
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(QUAD, material);
  mesh.visible = false;
  mesh.frustumCulled = false;
  return { mesh, material, alive: false, t: 0, ttl: 1, grow: 0, billboard: true, vel: { x: 0, y: 0, z: 0 } };
}

/** initEffects(W): the pool goes in the scene once. */
export function initEffects(W) {
  if (!pool) {
    const group = new THREE.Group();
    group.name = 'effects';
    const list = [];
    for (let i = 0; i < POOL; i += 1) {
      const q = blank();
      group.add(q.mesh);
      list.push(q);
    }
    pool = { group, list };
  }
  if (W?.scene && pool.group.parent !== W.scene) W.scene.add(pool.group);
  return pool;
}

/** A free slot; with all 96 busy, the oldest is recycled. */
function take() {
  if (!pool) initEffects(null);
  for (let i = 0; i < POOL; i += 1) {
    const at = (next + i) % POOL;
    if (!pool.list[at].alive) {
      next = (at + 1) % POOL;
      return pool.list[at];
    }
  }
  const old = pool.list[next];
  next = (next + 1) % POOL;
  return old;
}

/** Wake a quad at `at` as `kind`. */
function light(kind, at, vel) {
  const [ttl, size, grow, alpha, hex, billboard] = KIND[kind];
  const s = take();
  Object.assign(s, { alive: true, t: 0, ttl, grow, billboard, vel: vel || s.vel });
  s.material.color.setHex(hex);
  s.material.opacity = alpha;
  s.mesh.position.set(at.x, at.y ?? 1, at.z);
  s.mesh.quaternion.identity();
  s.mesh.scale.set(size, kind === 'tracer' ? size : 1, kind === 'tracer' ? 1 : size);
  s.mesh.visible = true;
  return s;
}

/** A thin stretched line from the eye to the impact, 60 ms long. */
export function spawnTracer(a, b) {
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = (b.y ?? 1) - (a.y ?? 1);
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz) || 0.1;
  const s = light('tracer', { x: (a.x + b.x) / 2, y: ((a.y ?? 1) + (b.y ?? 1)) / 2, z: (a.z + b.z) / 2 });
  s.mesh.scale.set(KIND.tracer[1], len, KIND.tracer[1]);
  s.mesh.quaternion.setFromUnitVectors(UP, new THREE.Vector3(dx, dy, dz).divideScalar(len));
  return s;
}

/** The warm bloom off a barrel. */
export function spawnMuzzle(pos) {
  return pos ? light('muzzle', pos, { x: 0, y: 0.4, z: 0 }) : null;
}

/** A fireball and six wedges of smoke thrown outward. */
export function spawnExplosion(pos) {
  if (!pos) return null;
  const at = { x: pos.x, y: (pos.y ?? 1) + 0.3, z: pos.z };
  const fire = light('fire', at, { x: 0, y: 2.2, z: 0 });
  fire.material.color.setHex(0xffd24a);
  fire.ttl = 0.25;
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    light('smoke', at, { x: Math.cos(a) * 3.2, y: 1.6 + i * 0.2, z: Math.sin(a) * 3.2 });
  }
  return true;
}

/** One grey breath from a dying engine. */
export function spawnSmokePuff(pos) {
  return pos ? light('smoke', pos, { x: 0.2, y: 1.1, z: 0.2 }) : null;
}

/** Red vignette via the #hud class, cleared after 200 ms. */
export function flashDamage() {
  const hud = typeof document === 'undefined' ? null : document.getElementById('hud');
  if (!hud) return false;
  hitT = 0.2;
  hud.classList.add('hit');
  return true;
}

/** updateEffects(W, dt): age, drift, grow, fade, and face the camera. */
export function updateEffects(W, dt) {
  if (!pool) return false;
  for (const s of pool.list) {
    if (!s.alive) continue;
    const life = (s.t += dt) / s.ttl;
    if (life >= 1) {
      Object.assign(s, { alive: false });
      s.mesh.visible = false;
      continue;
    }
    if (s.grow) {
      const keep = Math.max(0, 1 - DRAG * dt);
      s.vel.x *= keep;
      s.vel.y *= keep;
      s.vel.z *= keep;
      s.mesh.position.x += s.vel.x * dt;
      s.mesh.position.y += s.vel.y * dt;
      s.mesh.position.z += s.vel.z * dt;
      const size = s.mesh.scale.x + s.grow * dt;
      s.mesh.scale.set(size, 1, size);
    }
    s.material.opacity = 0.9 * (1 - life) * (1 - life * 0.3) + 0.05;
    if (s.billboard && W?.camera) s.mesh.lookAt(W.camera.position);
  }
  if (hitT > 0 && (hitT -= dt) <= 0 && typeof document !== 'undefined') document.getElementById('hud')?.classList.remove('hit');
  return true;
}
