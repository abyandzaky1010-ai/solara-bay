import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { makeCar, updateCarDrive, addCarToScene } from './car.js';
import { resolveMove } from './world.js';

// Wanted level + police AI: decay by sight, cruisers, officers on foot, roadblocks.
const { police: { foot: FT, carChase: CH, roadblock: BL, count: BAND }, wanted: WANTED, world: { half: HALF } } = CONFIG;
const MAX = 5, SEE = 12, LOSE = 170, TAU = 6.2832;
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (G, a, b) => (G && G.rng ? G.rng.range(a, b) : a + Math.random() * (b - a));
/** A crew's or officer's eyes: the car's x/z for cruisers, the vector for officers. */
const eye = (c) => (c.pos ? c.pos : c.car ? { x: c.car.x, z: c.car.z } : { x: c.x, z: c.z });
const turn = (a, t) => { const d = (t - a) % TAU; return d > Math.PI ? d - TAU : d < -Math.PI ? d + TAU : d; };
const mesh = (geo, mat) => new THREE.Mesh(geo, mat);

/** LOS: segment against every building footprint; false when a facade blocks. */
export function clearSight(W, from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  for (const b of W.colliders || []) {
    let n = 0, f = 1, cut = false;
    for (const [o, d, lo, hi] of [[from.x, dx, b.minX, b.maxX], [from.z, dz, b.minZ, b.maxZ]]) {
      if (Math.abs(d) < 1e-6) { cut = cut || o < lo || o > hi; continue; }
      let a = (lo - o) / d, c = (hi - o) / d;
      if (a > c) [a, c] = [c, a];
      if ((n = Math.max(n, a)) > (f = Math.min(f, c))) cut = true;
    }
    if (!cut && n < 0.97 && f > 0.03) return false;
  }
  return true;
}
const sees = (c, W, P) => gap(eye(c), P.pos) < SEE || clearSight(W, eye(c), P.pos);

/** Red and blue emissive plates; the flash swaps which one is lit. */
function lightbar() {
  const plate = (hex, x) => { const m = mesh(new THREE.BoxGeometry(0.42, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: hex })); m.position.x = x; return m; };
  const a = plate(C.barRed, -0.25), b = plate(C.barBlue, 0.25), rig = new THREE.Group();
  rig.add(a, b);
  return { rig, a, b, red: a.material, blue: b.material, off: new THREE.MeshBasicMaterial({ color: 0x5a6068 }) };
}
function attachBar(car) {
  if (car.mesh.userData.car && car.mesh.userData.car.lightbar) return { shared: car.mesh.userData.car.lightbar };
  const bar = lightbar();
  bar.rig.position.set(0, 1.62, 0.1);
  car.mesh.add(bar.rig);
  return bar;
}
function flash(PO, t) {
  const beat = Math.floor(t * 4.5) % 2 === 0, lit = PO.stars > 0;
  for (const bar of PO.cars.map((c) => c.bar)) {
    if (!bar) continue;
    if (bar.shared) bar.shared.material.color.setHex(lit ? (beat ? C.barRed : C.barBlue) : 0x5a6068);
    else { bar.a.material = lit && beat ? bar.red : bar.off; bar.b.material = lit && !beat ? bar.blue : bar.off; }
  }
}

/** Nearest avenue centre, so cruisers join the grid, not the grass. */
function lane(x, z) {
  let best = { x, z }, n = 1e9;
  for (let l = -160; l <= 160; l += 80) {
    if (Math.abs(x - l) < n) { n = Math.abs(x - l); best = { x: l, z: clamp(z, -HALF + 8, HALF - 8) }; }
    if (Math.abs(z - l) < n) { n = Math.abs(z - l); best = { x: clamp(x, -HALF + 8, HALF - 8), z: l }; }
  }
  return best;
}
/** A street point 60-80 m out: where a cruiser merges in toward her. */
function mergePoint(G, px, pz) {
  for (let i = 0; i < 6; i += 1) {
    const a = G.rng.angle(), r = rand(G, CH.spawnMin, CH.spawnMax);
    const s = lane(clamp(px + Math.cos(a) * r, -HALF + 6, HALF - 6), clamp(pz + Math.sin(a) * r, -HALF + 6, HALF - 6));
    if (gap(s, { x: px, z: pz }) >= 50) return s;
  }
  return lane(px + 70, pz);
}

