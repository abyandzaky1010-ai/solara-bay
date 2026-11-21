// Street life, part 1: traffic cars that follow lanes, slow for obstacles and turn at
// intersections, plus parked cars along the curbs (all of them stealable with E).
import { CFG } from './config.js';
import { PAL } from './palette.js';
import { rr, pick } from './random.js';
import { W, dist } from './world.js';
import { makeCar } from './car.js';

const LANE = 3.6;

function setLane(c) {
  if (c.axis === 'z') { c.pos.x = c.at + (c.dir > 0 ? LANE : -LANE); c.heading = c.dir > 0 ? 0 : Math.PI; }
  else { c.pos.z = c.at + (c.dir > 0 ? -LANE : LANE); c.heading = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
}

export function spawnTraffic(rng) {
  for (let i = 0; i < CFG.nTraffic; i++) {
    const c = makeCar(pick(rng, PAL.cars), 'traffic', 0, 0);
    c.axis = i % 2 === 0 ? 'z' : 'x';
    c.at = pick(rng, CFG.roadAt);
    c.dir = rng() < 0.5 ? 1 : -1;
    c.cruise = rr(rng, 8, 11.5);
    c.speed = c.cruise;
    c.lastGrid = Math.round((rr(rng, -140, 140)) / 50) * 50;
    if (c.axis === 'z') c.pos.z = rr(rng, -140, 140); else c.pos.x = rr(rng, -140, 140);
    setLane(c);
    c.mesh.position.set(c.pos.x, 0, c.pos.z);
    c.mesh.rotation.y = c.heading;
  }
  for (let i = 0; i < CFG.nParked; i++) {
    const p = CFG.roadAt[i % CFG.roadAt.length];
    const vertical = i % 2 === 0;
    const along = -170 + i * 62;
    const c = makeCar(pick(rng, PAL.cars), 'parked', 0, 0);
    if (vertical) { c.pos.x = p + 5.4; c.pos.z = along; c.heading = 0; }
    else { c.pos.z = p + 5.4; c.pos.x = along; c.heading = Math.PI / 2; }
    c.mesh.position.set(c.pos.x, 0, c.pos.z);
    c.mesh.rotation.y = c.heading;
  }
}

export function updateTraffic(dt) {
  const r = W.rng;
  const pp = W.player.inCar ? W.player.inCar.pos : W.player.pos;
  for (const c of W.cars) {
    if (c.kind !== 'traffic' || c.dead) continue;
    // brake for whatever is ahead
    const ax = c.pos.x + Math.sin(c.heading) * 9;
    const az = c.pos.z + Math.cos(c.heading) * 9;
    let blocked = dist(ax, az, pp.x, pp.z) < 4.5;
    if (!blocked) {
      for (const o of W.cars) {
        if (o !== c && !o.dead && dist(ax, az, o.pos.x, o.pos.z) < 4) { blocked = true; break; }
      }
    }
    c.speed += ((blocked ? 0 : c.cruise) - c.speed) * Math.min(1, dt * 3);
    const coord = c.axis === 'z' ? 'z' : 'x';
    c.pos[coord] += c.dir * c.speed * dt;
    const v = c.pos[coord];
    const grid = Math.round(v / 50) * 50;
    if (Math.abs(v - grid) < c.speed * dt + 0.05 && c.lastGrid !== grid) {
      c.lastGrid = grid;
      if (grid >= -150 && grid <= 150 && r() < 0.32) { // turn onto the cross street
        c.axis = c.axis === 'z' ? 'x' : 'z';
        c.dir = r() < 0.5 ? 1 : -1;
        c.at = grid;
        setLane(c);
      }
    }
    if (Math.abs(v) > 152) { c.dir *= -1; setLane(c); } // U-turn at the city edge
    c.mesh.position.set(c.pos.x, 0, c.pos.z);
    c.mesh.rotation.y = c.heading;
    for (const w of c.wheels) w.rotation.x += c.speed * dt / 0.38;
  }
}
