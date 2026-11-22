// Solara Bay — the built town: Meridian's glass towers, Palm Ward's low pastel
// blocks, Verde Park, the waterfront, the named places and the parking spots the
// player starts from. Every mesh of the city is made here; world.js stays bare.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { addCollider } from './world.js';

const WORLD = CONFIG.world;
const GRID = [-160, -80, 0, 80, 160];   // avenue lines on both axes
const LOT = WORLD.roadHalf + WORLD.sidewalk; // 9: block lots start at line + 9
const SEA = WORLD.sea;
const PARK = { x0: -74, x1: -6, z0: -74, z1: -6 };

// The one box + one cap geometry every building borrows; only the matrix differs.
const UNIT = new THREE.BoxGeometry(1, 1, 1);

// ------------------------------------------------------------------ districts

/** Blocks with x >= 0 belong to Meridian: tall, pale, glass and steel. */
const isMeridian = (x) => x >= 0;

/** A glass/steel tower's skin and its height, both drawn from the rng. */
function towerLook(rng) {
  const glassy = rng.chance(0.62);
  const hex = glassy ? rng.pick(C.glass) : rng.pick(C.steel);
  return { hex, height: rng.range(30, 90), glassy };
}

/** A Palm Ward house's stucco colour and its squat height. */
function wardLook(rng) {
  return { hex: rng.pick(C.stucco), height: rng.range(8, 24) };
}

// ------------------------------------------------------------------ lots

/** The square of a lot inside block (ix, iz), 68 m across, clear of kerbs. */
function lotBounds(ix, iz) {
  const x0 = GRID[ix] + LOT;
  const z0 = GRID[iz] + LOT;
  return { x0, z0, x1: GRID[ix + 1] - LOT, z1: GRID[iz + 1] - LOT };
}

/** True when the lot is Verde Park and must be left for grass. */
function isPark(ix, iz) {
  const b = lotBounds(ix, iz);
  return b.x0 >= PARK.x0 - 1 && b.x1 <= PARK.x1 + 1 && b.z0 >= PARK.z0 - 1 && b.z1 <= PARK.z1 + 1;
}

// ------------------------------------------------------------------ buildings

/** Split a lot into 2-4 plots along one axis, each at least 14 m. */
function splitLot(rng, from, to) {
  const span = to - from;
  const most = Math.min(4, Math.floor(span / 14));
  const count = Math.max(2, Math.min(most, rng.int(2, 4)));
  const cuts = [from];
  for (let i = 1; i < count; i += 1) {
    const rough = from + (span * i) / count;
    cuts.push(rough + rng.range(-3.5, 3.5));
  }
  cuts.push(to);
  cuts.sort((a, b) => a - b);
  return cuts;
}

/** One box for the body and one thin cap for the roof/trim — plus a collider. */
function raiseBuilding(W, scene, spec) {
  const { x, z, w, d, h, color, glassy, tower } = spec;
  const body = new THREE.Mesh(UNIT, material(color, { glassy }));
  body.position.set(x, h / 2, z);
  body.scale.set(w, h, d);
  body.castShadow = true;
  body.receiveShadow = true;
  scene.add(body);

  // Cap: a roof slab in the Ward, a pale cornice on the Meridian towers.
  const capHex = tower ? C.horizon : C.roof;
  const cap = new THREE.Mesh(UNIT, material(capHex));
  const capH = tower ? 1.6 : 2.2;
  cap.position.set(x, h + capH / 2, z);
  cap.scale.set(w + (tower ? 1.2 : 3), capH, d + (tower ? 1.2 : 3));
  cap.castShadow = true;
  scene.add(cap);

  // A service core on tall roofs, so the skyline is not a field of flat tops.
  if (tower && h > 46) {
    const core = new THREE.Mesh(UNIT, material(C.steel[0]));
    core.position.set(x, h + 1.6 + 2.4, z);
    core.scale.set(w * 0.42, 4.8, d * 0.42);
    core.castShadow = true;
    scene.add(core);
  }

  addCollider(W, x, z, w, d, h);
  return { x, z, w, d, h, color };
}