export function initPolice(W, city, rng) {
  return { stars: 0, noSeeT: 0, cars: [], foot: [], roadblock: null, W, city, rng, time: 0, spawnT: 0, blockT: 0, siren: false };
}
/** Raise the level by n stars (cap 5), reset the clock, wake the sirens. */
export function addStars(PO, n, G) {
  n = Math.min(MAX - PO.stars, Math.max(0, Math.floor(n || 0)));
  if (!n) return PO.stars;
  PO.stars += n; PO.noSeeT = PO.spawnT = 0;
  if (!PO.siren) { PO.siren = true; G?.sound?.siren?.(true); }
  return PO.stars;
}
/** Wipe the chase — a finished job pays off the heat. */
export function clearPolice(PO, G) {
  if (!PO) return PO;
  for (const c of (PO.cars || []).slice()) park(PO, c);
  for (const f of (PO.foot || []).slice()) retire(PO, f);
  Object.assign(PO, { stars: 0, noSeeT: 0, siren: false, roadblock: null });
  G?.sound?.siren?.(false);
  return PO;
}

function spawnCruiser(PO, G) {
  const at = mergePoint(G, G.P.pos.x, G.P.pos.z);
  const car = addCarToScene(PO.W, makeCar('police', at.x, at.z, rand(G, 0, TAU), C.copbody));
  Object.assign(car, { speed: 0, occupant: 'npc', police: true });
  PO.cars.push({ car, bar: attachBar(car), dead: false, stuckT: 0, ramCool: 0, dropped: false });
}
function park(PO, crew) {
  const car = crew.car;
  if (car.mesh.parent) car.mesh.parent.remove(car.mesh);
  Object.assign(car, { police: false, siren: false, player: false });
  PO.cars.splice(PO.cars.indexOf(crew), 1);
}
/** Her spot pushed along her heading by the lead seconds. */
function intercept(P, car) {
  const d = car ? Math.min(car.speed * CH.lead, 60) : 0;
  return { x: P.pos.x + (car ? Math.sin(car.heading) * d : 0), z: P.pos.z + (car ? Math.cos(car.heading) * d : 0) };
}
/** Ram: 10 car damage, a speed knock, and a bite out of her. */
function ram(crew, G, dt) {
  const car = crew.car, mine = G.inCar;
  crew.ramCool = Math.max(0, crew.ramCool - dt);
  if (!mine || mine.wrecked || crew.ramCool > 0 || gap(car, mine) > car.radius + mine.radius + 1.4) return;
  crew.ramCool = 0.9;
  mine.hp = Math.max(0, mine.hp - 10);
  mine.speed = mine.speed * 0.55 + Math.sign(car.speed || 1) * 2.2;
  car.speed *= -0.3;
  G.sound?.crash?.(); G.effects?.flashDamage?.();
  G.damagePlayer?.(CH.ram, G);
  if (mine.hp <= 0) G.explodeCar?.(mine);
}
function disembark(PO, G, car) {
  const s = Math.sign(Math.cos(car.heading)) || 1;
  const at = resolveMove(PO.W, car.x, car.z, 0.4, Math.cos(car.heading) * s * 2.2, -Math.sin(car.heading) * s * 2.2);
  spawnFoot(PO, G, at.x, at.z);
}
function drive(PO, crew, G, dt) {
  const car = crew.car, aim = intercept(G.P, G.inCar), away = gap(car, aim);
  const off = turn(car.heading, Math.atan2(aim.x - car.x, aim.z - car.z)), a = Math.abs(off);
  crew.stuckT = Math.abs(car.speed) < 0.8 ? crew.stuckT + dt : 0;
  let gas = a > 2.2 ? -0.8 : a > 1.1 ? 0.45 : 1;
  if (crew.stuckT > 1.6) { gas = -1; if (crew.stuckT > 3) crew.stuckT = 0; }
  updateCarDrive(car, gas, clamp(-off * 2.4, -1, 1), away < 9 && Math.abs(car.speed) > 12 && a < 0.3, dt, PO.W, G);
  car.police = true;
  if (car.wrecked) { crew.dead = true; return; }
  if (away < 30) ram(crew, G, dt);
  if (!crew.dropped && !G.inCar && away < 26) { crew.dropped = true; disembark(PO, G, car); }
}

