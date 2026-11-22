// Solara Bay — cars: the mesh a kind wears, the arcade physics that moves it,
// and the door a driver steps out of. Driving lives here and nowhere else.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';

const CAR = CONFIG.car;
const KINDS = CAR.kinds;
const LIMIT = CONFIG.world.half - 2;

// Numbers this module lives by.
const DRAG = 0.6; // per second, at any speed
const BRAKE = 22; // m/s² on Space
const COAST = 2; // m/s² of engine braking with no throttle
const SMOKE_AT = 30; // hp at which the engine trails grey
const HIT_SPEED = 8; // m/s: a wall strike harder than this costs hp
const BOUNCE = 0.35; // fraction of speed thrown back on impact

// Length, width, body height, wheel radius, cabin length, roof height.
const FRAME = {
  sport: { len: 4.5, wide: 1.9, tall: 0.72, wheel: 0.36, cabin: 1.7, roof: 0.52 },
  sedan: { len: 4.6, wide: 1.86, tall: 0.8, wheel: 0.34, cabin: 2.0, roof: 0.56 },
  police: { len: 4.8, wide: 1.9, tall: 0.82, wheel: 0.36, cabin: 2.1, roof: 0.55 },
};
FRAME.taxi = FRAME.sedan;
const PAINT = { sport: C.sport };

/** A small lit box at a local offset — the whole vocabulary of a car body. */
function part(w, h, d, hex, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

/**
 * buildCarMesh(kind, bodyHex) → THREE.Group: chassis, cabin, glass, four
 * cylinder wheels on hubs (front pair steerable), lamps. Taxi gets a roof sign,
 * police a red/blue bar with a real `emissive` so police.js can strobe it.
 */
export function buildCarMesh(kind, bodyHex) {
  const f = FRAME[kind] || FRAME.sedan;
  const group = new THREE.Group();
  group.name = `car-${kind}`;
  const paint = bodyHex ?? PAINT[kind] ?? (kind === 'taxi' ? C.taxi : kind === 'police' ? C.copbody : C.sedan);
  const topY = f.wheel + f.tall;
  const roofTop = topY + f.roof;

  group.add(part(f.wide, f.tall, f.len, paint, 0, topY - f.tall / 2, 0));
  group.add(part(f.wide * 0.86, f.roof, f.cabin, paint, 0, topY + f.roof / 2, 0.1));
  const glass = new THREE.Mesh(new THREE.BoxGeometry(f.wide * 0.88, f.roof * 0.6, f.cabin * 0.94), material(C.glass[0], { glassy: true }));
  glass.position.set(0, topY + f.roof * 0.6, 0.1);
  group.add(glass);

  const lampY = f.wheel + f.tall * 0.7;
  for (const side of [-1, 1]) {
    group.add(part(0.36, 0.16, 0.1, 0xfff4cf, side * f.wide * 0.3, lampY, -f.len / 2 - 0.02));
    group.add(part(0.34, 0.14, 0.1, 0xd93f36, side * f.wide * 0.32, lampY, f.len / 2 + 0.02));
  }

  // Wheels: a cylinder on its side inside a hub group; the front hubs steer.
  const wheels = [];
  const fronts = [];
  const tyre = new THREE.CylinderGeometry(f.wheel, f.wheel, 0.28, 10);
  const rubber = material(0x1d2024);
  for (let i = 0; i < 4; i += 1) {
    const spin = new THREE.Mesh(tyre, rubber);
    spin.rotation.z = Math.PI / 2;
    const hub = new THREE.Group();
    hub.position.set(i % 2 ? f.wide / 2 + 0.02 : -f.wide / 2 - 0.02, f.wheel, i < 2 ? -f.len * 0.31 : f.len * 0.31);
    hub.add(spin);
    group.add(hub);
    wheels.push(spin);
    if (i < 2) fronts.push(hub);
  }

  const kit = { kind, paint, wheels, fronts, barRed: null, barBlue: null };
  if (kind === 'taxi') {
    group.add(part(0.62, 0.22, 0.34, 0xfffbe0, 0, roofTop + 0.12, 0.1));
  } else if (kind === 'police') {
    const bar = roofTop + 0.08;
    group.add(part(1.28, 0.08, 0.34, C.coptrim, 0, bar - 0.1, 0.1));
    for (const side of [-1, 1]) {
      const color = side < 0 ? C.barRed : C.barBlue;
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.16, 0.3), material(color));
      lens.material.emissive = new THREE.Color(color);
      lens.material.emissiveIntensity = side < 0 ? 0.8 : 0.2;
      lens.position.set(side * 0.32, bar, 0.1);
      group.add(lens);
      if (side < 0) kit.barRed = lens;
      else kit.barBlue = lens;
    }
  }

  group.userData.car = kit;
  return group;
}

