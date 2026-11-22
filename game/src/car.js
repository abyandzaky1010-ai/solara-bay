// Solara Bay — cars: the shells you see and the arcade model that moves them.
// Four kinds share one chassis builder; a wreck goes black, smokes and stays put.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';

const KINDS = CONFIG.car.kinds;
const CAR_HP = CONFIG.car.hp;

// Chassis figures: length, width, body height, cabin height, wheel radius.
const SHAPE = {
  sport: { len: 4.5, width: 1.92, body: 0.62, wheel: 0.36, cabin: 0.5 },
  sedan: { len: 4.6, width: 1.88, body: 0.74, wheel: 0.38, cabin: 0.62 },
  taxi: { len: 4.6, width: 1.88, body: 0.74, wheel: 0.38, cabin: 0.62 },
  police: { len: 4.7, width: 1.96, body: 0.78, wheel: 0.4, cabin: 0.62 },
};
const LIVERY = { sport: C.sport, sedan: C.sedan, taxi: C.taxi, police: C.copbody };

const DRAG = 0.6;
const BRAKE_DECEL = 22;
const NATURAL_DECEL = 2;
const SMOKE_BELOW = 30;
const HARD_HIT = 8;

// A colour we may later blacken; userData.paint keeps the factory colour for repairs.
function shell(hex, shiny) {
  const mat = new THREE.MeshLambertMaterial({ color: hex, emissive: hex, emissiveIntensity: shiny ? 0.06 : 0.02 });
  mat.userData = { paint: hex };
  return mat;
}

function part(geo, mat, x, y, z, parent) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

// Four cylinders on pivots: front pair steers, all four roll with distance.
function wheelSet(shape, group) {
  const geo = new THREE.CylinderGeometry(shape.wheel, shape.wheel, 0.3, 12);
  const rubber = material(0x23262b);
  const hub = material(0xb9c2cc);
  const wheels = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (shape.width / 2 - 0.06), shape.wheel, sz * (shape.len / 2 - 1));
      pivot.userData = { front: sz > 0 };
      part(geo, rubber, 0, 0, 0, pivot);
      part(new THREE.BoxGeometry(0.06, 0.22, 0.22), hub, sx * 0.13, 0, 0, pivot);
      group.add(pivot);
      wheels.push(pivot);
    }
  }
  return wheels;
}

/** The shell: body, cabin, four wheels, lit lamps, plus the taxi sign or police bar. */
export function buildCarMesh(kind, bodyHex) {
  const shape = SHAPE[kind] || SHAPE.sedan;
  const paint = bodyHex ?? LIVERY[kind] ?? C.sedan;
  const group = new THREE.Group();
  const bodyMat = shell(paint, kind === 'sport' || kind === 'police');
  const { width: w, body: bh, wheel: wr, len, cabin: ch } = shape;

  part(new THREE.BoxGeometry(w, bh, len), bodyMat, 0, wr + bh / 2 - 0.05, 0, group);
  part(new THREE.BoxGeometry(w + 0.02, 0.16, len * 0.96), shell(kind === 'police' ? C.coptrim : 0x2c3138), 0, wr * 0.72, 0, group);

  const roofY = wr + bh + ch - 0.02;
  part(new THREE.BoxGeometry(w * 0.84, ch, len * 0.46), shell(0x33414d, true), 0, wr + bh + ch / 2 - 0.02, -len * 0.06, group);
  part(new THREE.BoxGeometry(w * 0.8, 0.08, len * 0.4), bodyMat, 0, roofY, -len * 0.06, group);

  const headMat = new THREE.MeshLambertMaterial({ color: C.sun, emissive: C.sun, emissiveIntensity: 0.9 });
  const tailMat = new THREE.MeshLambertMaterial({ color: C.barRed, emissive: C.barRed, emissiveIntensity: 0.7 });
  for (const sx of [-1, 1]) {
    part(new THREE.BoxGeometry(0.4, 0.17, 0.1), headMat, sx * (w / 2 - 0.38), wr + bh * 0.6, len / 2 - 0.02, group);
    part(new THREE.BoxGeometry(0.36, 0.15, 0.1), tailMat, sx * (w / 2 - 0.36), wr + bh * 0.65, -len / 2 + 0.02, group);
  }

  const parts = { wheels: null, barRed: null, barBlue: null, sign: null };
  if (kind === 'taxi') {
    const lit = new THREE.MeshLambertMaterial({ color: C.beacon, emissive: C.beacon, emissiveIntensity: 1 });
    parts.sign = part(new THREE.BoxGeometry(0.7, 0.22, 0.32), lit, 0, roofY + 0.16, 0.1, group);
  }
  if (kind === 'police') {
    for (const sx of [-1, 1]) part(new THREE.BoxGeometry(0.03, 0.22, len * 0.82), shell(C.coptrim), sx * (w / 2 + 0.005), wr + bh * 0.55, 0, group);
    const red = new THREE.MeshLambertMaterial({ color: C.barRed, emissive: C.barRed, emissiveIntensity: 1 });
    const blue = new THREE.MeshLambertMaterial({ color: C.barBlue, emissive: C.barBlue, emissiveIntensity: 1 });
    parts.barRed = part(new THREE.BoxGeometry(0.44, 0.17, 0.24), red, -0.28, roofY + 0.14, -len * 0.06, group);
    parts.barBlue = part(new THREE.BoxGeometry(0.44, 0.17, 0.24), blue, 0.28, roofY + 0.14, -len * 0.06, group);
  }

  parts.wheels = wheelSet(shape, group);
  // Read by police.js as userData.barRed/barBlue, and by this module as userData.car.
  group.userData.car = parts;
  Object.assign(group.userData, parts);
  return group;
}

