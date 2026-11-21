// Solara Bay — cars: the low-poly bodies, the arcade driving model, damage,
// smoke and the blackened wreck an unlucky sedan ends up as.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';

const WHEEL_R = 0.42;
const WHEEL_W = 0.34;
const SMOKE_AT = 30;

function box(w, h, d, paint, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), paint);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function wheel(paint) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 10), paint);
  mesh.rotation.z = Math.PI / 2;
  mesh.castShadow = true;
  return mesh;
}

// Cabin glass is its own mesh so the body colour can swap without touching it.
function cabinGlass(w, h, d, x, y, z) {
  const mesh = box(w, h, d, material(0x2d4a63, { glassy: true }), x, y, z);
  mesh.castShadow = false;
  return mesh;
}

export function buildCarMesh(kind, bodyHex) {
  const group = new THREE.Group();
  const paint = material(bodyHex, { glassy: true });
  const dark = material(0x22262b);

  // Every kind shares the footprint so collisions stay honest; only the
  // silhouette and extras change.
  const long = kind === 'sport' ? 4.3 : 4.6;
  const wide = 1.9;
  const bodyH = kind === 'sport' ? 0.62 : 0.72;

  group.add(box(wide, bodyH, long, paint, 0, 0.66, 0));
  group.add(box(wide + 0.06, 0.16, long * 0.9, material(0x1b1f24), 0, 0.36, 0));

  // Cabin: a narrower roof box set back over the rear wheels.
  const cabinLen = kind === 'sport' ? 1.7 : 2.1;
  const cabinZ = kind === 'sport' ? -0.25 : -0.05;
  group.add(box(wide - 0.18, 0.5, cabinLen, paint, 0, 1.2, cabinZ));
  group.add(cabinGlass(wide - 0.14, 0.36, cabinLen - 0.12, 0, 1.24, cabinZ));

  // Nostril / grille strip and bumpers.
  group.add(box(wide - 0.3, 0.12, 0.1, dark, 0, 0.7, long / 2 + 0.01));
  group.add(box(wide - 0.2, 0.14, 0.14, material(0xb9bec4), 0, 0.44, long / 2));
  group.add(box(wide - 0.2, 0.14, 0.14, material(0xb9bec4), 0, 0.44, -long / 2));

  // Head lamps forward, tail lamps aft, both slightly emissive.
  const headPaint = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
  const tailPaint = new THREE.MeshBasicMaterial({ color: 0xd8362c });
  group.add(box(0.42, 0.16, 0.08, headPaint, -0.62, 0.82, long / 2 + 0.02));
  group.add(box(0.42, 0.16, 0.08, headPaint, 0.62, 0.82, long / 2 + 0.02));
  group.add(box(0.46, 0.14, 0.08, tailPaint, -0.62, 0.84, -long / 2 - 0.02));
  group.add(box(0.46, 0.14, 0.08, tailPaint, 0.62, 0.84, -long / 2 - 0.02));

  // Four wheels, front two in their own pivots so they can steer.
  const rubber = material(0x181a1d);
  const hub = material(0xa7aeb5);
  const wheels = [];
  const steerPivots = [];
  const axleZ = long / 2 - 0.95;
  for (const sz of [axleZ, -axleZ]) {
    const steer = sz > 0;
    const pivot = new THREE.Group();
    pivot.position.set(0, WHEEL_R, sz);
    const left = wheel(rubber);
    left.position.x = -(wide / 2 - 0.06);
    const right = wheel(rubber);
    right.position.x = wide / 2 - 0.06;
    pivot.add(left, right);
    group.add(pivot);
    wheels.push(left, right);
    if (steer) steerPivots.push(pivot);
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, WHEEL_W + 0.04, 8), hub);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(sx * (wide / 2 - 0.06), WHEEL_R, sz);
      group.add(cap);
    }
  }

  const extras = { wheels, steerPivots, bars: null };

  if (kind === 'taxi') {
    // Roof sign: a lit cream box with a dark band, plus side stripe.
    group.add(box(0.9, 0.26, 0.42, material(0xfff3c4, { flat: false }), 0, 1.58, cabinZ));
    group.add(box(0.92, 0.08, 0.44, material(0x2b2b2b), 0, 1.58, cabinZ));
    group.add(box(wide + 0.02, 0.14, long * 0.72, material(0x1f2327), 0, 0.62, 0));
  }

  if (kind === 'police') {
    // Light bar: two emissive blocks the driver toggles every flash tick.
    const redMat = new THREE.MeshBasicMaterial({ color: C.barRed });
    const blueMat = new THREE.MeshBasicMaterial({ color: C.barBlue });
    const barRed = box(0.62, 0.22, 0.36, redMat, -0.34, 1.56, cabinZ);
    const barBlue = box(0.62, 0.22, 0.36, blueMat, 0.34, 1.56, cabinZ);
    group.add(barRed, barBlue);
    // Blue livery stripe and a bull bar.
    group.add(box(wide + 0.04, 0.34, long * 0.6, material(C.coptrim), 0, 0.62, 0));
    group.add(box(wide - 0.2, 0.3, 0.16, material(0x9aa4ad), 0, 0.6, long / 2 + 0.14));
    extras.bars = { red: barRed, blue: barBlue, redMat, blueMat };
  }

  // Panel list so a wreck can blacken the shell without touching the tyres.
  extras.panels = group.children.filter((child) => child && child.isMesh);
  extras.bodyHex = bodyHex;

  group.userData = { kind, extras, wheels, steerPivots };
  return group;
}

