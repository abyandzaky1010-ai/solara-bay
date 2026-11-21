// Cars: the low-poly bodies you see, the arcade driving model, and the damage ladder
// from clean paint to smoke to a blackened hull. Ownership (who is inside) belongs to
// main; this module only publishes where the doors are.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { resolveMove } from './world.js';

const DRAG = 0.6;            // passive speed loss per second at full tilt
const BRAKE = 22;            // m/s^2 while the brake key is held
const ROLL_DECEL = 2;        // coast-down when nothing is pressed
const REVERSE_MAX = 7;       // metres/second backwards
const HIT_MIN_SPEED = 8;     // below this a bump is free
const HIT_DIVISOR = 7;       // hp loss = (speed - 7) * 2
const HIT_SCALE = 2;
const BOUNCE = -0.35;        // speed multiplier after a real crash
const SMOKE_HP = 30;
const SMOKE_EVERY = 0.18;    // seconds between puffs while dying
const FLASH_RATE = 7;        // lightbar swaps per second
const SIREN_RANGE = 90;      // only ask for audio when the player could hear it

const LENGTH = 4.1;
const GLASSY = { glassy: true };
const FLAT = { flat: true };
const HALF_LEN = LENGTH / 2;
const WHEEL_R = 0.34;

// Scratch vectors, reused so a 60 Hz loop allocates nothing.
const FWD = new THREE.Vector3();
const BLAST = new THREE.Vector3();

/** A coloured box, axis-aligned inside the car group. */
function plate(w, h, d, hex, x, y, z, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex, opts));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** One wheel: tyre cylinder laid on its side, hub on the outside. Front pair steers. */
function wheel(side, front) {
  const pivot = new THREE.Group();
  pivot.position.set(side * 0.86, WHEEL_R, front ? -1.26 : 1.3);
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.28, 10), material(0x1c1f24));
  tyre.rotation.z = Math.PI / 2;
  tyre.castShadow = true;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 8), material(0xc3c9d1, GLASSY));
  hub.rotation.z = Math.PI / 2;
  pivot.add(tyre, hub);
  pivot.userData = { tyre, front: !!front };
  return pivot;
}

/**
 * Body + cabin + four wheels + lights, one kind at a time. Returns the group with
 * userData.legs (the wheel pivots) and userData.bars (the police lightbar pair) so
 * the driving code can animate them without searching the tree every frame.
 */
