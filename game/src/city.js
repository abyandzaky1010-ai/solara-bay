// Solara Bay itself: the two districts of buildings across sixteen blocks,
// Verde Park, the palm promenade, the named places the story hangs on, and the
// cars that start out parked there. Every piece of city geometry is born here.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { addCollider } from './world.js';

const LINES = [-160, -80, 0, 80, 160];
const PARK = CONFIG.world.parkRect;
const MID = 40; // centre of one 80 m block gap

// ------------------------------------------------------------------ helpers

function box(w, h, d, hex, x, y, z, opts) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex, opts));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function pad(w, d, hex, x, z, y = 0.12) {
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.24, d), material(hex));
  slab.position.set(x, y, z);
  slab.receiveShadow = true;
  return slab;
}

function tileSize(w, d) {
  return { w: Math.max(14, Math.min(30, w)), d: Math.max(14, Math.min(30, d)) };
}

// Does a block rect touch Verde Park?
function overlapsPark(x0, x1, z0, z1) {
  return x1 > PARK.minX && x0 < PARK.maxX && z1 > PARK.minZ && z0 < PARK.maxZ;
}

// Cut a block into 2-4 lots with uneven splits along a random axis.
function sliceBlock(x0, x1, z0, z1, rng) {
  const total = rng.int(2, 4);
  const lots = [];
  let cursor = x0;
  let cursorZ = z0;
  let remaining = total;
  const alongX = rng.chance(0.5);
  while (remaining > 0) {
    const share = remaining === 1 ? 1 : rng.range(0.34, 0.66);
    if (alongX) {
      const w = (x1 - cursor) * share;
      lots.push({ x: cursor + w / 2, z: (z0 + z1) / 2, w, d: z1 - z0 });
      cursor += w;
    } else {
      const d = (z1 - cursorZ) * share;
      lots.push({ x: (x0 + x1) / 2, z: cursorZ + d / 2, w: x1 - x0, d });
      cursorZ += d;
    }
    remaining -= 1;
  }
  return lots;
}

// ------------------------------------------------------------------- towers

function buildTower(city, lot, rng) {
  const scene = city.W.scene;
  const gap = 3.4;
  const { w, d } = tileSize(lot.w - gap * 2, lot.d - gap * 2);
  const h = rng.range(30, 90);
  const glassy = rng.chance(0.6);
  const hex = glassy ? rng.pick(C.glass) : rng.pick(C.steel);

  scene.add(box(w, h, d, hex, lot.x, h / 2, lot.z, glassy ? { glassy: true } : undefined));

  // One cap: ledge plate plus a small mechanical room on the tall ones.
  scene.add(box(w + 1.2, 0.9, d + 1.2, 0xb8c3cc, lot.x, h, lot.z));
  if (h > 52) scene.add(box(w * 0.34, 2.6, d * 0.34, 0x8b96a2, lot.x, h + 0.9, lot.z));

  // Vertical window ribs on the street sides only — cheap, sells the height.
  const ribs = Math.max(3, Math.round(w / 4));
  for (let i = 0; i < ribs; i += 1) {
    const rx = lot.x - w / 2 + (w / (ribs - 1)) * i;
    const rib = box(1.1, h * 0.96, 0.3, 0x517a96, rx, h / 2, lot.z + d / 2 + 0.16);
    rib.castShadow = false;
    scene.add(rib);
  }
  const sideRibs = Math.max(3, Math.round(d / 5));
  for (let i = 0; i < sideRibs; i += 1) {
    const rz = lot.z - d / 2 + (d / (sideRibs - 1)) * i;
    const rib = box(0.3, h * 0.96, 1.1, 0x517a96, lot.x + w / 2 + 0.16, h / 2, rz);
    rib.castShadow = false;
    scene.add(rib);
  }

  addCollider(city.W, lot.x, lot.z, w, d, h);
  city.buildings.push({ x: lot.x, z: lot.z, w, d, h, color: hex });
}