/** A car record plus its mesh, ready to drive or to park. */
export function makeCar(kind, x, z, heading, colorHex) {
  const key = KINDS[kind] ? kind : 'sedan';
  const car = {
    kind: key,
    mesh: buildCarMesh(key, colorHex),
    x,
    z,
    heading: heading || 0,
    speed: 0,
    hp: CAR_HP,
    radius: CONFIG.car.radius,
    occupant: null,
    player: false,
    wrecked: false,
    smokeT: 0,
    flashT: 0,
    wheelT: 0,
    steerVis: 0,
    bumpT: 0,
  };
  car.mesh.position.set(x, 0, z);
  car.mesh.rotation.y = car.heading;
  if (key === 'police') flashLightbar(car, 0);
  return car;
}

// ------------------------------------------------------------------- lights + paint

/** Siren strobe. */
function flashLightbar(car, dt) {
  const { barRed, barBlue } = car.mesh.userData.car || {};
  if (!barRed) return;
  car.flashT = (car.flashT + dt) % 0.6;
  const left = car.flashT < 0.3;
  barRed.material.emissiveIntensity = left ? 1.5 : 0.08;
  barBlue.material.emissiveIntensity = left ? 0.08 : 1.5;
}

/** Steady low glow once a cruiser stops caring. */
export function silenceLightbar(car) {
  const { barRed, barBlue } = car.mesh.userData.car || {};
  if (!barRed) return;
  barRed.material.emissiveIntensity = 0.2;
  barBlue.material.emissiveIntensity = 0.2;
}

// Recolour every panel this car owns; null restores the factory paint.
function repaintCar(car, hex) {
  car.mesh.traverse((child) => {
    const mat = child.isMesh && child.material;
    if (!mat || !mat.userData || mat.userData.paint === undefined) return;
    mat.color?.setHex(hex ?? mat.userData.paint);
    mat.emissive?.setHex(hex ?? mat.userData.paint);
  });
}

// ------------------------------------------------------------------- driving

function turnWheels(car, dt) {
  car.wheelT += car.speed * dt * 1.6;
  for (const wheel of car.mesh.userData.car.wheels) {
    wheel.rotation.x = car.wheelT;
    if (wheel.userData.front) wheel.rotation.y = car.steerVis * 0.5;
  }
}