/** A fresh parked car of `kind` at x,z facing heading. */
export function makeCar(kind, x, z, heading, colorHex) {
  const safeKind = KINDS[kind] ? kind : 'sedan';
  const mesh = buildCarMesh(safeKind, colorHex);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  return {
    kind: safeKind, mesh, x, z, heading, speed: 0, hp: CAR.hp, radius: CAR.radius,
    occupant: null, player: false, smokeT: 0, wheelT: 0, steerVis: 0,
    siren: safeKind === 'police', wrecked: false, color: colorHex, bumpCool: 0,
  };
}

/** Put a car in a scene once; returns it so call sites can chain. */
export function addCarToScene(W, car) {
  if (car?.mesh && W?.scene && car.mesh.parent !== W.scene) W.scene.add(car.mesh);
  return car;
}

/** Dashboard speed. */
export function carSpeedKmh(car) {
  return Math.abs(car?.speed || 0) * 3.6;
}

/** Close enough to the driver's door to get in, and not a burnt-out shell. */
export function canEnterCar(car, x, z) {
  if (!car || car.wrecked) return false;
  return Math.hypot(car.x - x, car.z - z) <= CONFIG.player.interact + (car.radius || CAR.radius) * 0.6;
}

/** Just outside the driver's door on the left flank, pushed clear of any wall. */
export function doorPoint(car, W) {
  const side = car.heading + Math.PI / 2;
  const off = (car.radius || CAR.radius) + 1.0;
  let x = car.x + Math.sin(side) * off;
  let z = car.z + Math.cos(side) * off;
  if (W) ({ x, z } = resolveMove(W, car.x, car.z, CONFIG.player.radius, x - car.x, z - car.z));
  return { x: Math.max(-LIMIT, Math.min(LIMIT, x)), z: Math.max(-LIMIT, Math.min(LIMIT, z)), heading: car.heading };
}

/** Driver and passenger seats in the car's local frame. */
export function seatPoints(car) {
  const f = FRAME[car?.kind] || FRAME.sedan;
  const y = f.wheel + f.tall + 0.42;
  const z = f.cabin * 0.16;
  return [{ x: -0.38, y, z }, { x: 0.38, y, z }];
}

/** Blow it up: blast, occupant thrown clear, blackened shell that can't drive. */
function wreckCar(car, W, G) {
  Object.assign(car, { wrecked: true, hp: 0, speed: 0 });
  if (car.siren) G?.sound?.siren?.(false);
  G?.effects?.spawnExplosion?.({ x: car.x, y: 1.1, z: car.z });
  G?.sound?.explode?.();
  if (car.occupant === 'npc') {
    const out = doorPoint(car, W);
    Object.assign(car, { occupant: 'down', downAt: { x: out.x, z: out.z } });
  }
  const charred = material(0x2a2724);
  car.mesh.traverse((node) => {
    if (node.isMesh) node.material = charred;
  });
  car.mesh.rotation.z = 0.06;
  car.mesh.position.y = -0.08;
  G?.onCarExplode?.(car);
  G?.explodeCar?.(car);
}