/** Put 2-4 buildings on every lot except the park. */
function raiseBlocks(W, scene, rng) {
  const made = [];
  for (let ix = 0; ix < 4; ix += 1) {
    for (let iz = 0; iz < 4; iz += 1) {
      if (isPark(ix, iz)) continue;
      const lot = lotBounds(ix, iz);
      const tower = isMeridian(lot.x0);
      // Plots run north-south; a tower may also split east-west for variety.
      const across = tower && rng.chance(0.45);
      const cuts = splitLot(rng, across ? lot.x0 : lot.z0, across ? lot.x1 : lot.z1);
      for (let i = 0; i < cuts.length - 1; i += 1) {
        const a = cuts[i] + (tower ? 2.5 : 3.5);
        const b = cuts[i + 1] - (tower ? 2.5 : 3.5);
        const size = Math.max(14, Math.min(30, b - a));
        const mid = (a + b) / 2;
        // The street-facing edge sits flush on the kerb line; the setback goes in.
        const look = tower ? towerLook(rng) : wardLook(rng);
        const lotW = lot.x1 - lot.x0;
        const lotD = lot.z1 - lot.z0;

        let x;
        let z;
        let w = Math.max(14, Math.min(30, lotW - rng.range(0, 5)));
        let d = Math.max(14, Math.min(30, lotD - rng.range(0, 5)));
        if (across) {
          // Split east-west: narrow in z, flush to the kerb it faces.
          x = mid;
          w = size;
          z = rng.chance(0.5) ? lot.z0 + d / 2 : lot.z1 - d / 2;
        } else {
          // Split north-south: flush to the east or west kerb.
          z = mid;
          d = size;
          x = rng.chance(0.5) ? lot.x0 + w / 2 : lot.x1 - w / 2;
        }
        made.push(raiseBuilding(W, scene, {
          x, z, w, d,
          h: look.height,
          color: look.hex,
          glassy: tower && look.glassy === true,
          tower,
        }));
      }
    }
  }
  return made;
}

// ------------------------------------------------------------------ trees and props

/** One palm: a leaning trunk and five crossed fronds — the bay's signature. */
function growPalm(scene, x, z, tall = 1) {
  const group = new THREE.Group();
  const height = 7.2 * tall;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, height, 6), material(C.trunk));
  trunk.position.y = height / 2;
  trunk.rotation.z = 0.06;
  trunk.castShadow = true;
  group.add(trunk);

  const frondGeo = new THREE.BoxGeometry(3.6, 0.09, 0.62);
  for (let i = 0; i < 5; i += 1) {
    const frond = new THREE.Mesh(frondGeo, material(C.frond));
    const spin = (i / 5) * Math.PI * 2;
    frond.position.set(Math.cos(spin) * 1.7, height - 0.2 + Math.sin(spin) * 0.2, Math.sin(spin) * 1.7);
    frond.rotation.set(0.34, -spin, -0.2);
    frond.castShadow = true;
    group.add(frond);
  }
  group.position.set(x, 0, z);
  scene.add(group);
  return group;
}

/** A park bench: seat, back and two legs, all one colour. */
function placeBench(scene, x, z, facing) {
  const group = new THREE.Group();
  const wood = material(C.roof);
  const seat = new THREE.Mesh(UNIT, wood);
  seat.scale.set(2.4, 0.18, 0.7);
  seat.position.y = 0.5;
  group.add(seat);
  const back = new THREE.Mesh(UNIT, wood);
  back.scale.set(2.4, 0.72, 0.16);
  back.position.set(0, 0.92, -0.32);
  group.add(back);
  const leg = new THREE.Mesh(UNIT, material(C.steel[0]));
  leg.scale.set(0.2, 0.5, 0.6);
  for (const side of [-1, 1]) {
    const copy = leg.clone();
    copy.position.set(side * 1.0, 0.25, 0);
    group.add(copy);
  }
  group.traverse((part) => { if (part.isMesh) { part.castShadow = true; part.receiveShadow = true; } });
  group.position.set(x, 0, z);
  group.rotation.y = facing;
  scene.add(group);
  return group;
}

