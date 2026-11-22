// Solara Bay — the stage: sun, renderer, third-person camera, street grid, sea, collision.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';

const { half: HALF, sea: SEA, roadHalf: HALF_ROAD, sidewalk: WALK } = CONFIG.world;

/** Avenue coordinates on both axes: five streets, sixteen blocks. */
const STREETS = [-160, -80, 0, 80, 160];
const LANES = STREETS.length;

/** Road-graph index for grid cell (ix,iz), or -1 off the map. */
export function id(ix, iz) {
  return ix < 0 || iz < 0 || ix >= LANES || iz >= LANES ? -1 : iz * LANES + ix;
}

// The street line nearest a coordinate.
function streetNear(v) {
  let best = 0;
  let gap = Infinity;
  STREETS.forEach((s, i) => Math.abs(v - s) < gap && ((gap = Math.abs(v - s)), (best = i)));
  return best;
}

// Four-way junctions wired to their orthogonal neighbours.
function buildRoadGraph() {
  const nodes = STREETS.flatMap((z) => STREETS.map((x) => ({ x, z, neighbors: [] })));
  nodes.forEach((node, i) => {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = id((i % LANES) + dx, Math.floor(i / LANES) + dz);
      if (j >= 0) node.neighbors.push(j);
    }
  });
  const links = [];
  nodes.forEach((node, i) => node.neighbors.forEach((j) => i < j && links.push([i, j])));
  return { nodes, links, at: (x, z) => nodes[id(streetNear(x), streetNear(z))] };
}

// Fixed late-morning sun, warm and low enough for long shadows.
function lightTheBay(scene) {
  scene.background = new THREE.Color(C.sky);
  scene.fog = new THREE.Fog(C.sky, 160, 640);
  scene.add(new THREE.HemisphereLight(C.horizon, C.sand, 0.85));
  // The sun sits past three-quarter so shadows lie long and warm.
  const sun = new THREE.DirectionalLight(C.sun, 1.35);
  sun.position.set(120, 190, 90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 260, bottom: -260, near: 10, far: 620 });
  sun.shadow.bias = -0.0006;
  scene.add(sun);
}

// A horizontal quad at height y.
function slab(hex, x0, z0, x1, z1, y, options) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0)), material(hex, options));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  mesh.receiveShadow = true;
  return mesh;
}

function groundAndSea(scene) {
  scene.add(slab(C.sand, -HALF, -HALF, HALF, HALF, 0)); // beach floor, bay, shallows, surf
  scene.add(slab(C.water, -620, -620, SEA, 620, -0.35, { glassy: true }));
  scene.add(slab(0x6cb6c4, SEA - 14, -HALF, SEA, HALF, -0.32));
  scene.add(slab(C.horizon, SEA, -HALF, SEA + 2.5, HALF, 0.02));
}

// Asphalt and pavement, merged into two meshes: junction squares, avenue arms, kerb bands.
function layStreets(scene) {
  const parts = { road: [], kerb: [] };
  const band = (list, w, d, x, z, y) => list.push({ w, d, x, z, y });
  const gaps = STREETS.map((s, i) => [i ? s - HALF_ROAD : -HALF, i < LANES - 1 ? STREETS[i + 1] - HALF_ROAD : HALF]);

  for (const s of STREETS) {
    band(parts.road, HALF_ROAD * 2, HALF * 2, s, 0, 0.04);
    band(parts.road, HALF * 2, HALF_ROAD * 2, 0, s, 0.04);
    for (const side of [-1, 1]) {
      for (const [a, b] of gaps) {
        const mid = (a + b) / 2;
        band(parts.kerb, WALK, b - a, s + side * (HALF_ROAD + WALK / 2), mid, 0.06);
        band(parts.kerb, b - a, WALK, mid, s + side * (HALF_ROAD + WALK / 2), 0.06);
      }
    }
  }

  // Centre dashes and zebra ticks share one instanced paint mesh.
  const paint = [];
  for (const s of STREETS) {
    for (let i = 0; i < LANES - 1; i += 1) {
      for (let v = STREETS[i] + HALF_ROAD + 6; v < STREETS[i + 1] - HALF_ROAD - 6; v += 9) {
        paint.push([0.45, 4, s, v]);
        paint.push([4, 0.45, v, s]);
      }
    }
  }
  for (const nx of STREETS) {
    for (const nz of STREETS) {
      for (let o = -HALF_ROAD + 1; o <= HALF_ROAD - 1; o += 1.7) {
        for (const side of [-1, 1]) {
          paint.push([0.8, 2.4, nx + o, nz + side * (HALF_ROAD + 1.6)]);
          paint.push([2.4, 0.8, nx + side * (HALF_ROAD + 1.6), nz + o]);
        }
      }
    }
  }

  const merge = (list, hex) => {
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material(hex, { flat: hex === C.roadline }), list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    list.forEach((p, i) => m.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.w, p.d, 1)) && mesh.setMatrixAt(i, m));
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  merge(parts.road, C.asphalt);
  merge(parts.kerb, C.sidewalk);
  merge(paint.map(([w, d, x, z]) => ({ w, d, x, z, y: 0.08 })), C.roadline);
}

