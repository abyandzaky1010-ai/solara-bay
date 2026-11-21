// Solara Bay — the stage: renderer, sky, sun, third-person camera, the street
// grid, the bay and the collision world. Cars, people and crime live elsewhere.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';

const GRID = [-160, -80, 0, 80, 160];
const N = GRID.length;
const RH = CONFIG.world.roadHalf;

/** Flat index of grid intersection (ix, iz) in W.roads.nodes. */
export function id(ix, iz) {
  return iz * N + ix;
}

/** Boot renderer, lights and streets; returns the world every module shares. */
export function initWorld(canvas) {
  const half = CONFIG.world.half;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.sky);
  scene.fog = new THREE.Fog(C.sky, 160, 640);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 900);
  camera.position.set(0, 34, 90);

  skyDome(scene);
  const sun = buildSun(scene);
  buildGround(scene, half);
  const roads = roadGrid(scene);

  const W = {
    scene, camera, renderer, roads, half, sun,
    colliders: [],
    time: 0,
    cam: { yaw: 0, pitch: 0.34, dist: CONFIG.player.camDistFoot, focus: new THREE.Vector3() },
  };
  window.addEventListener('resize', () => resizeWorld(W));
  return W;
}

/** Keep canvas and camera in step with the window. */
export function resizeWorld(W) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  W.camera.aspect = w / h;
  W.camera.updateProjectionMatrix();
  W.renderer.setSize(w, h, false);
}

/* ------------------------------------------------------------ light & sky */

function skyDome(scene) {
  const geo = new THREE.SphereGeometry(700, 20, 12);
  const top = new THREE.Color(C.sky);
  const low = new THREE.Color(C.horizon);
  const p = geo.attributes.position;
  const cols = [];
  for (let i = 0; i < p.count; i++) {
    const c = low.clone().lerp(top, Math.pow(Math.max(0, p.getY(i) / 700), 0.6));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  }));
  scene.add(dome);
}

function buildSun(scene) {
  scene.add(new THREE.HemisphereLight(C.sky, C.sand, 1.1));
  const sun = new THREE.DirectionalLight(C.sun, 1.8);
  sun.position.set(110, 170, 70);
  sun.castShadow = true;
  const sc = sun.shadow.camera;
  sc.left = -260; sc.right = 260; sc.top = 260; sc.bottom = -260;
  sc.near = 10; sc.far = 640;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.5;
  scene.add(sun, sun.target);
  return sun;
}

/* ---------------------------------------------------------------- ground */

function slab(hex, w, d, x, z, y, receive = true) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material(hex));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = receive;
  return m;
}

function buildGround(scene, half) {
  scene.add(slab(C.sand, half * 4, half * 4, 0, 0, 0));

  // The bay: water west of the shoreline, foam line, and a raised sea wall.
  const shore = CONFIG.world.sea;
  scene.add(slab(C.water, -400 - shore, half * 4, (shore - 400) / 2, 0, 0.06, false));
  scene.add(slab(0xdff1f4, 2.4, half * 4, shore + 1.6, 0, 0.09, false));
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, half * 4), material(0xbfb6a6));
  wall.position.set(shore + 0.4, 0.3, 0);
  wall.castShadow = wall.receiveShadow = true;
  scene.add(wall);

  // Promenade: tile strip between the sand edge and the sea wall.
  const cx = (shore - half) / 2;
  scene.add(slab(0xe4dccb, shore + half, half * 2, cx, 0, 0.05));
  const seamGeo = new THREE.PlaneGeometry(shore + half, 0.16);
  const seamMat = material(0xc2b8a4);
  for (let z = -half + 3; z < half; z += 6) {
    const s = new THREE.Mesh(seamGeo, seamMat);
    s.rotation.x = -Math.PI / 2;
    s.position.set(cx, 0.055, z);
    scene.add(s);
  }
  const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, half * 2), material(0xd8cfbd));
  kerb.position.set(-half + 0.3, 0.1, 0);
  kerb.receiveShadow = true;
  scene.add(kerb);
}

/* ------------------------------------------------------------ road grid */