/** A supply crate: a warm box on the park grass, the rifle's resting place. */
function stackCrate(scene, x, z) {
  const crate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), material(C.beacon));
  crate.position.set(x, 0.58, z);
  crate.rotation.y = 0.35;
  crate.castShadow = true;
  scene.add(crate);
  return crate;
}

// ------------------------------------------------------------------ Verde Park

function raisePark(W, scene, rng) {
  const w = PARK.x1 - PARK.x0;
  const d = PARK.z1 - PARK.z0;
  const cx = (PARK.x0 + PARK.x1) / 2;
  const cz = (PARK.z0 + PARK.z1) / 2;

  const grass = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), material(C.grass));
  grass.position.set(cx, 0.2, cz);
  grass.receiveShadow = true;
  scene.add(grass);

  // A walking loop of pale gravel round the lawn.
  const loop = material(C.sand);
  const path = new THREE.Mesh(new THREE.PlaneGeometry(w - 14, d - 14).rotateX(-Math.PI / 2), loop);
  path.position.set(cx, 0.215, cz);
  path.receiveShadow = true;
  scene.add(path);
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(w - 24, d - 24).rotateX(-Math.PI / 2), material(C.grass));
  lawn.position.set(cx, 0.225, cz);
  scene.add(lawn);

  // The pond, sunk into the north-west quadrant.
  const pondX = PARK.x0 + 18;
  const pondZ = PARK.z0 + 17;
  const pond = new THREE.Mesh(new THREE.CircleGeometry(9, 20).rotateX(-Math.PI / 2), material(C.water, { glassy: true }));
  pond.position.set(pondX, 0.24, pondZ);
  scene.add(pond);
  const rim = new THREE.Mesh(new THREE.RingGeometry(9, 9.8, 20).rotateX(-Math.PI / 2), material(C.sand));
  rim.position.set(pondX, 0.235, pondZ);
  scene.add(rim);

  // Eight palms ring the pond and the lawn edge.
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    const r = 12 + (i % 2) * 5;
    growPalm(scene, pondX + Math.cos(a) * r, pondZ + Math.sin(a) * r, 0.82 + (i % 3) * 0.1);
  }

  for (let i = 0; i < 3; i += 1) {
    placeBench(scene, cx + 14 - i * 12, cz + 16, Math.PI);
  }

  const crate = stackCrate(scene, cx + 4, cz - 10);

  return { bounds: { minX: PARK.x0, maxX: PARK.x1, minZ: PARK.z0, maxZ: PARK.z1 }, x: cx, z: cz, crate };
}

// ------------------------------------------------------------------ named places

/** A coloured awning plate over a doorway — the only signage; the map names them. */
function markPlace(W, scene, key, x, z, hex) {
  addCollider(W, x, z, 5.2, 1.5, 3.2); // the kiosk behind the canopy
  const canopy = new THREE.Mesh(UNIT, material(hex));
  canopy.scale.set(6, 0.4, 3);
  canopy.position.set(x, 3.1, z);
  canopy.castShadow = true;
  scene.add(canopy);

  const post = material(C.steel[0]);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 3.1, 6), post);
    pillar.position.set(x + side * 2.6, 1.55, z + 1.2);
    pillar.castShadow = true;
    scene.add(pillar);
  }

  // Initials live on the plate only as colour bands: three slim tiles, no text.
  for (let i = 0; i < 3; i += 1) {
    const tile = new THREE.Mesh(UNIT, material(C.horizon, { flat: true }));
    tile.scale.set(1.1, 0.9, 0.08);
    tile.position.set(x - 1.4 + i * 1.4, 3.65, z + 0.5);
    scene.add(tile);
  }

  // A glass pad on the ground, so the spot reads at a glance and on the map.
  const pad = new THREE.Mesh(new THREE.CircleGeometry(2.2, 16).rotateX(-Math.PI / 2), material(hex, { flat: true }));
  pad.position.set(x, 0.19, z + 1.9);
  scene.add(pad);

  return { key, x, z, pad, color: hex };
}

