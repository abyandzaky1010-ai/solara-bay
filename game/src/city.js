// Solara Bay — everything standing on the ground: the tower district, the
// pastel ward, Verde Park, the promenade palms, the named places, the pickup
// crate and the parked cars. One seed in, one city out.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { addCollider, snapToLane } from './world.js';

const GRID = [-160, -80, 0, 80, 160];
const RH = CONFIG.world.roadHalf;
const INNER = 32; // half-size of a block's flat pad between the sidewalks

/** Build the whole urban set and return the city record other modules read. */
export function buildCity(W, rng) {
  const city = {
    group: new THREE.Group(),
    buildings: [],
    park: { ...CONFIG.world.parkRect, cx: -40, cz: -40, pond: { x: -40, z: -40, r: 12 } },
    markers: {},
    spawns: { playerStart: { x: 0, z: 8 }, carParks: [] },
    pickup: null,
    shops: {},
  };
  city.group.name = 'city';
  W.scene.add(city.group);

  layBlocks(city, W, rng);
  buildVerdePark(city, rng);
  dressPromenade(city, rng);
  placeNamedPlaces(city, rng);
  placeSpawns(city, W, rng);

  return city;
}

/* ------------------------------------------------------------------ blocks */

function isParkBlock(x, z) {
  const p = CONFIG.world.parkRect;
  return x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ;
}

function layBlocks(city, W, rng) {
  for (let bi = 0; bi < GRID.length - 1; bi++) {
    for (let bj = 0; bj < GRID.length - 1; bj++) {
      const bx = GRID[bi] + CONFIG.world.pitch / 2;
      const bz = GRID[bj] + CONFIG.world.pitch / 2;
      if (isParkBlock(bx, bz)) continue;
      const meridian = bx >= 0;
      const count = rng.int(2, 4);
      const lots = splitLot(count, rng);

      let cursor = -INNER;
      for (const lotW of lots) {
        const lotD = rng.range(lotW * 0.85, Math.min(lotW * 1.35, INNER));
        const x = bx + cursor + lotW / 2 + 0.6;
        const z = bz + rng.range(-1, 1) + (lotD < INNER ? rng.range(-3, 3) : 0);
        cursor += lotW + 1.2;
        addBuilding(city, W, x, z, lotW - 1.4, lotD, meridian, rng);
      }
    }
  }
}

/** Split a block into 2-4 lot widths that sum to the usable span. */
function splitLot(count, rng) {
  const span = INNER * 2;
  const raw = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const v = rng.range(0.7, 1.3);
    raw.push(v);
    total += v;
  }
  return raw.map((v) => Math.max(13, Math.min(30, (v / total) * span)));
}

function addBuilding(city, W, x, z, w, d, meridian, rng) {
  const height = meridian ? rng.range(30, 90) : rng.range(8, 24);
  const color = meridian ? rng.pick(C.glass) : rng.pick(C.stucco);
  const glassy = meridian;

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), material(color, { glassy }));
  body.position.set(x, height / 2, z);
  body.castShadow = true;
  body.receiveShadow = true;
  body.name = meridian ? 'tower' : 'stuccoBlock';
  city.group.add(body);

  // One roof slab: flat and pale downtown, warm terracotta low in the ward.
  const roofH = meridian ? 1.1 : 0.8;
  const roofColor = meridian ? C.steel[1] : C.roof;
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(w + 1.2, roofH, d + 1.2),
    material(roofColor),
  );
  roof.position.set(x, height + roofH / 2, z);
  roof.castShadow = true;
  city.group.add(roof);

  // A single banded cap on tall towers gives the skyline some rhythm cheaply.
  if (meridian && height > 55) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, 3, d * 0.72), material(C.steel[0]));
    band.position.set(x, height + 2.4, z);
    band.castShadow = true;
    city.group.add(band);
  }

  addCollider(W, x, z, w, d, height);
  city.buildings.push({ x, z, w, d, h: height, color });
}

/* ------------------------------------------------------------ Verde Park */

