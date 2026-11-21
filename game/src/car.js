// Cars: the box-built entity, arcade driving for the player's car, AABB + circle collisions,
// ramming damage, explosions, and E to enter/exit (stealing a traffic or police car raises wanted).
import * as THREE from 'three';
import { CFG } from './config.js';
import { W, collideCircle, clampWorld, dist } from './world.js';
import { makeCarMesh } from './render.js';
import { hurtPlayer } from './player.js';
import { addWanted } from './police.js';
import { sfx } from './sfx.js';

let carId = 0;

export function makeCar(color, kind, x, z, heading = 0) {
  const { group, wheels, bar } = makeCarMesh(color, { police: kind === 'police', taxi: kind === 'taxi' });
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  group.userData.kind = 'car';
  const car = {
    id: carId++, kind, pos: { x, y: 0, z }, heading, speed: 0,
    hp: CFG.carHp, radius: 1.8, mesh: group, wheels, bar, dead: false,
  };
  group.userData.ref = car;
  W.scene.add(group);
  W.cars.push(car);
  return car;
}

export function explodeCar(c) {
  if (c.dead) return;
  c.dead = true; c.hp = 0;
  sfx.boom();
  const s = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 }));
  s.position.set(c.pos.x, 1.5, c.pos.z);
  W.scene.add(s);
  W.fx.push({ mesh: s, t: 0.7, kind: 'boom' });
  if (W.player.inCar === c) {
    W.player.inCar = null;
    W.player.pos.x = c.pos.x + 2.5; W.player.pos.z = c.pos.z; W.player.pos.y = 0;
    W.player.mesh.visible = true;
    hurtPlayer(55);
  }
  const d = dist(c.pos.x, c.pos.z, W.player.pos.x, W.player.pos.z);
  if (d < 6 && !W.player.inCar) hurtPlayer((6 - d) * 12);
  W.scene.remove(c.mesh);
}

// Arcade driving: throttle, speed-sensitive steering, wall/car/ped collisions.
export function updatePlayerCar(dt) {
  const p = W.player, c = p.inCar;
  if (!c || c.dead) { p.inCar = null; p.mesh.visible = true; return; }
  const th = (W.keys.KeyW ? 1 : 0) - (W.keys.KeyS ? 1 : 0);
  const st = (W.keys.KeyA ? 1 : 0) - (W.keys.KeyD ? 1 : 0);
  c.speed += th * CFG.carAccel * dt - c.speed * 0.55 * dt;
  c.speed = Math.max(-CFG.carRev, Math.min(CFG.carMax, c.speed));
  c.heading += st * CFG.steer * dt * Math.max(-1, Math.min(1, c.speed / 9)) * (c.speed < 0 ? -1 : 1);
  c.pos.x += Math.sin(c.heading) * c.speed * dt;
  c.pos.z += Math.cos(c.heading) * c.speed * dt;
  const res = collideCircle(c.pos.x, c.pos.z, c.radius);
  [c.pos.x, c.pos.z] = clampWorld(res.x, res.z, c.radius);
  if (res.hit) {
    const impact = Math.abs(c.speed);
    if (impact > 11) {
      c.hp -= (impact - 11) * 1.6;
      W.shake = Math.min(1, (impact - 11) / 14);
      sfx.crash();
      if (c.hp <= 0) explodeCar(c);
    }
    c.speed *= -0.22;
  }
  for (const o of W.cars) {
    if (o === c || o.dead) continue;
    const d = dist(c.pos.x, c.pos.z, o.pos.x, o.pos.z);
    if (d < c.radius + o.radius && d > 1e-4) {
      const push = (c.radius + o.radius - d) / 2;
      const nx = (c.pos.x - o.pos.x) / d, nz = (c.pos.z - o.pos.z) / d;
      c.pos.x += nx * push; c.pos.z += nz * push;
      if (o.kind !== 'parked') { o.pos.x -= nx * push; o.pos.z -= nz * push; o.speed *= 0.8; }
      const rel = Math.abs(c.speed - (o.speed || 0));
      if (rel > 9) {
        c.hp -= (rel - 9) * 1.2; o.hp -= (rel - 9) * 0.8;
        sfx.crash();
        if (c.hp <= 0) explodeCar(c);
        else if (o.hp <= 0) explodeCar(o);
      }
      c.speed *= 0.82;
    }
  }
  for (const ped of W.peds) {
    if (ped.dead || ped.rider) continue;
    if (dist(c.pos.x, c.pos.z, ped.pos.x, ped.pos.z) < c.radius + 0.6) {
      ped.dead = true; ped.deadT = 0;
      addWanted(1);
      sfx.thud();
      c.speed *= 0.55;
    }
  }
  c.mesh.position.set(c.pos.x, c.pos.y, c.pos.z);
  c.mesh.rotation.y = c.heading;
  for (const w of c.wheels) w.rotation.x += c.speed * dt / 0.38;
}

// E near a car: enter it (theft = wanted); E while driving: hop out.
export function tryEnterExit() {
  const p = W.player;
  if (p.inCar) {
    const c = p.inCar;
    p.inCar = null;
    p.pos.x = c.pos.x + Math.cos(c.heading) * 2.6;
    p.pos.z = c.pos.z - Math.sin(c.heading) * 2.6;
    [p.pos.x, p.pos.z] = clampWorld(p.pos.x, p.pos.z, p.radius);
    p.pos.y = 0; p.vel = { x: 0, y: 0, z: 0 };
    p.mesh.visible = true;
    W.justExited = c;
    return;
  }
  let best = null, bd = 3.6;
  for (const c of W.cars) {
    if (c.dead) continue;
    const d = dist(p.pos.x, p.pos.z, c.pos.x, c.pos.z);
    if (d < bd) { bd = d; best = c; }
  }
  if (!best) return;
  if (best.kind === 'traffic') addWanted(1);
  if (best.kind === 'police') addWanted(2);
  p.inCar = best;
  p.mesh.visible = false;
  W.justEntered = best;
}
