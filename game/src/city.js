// Solara Bay — the city on the stage: towers and pastel blocks, Verde Park, the pier,
// the street furniture that tells you where you are, and the spots cars wake up in.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { addCollider } from './world.js';

const { half: HALF, sea: SEA, roadHalf: HALF_ROAD, sidewalk: WALK, parkRect: PARK } = CONFIG.world;
const DIRS = [-160, -80, 0, 80, 160];
/** Inside edge of every block: 9 m in from each avenue centre line. */
const INNER = HALF_ROAD + WALK;
const between = (a, b) => [a + INNER, b - INNER];

/** Glass downtown east of the centre, stucco west. */
export function districtAt(x) {
  return x >= 0 ? 'Meridian' : 'Palm Ward';
}

/** The building whose footprint holds (x,z), or null. */
export function buildingAt(city, x, z) {
  return city.buildings.find((b) => Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) || null;
}

// ---------------------------------------------------------------------------- props

function box(scene, x, z, w, d, h, hex, { y = 0, glassy = false, flat = false, shadow = true } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex, { glassy, flat }));
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// A palm: tapered trunk, seven fronds.
function palm(scene, x, z, tall) {
  const height = tall ? 7.5 : 5.4;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.36, height, 6), material(C.trunk));
  trunk.position.set(x, height / 2, z);
  trunk.castShadow = true;
  scene.add(trunk);
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2;
    const frond = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 0.7), material(C.frond));
    frond.position.set(x + Math.cos(a) * 1.5, height + 0.15, z + Math.sin(a) * 1.5);
    frond.rotation.set(0, -a, -0.35);
    frond.castShadow = true;
    scene.add(frond);
  }
  addCollider(scene.userData.W, x, z, 0.8, 0.8, height);
}

function bench(scene, x, z, alongZ) {
  const w = alongZ ? 0.6 : 2.2;
  box(scene, x, z, w, alongZ ? 2.2 : 0.6, 0.16, 0xa9906f, { y: 0.42 });
  box(scene, x, z, w * 0.3, alongZ ? 2 : 0.5, 0.42, 0x6d6a63, { shadow: false });
}

// ---------------------------------------------------------------------------- buildings

// Tower or stucco block: body, roof, crown, collider.
function building(scene, city, rng, x, z, w, d) {
  const tower = x >= 0;
  const h = tower ? rng.range(30, 90) : rng.range(8, 24);
  const body = rng.pick(tower ? C.glass : C.stucco);
  box(scene, x, z, w, d, h, body, { glassy: tower });
  box(scene, x, z, w + 0.6, d + 0.6, 0.7, tower ? rng.pick(C.steel) : C.roof, { y: h });
  if (tower) {
    const crown = rng.range(4, 12);
    box(scene, x, z, w * 0.55, d * 0.55, crown, rng.pick(C.steel));
    box(scene, x, z, w * 0.55, d * 0.55, 0.6, C.glass[0], { y: h + crown });
  } else {
    box(scene, x + w * 0.2, z - d * 0.2, 4, 4, 2.4, 0xf2f0e8, { y: h + 0.7 });
  }
  addCollider(scene.userData.W, x, z, w, d, h);
  city.buildings.push({ x, z, w, d, h, color: body, district: districtAt(x) });
}