/** Drive one frame: throttle, steer and brake in 0..1. Impact over 8 m/s costs hp. */
export function updateCarDrive(car, throttle, steer, brake, dt, W, G) {
  const spec = KINDS[car.kind] || KINDS.sedan;
  const push = car.wrecked ? 0 : Math.max(0, Math.min(1, throttle));

  if (car.wrecked) {
    car.speed *= Math.max(0, 1 - dt * 6);
  } else if (push > 0) {
    car.speed = Math.min(spec.max, car.speed + spec.accel * push * dt);
  } else if (brake > 0) {
    car.speed = Math.max(-spec.max * 0.35, car.speed - BRAKE_DECEL * brake * dt);
  } else {
    // Coasting: drag plus a small constant roll-off, never spinning the sign.
    const bleed = DRAG * Math.abs(car.speed) * dt + NATURAL_DECEL * dt;
    car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), bleed);
  }
  if (car.bumpT > 0) car.bumpT = Math.max(0, car.bumpT - dt);
  if (!car.wrecked) {
    // Steering authority grows with speed.
    const grip = Math.min(1, Math.abs(car.speed) / 5) * Math.sign(car.speed || 1);
    car.heading += steer * spec.turn * grip * dt * (Math.abs(car.speed) / spec.max + 0.25);
  }
  car.steerVis += ((steer || 0) - car.steerVis) * Math.min(1, dt * 8);

  const impact = Math.abs(car.speed);
  if (W && car.speed) {
    const moved = resolveMove(W, car.x, car.z, car.radius, Math.sin(car.heading) * car.speed * dt, Math.cos(car.heading) * car.speed * dt);
    car.x = moved.x;
    car.z = moved.z;
    if (moved.hit) {
      if (impact > HARD_HIT && !car.wrecked) {
        car.hp -= (impact - 7) * 2;
        car.speed *= -0.35;
        car.bumpT = 0.35;
        G?.sound?.crash?.();
        G?.effects?.spawnSmokePuff?.({ x: car.x, y: 1, z: car.z });
      } else {
        car.speed *= impact > 1 ? 0.25 : 0;
      }
    }
  }
  const limit = (W && W.half) || CONFIG.world.half;
  car.x = Math.max(-limit, Math.min(limit, car.x));
  car.z = Math.max(-limit, Math.min(limit, car.z));

  // Smoke first, then fire and gone.
  if (!car.wrecked && car.hp <= SMOKE_BELOW) {
    car.smokeT -= dt;
    if (car.smokeT <= 0) {
      car.smokeT = car.hp <= 12 ? 0.12 : 0.3;
      G?.effects?.spawnSmokePuff?.({ x: car.x, y: 1.1, z: car.z });
    }
    if (car.hp <= 0) wreckTheCar(car, G);
  }
  if (car.kind === 'police' && !car.wrecked) flashLightbar(car, dt);

  turnWheels(car, dt);
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
}

// The hull stays where it died, blackened, for good.
function wreckTheCar(car, G) {
  car.wrecked = true;
  car.hp = 0;
  car.speed = 0;
  repaintCar(car, 0x1d1b19);
  if (car.kind === 'police') silenceLightbar(car);
  if (car.occupant === 'npc') car.occupant = null;
  if (G?.explodeCar) G.explodeCar(car);
  else G?.effects?.spawnExplosion?.({ x: car.x, y: 1, z: car.z });
}

/** Bring a wreck back to life (respawns and mission retries). */
export function repairCar(car) {
  Object.assign(car, { hp: CAR_HP, wrecked: false, speed: 0 });
  repaintCar(car, null);
  return car;
}

// ------------------------------------------------------------------- read-outs

/** Dashboard km/h. */
export function carSpeedKmph(car) {
  return Math.round(Math.abs(car.speed) * 3.6);
}

/** Where a person stands beside a car. */
export function seatPoints(car) {
  const out = car.radius + 0.3;
  return {
    x: car.x + Math.cos(car.heading) * out - Math.sin(car.heading) * 0.4,
    z: car.z - Math.sin(car.heading) * out - Math.cos(car.heading) * 0.4,
    heading: car.heading,
  };
}

/** The exit spot — the far flank if the near one is inside a wall. */
export function doorPoint(car, W) {
  const spot = seatPoints(car);
  const blocked = W?.colliders.some(
    (b) => spot.x + 0.5 > b.minX && spot.x - 0.5 < b.maxX && spot.z + 0.5 > b.minZ && spot.z - 0.5 < b.maxZ,
  );
  return blocked ? { x: car.x * 2 - spot.x, z: car.z * 2 - spot.z, heading: car.heading } : spot;
}

/** The E-key test. */
export function canEnterCar(car, px, pz) {
  return !!car && !car.player && !car.wrecked && Math.hypot(px - car.x, pz - car.z) <= 3.2;
}

/** Put a car in the scene (main owns the list). */
export function addCarToScene(W, car) {
  if (W && car.mesh.parent !== W.scene) W.scene.add(car.mesh);
  return car;
}

/** Clamp a car dead still (rammed, or the driver arrested). */
export function stallCar(car) {
  car.speed = 0;
  return car;
}

/** Mark a parked car occupied, so taking it is a carjacking. */
export function seatNpcDriver(car) {
  car.occupant = 'npc';
  return car;
}