function buildHouse(city, lot, rng) {
  const scene = city.W.scene;
  const gap = 3.6;
  const { w, d } = tileSize(lot.w - gap * 2, lot.d - gap * 2);
  const h = rng.range(8, 24) - 1.1;
  const hex = rng.pick(C.stucco);

  scene.add(box(w, h, d, hex, lot.x, h / 2, lot.z));
  // Oversailing roof slab shuts out the noon sun.
  scene.add(box(w + 1.8, 1.1, d + 1.8, C.roof, lot.x, h + 0.55, lot.z));

  const rows = Math.max(1, Math.floor(h / 8));
  const cols = Math.max(1, Math.floor(w / 7));
  for (let r = 0; r < rows; r += 1) {
    const wy = 4.2 + r * 7.4;
    if (wy > h - 2) break;
    for (let c = 0; c < cols; c += 1) {
      const wx = lot.x - w / 2 + (w / cols) * (c + 0.5);
      for (const face of [1, -1]) {
        const win = box(1.5, 2.0, 0.3, 0x41607a, wx, wy, lot.z + face * (d / 2 + 0.12));
        win.castShadow = false;
        scene.add(win);
      }
    }
  }

  addCollider(city.W, lot.x, lot.z, w, d, h + 1.1);
  city.buildings.push({ x: lot.x, z: lot.z, w, d, h: h + 1.1, color: hex });
}

function fillBlocks(city, rng) {
  const inset = 9; // 6 m road + 3 m sidewalk
  for (let b = 0; b < LINES.length - 1; b += 1) {
    for (let c = 0; c < LINES.length - 1; c += 1) {
      const x0 = LINES[b] + inset;
      const x1 = LINES[b + 1] - inset;
      const z0 = LINES[c] + inset;
      const z1 = LINES[c + 1] - inset;
      if (overlapsPark(x0, x1, z0, z1)) continue;
      const downtown = x0 >= 0;
      for (const lot of sliceBlock(x0, x1, z0, z1, rng)) {
        if (downtown) buildTower(city, lot, rng);
        else buildHouse(city, lot, rng);
      }
    }
  }
}

// ---------------------------------------------------------------- greenery

function buildPalm(height, rng) {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.44, height, 6), material(C.trunk));
  trunk.position.y = height / 2;
  trunk.castShadow = true;
  tree.add(trunk);

  for (let i = 0; i < 5; i += 1) {
    const frond = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.2, 4.2), material(C.frond));
    const a = (i / 5) * Math.PI * 2 + rng.range(-0.15, 0.15);
    frond.position.set(Math.sin(a) * 1.8, height + 0.12, Math.cos(a) * 1.8);
    frond.rotation.set(-0.4, a, 0);
    frond.castShadow = true;
    tree.add(frond);
  }
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 5), material(C.frond));
  crown.position.y = height;
  tree.add(crown);
  return tree;
}

function buildBench(x, z, yaw) {
  const bench = new THREE.Group();
  const wood = material(0x9a7250);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 0.7), wood);
  seat.position.y = 0.5;
  seat.castShadow = true;
  bench.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 0.14), wood);
  back.position.set(0, 0.92, -0.32);
  back.castShadow = true;
  bench.add(back);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.6), material(0x5b5b5b));
    leg.position.set(side * 0.95, 0.25, 0);
    bench.add(leg);
  }
  bench.position.set(x, 0, z);
  bench.rotation.y = yaw;
  return bench;
}

