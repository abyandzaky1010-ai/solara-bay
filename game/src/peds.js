// Street life, part 2: pedestrians patrolling sidewalk block perimeters; they flee gunfire and
// speeding cars, and die if a car runs over them.
import { CFG } from './config.js';
import { PAL } from './palette.js';
import { rr, ri, pick } from './random.js';
import { W, dist, clampWorld } from './world.js';
import { makeHumanoid } from './render.js';

const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

export function spawnPeds(rng) {
  for (let i = 0; i < CFG.nPeds; i++) {
    const b = pick(rng, W.blocks);
    const ped = {
      pos: { x: b.x + rr(rng, -15, 15), y: 0, z: b.z + rr(rng, -15, 15) },
      hp: CFG.pedHp, dead: false, deadT: 0, fleeT: 0,
      block: b, corner: ri(rng, 0, 3), speed: rr(rng, 1.5, 2.3),
      mesh: makeHumanoid(pick(rng, PAL.pedShirts)),
      rider: false, phase: i * 1.7,
    };
    ped.mesh.userData.kind = 'ped';
    ped.mesh.userData.ref = ped;
    W.scene.add(ped.mesh);
    W.peds.push(ped);
  }
}

export function updatePeds(dt) {
  const h = CFG.blockHalf - 2;
  for (let i = W.peds.length - 1; i >= 0; i--) {
    const ped = W.peds[i];
    if (ped.dead) {
      ped.deadT += dt;
      ped.mesh.rotation.x = Math.min(Math.PI / 2, ped.deadT * 4);
      if (ped.deadT > 5) { W.scene.remove(ped.mesh); W.peds.splice(i, 1); }
      continue;
    }
    if (ped.rider) { ped.mesh.visible = false; continue; }
    let wx = 0, wz = 0, speed = ped.speed;
    // flee gunfire
    if (W.time - W.gunshotT < 4 && W.alertPos) {
      const d = dist(ped.pos.x, ped.pos.z, W.alertPos.x, W.alertPos.z);
      if (d < 34) {
        ped.fleeT = 2.5;
        const l = d || 1;
        wx = (ped.pos.x - W.alertPos.x) / l; wz = (ped.pos.z - W.alertPos.z) / l;
        speed = 4.6;
      }
    }
    if (ped.fleeT > 0) {
      ped.fleeT -= dt;
      if (wx === 0 && wz === 0) {
        const d = dist(ped.pos.x, ped.pos.z, W.alertPos.x, W.alertPos.z) || 1;
        wx = (ped.pos.x - W.alertPos.x) / d; wz = (ped.pos.z - W.alertPos.z) / d;
        speed = 4.6;
      }
    } else {
      // walk the block perimeter
      const [cx, cz] = CORNERS[ped.corner];
      const tx = ped.block.x + cx * h, tz = ped.block.z + cz * h;
      const d = dist(ped.pos.x, ped.pos.z, tx, tz);
      if (d < 1.2) ped.corner = (ped.corner + 1) % 4;
      else { wx = (tx - ped.pos.x) / d; wz = (tz - ped.pos.z) / d; }
    }
    if (wx || wz) {
      ped.pos.x += wx * speed * dt;
      ped.pos.z += wz * speed * dt;
      [ped.pos.x, ped.pos.z] = clampWorld(ped.pos.x, ped.pos.z, 0.4);
      ped.mesh.rotation.y = Math.atan2(wx, wz);
      ped.phase += dt * speed * 3;
      ped.mesh.position.y = Math.abs(Math.sin(ped.phase)) * 0.07;
    }
    ped.mesh.position.x = ped.pos.x;
    ped.mesh.position.z = ped.pos.z;
  }
}
