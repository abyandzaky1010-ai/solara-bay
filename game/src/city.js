import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { addCollider, STREETS } from './world.js';

// One job: the city itself. Meridian glass towers east, pastel Palm Ward west,
// Verde Park in the middle-west, a palm-lined promenade, named venues and parking.

const EDGE = 6;          // asphalt half-width, kept local so block maths reads plainly
const INNER = 77;        // building line sits six metres off the block edge
const PARK = CONFIG.world.parkRect;

// ---------- small geometry helpers ----------

function box(w, h, d, hex, opts) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex, opts));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function slab(parent, w, h, d, hex, x, y, z, opts) {
  const m = box(w, h, d, hex, opts);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function disc(parent, radius, hex, x, y, z, opts) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 22), material(hex, opts));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** Palm: leaning trunk, five drooping frond plates, a crown. Cheap at any distance. */
function palm(parent, x, z, height, scale = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22 * scale, 0.34 * scale, height, 7),
    material(C.trunk),
  );
  trunk.position.y = height / 2;
  trunk.castShadow = true;
  trunk.rotation.z = 0.05;
  g.add(trunk);

  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const frond = new THREE.Mesh(new THREE.BoxGeometry(0.6 * scale, 0.1, 3.4 * scale), material(C.frond));
    frond.castShadow = true;
    frond.position.set(Math.cos(angle) * 1.4 * scale, height - 0.15, Math.sin(angle) * 1.4 * scale);
    frond.rotation.y = angle;
    frond.rotation.x = 0.32;
    g.add(frond);
  }

  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.6 * scale, 8, 6), material(C.frond));
  crown.position.y = height - 0.2;
  crown.castShadow = true;
  g.add(crown);

  g.position.set(x, 0, z);
  g.rotation.y = x * 0.37 + z * 0.11;
  parent.add(g);
  return g;
}

function bench(parent, x, z, turn) {
  const g = new THREE.Group();
  slab(g, 2.2, 0.12, 0.6, 0xa9713f, 0, 0.46, 0);
  slab(g, 2.2, 0.5, 0.12, 0x9b6537, 0, 0.74, -0.26);
  slab(g, 0.12, 0.44, 0.5, 0x4a4f57, -0.9, 0.22, 0);
  slab(g, 0.12, 0.44, 0.5, 0x4a4f57, 0.9, 0.22, 0);
  g.position.set(x, 0, z);
  g.rotation.y = turn;
  parent.add(g);
}

/** Flat pad with awnings and posts: the stand-in for a building we cannot walk into. */
function padBase(parent, x, z, w, d, padHex, awningHex) {
  slab(parent, w, 0.06, d, padHex, x, 0.03, z);
  for (const side of [-1, 1]) {
    slab(parent, w * 0.6, 0.14, 1.8, awningHex, x, 3.1, z + side * (d / 2 + 0.9));
    slab(parent, 0.22, 3.1, 0.22, 0x55606b, x - w * 0.28, 1.55, z + side * (d / 2 + 1.7));
    slab(parent, 0.22, 3.1, 0.22, 0x55606b, x + w * 0.28, 1.55, z + side * (d / 2 + 1.7));
  }
  return { x, z, w, d };
}

function pickHex(rng, list) {
  return list[Math.min(list.length - 1, Math.floor(rng.next() * list.length))];
}

// ---------- districts ----------

/** Steel mullions down the front and side faces, plus the crown and plant box. */
function dressTower(parent, rng, cx, cz, w, d, height, steelHex) {
  const stripes = Math.max(3, Math.floor(w / 4));
  for (let i = 0; i < stripes; i++) {
    const off = -w / 2 + (i + 0.5) * (w / stripes);
    slab(parent, 0.35, height * 0.94, 0.3, steelHex, cx + off, height / 2, cz + d / 2 + 0.16);
    slab(parent, 0.3, height * 0.94, 0.35, steelHex, cx + w / 2 + 0.16, height / 2, cz + off * 0.8);
  }
  slab(parent, w + 1.2, 1.4, d + 1.2, steelHex, cx, height + 0.7, cz);
  slab(parent, w * 0.35, 3.2, d * 0.35, 0xb9c3cc, cx + w * 0.18, height + 2.9, cz - d * 0.18);
  slab(parent, 0.5, rng.range(6, 16), 0.5, 0xd7dee4, cx - w * 0.25, height + 6, cz + d * 0.2);
}

