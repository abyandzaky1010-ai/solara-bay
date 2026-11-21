// Solara Bay: buildings, districts, Verde Park, waterfront palms, named places, car parks.
// Every piece of the city's geometry is built here; world.js owns only streets and ground.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { addCollider } from './world.js';

const AVENUES = [-160, -80, 0, 80, 160];
const PARK = CONFIG.world.parkRect;
const BLOCK_EDGE = CONFIG.world.blockUsable / 2 - 1.5;
const SIDEWALK_MID = CONFIG.world.roadHalf + CONFIG.world.sidewalk / 2;
const PLATE_TINT = { glassOrchid: 0x9fd8ff, vineMart: 0x6fae5e, hospital: 0xeef2f5, station: 0x2b3b55, taxiStand: 0xf7c948 };

function boxMesh(w, h, d, hex, opts) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex, opts));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Stand a mesh on the ground (or at a given y) and add it to the scene.
function place(W, mesh, x, z, y) {
  mesh.position.set(x, y === undefined ? mesh.geometry.parameters.height / 2 : y, z);
  W.scene.add(mesh);
  return mesh;
}

// A flat coloured panel on the ground.
function slab(W, hex, x, z, w, d, y, opts) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), material(hex, opts));
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  W.scene.add(mesh);
  return mesh;
}

// Split a block frontage into 2-4 non-overlapping slots.
function partition(rng, min, max) {
  const count = rng.int(2, 4);
  const weights = [];
  for (let i = 0; i < count; i += 1) weights.push(rng.range(0.7, 1.3));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = max - min;
  const slots = [];
  let cursor = min;
  weights.forEach((weight, i) => {
    const size = (span * weight) / total;
    slots.push({ mid: cursor + size / 2, size, north: i % 2 === 0 });
    cursor += size;
  });
  return slots;
}

// Commercial blocks. Meridian (x >= 0) grows glass and steel towers; Palm Ward stays low.
function buildBlock(W, rng, city, cx, cz) {
  const meridian = cx >= 0;
  for (const slot of partition(rng, -BLOCK_EDGE, BLOCK_EDGE)) {
    const w = rng.range(14, Math.min(30, slot.size));
    const d = rng.range(14, Math.min(30, slot.size));
    const x = cx + slot.mid;
    const z = cz + (slot.north ? -1 : 1) * rng.range(4, BLOCK_EDGE - 15);
    const h = meridian ? rng.range(30, 90) : rng.range(8, 24);
    const hex = meridian ? rng.pick([...C.glass, ...C.steel]) : rng.pick(C.stucco);

    place(W, boxMesh(w, h, d, hex, { glassy: meridian }), x, z);
    // Roof cap with a little overhang: the sunlit slab every flat roof in this city has.
    place(W, boxMesh(w + 1, 1.1, d + 1, meridian ? C.steel[0] : C.roof), x, z, h + 0.55);
    if (meridian) {
      const crown = rng.range(2, 8);
      place(W, boxMesh(w * 0.5, crown, d * 0.5, hex, { glassy: true }), x, z, h + crown / 2 + 1);
    } else {
      // Stucco shops get a tinted shopfront band at street level.
      place(W, boxMesh(w + 0.3, 2.6, d + 0.3, C.glass[0], { glassy: true }), x, z, 1.3);
    }
    addCollider(W, x, z, w, d, h);
    city.buildings.push({ x, z, w, d, h, color: hex, district: meridian ? 'meridian' : 'palm' });
  }
}

function palm(W, x, z, rng) {
  const s = rng.range(0.9, 1.3);
  const trunkH = 7 * s;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.42, trunkH, 6), material(C.trunk));
  trunk.position.set(x, trunkH / 2, z);
  trunk.rotation.z = rng.range(-0.07, 0.07);
  trunk.castShadow = true;
  W.scene.add(trunk);
  for (let i = 0; i < 5; i += 1) {
    const a = i * 1.2566;
    const frond = boxMesh(4.4 * s, 0.12, 1.2 * s, C.frond);
    frond.position.set(x + Math.cos(a) * 1.9 * s, trunkH + 0.1, z + Math.sin(a) * 1.9 * s);
    frond.rotation.set(0, a, -0.28);
    W.scene.add(frond);
  }
  addCollider(W, x, z, 0.9, 0.9, trunkH);
}

function bench(W, x, z, rot) {
  const group = new THREE.Group();
  const seat = boxMesh(3.2, 0.22, 0.8, C.roof);
  seat.position.y = 0.55;
  const back = boxMesh(3.2, 0.7, 0.16, C.roof);
  back.position.set(0, 0.95, -0.35);
  group.add(seat, back);
  for (const side of [-1.2, 1.2]) {
    const leg = boxMesh(0.2, 0.55, 0.7, C.trunk);
    leg.position.set(side, 0.27, 0);
    group.add(leg);
  }
  group.position.set(x, 0, z);
  group.rotation.y = rot;
  W.scene.add(group);
  addCollider(W, x, z, 3.2, 0.9, 1.1);
}