function buildPark(city, rng) {
  const scene = city.W.scene;
  const cx = (PARK.minX + PARK.maxX) / 2;
  const cz = (PARK.minZ + PARK.maxZ) / 2;
  const w = PARK.maxX - PARK.minX;
  const d = PARK.maxZ - PARK.minZ;

  scene.add(pad(w, d, C.grass, cx, cz, 0.1));

  // One diagonal path so the green reads as a park from the air.
  const path = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.05, 3.4), material(0xdccfb4));
  path.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
  path.position.set(cx, 0.26, cz);
  path.receiveShadow = true;
  scene.add(path);

  const pondX = cx + 16;
  const pondZ = cz + 16;
  const pond = new THREE.Mesh(new THREE.CircleGeometry(8.5, 20), material(C.water, { glassy: true }));
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(pondX, 0.27, pondZ);
  scene.add(pond);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(8.5, 0.45, 6, 22), material(0xcfc6b8));
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(pondX, 0.26, pondZ);
  scene.add(rim);

  const spots = [
    [cx - 25, cz - 25], [cx - 11, cz - 28], [cx + 3, cz - 25], [cx + 21, cz - 23],
    [cx - 26, cz + 19], [cx - 9, cz + 27], [cx + 21, cz + 3], [cx - 20, cz + 4],
  ];
  for (const [x, z] of spots) {
    const tree = buildPalm(rng.range(7, 11), rng);
    tree.position.set(x, 0.24, z);
    city.palms.push(tree);
    scene.add(tree);
  }

  for (const [x, z, yaw] of [[cx - 4, cz + 6, -0.7], [cx + 6, cz - 5, 2.4], [cx - 15, cz - 5, 0.4]]) {
    scene.add(buildBench(x, z, yaw));
  }

  // The crate that holds the rifle.
  const crateX = cx - 21;
  const crateZ = cz + 25;
  scene.add(box(1.8, 1.2, 1.8, 0x8a6a3f, crateX, 0.84, crateZ));
  scene.add(box(2.0, 0.16, 2.0, C.beacon, crateX, 1.5, crateZ, { flat: true }));
  addCollider(city.W, crateX, crateZ, 2.0, 2.0, 1.5);
  city.pickup = { x: crateX, z: crateZ, rifle: true };

  city.park = {
    minX: PARK.minX, maxX: PARK.maxX, minZ: PARK.minZ, maxZ: PARK.maxZ,
    x: cx, z: cz, pond: { x: pondX, z: pondZ, r: 8.5 },
  };
}

function buildPromenade(city, rng) {
  for (let i = 0; i < 10; i += 1) {
    const tree = buildPalm(rng.range(8, 12), rng);
    tree.position.set(-185 + rng.range(-1.5, 1.5), 0.05, -180 + i * 36);
    city.palms.push(tree);
    city.W.scene.add(tree);
  }
}

// ------------------------------------------------------------ named places

// Flat pad plus awning plate and beacon: the street face of a named place.
function placeSign(city, x, z, hex, w, d, faceZ) {
  const scene = city.W.scene;
  scene.add(pad(w, d, 0x2f3742, x, z, 0.1));
  const awning = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 0.5, 1.5), material(hex, { flat: true }));
  awning.position.set(x, 2.7, z + faceZ * (d / 2 - 0.6));
  awning.castShadow = true;
  scene.add(awning);
  for (const side of [-1, 1]) {
    scene.add(box(0.28, 2.7, 0.28, 0x3a3f46, x + side * (w * 0.38), 1.35, z + faceZ * (d / 2 - 0.6)));
  }
  scene.add(box(0.24, 3.6, 0.24, 0x5b6472, x, 1.8, z - faceZ * (d / 2 - 0.5)));
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 1.0), material(hex, { flat: true }));
  lamp.position.set(x, 3.85, z - faceZ * (d / 2 - 0.5));
  scene.add(lamp);
}