function buildVerdePark(city, rng) {
  const P = city.park;
  const size = CONFIG.world.blockUsable;

  const grass = flat(C.grass, size, size, P.cx, P.cz, 0.14);
  grass.name = 'verdeParkGrass';
  city.group.add(grass);

  const path = flat(0xdccfae, size, 4, P.cx, P.cz + 18, 0.17);
  city.group.add(path);

  const pond = new THREE.Mesh(new THREE.CircleGeometry(P.pond.r, 28), material(C.water));
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(P.pond.x, 0.18, P.pond.z);
  city.group.add(pond);

  const rim = new THREE.Mesh(new THREE.RingGeometry(P.pond.r, P.pond.r + 1.2, 28), material(0xcbbf9f));
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(P.pond.x, 0.19, P.pond.z);
  city.group.add(rim);

  // Eight palms ringing the pond, phone-booth thin and leaning with the wind.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    const r = P.pond.r + 5.5;
    palm(city, P.pond.x + Math.cos(a) * r, P.pond.z + Math.sin(a) * r, rng.range(0.85, 1.2), a);
  }

  // Three benches facing the water.
  for (let i = 0; i < 3; i++) {
    const a = -0.9 + i * 0.85;
    bench(city, P.pond.x + Math.cos(a) * 16, P.pond.z + Math.sin(a) * 16, -a);
  }

  // The rifle crate by the north path, with a gold lid line to catch the sun.
  const cx = P.cx + 14;
  const cz = P.cz + 12;
  const crate = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.1), material(0x6b4f35));
  crate.position.set(cx, 0.7, cz);
  crate.castShadow = true;
  city.group.add(crate);
  const lidTrim = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 1.2), material(C.beacon, { flat: true }));
  lidTrim.position.set(cx, 1.28, cz);
  city.group.add(lidTrim);
  city.pickup = { x: cx, z: cz, rifle: true };

  // A low hedge closes the park on the two street sides, with corner gaps so
  // the whole square never becomes a cage.
  const hedgeLen = size - 10;
  for (let i = -1; i <= 1; i += 2) {
    const hedgeA = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, hedgeLen), material(0x4d8f47));
    hedgeA.position.set(P.cx + i * (size / 2 - 0.8), 0.55, P.cz);
    hedgeA.castShadow = true;
    city.group.add(hedgeA);
    const hedgeB = new THREE.Mesh(new THREE.BoxGeometry(hedgeLen, 1.1, 0.9), material(0x4d8f47));
    hedgeB.position.set(P.cx, 0.55, P.cz + i * (size / 2 - 0.8));
    hedgeB.castShadow = true;
    city.group.add(hedgeB);
  }
}

/* -------------------------------------------------------------- promenade */

function dressPromenade(city, rng) {
  const x = -186;
  for (let i = 0; i < 10; i++) {
    const z = -180 + i * 40 + rng.range(-4, 4);
    palm(city, x + rng.range(-2, 2), z, rng.range(1.0, 1.35), rng.range(-0.4, 0.4));
  }
  // Driftwood benches on the sand side, facing the sea.
  for (let i = 0; i < 4; i++) {
    bench(city, -196, -120 + i * 80, Math.PI / 2);
  }
}

/* ---------------------------------------------------------- named places */

function placeNamedPlaces(city, rng) {
  const mk = city.markers;

  mk.glassOrchid = pad(city, 32, -30, 0x2f4a44, C.beacon, 9, 7);
  mk.vineMart = pad(city, 30, 30, 0x6b4a7a, 0xffd0e0, 8, 6);
  mk.hospital = pad(city, -178, 150, 0xe8f4ff, 0x4d8dff, 10, 8);
  mk.station = pad(city, -150, 100, 0x2b3b55, C.barBlue, 10, 8);
  mk.taxiStand = pad(city, -8, 2, C.taxi, 0x3a3f46, 7, 5);

  city.shops.vineMart = { x: mk.vineMart.x, z: mk.vineMart.z };
  void rng;
}