// ------------------------------------------------------------------ waterfront

function dressPromenade(scene) {
  for (let i = 0; i < 10; i += 1) {
    const z = -180 + i * 40;
    growPalm(scene, SEA - 4, z, 0.95);
    growPalm(scene, SEA - 12, z + 14, 0.8);
  }
}

// ------------------------------------------------------------------ public API

/**
 * Build every mesh and collider of Solara Bay and return the city record the rest
 * of the game reads: buildings, park, named markers, the rifle crate, spawns.
 */
export function buildCity(W, rng) {
  const scene = W.scene;
  const buildings = raiseBlocks(W, scene, rng);
  const park = raisePark(W, scene, rng);
  dressPromenade(scene);

  // Named places, each on its own pavement corner.
  const lotNorth = lotBounds(1, 1); // x 6..74, z -74..-6 — Glass Orchid's lot
  const lotWest = lotBounds(1, 2);  // x 6..74, z 6..74 — Vine Mart's lot
  const markers = {
    glassOrchid: { x: lotNorth.x0 + 10, z: lotNorth.z0 - 1.5 },
    vineMart: { x: lotWest.x0 + 10, z: lotWest.z0 - 1.5 },
    hospital: { x: -188, z: 150 },
    station: { x: -150, z: 112 },
    taxiStand: { x: -4, z: -4 },
  };
  // Signage: one awning per place, each its own canopied pad.
  const plates = [
    markPlace(W, scene, 'glassOrchid', markers.glassOrchid.x, markers.glassOrchid.z - 2.6, 0x2f6bff),
    markPlace(W, scene, 'vineMart', markers.vineMart.x, markers.vineMart.z - 2.6, 0x2c8a4a),
    markPlace(W, scene, 'hospital', markers.hospital.x, markers.hospital.z - 2.6, 0xe2492f),
    markPlace(W, scene, 'station', markers.station.x, markers.station.z - 2.6, C.coptrim),
    markPlace(W, scene, 'taxiStand', markers.taxiStand.x, markers.taxiStand.z - 2.6, C.taxi),
  ];

  const spawns = {
    playerStart: { x: markers.glassOrchid.x, z: markers.glassOrchid.z + 1.5 },
    carParks: [
      { x: -70, z: 10, heading: Math.PI / 2, kind: 'taxi', color: C.taxi },
      { x: 34, z: -14, heading: 0, kind: 'sport', color: C.sport },
      { x: 44, z: -14, heading: 0, kind: 'sedan', color: C.sedan },
      { x: -124, z: -40, heading: 0, kind: 'sedan', color: 0x6c7f92 },
      { x: 104, z: 26, heading: Math.PI, kind: 'sport', color: 0x2f6bff },
      { x: 2, z: 40, heading: Math.PI, kind: 'sport', color: 0xff7a5c, tag: 'm1car' },
    ],
  };

  // A few palms along the Ward kerbs so the streets are not bare.
  for (let i = 0; i < 6; i += 1) growPalm(scene, -152 + i * 12, -70 + (i % 2) * -8, 0.9);

  return {
    buildings,
    park,
    markers,
    pickup: { x: park.crate.position.x, z: park.crate.position.z, rifle: true },
    pier: { x: SEA + 6, z: -150 },
    plates,
    spawns,
  };
}

/** The building whose footprint holds x,z, or null when the point is open ground. */
export function buildingAt(city, x, z) {
  if (!city || !city.buildings) return null;
  for (const b of city.buildings) {
    if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) return b;
  }
  return null;
}
