// Vehicles: the meshes you see, the arcade driving that moves them, and the
// wear that eventually leaves one a smoking shell. Geometry lives beside the
// number-crunching so "taxi" means the same body, paint and physics everywhere.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';

const KINDS = CONFIG.car.kinds;
const HALF_LEN = 2.15;   // nose to tail
const HALF_WID = 0.95;
const WHEEL_R = 0.36;

const DRAG = 0.6;        // fraction of speed shed per second
const HANDBRAKE = 22;    // m/s²
const COAST = 2;         // engine braking, m/s²
const REVERSE_PART = 0.32;
const CRASH_SPEED = 8;
const SMOKE_HP = 30;
const SPIN_GAUGE = 1 / (WHEEL_R * 2); // radians of wheel rotation per metre

function bodyColour(kind) {
  return C[kind] || C.sedan;
}

// ------------------------------------------------------------------- mesh

function slab(w, h, d, hex, x, y, z, opts) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex, opts));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Group origin sits on the road at the car's centre. userData carries the
// handles the driver needs: wheels, lightbar emitters, paintable shells.
export function buildCarMesh(kind, bodyHex) {
  const hex = typeof bodyHex === 'number' ? bodyHex : bodyColour(kind);
  const group = new THREE.Group();
  const shells = [];
  const low = kind === 'sport';

  const bodyH = low ? 0.5 : 0.62;
  const bodyY = low ? 0.62 : 0.72;

  const main = slab(HALF_WID * 2, bodyH, HALF_LEN * 2, hex, 0, bodyY, 0);
  group.add(main);
  shells.push(main);
  const crease = slab(HALF_WID * 2 + 0.02, 0.1, HALF_LEN * 1.7, 0x2c3138, 0, bodyY - bodyH * 0.3, 0);
  crease.castShadow = false;
  group.add(crease);

  const cabinLen = low ? 1.85 : 2.2;
  const cabinH = low ? 0.42 : 0.56;
  const cabinZ = low ? -0.25 : -0.1;
  const cabinY = bodyY + bodyH * 0.5 + cabinH * 0.5;
  const cabin = slab(HALF_WID * 1.8, cabinH, cabinLen, hex, 0, cabinY, cabinZ);
  group.add(cabin);
  shells.push(cabin);

  const glass = 0x2f4e63;
  for (const z of [cabinZ + cabinLen / 2 + 0.01, cabinZ - cabinLen / 2 - 0.01]) {
    group.add(slab(HALF_WID * 1.65, cabinH * 0.72, 0.08, glass, 0, cabinY, z, { glassy: true }));
  }
  for (const side of [-1, 1]) {
    group.add(slab(0.06, cabinH * 0.6, cabinLen * 0.86, glass, side * HALF_WID * 0.9, cabinY, cabinZ, { glassy: true }));
  }

  // Wheels: cylinders on their side in steerable pivots.
  const spin = [];
  const steered = [];
  const tyreGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.26, 12);
  const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.29, 8);
  const rubber = material(0x1b1d21);
  const hubMat = material(0xb9bec4);
  for (const z of [HALF_LEN * 0.62, -HALF_LEN * 0.62]) {
    for (const x of [-HALF_WID - 0.02, HALF_WID + 0.02]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, WHEEL_R, z);
      const tyre = new THREE.Mesh(tyreGeo, rubber);
      tyre.rotation.z = Math.PI / 2;
      tyre.castShadow = true;
      pivot.add(tyre);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      hub.rotation.z = Math.PI / 2;
      pivot.add(hub);
      group.add(pivot);
      spin.push(pivot);
      if (z > 0) steered.push(pivot);
    }
  }

  // Daytime running lights: warm white nose, red tail.
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff4cf });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xd94f3a });
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08), headMat);
    lamp.position.set(side * (HALF_WID - 0.24), bodyY, HALF_LEN + 0.02);
    group.add(lamp);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.08), tailMat);
    tail.position.set(side * (HALF_WID - 0.24), bodyY, -HALF_LEN - 0.02);
    group.add(tail);
  }
  for (const z of [HALF_LEN + 0.06, -HALF_LEN - 0.06]) {
    group.add(slab(HALF_WID * 2 + 0.06, 0.16, 0.24, 0x363b42, 0, bodyY - bodyH * 0.45, z));
  }

  let barRed = null;
  let barBlue = null;

  if (kind === 'taxi') {
    // Rooflight plus a black checker band along both flanks.
    group.add(slab(0.9, 0.22, 0.46, 0xfdf6d8, 0, cabinY + cabinH / 2 + 0.13, cabinZ, { flat: true }));
    for (const side of [-1, 1]) {
      group.add(slab(0.04, 0.16, 0.9, 0x1f2328, side * HALF_WID, bodyY, 0));
    }
  }

  if (kind === 'police') {
    for (const side of [-1, 1]) {
      group.add(slab(0.05, 0.3, HALF_LEN * 1.8, C.coptrim, side * (HALF_WID + 0.01), bodyY, 0));
    }
    group.add(slab(HALF_WID * 1.4, 0.5, 0.12, 0x41474f, 0, 0.6, HALF_LEN + 0.18));
    const rackY = cabinY + cabinH / 2 + 0.12;
    group.add(slab(HALF_WID * 1.1, 0.1, 0.42, 0x232830, 0, rackY - 0.06, cabinZ));
    barRed = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 0.36), material(C.barRed));
    barRed.position.set(-0.3, rackY, cabinZ);
    group.add(barRed);
    barBlue = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 0.36), material(C.barBlue));
    barBlue.position.set(0.3, rackY, cabinZ);
    group.add(barBlue);
  }

  Object.assign(group.userData, {
    wheels: spin,
    frontWheels: steered,
    shells,
    barRed,
    barBlue,
    bodyHex: hex,
  });
  return group;
}