/** Flat named pad: slab, awning plate on two posts, no interior. */
function pad(city, x, z, slabHex, plateHex, w, d) {
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.28, d), material(slabHex));
  slab.position.set(x, 0.2, z);
  slab.receiveShadow = true;
  city.group.add(slab);

  const plate = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 1.5, 0.5), material(plateHex, { flat: true }));
  plate.position.set(x, 3.4, z - d / 2 + 0.6);
  city.group.add(plate);

  for (let i = -1; i <= 1; i += 2) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.2, 0.28), material(0x6a6f77));
    post.position.set(x + (i * w) / 2.6, 1.8, z - d / 2 + 0.6);
    post.castShadow = true;
    city.group.add(post);
  }
  return { x, z, w, d };
}

/* ------------------------------------------------------------------ spawns */

function placeSpawns(city, W, rng) {
  city.spawns.playerStart = { x: 0, z: 8 };

  const parks = [
    { x: 22, z: 2, kind: 'sport', color: C.sport, tag: 'm1car' },
    { x: -70, z: 2, kind: 'sport', color: 0x3f6f9f, tag: null },
    { x: 6, z: 40, kind: 'sedan', color: C.sedan, tag: null },
    { x: -46, z: 40, kind: 'sedan', color: 0xb9a37c, tag: null },
    { x: -8, z: -4, kind: 'taxi', color: C.taxi, tag: null },
    { x: 40, z: 70, kind: 'sport', color: 0x8a5fa8, tag: null },
  ];

  for (const p of parks) {
    const s = snapToLane(W, p.x, p.z);
    const heading = Math.abs(s.x - p.x) > 2 ? 0 : Math.PI / 2;
    city.spawns.carParks.push({
      x: s.x,
      z: s.z,
      heading,
      kind: p.kind,
      color: p.color,
      tag: p.tag,
      // Re-roll the jitter a little so repeat seeds never share a spot exactly.
      trim: rng.chance(0.5) ? 1 : 0,
    });
  }
}

/* ------------------------------------------------------------------- props */

function flat(hex, w, d, x, z, y) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material(hex));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  return mesh;
}

/** Trunk cylinder plus five frond boxes fanned around the top. */
function palm(city, x, z, scale = 1, lean = 0) {
  const g = new THREE.Group();
  const h = 7 * scale;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * scale, 0.42 * scale, h, 6), material(C.trunk));
  trunk.position.y = h / 2;
  trunk.castShadow = true;
  g.add(trunk);

  for (let i = 0; i < 5; i++) {
    const frond = new THREE.Mesh(new THREE.BoxGeometry(4.4 * scale, 0.14, 0.75 * scale), material(C.frond));
    const a = (i / 5) * Math.PI * 2 + lean;
    frond.position.set(Math.cos(a) * 1.9 * scale, h + 0.2 - i * 0.05, Math.sin(a) * 1.9 * scale);
    frond.rotation.y = -a;
    frond.rotation.z = 0.28;
    frond.castShadow = true;
    g.add(frond);
  }
  g.position.set(x, 0, z);
  g.rotation.z = lean * 0.08;
  city.group.add(g);
  return g;
}

function bench(city, x, z, heading) {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.7), material(0xa8805a));
  seat.position.y = 0.55;
  seat.castShadow = true;
  g.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.14), material(0xa8805a));
  back.position.set(0, 0.85, -0.32);
  g.add(back);
  for (const s of [-0.9, 0.9]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.6), material(0x5a5f66));
    leg.position.set(s, 0.28, 0);
    g.add(leg);
  }
  g.position.set(x, 0, z);
  g.rotation.y = heading;
  city.group.add(g);
  return g;
}

/* ----------------------------------------------------------------- helpers */

/** First building whose footprint contains the point, or null. */
export function buildingAt(city, x, z) {
  for (let i = 0; i < city.buildings.length; i++) {
    const b = city.buildings[i];
    if (x >= b.x - b.w / 2 && x <= b.x + b.w / 2 && z >= b.z - b.d / 2 && z <= b.z + b.d / 2) return b;
  }
  return null;
}