export function buildCarMesh(kind, bodyHex) {
  const g = new THREE.Group();
  g.name = `car-${kind}`;

  const paint = bodyHex != null ? bodyHex : defaultPaint(kind);
  const low = kind === 'sport';
  const tall = kind === 'taxi';

  // Chassis: low and wide for the sport, boxier for taxi and police.
  const bodyH = low ? 0.52 : 0.62;
  const bodyY = WHEEL_R + bodyH / 2 - 0.04;
  g.add(plate(1.86, bodyH, LENGTH, paint, 0, bodyY, 0, GLASSY));

  // Nose and tail caps give the silhouette a front and a back at distance.
  g.add(plate(1.9, 0.22, 0.28, C.coptrim, 0, bodyY - 0.12, -HALF_LEN + 0.06));
  g.add(plate(1.9, 0.22, 0.28, C.coptrim, 0, bodyY - 0.12, HALF_LEN - 0.06));

  // Cabin: glass all round, sitting on the beltline.
  const cabinH = tall ? 0.72 : 0.6;
  const cabin = plate(1.62, cabinH, low ? 1.9 : 2.1, paint, 0, bodyY + bodyH / 2 + cabinH / 2 - 0.02, 0.12, GLASSY);
  g.add(cabin);

  // Windscreen and rear glass as slightly proud dark panels.
  const glassHex = 0x22323d;
  g.add(plate(1.4, cabinH * 0.72, 0.08, glassHex, 0, cabin.position.y, cabin.position.z - (low ? 0.9 : 0.98), GLASSY));
  g.add(plate(1.36, cabinH * 0.66, 0.08, glassHex, 0, cabin.position.y, cabin.position.z + (low ? 0.9 : 0.98), GLASSY));

  // Headlights ahead (-z), tail lights behind (+z): unlit, so they read at noon.
  for (const side of [-1, 1]) {
    g.add(plate(0.44, 0.16, 0.1, 0xfff6d8, side * 0.62, bodyY + 0.1, -HALF_LEN - 0.01, FLAT));
    g.add(plate(0.4, 0.14, 0.1, 0xff5a4a, side * 0.64, bodyY + 0.12, HALF_LEN + 0.01, FLAT));
  }

  const legs = [];
  for (const side of [-1, 1]) {
    for (const front of [true, false]) {
      const w = wheel(side, front);
      g.add(w);
      legs.push(w);
    }
  }

  g.userData.legs = legs;
  g.userData.bars = null;

  if (kind === 'taxi') {
    // Roof sign: a bright stub over the cabin, lit so it pops against glass towers.
    g.add(plate(0.86, 0.22, 0.34, 0xfff1b8, 0, cabin.position.y + cabinH / 2 + 0.12, 0.2, FLAT));
    g.add(plate(0.9, 0.06, 0.38, C.taxi, 0, cabin.position.y + cabinH / 2 - 0.01, 0.2, GLASSY));
    // Chequer band down the flanks, the thing that says cab from 80 m.
    for (const side of [-1, 1]) {
      g.add(plate(0.04, 0.12, 2.4, 0x1f2328, side * 0.94, bodyY - 0.04, 0, FLAT));
    }
  }

  if (kind === 'police') {
    // Two-tone livery: white shell with dark doors and a marked hood.
    for (const side of [-1, 1]) {
      g.add(plate(0.04, 0.3, 1.5, C.coptrim, side * 0.94, bodyY, 0, FLAT));
      g.add(plate(0.04, 0.1, 1.4, C.barBlue, side * 0.95, bodyY - 0.24, 0, FLAT));
    }
    g.add(plate(1.5, 0.1, 0.7, C.coptrim, 0, bodyY + bodyH / 2, -1.4, FLAT));

    // Lightbar: two emissive boxes we toggle from updateCarDrive.
    const barY = cabin.position.y + cabinH / 2 + 0.12;
    const bar = new THREE.Group();
    bar.position.set(0, barY, cabin.position.z);
    const box = (hex, x) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.26), new THREE.MeshBasicMaterial({ color: hex }));
      m.position.x = x;
      return m;
    };
    bar.add(box(C.barRed, -0.36), box(C.barBlue, 0.36));
    g.add(bar);
    g.userData.bars = { red: bar.children[0], blue: bar.children[1], lit: 0 };
  }

  return g;
}

function defaultPaint(kind) {
  if (kind === 'taxi') return C.taxi;
  if (kind === 'police') return C.copbody;
  if (kind === 'sport') return C.sport;
  return C.sedan;
}

/** A car in the world: data first, mesh bolted on with its own yaw group. */
export function makeCar(kind, x, z, heading, colorHex, W) {
  const spec = CONFIG.car.kinds[kind] || CONFIG.car.kinds.sedan;
  const mesh = buildCarMesh(kind, colorHex);
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  if (W && W.scene) W.scene.add(mesh);

  const car = {
    kind,
    mesh,
    spec,
    x,
    z,
    heading: heading || 0,
    speed: 0,
    steerVis: 0,
    hp: CONFIG.car.hp,
    radius: CONFIG.car.radius,
    occupant: null,
    player: false,
    wrecked: false,
    smoking: false,
    smokeT: 0,
    flashT: 0,
    sirenOn: false,
    exploded: false,
    spawn: { x, z, heading: heading || 0 },
    label: null,
  };
  darkenLightbar(car);
  return car;
}

/** Push the model to match the data after any direct move (spawns, recovery). */
export function syncCarMesh(car) {
  if (!car.mesh) return;
  car.mesh.position.set(car.x, car.wrecked ? 0.1 : 0, car.z);
  car.mesh.rotation.y = car.heading;
}

/** Start the lightbar from a dark state; flashLightbar lights it from there. */
function darkenLightbar(car) {
  car.flashT = 0;
  const bars = car.mesh && car.mesh.userData && car.mesh.userData.bars;
  if (!bars) return;
  bars.red.material.color.setHex(car.sirenOn ? C.barRed : 0x552022);
  bars.blue.material.color.setHex(0x14204a);
}

/**
 * One step of arcade driving. throttle/steer in [-1, 1], brake 0 or 1. The car
 * slides along walls through resolveMove rather than sticking to them.
 */
