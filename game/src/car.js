// Solara Bay — vehicles: the low-poly shells, the arcade driving model, crash
// damage, smoke and the wreck that is left behind. One car object is a small
// plain record; the mesh only ever follows it.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';

const DRAG = 0.6;        // speed lost per second, per full speed
const BRAKE = 22;        // m/s² when the brake is held
const COAST = 2;         // m/s² of natural roll-off with no throttle
const HIT_SPEED = 8;     // below this a wall is a nudge, not damage
const SMOKE_HP = 30;     // engine starts coughing below this
const STEP_UP = 0.09;    // height of the car body above the asphalt

/* ------------------------------------------------------------------ shells */

/**
 * Body, cabin, four wheel cylinders, head and tail lights. Taxis get the roof
 * sign, police get the lightbar — two emissive boxes kept on car.bars so the
 * flashing is a material-colour swap, not a rebuild.
 */
export function buildCarMesh(kind, bodyHex) {
  const g = new THREE.Group();
  g.name = `car_${kind}`;
  const paint = material(bodyHex);

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.62, 4.3), paint);
  body.position.y = 0.62;
  body.name = 'hull';
  g.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.6, 2.1), material(0x2e3a45, { glassy: true }));
  cabin.position.set(0, 1.2, -0.15);
  cabin.name = 'cabin';
  cabin.castShadow = true;
  g.add(cabin);


  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 10);
  for (const [sx, sz] of [[-0.98, 1.35], [0.98, 1.35], [-0.98, -1.35], [0.98, -1.35]]) {
    const w = new THREE.Mesh(wheelGeo, material(0x24262a));
    w.rotation.z = Math.PI / 2;
    w.position.set(sx, 0.42, sz);
    w.castShadow = true;
    g.add(w);
    wheels.push({ mesh: w, front: sz > 0, baseY: 0.42 });
  }

  // Lights: white lenses forward, warm red back, unlit so they glow in daylight.
  for (const sx of [-0.68, 0.68]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.08), material(0xfff4cf, { flat: true }));
    head.position.set(sx, 0.7, 2.16);
    g.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.08), material(0xd6392f, { flat: true }));
    tail.position.set(sx, 0.72, -2.16);
    g.add(tail);
  }

  const bars = [];
  if (kind === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.34), material(0xffdf7a, { flat: true }));
    sign.position.set(0, 1.62, 0.2);
    g.add(sign);
    for (const sx of [-0.98, 0.98]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 2.0), material(0x2b3b55));
      stripe.position.set(sx, 0.62, 0);
      g.add(stripe);
    }
  } else if (kind === 'police') {
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.14, 0.4), material(C.coptrim));
    shell.position.set(0, 1.55, 0);
    g.add(shell);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.3, 0.36), material(C.barRed, { flat: true }));
    red.position.set(-0.42, 1.74, 0);
    g.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.3, 0.36), material(C.barBlue, { flat: true }));
    blue.position.set(0.42, 1.74, 0);
    g.add(blue);
    bars.push(
      { mesh: red, hot: material(C.barRed, { flat: true }), cold: material(0x552020, { flat: true }) },
      { mesh: blue, hot: material(C.barBlue, { flat: true }), cold: material(0x1c2a52, { flat: true }) },
    );
    for (const sx of [-1.06, 1.06]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 1.9), material(C.coptrim));
      panel.position.set(sx, 0.66, -0.1);
      g.add(panel);
    }
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.06), material(C.beacon, { flat: true }));
    shield.position.set(0, 0.72, 1.9);
    g.add(shield);
  }

  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  g.userData.wheels = wheels;
  g.userData.bars = bars;
  return g;
}

/**
 * A car record at (x,z) facing `heading` (radians, 0 = toward -z). Stays put
 * until something drives it.
 */