function roadGrid(scene) {
  const sw = CONFIG.world.sidewalk;
  const span = GRID[N - 1] - GRID[0] + (RH + sw) * 2;
  const line = material(C.roadline);

  for (const z of GRID) scene.add(slab(C.asphalt, span, RH * 2, 0, z, 0.08));
  for (const x of GRID) scene.add(slab(C.asphalt, RH * 2, span, x, 0, 0.085));
  // Sidewalk rings around the sixteen blocks.
  for (let ix = 0; ix < N - 1; ix++) {
    for (let iz = 0; iz < N - 1; iz++) {
      const x = GRID[ix] + CONFIG.world.pitch / 2;
      const z = GRID[iz] + CONFIG.world.pitch / 2;
      scene.add(slab(C.sidewalk, CONFIG.world.pitch, CONFIG.world.pitch, x, z, 0.1));
    }
  }

  // Dashed centre lines, stopping short of each junction.
  const dashGeo = new THREE.PlaneGeometry(3.4, 0.32);
  const tickGeo = new THREE.PlaneGeometry(0.7, 2.6);
  for (let i = 0; i < N - 1; i++) {
    const a = GRID[i] + RH + 1.5;
    const b = GRID[i + 1] - RH - 1.5;
    for (let s = a; s < b - 2; s += 7) {
      for (const g of GRID) {
        const sx = new THREE.Mesh(dashGeo, line);
        sx.rotation.x = -Math.PI / 2;
        sx.position.set(s + 1.7, 0.12, g);
        const sz = new THREE.Mesh(dashGeo, line);
        sz.rotation.x = -Math.PI / 2;
        sz.rotation.z = Math.PI / 2;
        sz.position.set(g, 0.12, s + 1.7);
        scene.add(sx, sz);
      }
    }
  }

  // Crosswalk ticks on all four approaches of every junction.
  for (const x of GRID) {
    for (const z of GRID) {
      for (const side of [-1, 1]) {
        for (let t = -RH + 0.8; t <= RH - 0.8; t += 1.6) {
          const a = new THREE.Mesh(tickGeo, line);
          a.rotation.x = -Math.PI / 2;
          a.position.set(x + t, 0.13, z + side * (RH + 1.3));
          const b = new THREE.Mesh(tickGeo, line);
          b.rotation.x = -Math.PI / 2;
          b.rotation.z = Math.PI / 2;
          b.position.set(x + side * (RH + 1.3), 0.13, z + t);
          scene.add(a, b);
        }
      }
    }
  }

  // Graph: one node per intersection, orthogonal neighbours only.
  const nodes = [];
  const links = [];
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) nodes.push({ x: GRID[ix], z: GRID[iz], neighbors: [] });
  }
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const n = nodes[id(ix, iz)];
      if (ix > 0) n.neighbors.push(id(ix - 1, iz));
      if (ix < N - 1) n.neighbors.push(id(ix + 1, iz));
      if (iz > 0) n.neighbors.push(id(ix, iz - 1));
      if (iz < N - 1) n.neighbors.push(id(ix, iz + 1));
      for (const nb of n.neighbors) {
        if (nb > id(ix, iz)) links.push({ a: id(ix, iz), b: nb, len: CONFIG.world.pitch });
      }
    }
  }

  return { nodes, links, pitch: CONFIG.world.pitch, at, randomPoint };

  /** Nearest road line to a point: {axis, x, z}. */
  function at(x, z) {
    let best = null;
    let bestD = 1e9;
    for (const gx of GRID) {
      const d = Math.abs(x - gx);
      if (d < bestD) { bestD = d; best = { axis: 'z', x: gx, z }; }
    }
    for (const gz of GRID) {
      const d = Math.abs(z - gz);
      if (d < bestD) { bestD = d; best = { axis: 'x', x, z: gz }; }
    }
    return best;
  }

  /** A point partway along a random link, for traffic and peds. */
  function randomPoint(rng) {
    const a = rng.int(0, nodes.length - 1);
    const b = nodes[a].neighbors[rng.int(0, nodes[a].neighbors.length - 1)];
    const t = rng.range(0.15, 0.85);
    const na = nodes[a];
    const nb = nodes[b];
    return { x: na.x + (nb.x - na.x) * t, z: na.z + (nb.z - na.z) * t, from: a, to: b };
  }
}

/* -------------------------------------------------------------- collision */

/** Register a box obstacle {minX,maxX,minZ,maxZ,h}. */
export function addCollider(W, x, z, w, d, h) {
  const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h: h || 4 };
  W.colliders.push(c);
  return c;
}

function blocking(W, x, z, r) {
  for (const b of W.colliders) {
    if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return b;
  }
  return null;
}

