// The city: a sun-soaked 400x400 m grid of streets, concrete blocks, and
// pale buildings, one green park, and a water edge to the south. Everything
// is a box or low-poly shape from the palette, lit by the world's sun. It
// also produces the flat collider list (AABB only) and the road/water layout
// that the cars, pedestrians and minimap all read.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const B = 200; // half-width; city runs -200..200 on x and z
const ROAD_W = 16;
const XS = [-100, 0, 100]; // vertical street centres (run along z)
const ZS = [-100, 0, 100]; // horizontal street centres (run along x)
const WATER_Z = 170; // the bay begins here (south edge)
export const buildingPositions = [];

export const CITY = {
  bound: B,
  roads: { xs: XS, zs: ZS, w: ROAD_W },
  water: { z0: WATER_Z, z1: B },
  colliders: [],
};

function solid(x0, x1, z0, z1, h) {
  // Register an AABB collider so the player and cars walk/roll around it.
  CITY.colliders.push({ x0, x1, z0, z1, h });
}

export function buildCity(scene) {
  const rng = mulberry32(7);
  const mats = {};
  const mat = (color) => (mats[color] ??= new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));

  // Ground: dry grass, one big plane that reads as the blocks' base.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4 * B, 4 * B), mat(PALETTE.ground));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Waterfront: a calm blue sheet to the south with a darker rim.
  const water = new THREE.Mesh(new THREE.PlaneGeometry(4 * B, B - WATER_Z + 40), mat(PALETTE.water));
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.02, WATER_Z + (B - WATER_Z) / 2);
  water.receiveShadow = true;
  scene.add(water);
  const pier = new THREE.Mesh(new THREE.BoxGeometry(120, 0.6, 14), mat(PALETTE.sidewalk));
  pier.position.set(0, 0.3, WATER_Z - 4);
  pier.receiveShadow = pier.castShadow = true;
  scene.add(pier);

  // Streets: a cross of asphalt strips, each with a painted centre line.
  for (const x of XS) strip(scene, x, 0, 0, B, PALETTE.road, PALETTE.roadLine, 'v', x, mat);
  for (const z of ZS) strip(scene, 0, z, B, 0, PALETTE.road, PALETTE.roadLine, 'h', z, mat);
  // Where the two cross, paint a lane line over the intersection too.
  for (const x of XS) lineOver(scene, x, mat);

  // Blocks: concrete aprons around each island, then buildings on most of them.
  let bi = 0;
  for (const bx of blockCenters()) for (const bz of blockCenters()) {
    const cx = bx, cz = bz;
    block(scene, cx, cz, mat(PALETTE.sidewalk));
    const park = parkBlock(cx, cz);
    const waterfront = cz > 90; // the southernmost row keeps a low beach
    if (park) {
      parkScene(scene, cx, cz, rng, mat);
      continue;
    }
    if (waterfront) {
      // Low seafront buildings + a beach strip, no tall blocks.
      buildings(scene, cx, cz, rng, mat, 2, 2);
      continue;
    }
    // A mix of one wide tower and a pair of mid blocks, varied heights.
    if (rng() < 0.4) buildings(scene, cx, cz, rng, mat, 1, 1);
    else buildings(scene, cx, cz, rng, mat, 2, 1);
    bi += 1;
  }
}

function strip(scene, cx, cz, horiz, len, col, lineCol, axis, center, mat) {
  const w = ROAD_W;
  const geo = axis === 'v'
    ? new THREE.BoxGeometry(w, 0.12, 4 * B)
    : new THREE.BoxGeometry(4 * B, 0.12, w);
  const m = new THREE.Mesh(geo, mat(col));
  m.position.set(axis === 'v' ? center : 0, 0.06, axis === 'v' ? 0 : center);
  m.receiveShadow = true;
  scene.add(m);
  // Centre line, dashed.
  const dashes = new THREE.BoxGeometry(axis === 'v' ? 0.4 : 4 * B, 0.05, axis === 'v' ? 4 * B : 0.4);
  const dm = new THREE.Mesh(dashes, mat(lineCol));
  dm.position.copy(m.position);
  dm.position.y = 0.14;
  scene.add(dm);
}

