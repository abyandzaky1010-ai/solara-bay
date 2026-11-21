// The player on foot: camera-relative WASD movement, sprint, jump, third-person camera,
// pistol shooting (hitscan raycast + tracer + muzzle flash), damage and death.
import * as THREE from 'three';
import { CFG } from './config.js';
import { W, collideCircle, clampWorld, dist } from './world.js';
import { consumeMouse } from './input.js';
import { makeHumanoid } from './render.js';
import { addWanted } from './police.js';
import { explodeCar } from './car.js';
import { sfx } from './sfx.js';

const ray = new THREE.Raycaster();
const tmpV = new THREE.Vector3();
const muzzle = new THREE.Vector3();

export function makePlayer() {
  const p = {
    pos: { x: W.spot.spawn.x, y: 0, z: W.spot.spawn.z },
    vel: { x: 0, y: 0, z: 0 },
    hp: CFG.playerHp, ammo: CFG.mag, pool: CFG.startPool, reload: 0,
    inCar: null, radius: 0.45,
    mesh: makeHumanoid(0x3a6fd8),
  };
  p.mesh.userData.kind = 'player'; p.mesh.userData.ref = p;
  W.scene.add(p.mesh);
  W.player = p;
  return p;
}

export function hurtPlayer(n) {
  const p = W.player;
  if (W.mode !== 'play' || p.hp <= 0) return;
  p.hp -= n;
  W.shake = Math.min(1, W.shake + n / 60);
  if (p.hp <= 0) {
    p.hp = 0;
    W.mode = 'wasted'; W.overT = 0;
  }
}

export function updatePlayer(dt) {
  const p = W.player;
  const [dx, dy] = consumeMouse();
  W.camYaw -= dx * 0.0026;
  W.camPitch = Math.max(-1.1, Math.min(1.25, W.camPitch + dy * 0.0022));

  if (p.inCar) { updateCamera(dt, p.inCar.pos, 10.5, 2.4); return; }

  const fx = Math.sin(W.camYaw), fz = Math.cos(W.camYaw);
  const rx = Math.cos(W.camYaw), rz = -Math.sin(W.camYaw);
  const ix = (W.keys.KeyD ? 1 : 0) - (W.keys.KeyA ? 1 : 0);
  const iz = (W.keys.KeyW ? 1 : 0) - (W.keys.KeyS ? 1 : 0);
  const speed = (W.keys.ShiftLeft || W.keys.ShiftRight) ? CFG.sprint : CFG.walk;
  let wx = fx * iz + rx * ix, wz = fz * iz + rz * ix;
  const moving = ix !== 0 || iz !== 0;
  if (moving) { const l = Math.hypot(wx, wz); wx = wx / l * speed; wz = wz / l * speed; }
  else { wx = 0; wz = 0; }
  p.vel.x += (wx - p.vel.x) * Math.min(1, dt * 12);
  p.vel.z += (wz - p.vel.z) * Math.min(1, dt * 12);
  p.vel.y -= 22 * dt;
  if (W.keys.Space && p.pos.y <= 0.001) p.vel.y = CFG.jumpV;
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  p.pos.y += p.vel.y * dt;
  if (p.pos.y < 0) { p.pos.y = 0; p.vel.y = 0; }
  const res = collideCircle(p.pos.x, p.pos.z, p.radius);
  [p.pos.x, p.pos.z] = clampWorld(res.x, res.z, p.radius);
  if (res.hit && p.pos.y <= 0.01) { p.vel.x *= 0.2; p.vel.z *= 0.2; }
  p.mesh.position.set(p.pos.x, p.pos.y, p.pos.z);
  p.mesh.rotation.y = W.camYaw;

  if (p.reload > 0) p.reload -= dt;
  if (W.keys.KeyR && p.reload <= 0 && p.ammo < CFG.mag && p.pool > 0) p.reload = CFG.reloadT;
  if (p.reload <= 0 && p.ammo === 0 && p.pool > 0) p.reload = CFG.reloadT;
  if (p.reload > 0 && p.reload <= dt) { // finish reload this step
    const take = Math.min(CFG.mag - p.ammo, p.pool);
    p.ammo += take; p.pool -= take;
  }
  if (W.clicked && p.ammo > 0 && p.reload <= 0) shoot();
  updateCamera(dt, p.pos, 6.5, 1.7);
}

function shoot() {
  const p = W.player;
  p.ammo--;
  W.gunshotT = W.time;
  W.alertPos = { x: p.pos.x, z: p.pos.z };
  addWanted(1);
  sfx.shoot();
  ray.setFromCamera({ x: 0, y: 0 }, W.camera);
  ray.far = CFG.range;
  const hits = ray.intersectObjects(W.scene.children, true);
  let end = null, target = null;
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.kind) o = o.parent;
    if (!o) continue;
    end = h.point.clone();
    if (o.userData.ref) target = o.userData;
    break;
  }
  if (!end) {
    end = new THREE.Vector3();
    ray.ray.at(CFG.range, end);
  }
  // tracer from the muzzle to the hit point
  const fx = Math.sin(W.camYaw), fz = Math.cos(W.camYaw);
  muzzle.set(p.pos.x + fx * 0.5, p.pos.y + 1.45, p.pos.z + fz * 0.5);
  const geo = new THREE.BufferGeometry().setFromPoints([muzzle.clone(), end]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 1 }));
  W.scene.add(line);
  W.fx.push({ mesh: line, t: 0.09, kind: 'tracer' });
  if (target) {
    const ref = target.ref;
    if (target.kind === 'ped' || target.kind === 'cop') {
      ref.hp -= CFG.dmg;
      if (ref.hp <= 0 && !ref.dead) {
        ref.dead = true; ref.deadT = 0;
        addWanted(target.kind === 'cop' ? 2 : 1);
        sfx.thud();
      }
    } else if (target.kind === 'car') {
      ref.hp -= CFG.dmg * 0.6;
      if (ref.hp <= 0) explodeCar(ref);
    }
  }
}

// Third-person chase camera: sits behind the look direction, clamped above the ground.
export function updateCamera(dt, t, d, up) {
  const cp = W.camPitch, cy = W.camYaw;
  const fx = Math.sin(cy) * Math.cos(cp), fy = -Math.sin(cp), fz = Math.cos(cy) * Math.cos(cp);
  tmpV.set(t.x - fx * d, t.y + up - fy * d, t.z - fz * d);
  if (tmpV.y < 0.5) tmpV.y = 0.5;
  W.camera.position.lerp(tmpV, Math.min(1, dt * 10));
  const look = new THREE.Vector3(t.x + fx * 3, t.y + up, t.z + fz * 3);
  W.camera.lookAt(look);
  if (W.shake > 0) {
    W.camera.position.x += (Math.random() - 0.5) * W.shake * 0.5;
    W.camera.position.y += (Math.random() - 0.5) * W.shake * 0.5;
  }
}