// Verde Park: grass, paths, pond, palms, benches, and the crate that holds the rifle.
function buildPark(W, rng, city) {
  const cx = (PARK.minX + PARK.maxX) / 2;
  const cz = (PARK.minZ + PARK.maxZ) / 2;
  const w = PARK.maxX - PARK.minX;
  const d = PARK.maxZ - PARK.minZ;
  city.park = { ...PARK, x: cx, z: cz };

  slab(W, C.grass, cx, cz, w, d, 0.03);
  slab(W, C.sand, cx, cz, 5, d, 0.04);
  slab(W, C.sand, cx, cz, w, 5, 0.04);

  const pond = new THREE.Mesh(new THREE.CircleGeometry(9, 24).rotateX(-Math.PI / 2), material(C.water, { glassy: true }));
  pond.position.set(cx + 14, 0.045, cz + 13);
  W.scene.add(pond);

  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2 + 0.35;
    palm(W, cx + Math.cos(a) * 26, cz + Math.sin(a) * 26, rng);
  }
  bench(W, cx - 9, cz - 2, Math.PI / 2);
  bench(W, cx + 2, cz + 9, 0);
  bench(W, cx - 2, cz - 12, 0);

  const crateX = cx + 21;
  const crateZ = cz - 21;
  place(W, boxMesh(2, 1.4, 2, C.trunk), crateX, crateZ);
  place(W, boxMesh(2.2, 0.3, 2.2, C.marker), crateX, crateZ, 1.55);
  addCollider(W, crateX, crateZ, 2, 2, 1.4);
  city.pickup = { x: crateX, z: crateZ, rifle: true };
}

function buildPromenade(W, rng) {
  const { half, sea } = CONFIG.world;
  for (let i = 0; i < 10; i += 1) {
    palm(W, sea + 12 + (i % 2) * 6, -half + 22 + i * ((half * 2 - 44) / 9), rng);
  }
}

// A flat pad plus a tinted awning plate; the HUD and minimap carry the names.
function signPad(W, key, x, z, w, d, posts) {
  slab(W, C.sidewalk, x, z, w, d, 0.14);
  place(W, boxMesh(w * 0.66, 0.6, d * 0.36, PLATE_TINT[key]), x, z, 3.5);
  place(W, boxMesh(w * 0.82, 0.25, d * 0.6, PLATE_TINT[key]), x, z, 2.9);
  if (!posts) return;
  for (const side of [-1, 1]) {
    place(W, boxMesh(0.3, 3.5, 0.3, C.steel[0]), x + side * w * 0.33, z + side * d * 0.24);
  }
}

function buildPlaces(W, city) {
  const m = city.markers;
  // GLASS ORCHID garage, block x [6,74] z [-74,-6], door on the south avenue.
  Object.assign(m.glassOrchid, { x: 40, z: -22 });
  signPad(W, 'glassOrchid', 40, -22, 20, 16, true);
  // VINE MART, block x [6,74] z [6,74].
  Object.assign(m.vineMart, { x: 40, z: 22 });
  signPad(W, 'vineMart', 40, 22, 18, 14, true);
  // CEDAR VIEW hospital on the west edge near z = 150.
  Object.assign(m.hospital, { x: -138, z: 150 });
  signPad(W, 'hospital', -138, 150, 20, 16, true);
  place(W, boxMesh(20, 18, 18, C.steel[1]), -160, 150);
  addCollider(W, -160, 150, 20, 18, 18);
  // SABLE ROW police station near x = -150, z = 100.
  Object.assign(m.station, { x: -152, z: 100 });
  signPad(W, 'station', -152, 100, 16, 12, true);
  place(W, boxMesh(16, 9, 14, C.coptrim), -128, 100);
  place(W, boxMesh(16.4, 0.8, 14.4, C.copbody), -128, 100, 9.4);
  addCollider(W, -128, 100, 16, 14, 9);
  // Taxi stand at the heart of town.
  Object.assign(m.taxiStand, { x: SIDEWALK_MID + 2, z: 26 });
  signPad(W, 'taxiStand', SIDEWALK_MID + 2, 26, 8, 8, false);
}

export function buildCity(W, rng) {
  const city = {
    buildings: [],
    park: null,
    markers: { glassOrchid: {}, vineMart: {}, hospital: {}, station: {}, taxiStand: {} },
    spawns: {
      playerStart: { x: -20, z: -18 },
      carParks: [
        { x: 44, z: -34, kind: 'sport', color: C.sport, tag: 'm1car' },
        { x: 14, z: 42, kind: 'sport', color: C.sport },
        { x: -40, z: 44, kind: 'sedan', color: C.sedan },
        { x: 46, z: 60, kind: 'sedan', color: C.sedan },
        { x: SIDEWALK_MID + 2, z: 30, kind: 'taxi', color: C.taxi },
        { x: -18, z: 96, kind: 'sport', color: C.sport },
      ],
    },
    pickup: null,
  };
  for (let ix = 0; ix < 4; ix += 1) {
    for (let iz = 0; iz < 4; iz += 1) {
      // Verde Park is exactly the block x,z in [-74,-6], i.e. the [-80,0] interval on both axes.
      if (ix === 1 || iz === 1) continue;
      buildBlock(W, rng, city, (AVENUES[ix] + AVENUES[ix + 1]) / 2, (AVENUES[iz] + AVENUES[iz + 1]) / 2);
    }
  }
  buildPark(W, rng, city);
  buildPromenade(W, rng);
  buildPlaces(W, city);
  return city;
}

// Which building, if any, covers this point.
export function buildingAt(city, x, z) {
  return city.buildings.find((b) => Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) || null;
}