/** Navy trousers, pale shirt, peaked cap. */
function officer(G) {
  const navy = material(C.coptrim), pup = material(C.skin[G.rng.int(0, C.skin.length - 1)]);
  const box = (w, h, d, mat, y, x) => { const m = mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x || 0, y, 0); m.castShadow = true; return m; };
  const g = new THREE.Group(), legs = [-0.15, 0.15].map((x) => box(0.19, 0.72, 0.22, navy, 0.36, x));
  g.add(box(0.56, 0.66, 0.32, material(0xdfe7ef), 1.13), box(0.5, 0.26, 0.3, navy, 0.78), box(0.26, 0.26, 0.26, pup, 1.62), box(0.3, 0.1, 0.32, navy, 1.77), ...legs);
  return { g, legs };
}
function spawnFoot(PO, G, x, z) {
  const made = officer(G);
  made.g.position.set(x, 0, z);
  PO.W.scene.add(made.g);
  const cool = rand(G, 0.2, FT.fireEvery);
  PO.foot.push({ mesh: made.g, legs: made.legs, pos: new THREE.Vector3(x, 0, z), hp: FT.hp, yaw: 0, walkT: 0, cool, strafe: rand(G, -1, 1) > 0 ? 1 : -1, deadT: 0, strafeT: 0 });
}
function retire(PO, cop) {
  if (cop.mesh.parent) cop.mesh.parent.remove(cop.mesh);
  PO.foot.splice(PO.foot.indexOf(cop), 1);
}
/** Hit an officer; true when this call puts him down. */
export function damageCop(PO, cop, n, G) {
  if (!cop || cop.down) return false;
  if ((cop.hp -= Math.max(0, n || 0)) > 0) return false;
  Object.assign(cop, { down: true, deadT: 40 });
  cop.mesh.rotation.set(Math.PI / 2, cop.yaw, 0);
  cop.mesh.position.y = 0.28;
  if (G) {
    Object.assign(G, { alarm: 1, alarmX: cop.pos.x, alarmZ: cop.pos.z });
    G.sound?.chime?.();
    if (PO.stars < 3) addStars(PO, WANTED.starsFor.killCop, G);
  }
  return true;
}
export function copShootTargets(PO) {
  return PO ? PO.foot.filter((c) => !c.down).concat(PO.cars.filter((c) => !c.dead).map((c) => c.car)).filter((t) => t && !t.wrecked) : [];
}
/** One shot: tracer, muzzle, 8-12 damage that can miss at range. */
function shoot(cop, G, dist) {
  const P = G.P, from = { x: cop.pos.x, y: 1.45, z: cop.pos.z };
  cop.cool = FT.fireEvery;
  G.effects?.spawnMuzzle?.(from);
  G.effects?.spawnTracer?.(from, { x: P.pos.x, y: 1.15, z: P.pos.z });
  G.sound?.shot?.();
  const miss = clamp((dist - 9) / 40, 0, 0.35) + (Math.abs(P.speed || 0) > 5 ? 0.1 : 0);
  if (G.rng.next() > miss) G.damagePlayer?.(Math.round(rand(G, FT.dmgMin, FT.dmgMax)));
  Object.assign(G, { alarm: 1, alarmX: cop.pos.x, alarmZ: cop.pos.z });
}
/** Run at her, hold 8-14 m with a sway, fire on the beat, arrest a wounded woman. */
function step(PO, cop, G, dt) {
  const P = G.P;
  if (cop.down) { if ((cop.deadT -= dt) <= 0 && gap(cop.pos, P.pos) > 30) retire(PO, cop); return; }
  cop.cool = Math.max(0, cop.cool - dt);
  const dist = gap(cop.pos, P.pos), yaw = Math.atan2(P.pos.x - cop.pos.x, P.pos.z - cop.pos.z), seen = sees(cop, PO.W, P);
  const ux = Math.sin(yaw), uz = Math.cos(yaw);
  if ((cop.strafeT -= dt) <= 0) { cop.strafeT = rand(G, 0.9, 2.2); cop.strafe = -cop.strafe; }
  let mx = -uz * cop.strafe * 0.55, mz = ux * cop.strafe * 0.55;
  if (!seen || dist > 14) { mx += ux; mz += uz; } else if (dist < 8) { mx -= ux * 0.7; mz -= uz * 0.7; }
  const mag = Math.hypot(mx, mz) || 1, stride = FT.run * (dist > 14 || !seen ? 1 : 0.45) * dt;
  const at = resolveMove(PO.W, cop.pos.x, cop.pos.z, 0.42, (mx / mag) * stride, (mz / mag) * stride);
  cop.pos.set(at.x, 0, at.z);
  cop.walkT += stride * 1.6;
  cop.yaw += turn(cop.yaw, yaw) * Math.min(1, dt * 8);
  cop.legs[0].rotation.x = Math.sin(cop.walkT * 6) * 0.5;
  cop.legs[1].rotation.x = -cop.legs[0].rotation.x;
  cop.mesh.position.set(at.x, 0, at.z);
  cop.mesh.rotation.set(0, cop.yaw, 0);
  if (seen && dist <= FT.range && cop.cool <= 0 && !P.dead) shoot(cop, G, dist);
  if (!G.inCar && !P.dead && P.hp <= FT.arrestHpBelow && dist <= FT.arrestDist) G.bust?.();
}