// Two to four lots per block, sized by the seeded rng.
function fillBlocks(scene, city, rng) {
  for (let ix = 0; ix < 4; ix += 1) {
    for (let iz = 0; iz < 4; iz += 1) {
      const [x0, x1] = between(DIRS[ix], DIRS[ix + 1]);
      const [z0, z1] = between(DIRS[iz], DIRS[iz + 1]);
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      // Verde Park keeps its block; the seaward strip is promenade.
      if (mx > PARK.minX && mx < PARK.maxX && mz > PARK.minZ && mz < PARK.maxZ) continue;
      if (ix === 0) continue;

      if (rng.chance(0.72)) {
        const lz = rng.range(18, 24);
        for (let c = 0; c < 2; c += 1) building(scene, city, rng, x0 + (x1 - x0) / 4 + (c * (x1 - x0)) / 2, z0 + lz / 2, (x1 - x0) / 2, lz);
        if (rng.chance(0.5)) {
          const lw = rng.range(20, 26);
          for (let r = 0; r < 2; r += 1) building(scene, city, rng, x0 + lw / 2, z0 + lz + (z1 - z0 - lz) / 4 + (r * (z1 - z0 - lz)) / 2, lw, (z1 - z0 - lz) / 2);
        } else {
          const [lw, ld] = [rng.range(24, 30), z1 - z0 - lz];
          building(scene, city, rng, x0 + lw / 2, z0 + lz + ld / 2, lw, ld);
        }
      } else {
        const [lw, ld] = [rng.range(26, 32), rng.range(24, 32)];
        building(scene, city, rng, x0 + (x1 - x0) / 2, z0 + ld / 2, Math.min(lw, x1 - x0), ld);
      }
    }
  }
}

// ---------------------------------------------------------------------------- park

function buildPark(scene, city) {
  const x = (PARK.minX + PARK.maxX) / 2;
  const z = (PARK.minZ + PARK.maxZ) / 2;
  city.park = { x, z, w: PARK.maxX - PARK.minX, d: PARK.maxZ - PARK.minZ, ...PARK };
  box(scene, x, z, PARK.maxX - PARK.minX, PARK.maxZ - PARK.minZ, 0.12, C.grass, { y: 0.02, shadow: false });

  // Pond in the north-west corner, ringed in stone.
  const pond = { x: PARK.minX + 18, z: PARK.minZ + 19, r: 10 };
  const water = new THREE.Mesh(new THREE.CircleGeometry(pond.r, 24), material(C.water, { glassy: true }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(pond.x, 0.13, pond.z);
  scene.add(water);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(pond.r + 0.4, 0.45, 4, 26), material(0xbdb5a4));
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(pond.x, 0.22, pond.z);
  scene.add(rim);

  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    palm(scene, x + Math.cos(a) * 24, z + Math.sin(a) * 24, i % 2 === 0);
  }
  [[4, -8, 0], [-8, 10, 1], [14, 16, 0]].forEach(([dx, dz, zed]) => bench(scene, x + dx, z + dz, !!zed));

  // The rifle crate on the south lawn: stencilled steel with a gold lid.
  const crate = { x: x + 6, z: PARK.maxZ - 12 };
  box(scene, crate.x, crate.z, 1.6, 1.6, 1.1, 0x4c5a4e);
  box(scene, crate.x, crate.z, 1.7, 1.7, 0.14, C.marker, { y: 1.1, flat: true });
  city.pickup = { x: crate.x, z: crate.z, rifle: true };
}

// ---------------------------------------------------------------------------- places

// Named place: low pad, bright awning plate on two posts.
function signPad(scene, place, hex, awningHex) {
  box(scene, place.x, place.z, 12, 12, 0.06, 0xcfd6cf, { y: 0.09, shadow: false }); // painted pad
  box(scene, place.x, place.z - 5, 9, 2.4, 0.12, awningHex, { y: 3.4 });
  box(scene, place.x - 4, place.z - 5, 0.6, 0.6, 3.4, C.steel[0]);
  box(scene, place.x + 4, place.z - 5, 0.6, 0.6, 3.4, C.steel[0]);
  box(scene, place.x, place.z - 4.6, 9.2, 0.3, 0.9, hex, { y: 3.5, flat: true, shadow: false });
}