/** Meridian: glass tower, steel crown, mullions on two faces, rooftop plant box. */
function tower(parent, rng, cx, cz, w, d) {
  const height = rng.range(30, 90);
  const glassHex = pickHex(rng, C.glass);
  const steelHex = pickHex(rng, C.steel);

  const body = box(w, height, d, glassHex, { glassy: true });
  body.position.set(cx, height / 2, cz);
  parent.add(body);

  dressTower(parent, rng, cx, cz, w, d, height, steelHex);
  return { x: cx, z: cz, w, d, h: height, color: glassHex, district: 'meridian' };
}

/** Palm Ward: stucco block, warm roof slab, corner stair box, one window band per face. */
function stuccoHouse(parent, rng, cx, cz, w, d) {
  const height = rng.range(8, 24);
  const wallHex = pickHex(rng, C.stucco);

  const body = box(w, height, d, wallHex);
  body.position.set(cx, height / 2, cz);
  parent.add(body);

  slab(parent, w + 1.0, 0.9, d + 1.0, C.roof, cx, height + 0.45, cz);
  slab(parent, w * 0.4, 2.4, d * 0.4, 0xf0e6d2, cx - w * 0.2, height + 1.9, cz + d * 0.2);

  const bandY = Math.max(3.2, height * 0.55);
  slab(parent, w * 0.78, 1.5, 0.2, 0x9fb6c4, cx, bandY, cz + d / 2 + 0.12);
  slab(parent, w * 0.78, 1.5, 0.2, 0x9fb6c4, cx, bandY, cz - d / 2 - 0.12);
  slab(parent, 0.2, 1.5, d * 0.7, 0x9fb6c4, cx + w / 2 + 0.12, bandY, cz);

  return { x: cx, z: cz, w, d, h: height, color: wallHex, district: 'palmward' };
}

/**
 * Four cells in a block: two facing the street, two behind them. Each footprint
 * is capped by its own cell, so neighbours can never intersect.
 */
function lotsForBlock(rng, x0, x1, z0, z1) {
  const count = rng.int(2, 4);
  const cells = [[0, 0], [1, 0], [0, 1], [1, 1]].slice(0, count);
  const cellW = (x1 - x0 - 2) / 2;
  const cellD = (z1 - z0 - 2) / 2;
  const w = Math.min(rng.range(15, 24), cellW);
  const d = Math.min(rng.range(13, 22), cellD);
  return cells.map(([cx, cz]) => ({
    x: x0 + 1 + cellW * (cx + 0.5),
    z: z0 + 1 + cellD * (cz + 0.5),
    w,
    d,
  }));
}

/** One block: 2-4 lots, towers east of the middle, stucco west, colliders for all. */
function fillBlock(W, group, rng, city, x0, x1, z0, z1) {
  const meridian = (x0 + x1) / 2 >= 0;
  for (const lot of lotsForBlock(rng, x0, x1, z0, z1)) {
    const b = meridian
      ? tower(group, rng, lot.x, lot.z, lot.w, lot.d)
      : stuccoHouse(group, rng, lot.x, lot.z, lot.w, lot.d);
    addCollider(W, b.x, b.z, b.w, b.d, b.h);
    city.buildings.push(b);
  }
}

function buildBlocks(W, rng, city) {
  const group = new THREE.Group();
  group.name = 'blocks';
  W.scene.add(group);

  for (let ix = 0; ix < STREETS.length - 1; ix++) {
    const x0 = STREETS[ix] + EDGE + 3;
    const x1 = STREETS[ix + 1] - EDGE - 3;
    for (let iz = 0; iz < STREETS.length - 1; iz++) {
      const z0 = STREETS[iz] + EDGE + 3;
      const z1 = STREETS[iz + 1] - EDGE - 3;

      // Verde Park owns its block outright.
      if (x1 > PARK.minX && x0 < PARK.maxX && z1 > PARK.minZ && z0 < PARK.maxZ) continue;

      // VINE MART keeps the shop block clear for its counters.
      if (ix === 2 && iz === 2) {
        city.lots.shop = { minX: x0, maxX: x1, minZ: z0, maxZ: z1 };
        continue;
      }

      fillBlock(W, group, rng, city, x0, x1, z0, z1);
    }
  }
}

