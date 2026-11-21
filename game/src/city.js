// Solara Bay — the city itself: districts, towers, the park, the waterfront
// props, the named places and every parked car. All geometry lives here.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { addCollider } from './world.js';

const LAND = CONFIG.world.half;
// Block boundaries on both axes: five lines make four 80 m blocks per axis.
const LINES = [-LAND, -80, 0, 80, LAND];
const PARK = CONFIG.world.parkRect;
const SEA = CONFIG.world.sea;

// Verde Park owns the Palm Ward block beside the sea; the Garage owns the
// Meridian block north of the cross avenue.
const PARK_BLOCK = { ix: 0, iz: 2 };
const ORCHID_BLOCK = { ix: 1, iz: 0 };

function flat(x0, z0, x1, z1, y, paint) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), paint);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  mesh.receiveShadow = true;
  return mesh;
}

function block(x, z, w, d, h, y, paint) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), paint);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function rect(ix, iz) {
  return { x0: LINES[ix], x1: LINES[ix + 1], z0: LINES[iz], z1: LINES[iz + 1] };
}

function inPark(x, z, pad = 0) {
  return x > PARK.x0 - pad && x < PARK.x1 + pad && z > PARK.z1 - pad && z < PARK.z1 + pad;
}

function palm(px, pz, scale) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2 * scale, 0.33 * scale, 6.5 * scale, 6),
    material(C.trunk),
  );
  trunk.position.y = 3.25 * scale;
  trunk.castShadow = true;
  group.add(trunk);
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(3.4 * scale, 0.13, 0.85 * scale), material(C.frond));
    const a = (i / 5) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 1.5 * scale, 6.4 * scale, Math.sin(a) * 1.5 * scale);
    leaf.rotation.set(0, -a, -0.2);
    leaf.castShadow = true;
    group.add(leaf);
  }
  group.position.set(px, 0, pz);
  return group;
}

// Hundreds of cheap boxes in one draw call: roof clutter, kerb planters, lamps.
function crowd(W, points, sx, sy, sz, hex) {
  if (!points.length) return;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(sx, sy, sz), material(hex), points.length);
  const m = new THREE.Matrix4();
  points.forEach((p, i) => {
    m.identity();
    m.setPosition(p.x, p.y, p.z);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  W.scene.add(mesh);
}

function layPark(W, city, rng) {
  const cx = (PARK.x0 + PARK.x1) / 2;
  const cz = (PARK.z0 + PARK.z1) / 2;
  const wide = PARK.x1 - PARK.x0;
  const deep = PARK.z1 - PARK.z0;
  W.scene.add(flat(PARK.x0, PARK.z0, PARK.x1, PARK.z1, 0.1, material(C.grass)));

  // Hedge ring. The south edge is the block's avenue side, so it stays open.
  const hedge = material(0x4c8a45);
  W.scene.add(block(cx, PARK.z1 - 0.55, wide, 1.1, 0.9, 0.45, hedge));
  W.scene.add(block(PARK.x0 + 0.55, cz, 1.1, deep, 0.9, 0.45, hedge));
  W.scene.add(block(PARK.x1 - 0.55, cz, 1.1, deep, 0.9, 0.45, hedge));

  // Paving: north-south walk into the park, plus an east-west cross walk.
  W.scene.add(flat(cx - 2.4, PARK.z0 + 2, cx + 2.4, PARK.z1 - 2, 0.12, material(0xdbd2c0)));
  W.scene.add(flat(PARK.x0 + 2, cz - 2.4, PARK.x1 - 2, cz + 2.4, 0.12, material(0xdbd2c0)));

  // Pond in the northern quarter, with a sandy shore ring.
  const pondX = PARK.x1 - 16;
  const pondZ = PARK.z1 - 20;
  const pondR = 9.5;
  const shore = new THREE.Mesh(new THREE.CircleGeometry(pondR + 1.6, 26), material(0xd9c8a2));
  shore.rotation.x = -Math.PI / 2;
  shore.position.set(pondX, 0.115, pondZ);
  W.scene.add(shore);
  const pond = new THREE.Mesh(new THREE.CircleGeometry(pondR, 26), material(C.water));
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(pondX, 0.13, pondZ);
  W.scene.add(pond);

  const palms = [
    [PARK.x0 + 7, PARK.z1 - 8], [PARK.x0 + 21, PARK.z1 - 6], [PARK.x0 + 8, PARK.z1 - 26],
    [PARK.x0 + 25, PARK.z1 - 22], [PARK.x0 + 10, PARK.z0 + 44], [PARK.x0 + 31, PARK.z0 + 40],
    [PARK.x1 - 9, PARK.z0 + 44], [PARK.x1 - 24, PARK.z0 + 50],
  ];
  for (const [px, pz] of palms) W.scene.add(palm(px, pz, rng.range(1, 1.25)));

  const benches = [
    [pondX - 17, pondZ, Math.PI / 2],
    [pondX, pondZ - 14, 0],
    [PARK.x0 + 30, cz + 12, 0],
  ];
  for (const [bx, bz, turn] of benches) {
    const seat = block(bx, bz, 2.6, 0.7, 0.16, 0.58, material(0x9c6b45));
    seat.rotation.y = turn;
    W.scene.add(seat);
    const back = block(bx - Math.sin(turn) * 0.32, bz - Math.cos(turn) * 0.32, 2.6, 0.16, 0.6, 0.95, material(0x9c6b45));
    back.rotation.y = turn;
    W.scene.add(back);
  }

  // The rifle crate sits in the south-east corner, clear of the pond.
  const crateX = PARK.x1 - 12;
  const crateZ = cz + 16;
  W.scene.add(block(crateX, crateZ, 1.6, 1.6, 1.2, 0.7, material(0xa8804f)));
  W.scene.add(block(crateX, crateZ, 1.76, 1.76, 0.14, 1.37, material(0x8a683d)));
  addCollider(W, crateX, crateZ, 1.76, 1.76, 1.4);

  city.park = {
    x0: PARK.x0, x1: PARK.x1, z0: PARK.z0, z1: PARK.z1,
    pond: { x: pondX, z: pondZ, r: pondR },
  };
  city.pickup = { x: crateX, z: crateZ, rifle: true };
}

function raise(W, city, x, z, w, d, h, hex, glassy) {
  W.scene.add(block(x, z, w, d, h, h / 2 + 0.1, material(hex, { glassy })));
  W.scene.add(block(x, z, w + 0.6, d + 0.6, 0.6, h + 0.4, material(glassy ? C.steel[1] : C.roof)));
  if (glassy) {
    W.scene.add(block(x, z, w * 0.62, d * 0.62, 1.6, h + 1.3, material(C.steel[0])));
    if (h > 52) W.scene.add(block(x, z, 0.3, 0.3, 8, h + 5.6, material(C.steel[1])));
  } else if (h > 15) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.2, 8), material(0x6b6257));
    tank.position.set(x + w * 0.24, h + 1.7, z - d * 0.2);
    tank.castShadow = true;
    W.scene.add(tank);
  }
  addCollider(W, x, z, w, d, h);
  city.buildings.push({ x, z, w, d, h, color: hex });
}