export function updateCarDrive(car, throttle, steer, brake, dt, W, G) {
  if (!car || car.wrecked) {
    if (car) { car.speed = 0; spinWheels(car, dt); }
    return car;
  }
  const spec = car.spec || CONFIG.car.kinds[car.kind] || CONFIG.car.kinds.sedan;

  // --- longitudinal ---
  if (brake) {
    const drop = BRAKE * dt;
    if (Math.abs(car.speed) <= drop) car.speed = 0;
    else car.speed -= Math.sign(car.speed) * drop;
  } else if (throttle > 0) {
    if (car.speed < 0) {
      car.speed = Math.min(0, car.speed + BRAKE * dt);   // stop a reverse before going forward
    } else if (car.speed < spec.max) {
      car.speed = Math.min(spec.max, car.speed + spec.accel * throttle * dt);
    }
  } else if (throttle < 0) {
    if (car.speed > 0) {
      car.speed = Math.max(0, car.speed - BRAKE * dt);
    } else if (car.speed > -REVERSE_MAX) {
      car.speed = Math.max(-REVERSE_MAX, car.speed + spec.accel * 0.5 * throttle * dt);
    }
  } else {
    // Coast down gently.
    const drop = ROLL_DECEL * dt;
    if (Math.abs(car.speed) <= drop) car.speed = 0;
    else car.speed -= Math.sign(car.speed) * drop;
  }

  // Drag, proportional to speed, always fights motion.
  car.speed -= car.speed * DRAG * dt;

  // --- steering: needs roll speed, and reverses its sense when backing up ---
  const grip = Math.min(1, Math.abs(car.speed) / 6);
  const dir = car.speed < 0 ? -1 : 1;
  const turn = spec.turn * steer * grip * dir * dt;
  car.heading += turn;
  car.steerVis += ((steer || 0) * 0.5 - car.steerVis) * Math.min(1, dt * 10);

  // --- integrate along the heading (-z is the nose) ---
  const dx = -Math.sin(car.heading) * car.speed * dt;
  const dz = -Math.cos(car.heading) * car.speed * dt;

  if (W && W.colliders) {
    const before = car.speed;
    const moved = resolveMove(W, car.x, car.z, car.radius, dx, dz);
    const blocked = moved.hit && Math.abs(before) > 1;
    car.x = moved.x;
    car.z = moved.z;

    if (blocked) {
      if (Math.abs(before) > HIT_MIN_SPEED) {
        const loss = (Math.abs(before) - HIT_DIVISOR) * HIT_SCALE;
        car.hp -= loss;
        car.speed = before * BOUNCE;
        if (G && G.sound && G.sound.crash) G.sound.crash(Math.min(1, Math.abs(before) / spec.max));
        if (G && (G.effects && G.effects.spark)) G.effects.spark({ x: car.x, y: 0.9, z: car.z });
      } else {
        car.speed = 0;
      }
    }
  } else {
    car.x += dx;
    car.z += dz;
  }

  const lim = (CONFIG.world && CONFIG.world.half ? CONFIG.world.half : 200) - car.radius;
  car.x = Math.max(-lim, Math.min(lim, car.x));
  car.z = Math.max(-lim, Math.min(lim, car.z));

  syncCarMesh(car);
  spinWheels(car, dt);
  flashLightbar(car, dt, G);
  updateCarDamage(car, dt, G);
  return car;
}

/** Rotate the tyres by distance travelled; steer the front pair a touch. */
function spinWheels(car, dt) {
  const legs = car.mesh && car.mesh.userData && car.mesh.userData.legs;
  if (!legs) return;
  const roll = (car.speed * dt) / WHEEL_R;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (leg.userData.front) leg.rotation.y = car.steerVis;
    const tyre = leg.userData.tyre;
    if (tyre) tyre.rotation.x += roll;
  }
}

/** Alternating red/blue swap while the siren is live. */
function flashLightbar(car, dt, G) {
  const bars = car.mesh && car.mesh.userData && car.mesh.userData.bars;
  if (!bars) return;
  car.flashT += dt;
  const on = car.sirenOn && !car.wrecked;
  const phase = Math.floor(car.flashT * FLASH_RATE) % 2;
  const want = on ? (phase === 0 ? 'red' : 'blue') : 'off';

  if (on && G && G.sound && G.sound.siren) {
    // Ask for audio at most once per second; the sfx layer debounces internally.
    car.sirenT = (car.sirenT || 0) + dt;
    if (car.sirenT > 1) {
      car.sirenT = 0;
      const near = G.P ? Math.hypot(car.x - G.P.pos.x, car.z - G.P.pos.z) < SIREN_RANGE : true;
      G.sound.siren(near);
    }
  }

  if (bars.lit === want && want !== 'off') return;
  if (want === 'off') {
    bars.red.material.color.setHex(0x552022);
    bars.blue.material.color.setHex(0x14204a);
    bars.lit = 'off';
    return;
  }
  bars.red.material.color.setHex(want === 'red' ? C.barRed : 0x552022);
  bars.blue.material.color.setHex(want === 'blue' ? C.barBlue : 0x14204a);
  bars.lit = want;
}

