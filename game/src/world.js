// The stage: renderer, sun, camera, collision and the street grid of Solara Bay.
// world.js knows nothing about people or cars — it hands out surfaces to stand
// on, walls to bump into, and a road graph to drive.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';

const HW = CONFIG.world.half;       // 200 -> city spans x,z in [-200,200]
const SEA_X = CONFIG.world.sea;     // -172 -> everything west of this is ocean
const PITCH = CONFIG.world.pitch;   // 80 -> street lines at -160..160
const ROAD_HW = CONFIG.world.roadHalf;
const WALK = CONFIG.world.sidewalk;
const GRID_X = [-160, -80, 0, 80, 160];
const GRID_Z = [-160, -80, 0, 80, 160];
const COUNT = GRID_X.length;

// Grid node index: row-major over (x column, z row).
export function id(ix, iz) {
  return iz * COUNT + ix;
}

// Nearest node coordinate on one axis.
function nearestLine(v, grid) {
  let best = grid[0];
  for (let i = 1; i < grid.length; i += 1) {
    if (Math.abs(grid[i] - v) < Math.abs(best - v)) best = grid[i];
  }
  return best;
}

function flatMesh(w, d, hex, x, y, z, flat = false) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material(hex, { flat }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

function roadGraph() {
  const nodes = [];
  for (let iz = 0; iz < COUNT; iz += 1) {
    for (let ix = 0; ix < COUNT; ix += 1) {
      nodes.push({ x: GRID_X[ix], z: GRID_Z[iz], ix, iz, neighbors: [] });
    }
  }
  for (let iz = 0; iz < COUNT; iz += 1) {
    for (let ix = 0; ix < COUNT; ix += 1) {
      const n = nodes[id(ix, iz)];
      if (ix > 0) n.neighbors.push(id(ix - 1, iz));
      if (ix < COUNT - 1) n.neighbors.push(id(ix + 1, iz));
      if (iz > 0) n.neighbors.push(id(ix, iz - 1));
      if (iz < COUNT - 1) n.neighbors.push(id(ix, iz + 1));
    }
  }
  const roads = {
    nodes,
    size: COUNT,
    pitch: PITCH,
    links: nodes.reduce((sum, n) => sum + n.neighbors.length, 0) / 2,
    // Axes sharing the node line at x,z (useful for AI lookups).
    at(x, z) {
      return { x: nearestLine(x, GRID_X), z: nearestLine(z, GRID_Z) };
    },
    nearest(x, z) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < nodes.length; i += 1) {
        const dx = nodes[i].x - x;
        const dz = nodes[i].z - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
  };
  return roads;
}

// 1 m tile strip of the seaside promenade, drawn as one merged plane with a
// second darker grid so it reads as paving from the camera.
function promenadeTiles(scene) {
  const width = SEA_X - -HW;
  const cx = (-HW + SEA_X) / 2;
  const walk = flatMesh(width, HW * 2, C.sidewalk, cx, 0.04, 0);
  scene.add(walk);

  const lineMat = material(0xb8ae9c, { flat: true });
  const group = new THREE.Group();
  for (let z = -HW; z <= HW; z += 4) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.14), lineMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(cx, 0.055, z);
    group.add(strip);
  }
  for (let x = -HW + 4; x < SEA_X; x += 4) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.14, HW * 2), lineMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(x, 0.055, 0);
    group.add(strip);
  }
  scene.add(group);

  // Low seawall between promenade and water.
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.0, HW * 2), material(0xc4b9a6));
  wall.position.set(SEA_X + 0.4, 0.5, 0);
  wall.receiveShadow = true;
  wall.castShadow = true;
  scene.add(wall);
  return wall;
}

function sea(scene) {
  const width = HW * 2;
  const ocean = flatMesh(width, HW * 2, C.water, SEA_X - width / 2, 0.01, 0);
  scene.add(ocean);
  const foam = flatMesh(6, HW * 2, 0xd7f1f6, SEA_X - 3, 0.03, 0);
  scene.add(foam);
}