// A footprint inside a lot, snapped to whole metres and kept whole within it.
function seat(lot, w, d, rng) {
  const lowX = lot.x0 + 2 + w / 2;
  const highX = Math.max(lowX, lot.x1 - 2 - w / 2);
  const lowZ = lot.z0 + 2 + d / 2;
  const highZ = Math.max(lowZ, lot.z1 - 2 - d / 2);
  return {
    x: Math.round(lowX + rng.range(0, highX - lowX)),
    z: Math.round(lowZ + rng.range(0, highZ - lowZ)),
  };
}

function free(city, x, z, w, d, pad) {
  for (const b of city.buildings) {
    if (Math.abs(x - b.x) < (w + b.w) / 2 + pad && Math.abs(z - b.z) < (d + b.d) / 2 + pad) return false;
  }
  const PK = city.park;
  if (x + w / 2 + pad > PK.x0 && x - w / 2 - pad < PK.x1 && z + d / 2 + pad > PK.z0 && z - d / 2 - pad < PK.z1) return false;
  return true;
}

// Lays out one block: tries a few sizes, keeps the first that clears the rest.
function fillLot(W, city, lot, meridian, rng) {

  const room = Math.min(lot.x1 - lot.x0, lot.z1 - lot.z0);
  if (room < 12) return false;
  const widest = Math.max(10, Math.min(26, lot.x1 - lot.x0 - 4));
  const deepest = Math.max(10, Math.min(26, lot.z1 - lot.z0 - 4));
  for (let tries = 0; tries < 6; tries++) {
    const w = Math.round(rng.range(Math.min(widest, meridian ? 15 : 14), widest));
    const d = Math.round(rng.range(Math.min(deepest, 13), deepest));
    const spot = seat(lot, w, d, rng);
    if (!free(city, spot.x, spot.z, w, d, 1.5)) continue;
    const h = meridian ? Math.round(rng.range(30, 90)) : Math.round(rng.range(8, 24));
    raise(W, city, spot.x, spot.z, w, d, h, rng.pick(meridian ? C.glass : C.stucco), meridian);
    return true;
  }
  return false;
}