/** Smoke past 30 hp, then one explosion at zero and a hull that stays put. */
function updateCarDamage(car, dt, G) {
  if (car.wrecked) {
    car.smokeT = Math.max(0, car.smokeT - dt);
    return;
  }

  if (car.hp <= SMOKE_HP && car.hp > 0) {
    car.smoking = true;
    car.smokeT += dt;
    if (car.smokeT >= SMOKE_EVERY) {
      car.smokeT = 0;
      const fx = G && (G.effects || (G.W && G.W.fx));
      if (fx && fx.smoke) {
        FWD.set(Math.sin(car.heading) * 1.4, 0, Math.cos(car.heading) * 1.4);
        fx.smoke({ x: car.x + FWD.x, y: 1.1, z: car.z + FWD.z });
      }
    }
  } else if (car.hp <= 0) {
    blowUp(car, G);
  }
}

function blowUp(car, G) {
  car.wrecked = true;
  car.speed = 0;
  car.hp = 0;
  car.smoking = false;
  car.sirenOn = false;
  const fx = G && (G.effects || (G.W && G.W.fx));
  if (fx && fx.explosion) fx.explosion({ x: car.x, y: 1.1, z: car.z });

  // Blackened hull: dull the paint, drop the ride a little onto its rims.
  if (car.mesh) {
    car.mesh.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if (o.material.color) o.material.color.setHex(0x2a2622);
      o.material.transparent = false;
      o.castShadow = false;
    });
    car.mesh.position.y = 0.12;
    car.mesh.rotation.z = 0.06;
  }
  darkenLightbar(car);

  // Shrapnel damage to everything close, then the occupant's problem.
  const R = 7;
  const dmgFar = 45;
  const players = G && G.P && !G.inCar ? [G.P] : [];
  for (let i = 0; i < players.length; i++) {
    const P = players[i];
    const d = Math.hypot(P.pos.x - car.x, P.pos.z - car.z);
    if (d < R && G.damagePlayer) G.damagePlayer(Math.round(dmgFar * (1 - d / R)));
  }
  const neighbours = ((G && G.cars) || []).concat((G && G.traffic) || []);
  for (let i = 0; i < neighbours.length; i++) {
    const other = neighbours[i];
    if (!other || other === car || other.wrecked) continue;
    const d = Math.hypot(other.x - car.x, other.z - car.z);
    if (d >= R) continue;
    other.hp -= Math.round(dmgFar * (1 - d / R));
    if (other.hp <= 0 && !other.wrecked) overturn(other, G);
  }
  const peds = (G && G.peds) || [];
  for (let i = 0; i < peds.length; i++) {
    const ped = peds[i];
    if (!ped) continue;
    const d = Math.hypot(ped.pos.x - car.x, ped.pos.z - car.z);
    if (d < R && G.damagePed) G.damagePed(ped, Math.round(dmgFar * (1 - d / R)));
  }

  if (G && G.onCarExplode) G.onCarExplode(car);
  if (G && G.sound && G.sound.explode) G.sound.explode();
  BLAST.set(car.x, 1, car.z);
}

/** Second-hand explosions cascade without re-entering blowUp's radius loop. */
function overturn(car, G) {
  car.wrecked = true;
  car.hp = 0;
  car.speed = 0;
  if (car.mesh) car.mesh.position.y = 0.12;
}

export function carSpeedKmh(car) {
  if (!car) return 0;
  return Math.round(Math.abs(car.speed) * 3.6);
}

/** Door handles: where a person stands to get in, just left of the body. */
export function seatPoints(car) {
  const side = 2.0;
  return {
    x: car.x + Math.cos(car.heading) * side,
    z: car.z - Math.sin(car.heading) * side,
  };
}