function asphaltRoads(scene) {
  const asphaltMat = material(C.asphalt);
  const lineMat = material(C.roadline, { flat: true });
  const walkMat = material(C.sidewalk);

  // Full asphalt planes down every street line, both axes.
  for (let i = 0; i < COUNT; i += 1) {
    const along = GRID_X[i];
    const across = GRID_Z[i];

    const ns = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HW * 2, HW * 2), asphaltMat);
    ns.rotation.x = -Math.PI / 2;
    ns.position.set(along, 0.02, 0);
    ns.receiveShadow = true;
    scene.add(ns);

    const ew = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, ROAD_HW * 2), asphaltMat);
    ew.rotation.x = -Math.PI / 2;
    ew.position.set(0, 0.021, across);
    ew.receiveShadow = true;
    scene.add(ew);
  }

  // Dashed centre lines between intersections.
  const dashGeo = new THREE.PlaneGeometry(3, 0.36);
  const dashGeoV = new THREE.PlaneGeometry(0.36, 3);
  const dashes = new THREE.Group();
  for (let a = 0; a < COUNT; a += 1) {
    for (let b = 0; b < COUNT - 1; b += 1) {
      const a0 = GRID_X[b];
      const a1 = GRID_X[b + 1];
      const mid = (a0 + a1) / 2;
      const span = a1 - a0 - (ROAD_HW + WALK) * 2;
      const steps = Math.floor(span / 8);

      for (let s = 0; s <= steps; s += 1) {
        const offset = -span / 2 + s * 8;
        const h = new THREE.Mesh(dashGeo, lineMat);
        h.rotation.x = -Math.PI / 2;
        h.position.set(mid + offset, 0.05, GRID_Z[a]);
        dashes.add(h);

        const v = new THREE.Mesh(dashGeoV, lineMat);
        v.rotation.x = -Math.PI / 2;
        v.position.set(GRID_X[a], 0.05, mid + offset);
        dashes.add(v);
      }
    }
  }
  scene.add(dashes);

  // Sidewalk aprons around each block, and crosswalk ticks at junctions.
  const ticks = new THREE.Group();
  for (let b = 0; b < COUNT - 1; b += 1) {
    for (let c = 0; c < COUNT - 1; c += 1) {
      const x0 = GRID_X[b] + ROAD_HW;
      const x1 = GRID_X[b + 1] - ROAD_HW;
      const z0 = GRID_Z[c] + ROAD_HW;
      const z1 = GRID_Z[c + 1] - ROAD_HW;
      const w = x1 - x0;
      const d = z1 - z0;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;

      const aprons = [
        [cx, z0 + WALK / 2, w, WALK],
        [cx, z1 - WALK / 2, w, WALK],
        [x0 + WALK / 2, cz, WALK, d - WALK * 2],
        [x1 - WALK / 2, cz, WALK, d - WALK * 2],
      ];
      for (const [ax, az, aw, ad] of aprons) {
        const slab = new THREE.Mesh(new THREE.BoxGeometry(aw, 0.16, ad), walkMat);
        slab.position.set(ax, 0.08, az);
        slab.receiveShadow = true;
        scene.add(slab);
      }
    }
  }

  // Crosswalk ticks: short bars laid across each road approach to a junction.
  const tickGeo = new THREE.PlaneGeometry(0.5, 3.2);
  for (let i = 0; i < COUNT; i += 1) {
    for (let j = 0; j < COUNT; j += 1) {
      const nx = GRID_X[i];
      const nz = GRID_Z[j];
      const gap = ROAD_HW + 2.2;
      for (let k = -5; k <= 5; k += 1) {
        const off = k * 1.05;
        if (Math.abs(off) > ROAD_HW - 0.6) continue;
        const north = new THREE.Mesh(tickGeo, lineMat);
        north.rotation.x = -Math.PI / 2;
        north.position.set(nx + off, 0.052, nz + gap);
        ticks.add(north);
        const south = north.clone();
        south.position.z = nz - gap;
        ticks.add(south);
        const east = new THREE.Mesh(tickGeo, lineMat);
        east.rotation.x = -Math.PI / 2;
        east.rotation.z = Math.PI / 2;
        east.position.set(nx + gap, 0.053, nz + off);
        ticks.add(east);
        const west = east.clone();
        west.position.x = nx - gap;
        ticks.add(west);
      }
    }
  }
  scene.add(ticks);
}

function sunRig(scene) {
  const hemi = new THREE.HemisphereLight(0xb7dcff, 0xe0d2ae, 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff3d6, 1.35);
  sun.position.set(120, 165, 90);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -260;
  cam.right = 260;
  cam.top = 260;
  cam.bottom = -260;
  cam.near = 10;
  cam.far = 520;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.35;
  scene.add(sun);
  scene.add(sun.target);

  // A soft warm bounce so shaded walls keep some colour.
  const bounce = new THREE.DirectionalLight(0xffe9c9, 0.25);
  bounce.position.set(-110, 40, -80);
  scene.add(bounce);

  return { hemi, sun, bounce };
}

export function initWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(C.sky, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.sky);
  scene.fog = new THREE.Fog(C.sky, CONFIG.world.fogNear, CONFIG.world.fogFar);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);
  camera.position.set(10, 14, 90);
  camera.lookAt(-20, 4, 0);

  const W = {
    scene,
    camera,
    renderer,
    colliders: [],
    roads: roadGraph(),
    half: HW,
    lights: sunRig(scene),
    cam: { yaw: Math.PI, pitch: 0.34, dist: CONFIG.player.camDistFoot },
    time: 0,
  };

  // Sand ground beneath everything, then the layered city surfaces.
  const ground = flatMesh(HW * 2, HW * 2, C.sand, 0, 0, 0);
  scene.add(ground);

  sea(scene);
  asphaltRoads(scene);
  promenadeTiles(scene);

  const onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  window.addEventListener('resize', onResize);

  return W;
}