function lineOver(scene, x, mat) {
  // Short painted line across each intersection so the junctions read as roads.
  const dm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, ROAD_W), mat(PALETTE.roadLine));
  dm.position.set(x, 0.14, 0);
  scene.add(dm);
}

function block(scene, cx, cz, m) {
  // A concrete apron just off the asphalt.
  const s = 78;
  const g = new THREE.BoxGeometry(s, 0.2, s);
  const b = new THREE.Mesh(g, m);
  b.position.set(cx, 0.1, cz);
  b.receiveShadow = true;
  scene.add(b);
}

function blockCenters() {
  // The four island centres between the streets.
  return [-150, -50, 50, 150];
}

function parkBlock(cx, cz) {
  // One island is the park (north-east).
  return cx > 0 && cz < 0 && cx > 50;
}

function parkScene(scene, cx, cz, rng, mat) {
  const lawn = new THREE.Mesh(new THREE.BoxGeometry(84, 0.3, 84), mat(PALETTE.park));
  lawn.position.set(cx, 0.15, cz);
  lawn.receiveShadow = true;
  scene.add(lawn);
  for (let i = 0; i < 7; i += 1) {
    const tx = cx + (rng() - 0.5) * 60;
    const tz = cz + (rng() - 0.5) * 60;
    tree(scene, tx, tz, rng, mat);
  }
}

function tree(scene, x, z, rng, mat) {
  const h = 4 + rng() * 3;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, h, 6), mat(0x8a5f3f));
  trunk.position.set(x, h / 2, z);
  trunk.castShadow = true;
  scene.add(trunk);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(2.4 + rng() * 1.6, 8, 6), mat(0x5f9f4f));
  crown.position.set(x, h + 1.4, z);
  crown.castShadow = true;
  scene.add(crown);
  solid(x - 0.5, x + 0.5, z - 0.5, z + 0.5, h + 2, scene);
}

function buildings(scene, cx, cz, rng, mat, cols, rows) {
  // Lay out the boxes in a small grid, leaving a gap where streets cut.
  const gap = ROAD_W / 2 + 6;
  const heights = [14, 22, 34, 48, 62];
  for (let i = 0; i < cols; i += 1) for (let j = 0; j < rows; j += 1) {
    const off = cols === 1 ? 0 : (i - (cols - 1) / 2) * (44 + gap);
    const off2 = rows === 1 ? 0 : (j - (rows - 1) / 2) * (44 + gap);
    const x = cx + off, z = cz + off2;
    const w = 34 + rng() * 10;
    const h = heights[(rng() * heights.length) | 0];
    buildingPositions.push(new THREE.Vector3(x, h / 2 + 0.3, z));
    tower(scene, x, z, w, h, rng, mat);
  }
}

export function getBuildingPosition(index) {
  return buildingPositions[index] ?? null;
}

function tower(scene, x, z, w, h, rng, mat) {
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, w),
    mat(PALETTE.building[(rng() * PALETTE.building.length) | 0]),
  );
  body.position.set(x, h / 2 + 0.3, z);
  body.castShadow = body.receiveShadow = true;
  scene.add(body);

  // Window band, a slightly proud strip of the palette's window colour.
  const win = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, h * 0.5, 0.2), mat(PALETTE.window));
  for (const sx of [1, -1]) {
    win.position.set(x + sx * (w / 2 + 0.2), h * 0.55, z);
    win.rotation.y = Math.PI / 2;
    scene.add(win.clone());
  }

  // A coloured accent band near the roof, one per building.
  const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 2.4, w + 0.3),
    mat(PALETTE.accent[(rng() * PALETTE.accent.length) | 0]));
  band.position.set(x, h - 4, z);
  scene.add(band);

  solid(x - w / 2, x + w / 2, z - w / 2, z + w / 2, h, scene);
}