// ---------- Verde Park ----------

function buildPark(W, rng, city) {
  const g = new THREE.Group();
  g.name = 'verde-park';
  W.scene.add(g);

  const { minX, maxX, minZ, maxZ } = PARK;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX, maxZ - minZ), material(C.grass));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(cx, 0.025, cz);
  lawn.receiveShadow = true;
  g.add(lawn);

  // Pond against the south edge, ringed with wet sand.
  const pondX = minX + 18;
  const pondZ = maxZ - 17;
  disc(g, 10.8, 0xd8cdb2, pondX, 0.05, pondZ);
  disc(g, 10, C.water, pondX, 0.07, pondZ, { glassy: true });

  for (let i = 0; i < 8; i++) {
    const px = minX + 10 + (i % 3) * 20 + rng.range(-2, 2);
    const pz = minZ + 10 + Math.floor(i / 4) * 44 + rng.range(-3, 3);
    palm(g, px, pz, rng.range(6, 10), rng.range(0.9, 1.15));
  }

  // Benches face the lawn from its north-west side, away from the pond.
  bench(g, cx - 6, cz - 4, 0);
  bench(g, cx + 4, cz + 16, Math.PI);
  bench(g, cx + 14, cz + 6, Math.PI / 2);

  // The crate: one rifle, waiting where the palms shade the north lawn.
  const crateX = cx - 24;
  const crateZ = cz - 20;
  const crate = new THREE.Group();
  slab(crate, 1.6, 1.1, 1.6, 0x8a6a3f, 0, 0.55, 0);
  slab(crate, 1.7, 0.16, 1.7, 0x6f5330, 0, 1.12, 0);
  slab(crate, 0.9, 0.06, 0.9, C.beacon, 0, 1.22, 0);
  crate.position.set(crateX, 0, crateZ);
  g.add(crate);
  addCollider(W, crateX, crateZ, 1.7, 1.7, 1.3);

  city.park = { minX, maxX, minZ, maxZ, x: cx, z: cz };
  city.pickup = { x: crateX, z: crateZ, rifle: true };
}

// ---------- promenade and waterfront ----------

function buildPromenade(W, rng, city) {
  const g = new THREE.Group();
  g.name = 'promenade';
  W.scene.add(g);

  const x = CONFIG.world.sea + 9;
  for (let i = 0; i < 10; i++) {
    palm(g, x, -150 + i * 33 + rng.range(-3, 3), rng.range(8, 13), rng.range(1, 1.25));
  }
  for (let i = 0; i < 5; i++) {
    bench(g, x + 6, -120 + i * 60, -Math.PI / 2);
  }
  city.promenade = { x, minZ: -165, maxZ: 165 };
}

/** Posts and rail along the sea wall so the water edge never reads as a seam. */
function buildSeawall(W) {
  const rail = new THREE.Group();
  rail.name = 'seawall';
  const x = CONFIG.world.sea + 2;
  for (let i = 0; i < 22; i++) {
    const post = box(0.3, 1.0, 0.3, 0xf2e6cc);
    post.position.set(x, 0.5, -154 + i * 14);
    rail.add(post);
    const arm = box(0.16, 0.16, 14, 0xe9dcc4);
    arm.position.set(x, 0.9, -147 + i * 14);
    rail.add(arm);
  }
  W.scene.add(rail);
}

// ---------- named venues ----------

/** Pool-blue awning and three posts over the garage door. */
function dressGarage(g, go) {
  slab(g, go.w, 0.5, 2.2, 0x2f6bff, go.x, 3.6, go.z - go.d / 2 - 1.0);
  for (let i = 0; i < 3; i++) slab(g, 0.5, 4.4, 0.5, 0x7d8a95, 28 + i * 0.9, 2.2, -48 - i * 0.4);
}

/** Two shopfront kiosks with their own awnings, inside the mart pad. */
function dressMart(g) {
  for (const [x, z] of [[32, 32], [48, 48]]) {
    slab(g, 16, 2.2, 6, 0xf2e6cc, x, 1.1, z);
    slab(g, 12, 0.14, 8.4, 0x4f7a5e, x, 2.4, z);
  }
}