export function makeCar(kind, x, z, heading, colorHex) {
  const hex = colorHex !== undefined ? colorHex : defaultColor(kind);
  const mesh = buildCarMesh(kind, hex);
  const kindCfg = CONFIG.car.kinds[kind] || CONFIG.car.kinds.sedan;
  const car = {
    kind,
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
    steer: 0,
    wheelSpin: 0,
    lastCrash: 0,
    extras: mesh.userData.extras,
    max: kindCfg.max,
    accel: kindCfg.accel,
    turn: kindCfg.turn,
    tag: null,
    dead: false,
  };
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading || 0;
  return car;
}

function defaultColor(kind) {
  if (kind === 'police') return C.copbody;
  if (kind === 'taxi') return C.taxi;
  if (kind === 'sport') return C.sport;
  return C.sedan;
}

// Arcade driving: throttle/brake push the speed number, drag bleeds it, the
// heading turns proportionally to how fast the car is actually rolling.
export function updateCarDrive(car, throttle, steer, brake, dt, W, G) {
  if (!car) return;
  if (car.wrecked) {
    car.speed *= 1 - Math.min(1, dt * 3);
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    return;
  }

  const top = car.max || CONFIG.car.kinds.sedan.max;
  const push = car.accel || CONFIG.car.kinds.sedan.accel;
  const grip = car.turn || CONFIG.car.kinds.sedan.turn;

  // Throttle up (slower past 70% of top speed), brake down hard, else coast.
  if (throttle > 0) {
    const headroom = 1 - Math.max(0, car.speed) / top;
    car.speed += push * throttle * Math.max(0.15, headroom) * dt;
  } else if (throttle < 0) {
    car.speed -= push * 0.7 * -throttle * dt;
  }
  if (brake) {
    const stop = 22 * dt;
    car.speed = Math.abs(car.speed) <= stop ? 0 : car.speed - Math.sign(car.speed) * stop;
  }
  if (throttle === 0 && !brake) {
    const idle = 2 * dt;
    car.speed = Math.abs(car.speed) <= idle ? 0 : car.speed - Math.sign(car.speed) * idle;
  }

  // Air/rolling drag: 0.6 per second of the current speed.
  car.speed -= car.speed * 0.6 * dt;
  if (car.speed > top) car.speed = top;
  if (car.speed < -top * 0.35) car.speed = -top * 0.35;

  // Steering fades at a crawl so a parked car does not pirouette.
  const roll = Math.min(1, Math.abs(car.speed) / 6);
  const reverseBias = car.speed < 0 ? -1 : 1;
  const yaw = steer * grip * roll * reverseBias * dt;
  car.heading -= yaw;
  car.steer = steer;

  const dx = Math.sin(car.heading) * car.speed * dt;
  const dz = Math.cos(car.heading) * car.speed * dt;

  const moved = resolveMove(W, car.x, car.z, car.radius, dx, dz);
  car.x = moved.x;
  car.z = moved.z;

  if (moved.hit) {
    const impact = Math.abs(car.speed);
    if (impact > 8) {
      car.hp -= (impact - 7) * 2;
      car.speed = -car.speed * 0.35;
      if (G && G.sound && G.sound.crash) G.sound.crash();
    } else {
      car.speed *= 0.25;
    }
  }

  // Mesh + wheels: steer the front pair, spin the tyres forward.
  for (const pivot of car.steerPivots || (car.extras && car.extras.steerPivots) || []) {
    pivot.rotation.y = steer * 0.45;
  }
  const wheels = (car.extras && car.extras.wheels) || [];
  for (let i = 0; i < wheels.length; i++) {
    // Cylinders were turned on Z; roll them forward on X.
    wheels[i].rotation.x -= car.speed * dt / WHEEL_R;
  }

  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;

  // Police cars keep their siren and their bar cycling whenever they roll.
  if (car.kind === 'police') {
    car.flashT = (car.flashT + dt) % 0.5;
    flashLightBar(car, car.flashT < 0.25);
    if (G && G.sound && G.sound.siren) {
      const howl = car.player || (G.audioOn !== false && Math.abs(car.speed) > 1);
      G.sound.siren(!!howl);
    }
  }

  // Damage: a coughing engine and a rising column of smoke, then fire.
  tickCarDamage(car, dt, G);
}