function pushOut(b, x, z, r) {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  if (Math.abs(x - cx) / (b.maxX - b.minX) > Math.abs(z - cz) / (b.maxZ - b.minZ)) {
    x = x > cx ? b.maxX + r + 0.001 : b.minX - r - 0.001;
  } else {
    z = z > cz ? b.maxZ + r + 0.001 : b.minZ - r - 0.001;
  }
  return { x, z };
}

/** Move a circle from (px,pz) by (dx,dz); slides along box faces, returns hit. */
export function resolveMove(W, px, pz, r, dx, dz) {
  let x = px;
  let z = pz;
  let hit = null;
  const edge = W.half - r - 5;

  for (const [ax, az] of [[dx, 0], [0, dz]]) {
    if (!ax && !az) continue;
    const nx = Math.max(-edge, Math.min(edge, x + ax));
    const nz = Math.max(-edge, Math.min(edge, z + az));
    const b = blocking(W, nx, nz, r);
    if (!b) { x = nx; z = nz; continue; }
    hit = b;
    if (ax) x = ax > 0 ? b.minX - r - 0.001 : b.maxX + r + 0.001;
    else z = az > 0 ? b.minZ - r - 0.001 : b.maxZ + r + 0.001;
  }

  // Corner catch: the axis passes each landed the circle in a second box.
  const c = blocking(W, x, z, r);
  if (c) {
    hit = hit || c;
    const o = pushOut(c, x, z, r);
    x = o.x;
    z = o.z;
  }
  return { x, z, hit };
}

/** True on asphalt (either axis ribbon), false on walks and blocks. */
export function isOnRoad(W, x, z) {
  for (const g of GRID) if (Math.abs(x - g) <= RH || Math.abs(z - g) <= RH) return true;
  return false;
}

/** Nearest point on the road network, for spawning cars and markers. */
export function snapToLane(W, x, z) {
  const p = W && W.roads ? W.roads.at(x, z) : null;
  if (!p) return { x, z };
  const lo = GRID[0] - RH;
  const hi = GRID[N - 1] + RH;
  return p.axis === 'z'
    ? { x: Math.max(lo, Math.min(hi, p.x)), z: p.z }
    : { x: p.x, z: Math.max(lo, Math.min(hi, p.z)) };
}

/* ------------------------------------------------------------------ camera */

/** Third person orbit: mouse turns yaw/pitch, camera eases behind the focus. */
export function updateCamera(W, I, focus, dt) {
  const cam = W.cam;
  const m = I && I.mouse ? I.mouse() : { dx: 0, dy: 0, wheel: 0 };
  cam.yaw -= m.dx * 0.0026;
  cam.pitch = Math.max(-0.15, Math.min(1.1, cam.pitch + m.dy * 0.0018));
  if (m.wheel) cam.dist = Math.max(3, Math.min(11, cam.dist * (1 + m.wheel * 0.08)));

  const head = (focus.y || 0) + CONFIG.player.camHeight;
  const flat = Math.cos(cam.pitch) * cam.dist;
  const bx = focus.x + Math.sin(cam.yaw) * flat;
  const bz = focus.z + Math.cos(cam.yaw) * flat;
  const by = head + Math.sin(cam.pitch) * cam.dist + 0.9;

  // Shorten the boom if a building clips the lens.
  let shrink = 1;
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    if (blocking(W, focus.x + (bx - focus.x) * t, focus.z + (bz - focus.z) * t, 0.4)) {
      shrink = (i - 1) / 6;
      break;
    }
  }

  const k = Math.min(1, 1 - Math.pow(0.0016, dt));
  const t = cam.focus.lerp({ x: focus.x, y: head, z: focus.z }, k);
  W.camera.position.lerp({
    x: focus.x + (bx - focus.x) * shrink,
    y: head + (by - head) * shrink + 0.4 * (1 - shrink),
    z: focus.z + (bz - focus.z) * shrink,
  }, k);
  W.camera.lookAt(t.x, t.y, t.z);
}

/** Draw a frame; keeps the shadow box wrapped around the camera. */
export function renderFrame(W) {
  W.time += 0.016;
  const px = W.camera.position.x;
  const pz = W.camera.position.z;
  W.sun.position.set(px + 110, 170, pz + 70);
  W.sun.target.position.set(px, 0, pz);
  W.sun.target.updateMatrixWorld();
  W.renderer.render(W.scene, W.camera);
}