/** Two cruisers nose to nose across her path, 60 m ahead, once per window. */
function roadblock(PO, G) {
  const P = G.P, h = G.inCar ? G.inCar.heading : P.yaw || 0;
  const base = lane(P.pos.x + Math.sin(h) * BL.dist, P.pos.z + Math.cos(h) * BL.dist);
  const across = Math.atan2(Math.cos(h), -Math.sin(h)), px = Math.cos(across) * 3.1, pz = -Math.sin(across) * 3.1;
  const crews = [-1, 1].map((s) => {
    const car = addCarToScene(PO.W, makeCar('police', base.x + px * s, base.z + pz * s, across, C.copbody));
    Object.assign(car, { speed: 0, occupant: 'npc', police: true });
    const crew = { car, bar: attachBar(car), dead: false, stuckT: 0, ramCool: 0, dropped: true, parked: true };
    PO.cars.push(crew);
    spawnFoot(PO, G, car.x + Math.sin(across) * 2.4, car.z + Math.cos(across) * 2.4);
    return crew;
  });
  PO.roadblock = { ...base, crews, t: BL.every };
}

/** Lose a star per full window with no officer able to see her. */
function coolOff(PO, G, dt) {
  if (PO.stars <= 0) return;
  if (PO.cars.some((c) => !c.dead && sees(c, PO.W, G.P)) || PO.foot.some((f) => !f.down && sees(f, PO.W, G.P))) { PO.noSeeT = 0; return; }
  const win = WANTED.decay[PO.stars] || 60;
  if ((PO.noSeeT += dt) < win) return;
  PO.noSeeT -= win;
  PO.stars -= 1;
  if (!PO.stars) { PO.noSeeT = 0; G.evaded = (G.evaded || 0) + 1; }
}
/** Keep cruisers and officers at the count the stars demand; recycle stragglers. */
function muster(PO, G, dt) {
  const [wantCars, wantFoot] = BAND[PO.stars] || [0, 0], P = G.P;
  const live = PO.cars.filter((c) => !c.dead);
  for (let i = live.length - 1; i >= wantCars; i -= 1) park(PO, live[i]);
  const stale = PO.cars.filter((c) => !c.dead && !c.parked && gap(c.car, P.pos) > LOSE);
  if (stale.length && PO.cars.length >= wantCars) park(PO, stale.pop());
  if ((PO.spawnT = Math.max(0, PO.spawnT - dt)) <= 0 && PO.cars.filter((c) => !c.dead).length < wantCars) {
    spawnCruiser(PO, G);
    PO.spawnT = 1.1;
  }
  const onFoot = PO.foot.filter((f) => !f.down);
  if (onFoot.length < wantFoot && !G.inCar) {
    const idle = PO.cars.filter((c) => !c.dead && !c.dropped && gap(c.car, P.pos) < 90).sort((a, b) => gap(a.car, P.pos) - gap(b.car, P.pos))[0];
    if (idle) { idle.dropped = true; disembark(PO, G, idle.car); }
  }
  const spare = onFoot.filter((f) => gap(f.pos, P.pos) > 45);
  while (onFoot.length > wantFoot && spare.length) { retire(PO, spare.pop()); onFoot.pop(); }
}

/** Flat read of the law for the HUD. */
export function wantedPoliced(PO) {
  const s = (PO && PO.stars) | 0, cars = PO ? PO.cars.filter((c) => !c.dead).length : 0, foot = PO ? PO.foot.filter((f) => !f.down).length : 0;
  return { stars: s, hot: s > 0, cars, foot, units: cars + foot, siren: Boolean(PO && PO.siren), coolIn: s ? Math.max(0, (WANTED.decay[s] || 60) - PO.noSeeT) : 0 };
}
/** One tick of the law: sirens, decay, strength, driving, officers, roadblocks, bars. */
export function updatePolice(PO, G, dt) {
  if (!PO || !G || !G.P) return;
  PO.time += dt;
  if ((PO.stars > 0) !== PO.siren) { PO.siren = !PO.siren; G.sound?.siren?.(PO.siren); }
  coolOff(PO, G, dt);
  muster(PO, G, dt);
  for (const crew of PO.cars.slice()) { if (crew.dead) park(PO, crew); else if (!crew.parked) drive(PO, crew, G, dt); }
  for (const cop of PO.foot.slice()) step(PO, cop, G, dt);
  PO.blockT = Math.max(0, (PO.blockT || 0) - dt);
  if (PO.stars >= BL.stars && !PO.roadblock && PO.blockT <= 0) roadblock(PO, G);
  const rb = PO.roadblock;
  if (rb) {
    rb.t -= dt;
    if (rb.t <= 0 || gap(G.inCar || G.P.pos, rb) > 210) {
      for (const c of rb.crews) if (PO.cars.includes(c)) park(PO, c);
      PO.roadblock = null;
      PO.blockT = BL.every;
    }
  }
  flash(PO, PO.time);
}