function mulberry32(a) {
  return function random() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Pedestrians -------------------------------------------------------
// Ten simple walkers: a boxy torso with a small head box on top and two
// swinging legs, laid out on the sidewalk lanes of the city blocks. They
// pace a lane until they reach the end, turn around, and bob as they walk.
export const pedestrians = [];

const PED_COLORS = [
  0xe4572e, 0x3d99d6, 0xf2c14e, 0x7a4fbf, 0x2fa36b,
  0xd94f70, 0xf4f4f4, 0x4a4a55, 0x77d1c1, 0xc07a3a,
];

export function spawnPedestrians(scene) {
  const rng = mulberry32(21);
  const centers = [-150, -50, 50, 150];
  const lanes = [];
  // Every block contributes four sidewalk lanes: two along z, two along x.
  for (const cx of centers) {
    for (const cz of centers) {
      for (const off of [-33, 33]) {
        lanes.push({ axis: 'z', fixed: cx + off, lo: cz - 36, hi: cz + 36 });
        lanes.push({ axis: 'x', fixed: cz + off, lo: cx - 36, hi: cx + 36 });
      }
    }
  }

  const count = 10;
  const stride = Math.max(1, Math.floor(lanes.length / count));
  for (let i = 0; i < count; i += 1) {
    const lane = lanes[(i * stride + 5) % lanes.length];
    const scale = 0.85 + rng() * 0.4;
    const ped = makePedestrian(scene, PED_COLORS[i % PED_COLORS.length], scale);

    ped.axis = lane.axis;
    ped.fixed = lane.fixed;
    ped.lo = lane.lo;
    ped.hi = lane.hi;
    ped.dir = rng() < 0.5 ? 1 : -1;
    ped.speed = 1.2 + rng() * 1.0;
    ped.phase = rng() * Math.PI * 2;
    ped.baseY = 0.2; // top of the concrete apron

    const along = lane.lo + rng() * (lane.hi - lane.lo);
    if (lane.axis === 'z') ped.position.set(lane.fixed, ped.baseY, along);
    else ped.position.set(along, ped.baseY, lane.fixed);
    ped.rotation.y = ped.axis === 'z'
      ? (ped.dir > 0 ? 0 : Math.PI)
      : (ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2);

    scene.add(ped);
    pedestrians.push(ped);
  }
  return pedestrians;
}

function makePedestrian(scene, color, scale) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd9a06b, roughness: 0.7 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x3a3f52, roughness: 0.9 });

  // Torso box, then the small head box sitting on top of it.
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.8, 0.38), bodyMat);
  torso.position.y = 1.06;
  torso.castShadow = true;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), skinMat);
  head.position.y = 1.68;
  head.castShadow = true;
  g.add(head);

  // Two hips that pivot so the legs can swing while walking.
  const legs = [];
  for (const sx of [-0.16, 0.16]) {
    const hip = new THREE.Group();
    hip.position.set(sx, 0.66, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.66, 0.24), legMat);
    leg.position.y = -0.33;
    leg.castShadow = true;
    hip.add(leg);
    hip.userData.offset = sx > 0 ? Math.PI : 0;
    g.add(hip);
    legs.push(hip);
  }

  g.legs = legs;
  g.scale.setScalar(scale);
  return g;
}

export function updatePedestrians(deltaTime) {
  if (!pedestrians.length) return;
  for (const ped of pedestrians) {
    const step = ped.speed * deltaTime;
    let along = ped.axis === 'z' ? ped.position.z : ped.position.x;
    along += ped.dir * step;

    // Turn around when the sidewalk lane runs out.
    if (along > ped.hi) { along = ped.hi; ped.dir = -1; }
    else if (along < ped.lo) { along = ped.lo; ped.dir = 1; }

    if (ped.axis === 'z') ped.position.z = along;
    else ped.position.x = along;

    ped.rotation.y = ped.axis === 'z'
      ? (ped.dir > 0 ? 0 : Math.PI)
      : (ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2);

    // A light bob up and down plus a matching leg swing.
    ped.phase += step * 6;
    ped.position.y = ped.baseY + Math.abs(Math.sin(ped.phase)) * 0.06;
    if (ped.legs) {
      for (const leg of ped.legs) {
        leg.rotation.x = Math.sin(ped.phase + leg.userData.offset) * 0.5;
      }
    }
  }
}