export function makeCar(kind, x, z, heading, colorHex) {
  const spec = CONFIG.car.kinds[kind] || CONFIG.car.kinds.sedan;
  const hex = colorHex ?? defaultPaint(kind);
  const mesh = buildCarMesh(kind, hex);
  mesh.position.set(x, STEP_UP, z);
  mesh.rotation.y = heading;
  return {
    kind,
    mesh,
    x,
    z,
    heading,
    speed: 0,
    hp: CONFIG.car.hp,
    maxSpeed: spec.max,
    accel: spec.accel,
    turn: spec.turn,
    radius: CONFIG.car.radius,
    occupant: null,
    player: false,
    wrecked: false,
    smokeT: 0,
    flashT: 0,
    siren: false,
    wheelSpin: 0,
    steerVis: 0,
    paint: hex,
    exploded: false,
  };
}

function defaultPaint(kind) {
  if (kind === 'taxi') return C.taxi;
  if (kind === 'police') return C.copbody;
  if (kind === 'sport') return C.sport;
  return C.sedan;
}

/* ------------------------------------------------------------------ driving */

/**
 * Arcade driving. throttle/steer/brake are -1..1 (steer negative = left).
 * Speed builds toward kind.max with drag, coasts down, brakes hard; steering
 * scales with speed so a parked car never spins on the spot. Collisions go
 * through resolveMove at the car radius; a hard wall hit costs hp, bounces the
 * car back and rings the crash sound.
 */
export function updateCarDrive(car, throttle, steer, brake, dt, W, G) {
  if (!car || car.wrecked) return;
  const spec = CONFIG.car.kinds[car.kind] || { max: 22, accel: 9, turn: 1.6 };
  const max = spec.max;

  if (throttle > 0) car.speed += spec.accel * throttle * dt;
  else if (throttle < 0) car.speed += spec.accel * 1.2 * throttle * dt;
  if (brake > 0) car.speed = approach(car.speed, 0, BRAKE * brake * dt);

  if (throttle === 0 && brake === 0) {
    car.speed = approach(car.speed, 0, COAST * dt);
  } else if (car.speed !== 0) {
    car.speed -= car.speed * DRAG * dt;
  }
  if (car.speed > max) car.speed = max;
  if (car.speed < -max * 0.35) car.speed = -max * 0.35;

  // Steering: full authority from walking pace up, never while stationary.
  const grip = Math.min(1, Math.abs(car.speed) / 6);
  const dir = car.speed < 0 ? -1 : 1;
  const yawStep = steer * spec.turn * grip * dir * dt;
  car.heading += yawStep;

  const fx = -Math.sin(car.heading);
  const fz = -Math.cos(car.heading);
  const step = car.speed * dt;
  const moved = resolveMove(W, car.x, car.z, car.radius, fx * step, fz * step);
  const travelled = Math.hypot(moved.x - car.x, moved.z - car.z);
  car.x = moved.x;
  car.z = moved.z;

  if (travelled < Math.abs(step) - 0.02 && Math.abs(car.speed) > 0.4) {
    const impact = Math.abs(car.speed);
    if (impact > HIT_SPEED) {
      car.hp -= (impact - 7) * 2;
      car.speed *= -0.35;
      if (G && G.sound && G.sound.crash) G.sound.crash();
    } else {
      car.speed = 0;
    }
  }

  placeCar(car, dt, yawStep, steer);
  updateCarDamage(car, G, dt);
}

/** Copy the record onto the mesh: body pose, wheel spin, steer angle, bars. */
function placeCar(car, dt, yawStep, steer) {
  const m = car.mesh;
  m.position.set(car.x, STEP_UP, car.z);
  m.rotation.y = car.heading;

  const wheels = m.userData.wheels || [];
  car.wheelSpin += car.speed * dt * 2.4;
  car.steerVis += (steer * 0.45 - car.steerVis) * 0.2;
  for (const w of wheels) {
    w.mesh.rotation.x = car.wheelSpin;
    if (w.front) w.mesh.rotation.y = car.steerVis;
  }


  const bars = m.userData.bars || [];
  if (bars.length) {
    car.flashT += dt;
    const lit = Math.floor(car.flashT * 6) % 2 === 0;
    bars[0].mesh.material = lit ? bars[0].hot : bars[0].cold;
    bars[1].mesh.material = lit ? bars[1].cold : bars[1].hot;
  }
}