function buildPromenade(scene) {
  scene.add(slab(C.sidewalk, -HALF, -HALF, SEA, HALF, 0.07));
  for (let z = -HALF; z <= HALF; z += 8) scene.add(slab(0xbcb2a2, -HALF, z, SEA, z + 0.25, 0.075));
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, HALF * 2), material(0xd9d2c4));
  wall.position.set(SEA + 0.6, 0.55, 0);
  scene.add(wall);
}

/** A solid box: x/z centre, w/d footprint, h height. */
export function addCollider(W, x, z, w, d, h) {
  const box = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h: h || 0 };
  W.colliders.push(box);
  return box;
}

// Shove a circle out of each box it has sunk into, along the shallowest face.
function pushOut(W, x, z, r) {
  let hit = false;
  for (const b of W.colliders) {
    const ox = Math.min(x + r, b.maxX) - Math.max(x - r, b.minX);
    const oz = Math.min(z + r, b.maxZ) - Math.max(z - r, b.minZ);
    if (ox <= 0 || oz <= 0) continue;
    if (ox < oz) {
      const l = b.minX - r - x;
      const rt = b.maxX + r - x;
      x += Math.abs(l) < Math.abs(rt) ? l : rt;
    } else {
      const t = b.minZ - r - z;
      const bt = b.maxZ + r - z;
      z += Math.abs(t) < Math.abs(bt) ? t : bt;
    }
    hit = true;
  }
  return { x, z, hit };
}

/** Move a circle by (dx,dz): both axes, else one axis to slide along a wall; ends outside every box. */
export function resolveMove(W, px, pz, r, dx, dz) {
  const solid = (x, z) => W.colliders.some((b) => x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ);
  let x = px;
  let z = pz;
  let hit = false;
  if (!solid(px + dx, pz + dz)) {
    x = px + dx;
    z = pz + dz;
  } else if (!solid(px + dx, pz)) {
    x = px + dx;
    hit = true;
  } else {
    z = solid(px, pz + dz) ? pz : pz + dz;
    hit = true;
  }
  const fixed = pushOut(W, x, z, r);
  return { x: fixed.x, z: fixed.z, hit: hit || fixed.hit };
}

/** True when a point lies on asphalt. */
export function isOnRoad(W, x, z) {
  return STREETS.some((s) => (Math.abs(x - s) <= HALF_ROAD && Math.abs(z) <= HALF) || (Math.abs(z - s) <= HALF_ROAD && Math.abs(x) <= HALF));
}

/** The nearest avenue centre line, for spawning and parking cars. */
export function snapToLane(W, x, z) {
  const ix = streetNear(x);
  const iz = streetNear(z);
  const clamp = (v) => Math.max(-HALF + HALF_ROAD, Math.min(HALF - HALF_ROAD, v));
  if (Math.abs(x - STREETS[ix]) <= Math.abs(z - STREETS[iz])) return { x: STREETS[ix], z: clamp(z), alongZ: true };
  return { x: clamp(x), z: STREETS[iz], alongZ: false };
}

/** Build the bay and return the shared world object. */
export function initWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.3, 1400);

  lightTheBay(scene);
  groundAndSea(scene);
  layStreets(scene);
  buildPromenade(scene);

  const W = {
    scene,
    camera,
    renderer,
    colliders: [],
    roads: buildRoadGraph(),
    half: HALF,
    sea: SEA,
    camPos: new THREE.Vector3(0, 12, 30),
    yaw: Math.PI,
    pitch: 0.32,
    look: new THREE.Vector3(0, 1.5, 0),
  };

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  return W;
}

/** Third person: mouse yaw/pitch, camera easing to a slot behind the focus, looking at it. */
export function updateCamera(W, I, focus, dt) {
  if (I && I.locked) {
    const m = I.mouse();
    W.yaw -= m.dx * 0.0026;
    W.pitch += m.dy * 0.0022;
  }

  const f = focus || { x: 0, z: 0, y: 1.6, dist: CONFIG.player.camDistFoot };
  W.pitch = Math.max(-0.15, Math.min(1.1, W.pitch));
  const reach = (f.dist || CONFIG.player.camDistFoot) * Math.cos(W.pitch);
  const ease = Math.min(1, dt * 9);
  const tx = f.x + Math.sin(W.yaw) * reach;
  const tz = f.z + Math.cos(W.yaw) * reach;
  const ty = Math.max(1.1, f.y + reach * Math.tan(W.pitch) + 2);

  W.camPos.x += (tx - W.camPos.x) * ease;
  W.camPos.y += (ty - W.camPos.y) * ease;
  W.camPos.z += (tz - W.camPos.z) * ease;
  W.look.x += (f.x - W.look.x) * ease;
  W.look.y += (f.y + 0.9 - W.look.y) * ease;
  W.look.z += (f.z - W.look.z) * ease;

  W.camera.position.copy(W.camPos);
  W.camera.lookAt(W.look);
}

/** Draw one frame. */
export function renderFrame(W) {
  W.renderer.render(W.scene, W.camera);
}