function flashLightBar(car, redOn) {
  const bars = car.extras && car.extras.bars;
  if (!bars) return;
  bars.redMat.color.setHex(redOn ? C.barRed : 0x521512);
  bars.blueMat.color.setHex(redOn ? 0x182a52 : C.barBlue);
}

function tickCarDamage(car, dt, G) {
  if (car.wrecked) return;
  if (car.hp <= SMOKE_AT) {
    car.smokeT += dt;
    if (car.smokeT > 0.09) {
      car.smokeT = 0;
      if (G && G.effects) {
        const p = { x: car.x + (Math.random() - 0.5) * 1.2, y: 1.3, z: car.z + (Math.random() - 0.5) * 1.2 };
        G.effects.spawnSmokePuff(p);
      }
      if (G && G.sound && G.sound.engine) G.sound.engine(true);
    }
  }
  if (car.hp <= 0) explodeCar(car, G);
}

// One-way trip to a burnt shell: blacken every panel, stop the car dead.
function explodeCar(car, G) {
  car.wrecked = true;
  car.hp = 0;
  car.speed = 0;
  car.dead = true;
  const charred = material(0x212124);
  for (const part of (car.extras && car.extras.panels) || []) {
    if (part.isMesh && part.material && part.material.color && part.geometry && part.geometry.type === 'BoxGeometry') {
      part.material = charred;
    }
  }
  if (car.mesh) {
    car.mesh.rotation.x = 0;
    car.mesh.position.y = 0;
  }
  if (G && G.effects) {
    G.effects.spawnExplosion({ x: car.x, y: 0.9, z: car.z });
  }
  if (G && G.sound && G.sound.explode) G.sound.explode();
  if (G && G.explodeCar) G.explodeCar(car);
  else if (G && G.onCarExplode) G.onCarExplode(car);
}

export function carSpeedKmh(car) {
  return Math.round(Math.abs(car ? car.speed : 0) * 3.6);
}

// Where the two doors are: main uses the left-hand seat for enter/exit.
export function seatPoints(car) {
  const right = car.heading + Math.PI / 2;
  const off = 1.15;
  return {
    x: car.x + Math.sin(right) * off,
    z: car.z + Math.cos(right) * off,
  };
}