function buildPlaces(scene, city) {
  const giver = { x: 24, z: -12 };
  const shop = { x: 24, z: 14 };
  signPad(scene, giver, C.beacon, 0x2d3a4a);
  signPad(scene, shop, 0x9cf0c0, 0x2e4a3c);
  // Red bays inside the Orchid lockup, where the coupe has to stop.

  // Hospital: a pale pad on the seaward edge, marked with a red cross.
  const hospital = { x: -166, z: 150 };
  box(scene, hospital.x, hospital.z, 12, 16, 0.08, 0xe9eef2, { y: 0.09, shadow: false });
  box(scene, hospital.x, hospital.z - 9, 6, 1.4, 3.2, 0xf4f6f8);
  box(scene, hospital.x, hospital.z - 9, 3, 1.8, 0.5, 0xd8425a, { y: 3.3, flat: true, shadow: false });
  box(scene, hospital.x, hospital.z - 9, 0.9, 1.8, 3, 0xd8425a, { y: 3.3, flat: true, shadow: false });

  // Police station: slate building with a blue stripe on Sable Row.
  const station = { x: -150, z: 100 };
  box(scene, station.x, station.z, 14, 14, 9, 0xc9d2e0);
  box(scene, station.x, station.z - 7.2, 14.2, 0.4, 0.8, C.barBlue, { y: 4, flat: true, shadow: false });
  box(scene, station.x, station.z, 14.4, 14.4, 0.7, C.coptrim, { y: 9 });
  addCollider(scene.userData.W, station.x, station.z, 14, 14, 9);

  // Taxi stand: a yellow plate over three bays near the centre.
  const taxiStand = { x: -18, z: 20 };
  box(scene, taxiStand.x, taxiStand.z, 14, 6, 0.05, C.taxi, { y: 0.08, shadow: false });
  box(scene, taxiStand.x, taxiStand.z - 3.6, 6, 0.5, 2.6, 0x6d6a63);
  box(scene, taxiStand.x, taxiStand.z - 3.6, 6.2, 0.7, 0.8, C.taxi, { y: 2.6, flat: true, shadow: false });

  Object.assign(city, { glassOrchid: giver, vineMart: shop, hospital, station, taxiStand });
  city.markers = { glassOrchid: giver, vineMart: shop, hospital, station, taxiStand };
}

// ---------------------------------------------------------------------------- promenade

function dressPromenade(scene, city) {
  for (let i = 0; i < 10; i += 1) palm(scene, SEA - 9, -HALF + 20 + i * ((HALF * 2 - 40) / 9), i % 2 === 0);
  // Pier at the south end of the waterfront, where the last package waits.
  box(scene, SEA - 14, -150, 34, 8, 0.5, 0xa79b86, { y: 0.1 });
  box(scene, SEA - 30, -150, 1, 8, 1.4, 0xe7e2d4);
  city.pier = { x: SEA - 22, z: -150 };
}

// ---------------------------------------------------------------------------- spawns

function placeSpawns(city) {
  city.spawns = {
    playerStart: { x: 12, z: -14 }, // pavement outside the Glass Orchid
    carParks: [
      { x: 30, z: -22, heading: Math.PI / 2, kind: 'sport', color: C.sport },
      { x: 46, z: -20, heading: Math.PI / 2, kind: 'sedan', color: C.sedan },
      { x: -34, z: 30, heading: 0, kind: 'taxi', color: C.taxi },
      { x: -96, z: 22, heading: Math.PI, kind: 'sedan', color: 0x6c7f92 },
      { x: 104, z: -34, heading: 0, kind: 'sport', color: 0x2f6bff },
      { x: 96, z: 26, heading: Math.PI / 2, kind: 'sport', color: 0xff7a5c, tag: 'm1car' },
    ],
  };
}

/** Raise the whole city and hand back its map data. */
export function buildCity(W, rng) {
  W.scene.userData.W = W;
  const city = { buildings: [], park: null, markers: null, pickup: null, pier: null, spawns: null };
  fillBlocks(W.scene, city, rng);
  buildPark(W.scene, city);
  buildPlaces(W.scene, city);
  dressPromenade(W.scene, city);
  placeSpawns(city);
  return city;
}