// Lightbar materials are shared so flashing costs no allocation per frame.
const litMats = new Map();
const dimMats = new Map();

function barShade(hex, lit) {
  const store = lit ? litMats : dimMats;
  let m = store.get(hex);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: lit ? hex : new THREE.Color(hex).multiplyScalar(0.25).getHex() });
    store.set(hex, m);
  }
  return m;
}

// ------------------------------------------------------------- lifecycle

export function makeCar(kind, x, z, heading, colorHex) {
  const real = KINDS[kind] ? kind : 'sedan';
  const mesh = buildCarMesh(real, colorHex);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading || 0;

  return {
    kind: real,
    mesh,
    x,
    z,
    heading: heading || 0,
    speed: 0,
    hp: CONFIG.car.hp,
    radius: CONFIG.car.radius,
    occupant: null,
    player: false,
    wrecked: false,
    smokeT: 0,
    flashT: 0,
    sirenOn: false,
    spin: 0,
    steerVis: 0,
    colorHex,
  };
}

// Driver's door: one step out to the car's left, same heading.
export function seatPoints(car) {
  return {
    x: car.x + Math.sin(car.heading) * HALF_WID - Math.cos(car.heading) * (HALF_WID + 0.9),
    z: car.z + Math.cos(car.heading) * HALF_WID + Math.sin(car.heading) * (HALF_WID + 0.9),
    heading: car.heading,
  };
}

export function carSpeedKmh(car) {
  return Math.round(Math.abs(car.speed) * 3.6);
}

// ----------------------------------------------------------------- drive