export function addCollider(W, x, z, w, d, h) {
  const box = {
    minX: x - w / 2,
    maxX: x + w / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2,
    h: h || 10,
  };
  W.colliders.push(box);
  return box;
}

// Circle-vs-AABB push-out. Move on each axis, resolve the overlap on whichever
// face is nearest, and report whether anything blocked.
export function resolveMove(W, px, pz, r, dx, dz) {
  let x = px + dx;
  let z = pz + dz;
  let hit = false;
  const boxes = W.colliders;

  for (let pass = 0; pass < 2; pass += 1) {
    let moved = false;
    for (let i = 0; i < boxes.length; i += 1) {
      const b = boxes[i];
      if (x + r <= b.minX || x - r >= b.maxX || z + r <= b.minZ || z - r >= b.maxZ) continue;
      moved = true;
      hit = true;

      const toLeft = x - b.minX;
      const toRight = b.maxX - x;
      const toBack = z - b.minZ;
      const toFront = b.maxZ - z;
      const min = Math.min(toLeft, toRight, toBack, toFront);

      // Slide along the shallowest axis: only the small penetration is removed.
      if (min === toLeft) x = b.minX - r;
      else if (min === toRight) x = b.maxX + r;
      else if (min === toBack) z = b.minZ - r;
      else z = b.maxZ + r;
    }
    if (!moved) break;
  }

  const lim = HW - 4;
  if (x > lim) { x = lim; hit = true; }
  if (x < SEA_X + 2) { x = SEA_X + 2; hit = true; }
  if (z > lim) { z = lim; hit = true; }
  if (z < -lim) { z = -lim; hit = true; }

  return { x, z, hit };
}

// True when a point sits on asphalt: within roadHalf of any street line and
// not inside a block apron.
export function isOnRoad(W, x, z) {
  const nx = nearestLine(x, GRID_X);
  const nz = nearestLine(z, GRID_Z);
  const onX = Math.abs(x - nx) <= ROAD_HW;
  const onZ = Math.abs(z - nz) <= ROAD_HW;
  return onX || onZ;
}

// Snap a point onto the nearest road centre line, for spawning cars and picks.
export function snapToLane(W, x, z) {
  const nx = nearestLine(x, GRID_X);
  const nz = nearestLine(z, GRID_Z);
  if (Math.abs(x - nx) <= Math.abs(z - nz)) return { x: nx, z };
  return { x, z: nz };
}

export function updateCamera(W, I, focus, dt) {
  const cam = W.cam;
  const body = CONFIG.player;
  const view = CONFIG.camera;
  const car = focus && focus.kind && !focus.onFoot;

  if (I && I.mouse) {
    const m = I.mouse();
    cam.yaw -= (m.dx || 0) * view.sensitivity;
    cam.pitch += (m.dy || 0) * view.sensitivity;
  }
  if (cam.yaw > Math.PI * 4 || cam.yaw < -Math.PI * 4) cam.yaw %= Math.PI * 2;
  cam.pitch = Math.max(view.pitchMin, Math.min(view.pitchMax, cam.pitch));

  const wantDist = car ? view.distCar : body.camDistFoot;
  const lift = car ? view.heightCar : body.camHeight;
  cam.dist += (wantDist - cam.dist) * Math.min(1, dt * 4);

  const cosP = Math.cos(cam.pitch);
  const sinP = Math.sin(cam.pitch);
  const targetX = focus.x;
  const targetY = (typeof focus.y === 'number' ? focus.y : 0) + lift * 0.55;
  const targetZ = focus.z;

  const backX = Math.sin(cam.yaw) * cosP * cam.dist;
  const backZ = Math.cos(cam.yaw) * cosP * cam.dist;
  const rise = sinP * cam.dist + lift * 0.5;

  const cam3 = W.camera;
  const k = Math.min(1, dt * view.lerp);
  cam3.position.x += (targetX + backX - cam3.position.x) * k;
  cam3.position.y += (targetY + rise - cam3.position.y) * k;
  cam3.position.z += (targetZ + backZ - cam3.position.z) * k;

  // Never let the lens dip under the pavement.
  if (cam3.position.y < 0.9) cam3.position.y = 0.9;
  cam3.lookAt(targetX, targetY, targetZ);
}

export function renderFrame(W) {
  W.renderer.render(W.scene, W.camera);
}