/**
 * Damage state: smoke below SMOKE_HP, fire-and-wreck at zero. Explodes once —
 * explosion, occupant thrown out, blackened hull that never moves again.
 */
function updateCarDamage(car, G, dt) {
  if (car.hp <= SMOKE_HP && car.hp > 0) {
    car.smokeT -= dt;
    if (car.smokeT <= 0) {
      car.smokeT = 0.18 + (car.hp / SMOKE_HP) * 0.5;
      if (G && G.effects && G.effects.spawnSmokePuff) {
        G.effects.spawnSmokePuff({ x: car.x, y: 1.0, z: car.z }, 0.9);
      }
      if (G && G.sound && G.sound.engineSputter) G.sound.engineSputter();
    }
  }

  if (car.hp <= 0 && !car.exploded) {
    car.exploded = true;
    car.wrecked = true;
    car.speed = 0;
    blacken(car);
    if (G && G.explodeCar) G.explodeCar(car);
  }
}

/** Char the paint and hide the lightbar: a burnt shell, not a respawn. */
function blacken(car) {
  const charred = material(0x232629);
  const soot = material(0x17191b);
  car.mesh.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name === 'cabin') o.material = soot;
    else if (o.name === 'hull' || o.material === material(car.paint)) o.material = charred;
    else o.material = soot;
  });
  for (const b of car.mesh.userData.bars || []) b.mesh.visible = false;
}

/** Speed in km/h for the HUD dial; always positive. */
export function carSpeedKmph(car) {
  return Math.round(Math.abs(car.speed || 0) * 3.6);
}

/**
 * Where a person sits in this car: driver on the left of the cabin, so the
 * exit point always lands on the road side the door opens onto. `exit` is the
 * spot just outside that door, for main to drop the player on.
 */
export function seatPoints(car) {
  const fx = -Math.sin(car.heading);
  const fz = -Math.cos(car.heading);
  const rx = -Math.cos(car.heading);
  const rz = Math.sin(car.heading);
  return {
    x: car.x - fx * 0.2 + rx * 0.55,
    z: car.z - fz * 0.2 + rz * 0.55,
    // Left door: step out sideways so nobody exits into oncoming traffic.
    exit: { x: car.x + rx * 2.1, z: car.z + rz * 2.1 },
    fx,
    fz,
  };
}

/**
 * Aftermath of a destroyed car: spread the blast to people and nearby cars,
 * throw the driver out if someone was aboard, and let main update the world.
 * The shell itself is already charred by the damage pass.
 */
export function onCarDestroyed(car, G) {
  if (!G) return;
  car.occupant = null;
  car.player = false;
  if (!G.effects || !G.effects.spawnExplosion) return;
  const blast = { x: car.x, y: 1.2, z: car.z };
  G.effects.spawnExplosion(blast);
  if (G.sound && G.sound.explode) G.sound.explode();

  const throwPed = (body) => {
    const p = body.pos || body;
    const d = Math.hypot(p.x - car.x, p.z - car.z);
    if (d > 6) return;
    if (G.damagePed && body.hp !== undefined) G.damagePed(body, 70, G);
  };
  for (const ped of G.peds || []) throwPed(ped);
  for (const cop of (G.PO && G.PO.foot) || []) throwPed(cop);

  for (const other of [...(G.cars || []), ...(G.traffic || [])]) {
    if (other === car || other.wrecked) continue;
    if (Math.hypot(other.x - car.x, other.z - car.z) > 5) continue;
    other.hp -= 25;
  }
  if (G.alarm !== undefined) {
    G.alarm = 1;
    G.alarmX = car.x;
    G.alarmZ = car.z;
  }
}

/**
 * Put a car back on the road after it has been used up: repaint, restore hp,
 * un-wreck and clear the owner. Used when a wreck would block a road forever.
 */

function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}
