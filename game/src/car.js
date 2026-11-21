// Solara Bay: car bodies, arcade driving, damage, smoke, explosions, cops' sirens.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';

const CAR = CONFIG.car;
const WHEEL_R = 0.34;
const DRAG = 0.6;
const BRAKE = 22;
const ROLL_DECEL = 2;
const SMOKE_HP = 30;
const HIT_SPEED = 8;

const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.24, 10).rotateZ(Math.PI / 2);

function part(w, h, d, hex, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Unlit bright box: lamps and the lightbar pop even in full sun.
function lamp(w, h, d, hex, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: hex }));
  mesh.position.set(x, y, z);
  mesh.lampMesh = true;
  return mesh;
}

export function buildCarMesh(kind, bodyHex) {
  const group = new THREE.Group();
  const body = bodyHex ?? (kind === 'taxi' ? C.taxi : kind === 'police' ? C.copbody : kind === 'sport' ? C.sport : C.sedan);
  const cabin = kind === 'sport' ? 0x2f3a44 : C.glass[0];

  // Main hull and a lower sill so the car reads as a car from any angle.
  group.add(part(2.05, 0.7, 4.3, body, 0, 0.62, 0));
  group.add(part(2.15, 0.2, 4.1, 0x2b2f33, 0, 0.32, 0));
  group.add(part(1.8, 0.62, 2.1, cabin, 0, 1.24, kind === 'sport' ? 0.3 : 0.15));
  if (kind === 'sport') {
    group.add(part(1.9, 0.1, 0.5, 0x22272c, 0, 1.6, 1.75));
    group.add(part(2.0, 0.16, 0.4, 0x22272c, 0, 0.98, -2.1));
  }
  if (kind === 'police') {
    group.add(part(2.1, 0.34, 2.4, C.coptrim, 0, 0.78, 0.1));
  }
  if (kind === 'taxi') {
    const sign = part(0.7, 0.3, 0.42, C.beacon, 0, 1.68, 0.1);
    group.add(sign);
  }

  // Head and tail lights.
  for (const side of [-0.66, 0.66]) {
    group.add(lamp(0.4, 0.16, 0.1, 0xfff5d0, side, 0.72, -2.16));
    group.add(lamp(0.36, 0.16, 0.1, 0xff4a3a, side, 0.72, 2.16));
  }

  // Police lightbar: two emissive boxes, swapped each flash tick.
  let barRed = null;
  let barBlue = null;
  if (kind === 'police') {
    barRed = lamp(0.55, 0.18, 0.26, C.barRed, -0.35, 1.65, 0.05);
    barBlue = lamp(0.55, 0.18, 0.26, C.barBlue, 0.35, 1.65, 0.05);
    group.add(barRed, barBlue, part(1.3, 0.1, 0.32, 0x1d2530, 0, 1.55, 0.05));
  }

  // Wheels: front pair sits a little forward so steering reads.
  const wheels = [];
  const fronts = [];
  for (const sx of [-1.02, 1.02]) {
    for (const sz of [-1.4, 1.4]) {
      const w = new THREE.Mesh(wheelGeo, material(0x1e2226));
      w.position.set(sx, WHEEL_R, sz);
      w.castShadow = true;
      group.add(w);
      wheels.push(w);
      if (sz < 0) fronts.push(w);
    }
  }

  group.userData = { wheels, fronts, barRed, barBlue, body };
  return group;
}

export function makeCar(kind, x, z, heading, colorHex) {
  const k = CAR.kinds[kind] ? kind : 'sedan';
  const mesh = buildCarMesh(k, colorHex);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  return {
    kind: k,
    mesh,
    x,
    z,
    heading,
    speed: 0,
    hp: CAR.hp,
    radius: CAR.radius,
    occupant: null,
    player: false,
    wrecked: false,
    smokeT: 0,
    flashT: 0,
    siren: false,
    steerVis: 0,
    color: colorHex,
  };
}