function buildVenues(W, city) {
  const g = new THREE.Group();
  g.name = 'venues';
  W.scene.add(g);

  // GLASS ORCHID: the garage where Vesper hands out work, north-east block.
  const go = padBase(g, 40, -40, 26, 12, 0xdfd5c2, 0x2f6bff);
  dressGarage(g, go);

  // VINE MART: the shop block, south-east of centre.
  const vm = padBase(g, 40, 40, 34, 10, 0xe8dfcc, 0x4f7a5e);
  dressMart(g);

  // CEDAR VIEW: hospital pad on the waterfront edge, z ~ 150, white cross on top.
  const cv = padBase(g, -150, 148, 22, 16, 0xe9f0ec, 0x2f9f7a);
  slab(g, 6, 6, 6, 0xf4f7f5, -158, 3, 152);
  slab(g, 3.4, 0.9, 0.7, 0x2f9f7a, -158, 4.4, 148.6);
  slab(g, 0.9, 3.4, 0.7, 0x2f9f7a, -158, 4.4, 148.6);

  // SABLE ROW: police station pad, x ~ -150, z ~ 100.
  const sr = padBase(g, -130, 100, 24, 14, 0xd9dde2, 0x2b3b55);
  slab(g, 4, 3.2, 4, 0xc9ced4, -138, 1.6, 104);
  slab(g, 2.4, 0.7, 0.5, C.barBlue, -138, 2.6, 101.6);

  // Taxi stand near the centre, on the promenade side of the middle.
  const ts = padBase(g, -40, 12, 16, 8, 0xf5e6b8, C.taxi);
  slab(g, 1.2, 3.2, 0.4, C.taxi, -40, 1.6, 16);

  city.markers = {
    glassOrchid: { x: go.x, z: go.z },
    vineMart: { x: vm.x, z: vm.z },
    hospital: { x: cv.x, z: cv.z },
    station: { x: sr.x, z: sr.z },
    taxiStand: { x: ts.x, z: ts.z },
  };
}

/** A soft gold column over the garage door so the mission giver reads from afar. */
function buildBeacon(W, city) {
  const m = city.markers.glassOrchid;
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 26, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: C.marker, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
  );
  beacon.position.set(m.x, 13, m.z);
  W.scene.add(beacon);
  city.beacon = beacon;
}

// ---------- spawns ----------

function buildSpawns(city) {
  city.spawns = {
    playerStart: { x: -18, z: 20 },
    carParks: [
      { x: 30, z: -22, heading: 0, kind: 'sport', color: C.sport, mission1: true, label: 'm1car' },
      { x: 52, z: -18, heading: 0, kind: 'sport', color: 0x2f6bff },
      { x: 88, z: 30, heading: Math.PI / 2, kind: 'sedan', color: C.sedan },
      { x: -40, z: 96, heading: -Math.PI / 2, kind: 'sedan', color: 0xd7d0c2 },
      { x: -44, z: 20, heading: Math.PI / 2, kind: 'taxi', color: C.taxi },
      { x: 8, z: -118, heading: Math.PI, kind: 'sport', color: C.sport },
    ],
  };
}

/** Positions are authored on an 80 m grid; scale them once to whatever pitch is live. */
function snapToGrid(city) {
  const k = CONFIG.world.pitch / 80;
  const lift = (p) => {
    p.x = Math.round(p.x * k);
    p.z = Math.round(p.z * k);
  };
  for (const key of Object.keys(city.markers)) lift(city.markers[key]);
  lift(city.spawns.playerStart);
  for (const spot of city.spawns.carParks) lift(spot);
}

// ---------- export ----------

/** Build every static piece of Solara Bay and return the city handle. */
export function buildCity(W, rng) {
  const city = {
    buildings: [],
    park: null,
    markers: {},
    spawns: null,
    pickup: null,
    lots: {},
  };

  buildBlocks(W, rng, city);
  buildPark(W, rng, city);
  buildPromenade(W, rng, city);
  buildVenues(W, city);
  buildSpawns(city);
  snapToGrid(city);
  buildSeawall(W);
  buildBeacon(W, city);

  return city;
}

/** Which building, if any, hides this point. Cover checks and minimap hits use it. */
export function buildingAt(city, x, z) {
  const list = city.buildings;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) return b;
  }
  return null;
}