// throttle and steer run -1..1, brake is the handbrake key. G supplies hooks
// for sound, smoke and the explosion.
export function updateCarDrive(car, throttle, steer, brake, dt, W, G) {
  if (!car || car.wrecked) return car;
  const spec = KINDS[car.kind] || KINDS.sedan;

  // Longitudinal: engine, drag, coast-down, handbrake.
  const t = Math.max(-1, Math.min(1, throttle || 0));
  if (t !== 0) {
    const gripping = Math.sign(t) === Math.sign(car.speed) || Math.abs(car.speed) < 0.4;
    car.speed += t * spec.accel * (gripping ? 1 : 2.2) * dt;
    car.speed -= car.speed * DRAG * dt;
    car.speed = Math.max(-spec.max * REVERSE_PART, Math.min(spec.max, car.speed));
  } else {
    const shed = COAST * dt;
    car.speed = Math.abs(car.speed) <= shed ? 0 : car.speed - Math.sign(car.speed) * shed;
  }
  if (brake) {
    const shed = HANDBRAKE * dt;
    car.speed = Math.abs(car.speed) <= shed ? 0 : car.speed - Math.sign(car.speed) * shed;
  }

  // Heading: steering authority grows with speed; reversing mirrors the wheel.
  const ratio = Math.min(1, Math.abs(car.speed) / spec.max);
  const direction = car.speed < -0.3 ? -1 : 1;
  car.heading += (steer || 0) * spec.turn * (0.35 + 0.65 * ratio) * direction * dt;

  // Move, then settle against the city.
  const wanted = Math.abs(car.speed);
  const step = car.speed * dt;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const moved = resolveMove(W, car.x, car.z, car.radius, fx * step, fz * step);
  car.x = moved.x;
  car.z = moved.z;

  if (moved.hit) {
    if (wanted > CRASH_SPEED) {
      car.hp -= (wanted - 7) * 2;
      if (G.sound && G.sound.crash) G.sound.crash(wanted / spec.max);
      if (G.effects && G.effects.spawnSmokePuff) G.effects.spawnSmokePuff({ x: car.x + fx * 2, y: 0.8, z: car.z + fz * 2 });
    }
    car.speed *= -0.35;
    if (Math.abs(car.speed) < 0.6) car.speed = 0;
  }

  // Wheel spin and visible steering angle.
  car.spin -= car.speed * dt * SPIN_GAUGE;
  const target = Math.max(-0.55, Math.min(0.55, (steer || 0) * 0.55));
  car.steerVis += (target - car.steerVis) * Math.min(1, dt * 10);

  const ud = car.mesh.userData;
  for (const w of ud.wheels) w.rotation.x = car.spin;
  for (const w of ud.frontWheels) w.rotation.y = car.steerVis;

  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  const lean = -(steer || 0) * ratio * 0.06;
  car.mesh.rotation.z += (lean - car.mesh.rotation.z) * Math.min(1, dt * 6);

  // Damage: steam from the hood below a third of the tank, then the bang.
  car.smokeT -= dt;
  if (car.hp > 0 && car.hp <= SMOKE_HP && car.smokeT <= 0) {
    car.smokeT = 0.18;
    if (G.effects && G.effects.spawnSmokePuff) {
      G.effects.spawnSmokePuff({
        x: car.x + fx * 1.6 + (Math.random() - 0.5) * 0.5,
        y: 0.9,
        z: car.z + fz * 1.6 + (Math.random() - 0.5) * 0.5,
      });
    }
    if (G.sound && G.sound.engineSputter) G.sound.engineSputter();
  }
  if (car.hp <= 0) {
    wreckCar(car, G);
    return car;
  }

  // Police: siren follows the wanted level, lightbar flips red/blue.
  if (car.kind === 'police') {
    const hot = !!(G.PO && G.PO.stars > 0);
    if (hot !== car.sirenOn) {
      car.sirenOn = hot;
      if (G.sound && G.sound.siren) G.sound.siren(hot, car.x, car.z);
    }
    car.flashT += dt;
    const flip = Math.floor(car.flashT * 6) % 2;
    ud.barRed.material = barShade(C.barRed, car.sirenOn && flip === 0);
    ud.barBlue.material = barShade(C.barBlue, car.sirenOn && flip === 1);
  }

  return car;
}

// Blackened hull that never drives again.
export function wreckCar(car, G) {
  if (car.wrecked) return;
  car.wrecked = true;
  car.speed = 0;
  car.hp = 0;

  const ud = car.mesh.userData;
  const soot = material(0x1e1d1b);
  for (const shell of ud.shells) shell.material = soot;
  if (ud.barRed) ud.barRed.material = barShade(C.barRed, false);
  if (ud.barBlue) ud.barBlue.material = barShade(C.barBlue, false);
  car.mesh.rotation.z = 0.06;
  car.mesh.position.y = -0.06;

  if (!G) return;
  if (G.spawnExplosion) G.spawnExplosion({ x: car.x, y: 1, z: car.z });
  else if (G.effects && G.effects.spawnExplosion) G.effects.spawnExplosion({ x: car.x, y: 1, z: car.z });
  if (G.sound && G.sound.explode) G.sound.explode();
  if (G.explodeCar) G.explodeCar(car);
  if (G.onCarExplode) G.onCarExplode(car);
}