function blocks(W, city, rng) {
  // Tall anchors first, so Meridian keeps its skyline even when lots are tight.
  const anchors = [
    { x: 16, z: -66, w: 22, d: 20, h: 88 },
    { x: 62, z: -70, w: 20, d: 18, h: 64 },
    { x: 10, z: 26, w: 18, d: 20, h: 52 },
    { x: 66, z: 62, w: 18, d: 18, h: 72 },
    { x: -70, z: 64, w: 20, d: 20, h: 22 },
    { x: -144, z: 140, w: 22, d: 18, h: 18 },
  ];
  for (const a of anchors) {
    if (free(city, a.x, a.z, a.w, a.d, 1.5)) {
      raise(W, city, a.x, a.z, a.w, a.d, a.h, rng.pick(a.x >= 0 ? C.glass : C.stucco), a.x >= 0);
    }
  }

  for (let iz = 0; iz < 4; iz++) {
    for (let ix = 0; ix < 4; ix++) {
      if (ix === PARK_BLOCK.ix && iz === PARK_BLOCK.iz) continue;
      if (ix === ORCHID_BLOCK.ix && iz === ORCHID_BLOCK.iz) continue;
      const lot = rect(ix, iz);
      const meridian = lot.x0 >= 0;
      const count = rng.int(2, 3);
      const width = (lot.x1 - lot.x0) / count;
      for (let i = 0; i < count; i++) {
        const slot = { x0: lot.x0 + i * width, x1: lot.x0 + (i + 1) * width, z0: lot.z0, z1: lot.z1 };
        fillLot(W, city, slot, meridian, rng);
      }
    }
  }
}

// Ground reserved for a named place: nothing gets built on it later.
function reserve(city, x, z, w, d, colour) {
  city.reserved.push({ x, z, w, d });
  city.buildings.push({ x, z, w, d, h: 0, color: colour, pad: true });
}

function pads(W, city) {
  // Meridian block x[0,80] z[-80,0]: the Glass Orchid garage fills its east half.
  const gar = { x0: 40, x1: 56, z0: -18, z1: -4 };
  const gx = (gar.x0 + gar.x1) / 2;
  const gz = (gar.z0 + gar.z1) / 2;
  W.scene.add(flat(gar.x0, gar.z0, gar.x1, gar.z1, 0.09, material(0x8fd8b0)));
  for (const side of [-1, 1]) {
    W.scene.add(block(gx + side * 7.6, gz, 0.6, gar.z1 - gar.z0, 5.4, 2.7, material(0xe7f5ec)));
    addCollider(W, gx + side * 7.6, gz, 0.6, gar.z1 - gar.z0, 5.4);
  }
  W.scene.add(block(gx, gz, 16.2, gar.z1 - gar.z0, 0.9, 5.6, material(0x8fd8b0)));
  reserve(city, gx, gz, gar.x1 - gar.x0, gar.z1 - gar.z0, 0x8fd8b0);
  city.places.glassOrchid = { x: gx, z: gz };
  city.markers.glassOrchid = { x: gx, z: gz, label: 'Glass Orchid' };

  // Vine Mart block x[0,80] z[0,80]: shop pad on the corner by the avenue.
  const mart = { x0: 10, x1: 26, z0: 12, z1: 20 };
  const mx = (mart.x0 + mart.x1) / 2;
  const mz = (mart.z0 + mart.z1) / 2;
  W.scene.add(flat(mart.x0, mart.z0, mart.x1, mart.z1, 0.09, material(0x74e2b6)));
  W.scene.add(block(mx, mart.z0 + 0.7, 13, 1.4, 0.3, 3.1, material(C.frond)));
  reserve(city, mx, mz, mart.x1 - mart.x0, mart.z1 - mart.z0, 0x74e2b6);
  city.places.vineMart = { x: mx, z: mz };
  city.markers.vineMart = { x: mx, z: mz, label: 'Vine Mart' };

  // Taxi stand: the kerb bay on the Meridian avenue, just south of the Vine Mart.
  const tx = 22;
  const tz = 34;
  W.scene.add(flat(tx - 6, tz - 4, tx + 6, tz + 4, 0.09, material(C.taxi)));
  W.scene.add(block(tx, tz - 4.7, 10, 1.2, 0.3, 2.9, material(C.taxi)));
  reserve(city, tx, tz, 12, 8, C.taxi);
  city.places.taxiStand = { x: tx, z: tz };
  city.markers.taxiStand = { x: tx, z: tz, label: 'Taxi stand' };
}

