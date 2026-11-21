// Wanted level (1-5 stars) and the response: police cars that spawn, chase and ram, foot cops that
// run in and arrest, flashing light bars, star decay when the player lays low, and BUSTED.
import { CFG } from './config.js';
import { PAL } from './palette.js';
import { W, dist, collideCircle, clampWorld } from './world.js';
import { makeCar, explodeCar } from './car.js';
import { makeHumanoid } from './render.js';
import { sfx } from './sfx.js';

export function addWanted(n) {
  W.wanted = Math.max(0, Math.min(5, W.wanted + n));
  W.lastCrime = W.time;
}

function spawnPoliceCar() {
  const p = W.player.inCar ? W.player.inCar.pos : W.player.pos;
  let at = CFG.roadAt[0];
  for (const r of CFG.roadAt) if (Math.abs(r - p.x) < Math.abs(at - p.x)) at = r;
  const z = Math.max(-160, Math.min(160, p.z + (p.z < 0 ? 85 : -85)));
  const c = makeCar(PAL.police, 'police', at + 3.6, z, 0);
  c.speed = 12;
  return c;
}

function spawnCop() {
  const near = W.cars.find((c) => c.kind === 'police' && !c.dead);
  const x = near ? near.pos.x + 3 : W.spot.spawn.x + 30;
  const z = near ? near.pos.z + 3 : W.spot.spawn.z;
  const mesh = makeHumanoid(0x27324e, 0x1c2438);
  const cap = mesh.children[1];
  cap.scale.set(1.1, 0.5, 1.1);
  cap.position.y = 1.86;
  const cop = { pos: { x, y: 0, z }, hp: CFG.copHp, dead: false, deadT: 0, mesh };
  mesh.userData.kind = 'cop';
  mesh.userData.ref = cop;
  mesh.position.set(x, 0, z);
  W.scene.add(mesh);
  W.cops.push(cop);
  return cop;
}

export function updatePolice(dt) {
  // stars decay when the player stays out of trouble
  if (W.wanted > 0 && W.time - W.lastCrime > CFG.decayEvery) {
    W.decayT += dt;
    if (W.decayT >= CFG.decayEvery) { W.decayT = 0; W.wanted--; }
  } else W.decayT = 0;

  const wantCars = W.wanted >= 1 ? Math.min(W.wanted, 4) : 0;
  const wantCops = W.wanted >= 2 ? Math.min(W.wanted - 1, 3) : 0;

  let pcars = W.cars.filter((c) => c.kind === 'police' && !c.dead);
  while (pcars.length < wantCars) { spawnPoliceCar(); pcars = W.cars.filter((c) => c.kind === 'police' && !c.dead); }
  if (pcars.length > wantCars) {
    for (const c of pcars.slice(wantCars)) {
      W.scene.remove(c.mesh);
      W.cars.splice(W.cars.indexOf(c), 1);
    }
  }
  let cops = W.cops.filter((c) => !c.dead);
  while (cops.length < wantCops) { spawnCop(); cops = W.cops.filter((c) => !c.dead); }
  if (cops.length > wantCops) {
    for (const c of cops.slice(wantCops)) { W.scene.remove(c.mesh); W.cops.splice(W.cops.indexOf(c), 1); }
  }

  const tgt = W.player.inCar ? W.player.inCar.pos : W.player.pos;

  for (const c of W.cars) {
    if (c.kind !== 'police' || c.dead) continue;
    const dx = tgt.x - c.pos.x, dz = tgt.z - c.pos.z;
    const d = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    let dh = want - c.heading;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    c.heading += Math.max(-2.3 * dt, Math.min(2.3 * dt, dh));
    const sp = Math.min(CFG.policeMaxSpeed, 12 + d * 0.55);
    c.speed += (sp - c.speed) * Math.min(1, dt * 2);
    c.pos.x += Math.sin(c.heading) * c.speed * dt;
    c.pos.z += Math.cos(c.heading) * c.speed * dt;
    const res = collideCircle(c.pos.x, c.pos.z, c.radius);
    [c.pos.x, c.pos.z] = clampWorld(res.x, res.z, c.radius);
    if (res.hit) { c.heading += 1.3; c.speed *= 0.55; }
    c.mesh.position.set(c.pos.x, 0, c.pos.z);
    c.mesh.rotation.y = c.heading;
    if (c.bar) {
      const on = Math.floor(W.time * 6) % 2 === 0;
      c.bar.children[0].material.color.setHex(on ? 0xff2038 : 0x4a0a10);
      c.bar.children[1].material.color.setHex(on ? 0x0a1a55 : 0x2050ff);
    }
    if (W.player.inCar && d < 3.6) { // ram the player's car
      W.player.inCar.hp -= 26 * dt;
      W.player.inCar.speed *= 0.9;
      if (Math.floor(W.time * 8) % 4 === 0) sfx.crash();
      if (W.player.inCar.hp <= 0) explodeCar(W.player.inCar);
    }
    if (!W.player.inCar && d < 2.4) {
      W.arrestT += dt;
      if (W.arrestT > 1.1) busted();
    }
  }

  for (const cop of W.cops) {
    if (cop.dead) continue;
    const dx = tgt.x - cop.pos.x, dz = tgt.z - cop.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    cop.pos.x += (dx / d) * CFG.copRun * dt;
    cop.pos.z += (dz / d) * CFG.copRun * dt;
    const res = collideCircle(cop.pos.x, cop.pos.z, 0.45);
    [cop.pos.x, cop.pos.z] = clampWorld(res.x, res.z, 0.45);
    cop.mesh.position.set(cop.pos.x, 0, cop.pos.z);
    cop.mesh.rotation.y = Math.atan2(dx, dz);
    if (!W.player.inCar && d < 2.2) {
      W.arrestT += dt;
      if (W.arrestT > 1.1) busted();
    }
  }
  if (W.player.inCar) W.arrestT = 0;
}

export function busted() {
  W.mode = 'busted';
  W.overT = 0;
  W.money = Math.floor(W.money * 0.8);
  W.wanted = 0;
  W.arrestT = 0;
  sfx.denied();
}