/**
 * One fixed driving step. throttle -1..1, steer -1..1, brake boolean. Speed
 * integrates with accel, drag over the kind's top speed and a coast-down; the
 * nose turns by speed; walls cost hp and bounce the car back.
 */
export function updateCarDrive(car, throttle, steer, brake, dt, W, G) {
  if (!car || car.wrecked) return car;
  const spec = KINDS[car.kind] || KINDS.sedan;
  const gas = Math.max(-1, Math.min(1, throttle || 0));
  const wheel = Math.max(-1, Math.min(1, steer || 0));

  if (brake) car.speed = Math.sign(car.speed) * Math.max(0, Math.abs(car.speed) - BRAKE * dt);
  else if (gas > 0) car.speed += spec.accel * (car.speed < 0 ? 1.6 : 1) * gas * dt;
  else if (gas < 0) car.speed += spec.accel * (car.speed > 0 ? 1.8 : 0.55) * gas * dt;
  else car.speed = Math.sign(car.speed) * Math.max(0, Math.abs(car.speed) - COAST * dt);

  car.speed -= car.speed * DRAG * dt;
  const limit = gas < 0 ? spec.max * 0.32 : spec.max;
  if (Math.abs(car.speed) > limit) car.speed = Math.sign(car.speed) * limit;
  if (gas === 0 && Math.abs(car.speed) < 0.05) car.speed = 0;

  // Steering bites with speed and reverses when the car is in reverse.
  car.heading += spec.turn * wheel * Math.min(1, Math.abs(car.speed) / 6) * Math.sign(car.speed || 1) * dt;
  car.heading = (car.heading + Math.PI * 4) % (Math.PI * 2);

  const before = Math.abs(car.speed);
  const moved = resolveMove(W, car.x, car.z, car.radius, Math.sin(car.heading) * car.speed * dt, Math.cos(car.heading) * car.speed * dt);
  car.x = Math.max(-LIMIT, Math.min(LIMIT, moved.x));
  car.z = Math.max(-LIMIT, Math.min(LIMIT, moved.z));

  if (moved.hit && before > HIT_SPEED) {
    car.hp = Math.max(0, car.hp - (before - 7) * 2);
    car.speed = -car.speed * BOUNCE;
    if (car.bumpCool <= 0) {
      car.bumpCool = 0.5;
      G?.sound?.crash?.();
    }
  } else if (moved.hit) car.speed *= 0.5;
  car.bumpCool = Math.max(0, (car.bumpCool || 0) - dt);

  // Wheels spin, front hubs lean into the steering, the shell sits on the road.
  car.wheelT += (car.speed * dt) / 0.34;
  car.steerVis += (wheel - car.steerVis) * Math.min(1, dt * 12);
  const kit = car.mesh.userData.car;
  if (kit) {
    for (const w of kit.wheels) w.rotation.y = car.wheelT;
    for (const hub of kit.fronts) hub.rotation.y = car.steerVis * 0.45;
    if (kit.barRed && car.siren && !car.aiOwned) {
      const red = ((car.flashT = (car.flashT || 0) + dt) % 0.6) < 0.3;
      kit.barRed.material.emissiveIntensity = red ? 1.6 : 0.06;
      kit.barBlue.material.emissiveIntensity = red ? 0.06 : 1.6;
    }
  }
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  car.mesh.rotation.z *= 0.9;

  // A cruiser only wails while someone is actually driving it fast.
  if (car.siren && car.player) G?.sound?.siren?.(car.speed > 1);

  if (car.hp <= SMOKE_AT && car.hp > 0) {
    car.smokeT -= dt;
    if (car.smokeT <= 0) {
      car.smokeT = 0.25;
      G?.effects?.spawnSmokePuff?.({ x: car.x - Math.sin(car.heading) * 1.6, y: 0.7, z: car.z - Math.cos(car.heading) * 1.6 });
    }
  }
  if (car.hp <= 0) wreckCar(car, W, G);
  return car;
}