// Cedar View sits on the waterfront strip; Sable Row takes the north-west lot.
function landmarkPads(W, city) {
  const hx = SEA + 16;
  const hz = 150;
  W.scene.add(flat(hx - 13, hz - 9, hx + 13, hz + 9, 0.09, material(0xf2f6f9)));
  raise(W, city, hx, hz - 11, 24, 9, 17, 0xf2f6f9, false);
  city.places.hospital = { x: hx, z: hz };
  city.markers.hospital = { x: hx, z: hz, label: 'Cedar View' };

  const sx = -150;
  const sz = 100;
  W.scene.add(flat(sx - 9, sz - 7, sx + 9, sz + 7, 0.09, material(0xc7ced6)));
  raise(W, city, sx, sz - 11, 18, 10, 12, C.copbody, false);
  W.scene.add(block(sx, sz - 11, 18.3, 10.3, 1.2, 4.4, material(C.coptrim)));
  city.places.station = { x: sx, z: sz };
  city.markers.station = { x: sx, z: sz, label: 'Sable Row' };
}

function promenade(W, city) {
  // Tiled decks only at the z rows clear of the -160 road, palms beside them.
  const decks = [];
  const lamps = [];
  for (let i = 0; i < 8; i++) {
    const z = -150 + i * 42;
    const clearOfRoad = Math.abs(z + 80) > 10 && Math.abs(z) > 10 && Math.abs(z - 80) > 10;
    if (clearOfRoad) {
      W.scene.add(flat(SEA + 0.6, z - 9, SEA + 12, z + 9, 0.05, material(0xe8e0cf)));
      decks.push({ x: SEA + 10, y: 1.1, z });
    }
    lamps.push({ x: SEA + 3, y: 2.4, z });
    if (clearOfRoad) W.scene.add(palm(SEA + 6, z + 14, 1.15));
  }
  crowd(W, decks, 0.34, 2.2, 0.34, 0xcfc6b8);
  crowd(W, lamps, 0.22, 4.8, 0.22, 0x8a949c);
  city.promenade = { x0: -LAND, x1: SEA, z0: -LAND, z1: LAND };
}

function clear(W, city, x, z, pad) {
  for (const b of city.buildings) {
    if (b.h === 0) continue;
    if (Math.abs(x - b.x) < b.w / 2 + pad && Math.abs(z - b.z) < b.d / 2 + pad) return false;
  }
  return !inPark(x, z, pad);
}

function carParks(W, city) {
  const wanted = [
    { x: -20, z: -12, kind: 'sport', color: C.sport },
    { x: -28, z: -22, kind: 'sport', color: 0x4a8fd4 },
    { x: -38, z: -12, kind: 'sedan', color: C.sedan },
    { x: -44, z: -22, kind: 'sedan', color: 0xc8d4dc },
    { x: -56, z: -12, kind: 'taxi', color: C.taxi },
    { x: -60, z: -22, kind: 'sport', color: 0xe88f6f, tag: 'm1car' },
  ];
  for (const spot of wanted) {
    let place = { x: spot.x, z: spot.z };
    const open = (px, pz) => clear(W, city, px, pz, 3)
      && !city.spawns.carParks.some((c) => Math.abs(c.x - px) < 5 && Math.abs(c.z - pz) < 5);
    if (!open(place.x, place.z)) {
      search: for (let ring = 6; ring < 70; ring += 6) {
        for (let a = 0; a < 8; a++) {
          const px = spot.x + Math.cos(a * 0.785) * ring;
          const pz = spot.z + Math.sin(a * 0.785) * ring;
          if (!inPark(px, pz, 3) && open(px, pz)) { place = { x: px, z: pz }; break search; }
        }
      }
    }
    const entry = { x: place.x, z: place.z, kind: spot.kind, color: spot.color, heading: -Math.PI / 2 };
    if (spot.tag) entry.tag = spot.tag;
    city.spawns.carParks.push(entry);
    // Painted kerb bay, long axis along the avenue the car faces.
    W.scene.add(flat(place.x - 1.3, place.z - 3.2, place.x + 1.3, place.z + 3.2, 0.08, material(0xb9b2a4)));
  }
}

export function buildCity(W, rng) {
  const city = {
    buildings: [],
    reserved: [],
    places: {},
    markers: {},
    pickup: null,
    park: null,
    promenade: null,
    spawns: { carParks: [] },
  };

  layPark(W, city, rng);
  pads(W, city);
  landmarkPads(W, city);
  blocks(W, city, rng);
  promenade(W, city);

  const lamps = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      lamps.push({ x: LINES[i] + 10 + j * 19, y: 3.1, z: LINES[i] + 3.2 });
    }
  }
  crowd(W, lamps, 0.22, 4.8, 0.22, 0x8a949c);

  carParks(W, city);

  city.spawns.playerStart = { x: -40, z: -8 };
  city.districtOf = (x) => (x >= 0 ? 'Meridian' : 'Palm Ward');
  return city;
}

export function buildingAt(city, x, z) {
  for (let i = 0; i < city.buildings.length; i++) {
    const b = city.buildings[i];
    if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) return b;
  }
  return null;
}