// Drives one car for one tick. Returns the collision normal for callers that care.
export function updateCarDrive(car, throttle, steer, brake, dt, W, G) {
  if (!car) return { hit: false };
  const kind = CAR.kinds[car.kind] || CAR.kinds.sedan;

  if (car.wrecked) {
    car.speed *= Math.max(0, 1 - dt * 3);
  } else {
    // Throttle, brake, drag, rolling resistance.
    if (throttle > 0) car.speed += kind.accel * throttle * dt;
    else if (throttle < 0) car.speed += kind.accel * 0.6 * throttle * dt;
    if (brake) {
      const cut = BRAKE * dt;
      car.speed = Math.abs(car.speed) <= cut ? 0 : car.speed - Math.sign(car.speed) * cut;
    }
    car.speed -= car.speed * DRAG * dt;
    if (!throttle) {
      const roll = ROLL_DECEL * dt;
      car.speed = Math.abs(car.speed) <= roll ? 0 : car.speed - Math.sign(car.speed) * roll;
    }
    car.speed = Math.max(-kind.max * 0.4, Math.min(kind.max, car.speed));

    // Steering scales with speed so a parked car cannot spin on the spot.
    const grip = Math.min(1, Math.abs(car.speed) / 6);
    const rate = kind.turn * grip * Math.sign(car.speed || 1);
    car.heading += steer * rate * dt;
    car.steerVis += ((steer * 0.5) - car.steerVis) * Math.min(1, dt * 10);
  }

  const fx = -Math.sin(car.heading);
  const fz = -Math.cos(car.heading);
  const dist = car.speed * dt;
  const res = resolveMove(W, car.x, car.z, car.radius, fx * dist, fz * dist);
  car.x = res.x;
  car.z = res.z;

  if (res.hit && !car.wrecked && Math.abs(car.speed) > HIT_SPEED) {
    const impact = Math.abs(car.speed);
    car.hp -= (impact - 7) * 2;
    car.speed *= -0.35;
    G?.sound?.crash?.();
  }
  bumpCars(car, G);

  // Dying cars: smoke puffs, then one explosion and a blackened hull.
  if (car.hp <= SMOKE_HP && !car.wrecked) {
    car.smokeT -= dt;
    if (car.smokeT <= 0) {
      car.smokeT = 0.22;
      G?.effects?.spawnSmokePuff?.({ x: car.x, y: 1.1, z: car.z });
      if (car.player) G?.engine?.sputter?.();
    }
  }
  if (car.hp <= 0 && !car.wrecked) {
    car.wrecked = true;
    car.speed *= 0.2;
    G?.explodeCar?.(car);
  }
  if (car.hp <= 0 && !car.charred) {
    car.charred = true;
    for (const child of car.mesh.children) {
      if (child.isMesh && child.material?.color && !child.lampMesh) child.material = material(0x23262a);
    }
  }

  // Police lightbar alternates red/blue six times a second.
  if (car.kind === 'police') {
    car.flashT += dt;
    const on = Math.floor(car.flashT * 6) % 2 === 0;
    const bar = car.mesh.userData;
    if (bar.barRed) {
      bar.barRed.material = material(on ? C.barRed : 0x4a1512, { flat: true });
      bar.barBlue.material = material(on ? 0x1a2a55 : C.barBlue, { flat: true });
    }
    G?.sound?.siren?.(!!car.siren);
  }

  // Wheels spin with travel, fronts turn with steering.
  const { wheels, fronts } = car.mesh.userData;
  const spin = (car.speed * dt) / WHEEL_R;
  for (const w of wheels) w.rotation.x -= spin;
  for (const w of fronts) w.rotation.y = car.steerVis * 0.9;

  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  return res;
}

export function carSpeedKmph(car) {
  if (!car) return 0;
  return Math.round(Math.abs(car.speed) * 3.6);
}

// Soft car-vs-car hit: both lose speed and the faster one takes damage.
function bumpCars(car, G) {
  const others = G ? [...(G.cars || []), ...(G.traffic || []), ...(G.PO?.cars || []).map((c) => c.car).filter(Boolean)] : null;
  if (!others && !G?.playerCar) return;
  for (const o of others || []) {
    if (!o || o === car) continue;
    const dx = o.x - car.x;
    const dz = o.z - car.z;
    const min = car.radius + o.radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min || d2 < 1e-6) continue;
    const d = Math.sqrt(d2);
    const push = (min - d) / 2;
    car.x -= (dx / d) * push;
    car.z -= (dz / d) * push;
    const impact = Math.abs(car.speed);
    car.speed *= 0.55;
    if (impact > HIT_SPEED) {
      car.hp -= (impact - 7) * 2;
      o.hp = Math.max(0, (o.hp ?? 0) - (impact - 7));
      G?.sound?.crash?.();
    }
  }
}

// Driver seat offset from the car centre, plus its heading for the chase camera.
export function seatPoints(car) {
  const fx = -Math.sin(car.heading);
  const fz = -Math.cos(car.heading);
  const rx = Math.cos(car.heading);
  const rz = -Math.sin(car.heading);
  return {
    x: car.x + fx * 0.35 + rx * 0.34,
    z: car.z + fz * 0.35 + rz * 0.34,
    yaw: car.heading,
    heading: car.heading,
    y: 0.9,
  };
}