function buildPlaces(city) {
  const scene = city.W.scene;

  // GLASS ORCHID — the giver's lockup in Meridian's north-west block.
  const go = { x: MID + 20, z: -MID - 20 };
  scene.add(pad(30, 22, 0x8c929a, go.x, go.z, 0.11));
  scene.add(box(26, 7, 4, C.glass[1], go.x, 3.5, go.z - 9, { glassy: true }));
  addCollider(city.W, go.x, go.z - 9, 26, 4, 7);
  city.buildings.push({ x: go.x, z: go.z - 9, w: 26, d: 4, h: 7, color: C.glass[1] });
  placeSign(city, go.x, go.z + 6, C.barRed, 14, 8, 1);
  city.markers.glassOrchid = { x: go.x, z: go.z };

  // VINE MART — corner shop south of the avenue.
  const vm = { x: MID + 20, z: MID + 22 };
  scene.add(pad(22, 16, 0x8c929a, vm.x, vm.z, 0.11));
  scene.add(box(18, 5.2, 10, C.stucco[1], vm.x, 2.6, vm.z - 11));
  addCollider(city.W, vm.x, vm.z - 11, 18, 10, 5.2);
  city.buildings.push({ x: vm.x, z: vm.z - 11, w: 18, d: 10, h: 5.2, color: C.stucco[1] });
  placeSign(city, vm.x, vm.z + 2, C.stucco[3], 12, 8, 1);
  city.markers.vineMart = { x: vm.x, z: vm.z };

  // CEDAR VIEW — hospital on the west edge by the promenade.
  const cv = { x: -160, z: 150 };
  scene.add(pad(24, 26, 0xe8e4dc, cv.x, cv.z, 0.11));
  scene.add(box(16, 12, 16, 0xf3efe6, cv.x - 4, 6, cv.z));
  addCollider(city.W, cv.x - 4, cv.z, 16, 16, 12);
  city.buildings.push({ x: cv.x - 4, z: cv.z, w: 16, d: 16, h: 12, color: 0xf3efe6 });
  placeSign(city, cv.x + 4, cv.z, 0xdfe9f2, 10, 14, 1);
  city.markers.hospital = { x: cv.x + 4, z: cv.z };

  // SABLE ROW — police station, Palm Ward.
  const sr = { x: -150, z: 100 };
  scene.add(pad(26, 24, 0xa8b2bc, sr.x, sr.z, 0.11));
  scene.add(box(20, 9, 12, C.coptrim, sr.x, 4.5, sr.z - 11));
  addCollider(city.W, sr.x, sr.z - 11, 20, 12, 9);
  city.buildings.push({ x: sr.x, z: sr.z - 11, w: 20, d: 12, h: 9, color: C.coptrim });
  placeSign(city, sr.x, sr.z - 1, C.barBlue, 16, 10, -1);
  city.markers.station = { x: sr.x, z: sr.z };

  // TAXI STAND — where the cabs idle near the central crossing.
  const ts = { x: 26, z: -16 };
  scene.add(pad(16, 8, 0x3b4147, ts.x, ts.z, 0.08));
  scene.add(box(0.3, 3.2, 0.3, 0x5b6472, ts.x - 7, 1.7, ts.z - 3.2));
  scene.add(box(3.4, 1.0, 0.3, C.taxi, ts.x - 5.4, 3.4, ts.z - 3.2, { flat: true }));
  city.markers.taxiStand = { x: ts.x, z: ts.z };
}

// ----------------------------------------------------------------- spawns

function buildSpawns(city) {
  city.spawns.playerStart = { x: 14, z: 20 };
  city.spawns.carParks = [
    { x: 26, z: 14, kind: 'sport', color: C.sport, tag: 'm1car' },
    { x: -18, z: 46, kind: 'sedan', color: C.sedan },
    { x: 62, z: -20, kind: 'sedan', color: 0xd9d2c4 },
    { x: 34, z: -18, kind: 'taxi', color: C.taxi },
    { x: -34, z: -26, kind: 'sport', color: 0x4fa0d9 },
    { x: -62, z: 64, kind: 'sport', color: 0xe0c14f },
  ];
}

export function buildCity(W, rng) {
  const city = {
    W,
    buildings: [],
    palms: [],
    markers: {},
    spawns: {},
    park: null,
    pickup: null,
  };

  fillBlocks(city, rng);
  buildPark(city, rng);
  buildPromenade(city, rng);
  buildPlaces(city);
  buildSpawns(city);

  return city;
}

// Which building footprint contains this point? Buildings are sorted into a
// coarse bucket grid the first time it is asked, then the check is O(1).
export function buildingAt(city, x, z) {
  const list = city.buildings;
  if (!city.buildingIndex) {
    const index = new Map();
    for (const b of list) {
      for (let ix = Math.floor((b.x - b.w / 2) / 40); ix <= Math.floor((b.x + b.w / 2) / 40); ix += 1) {
        for (let iz = Math.floor((b.z - b.d / 2) / 40); iz <= Math.floor((b.z + b.d / 2) / 40); iz += 1) {
          const key = `${ix},${iz}`;
          if (!index.has(key)) index.set(key, []);
          index.get(key).push(b);
        }
      }
    }
    city.buildingIndex = index;
  }

  const bucket = city.buildingIndex.get(`${Math.floor(x / 40)},${Math.floor(z / 40)}`);
  if (!bucket) return null;
  for (const b of bucket) {
    if (x >= b.x - b.w / 2 && x <= b.x + b.w / 2 && z >= b.z - b.d / 2 && z <= b.z + b.d / 2) return b;
  }
  return null;
}
