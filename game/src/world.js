// Solara Bay stage: renderer, sun, third-person camera, street grid, sea, AABB collision.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';

const PITCH = CONFIG.world.pitch;
const AXIS = 5;
const HALF_ROAD = CONFIG.world.roadHalf;
const WALK = CONFIG.world.sidewalk;
const LIMIT = CONFIG.world.half - 3;
const SHORE = CONFIG.world.sea + 1.2;
const STRIPE = material(C.roadline);
const SQUARE = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

// Lattice index on the 5x5 intersection grid.
export const id = (ix, iz) => iz * AXIS + ix;

function coord(i) {
  return (i - 2) * PITCH;
}

function axisIndex(v) {
  const i = Math.round(v / PITCH) + 2;
  return i >= 0 && i < AXIS && Math.abs(coord(i) - v) < 0.5 ? i : -1;
}

// Avenues at {-160,-80,0,80,160} on both axes.
function buildGraph() {
  const nodes = [];
  const links = [];
  const join = (a, b) => {
    nodes[a].neighbors.push(b);
    nodes[b].neighbors.push(a);
    links.push([a, b]);
  };
  for (let iz = 0; iz < AXIS; iz += 1) {
    for (let ix = 0; ix < AXIS; ix += 1) nodes.push({ x: coord(ix), z: coord(iz), io: [ix, iz], neighbors: [] });
  }
  for (let iz = 0; iz < AXIS; iz += 1) {
    for (let ix = 0; ix < AXIS; ix += 1) {
      if (ix + 1 < AXIS) join(id(ix, iz), id(ix + 1, iz));
      if (iz + 1 < AXIS) join(id(ix, iz), id(ix, iz + 1));
    }
  }
  const at = (x, z) => {
    const ix = axisIndex(x);
    const iz = axisIndex(z);
    return ix < 0 || iz < 0 ? null : nodes[id(ix, iz)];
  };
  return { nodes, links, at };
}

function rect(parent, hex, x, z, w, d, y, opts) {
  const mesh = new THREE.Mesh(SQUARE, material(hex, opts));
  mesh.scale.set(w, 1, d);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function box(parent, hex, x, y, z, w, h, d) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(hex));
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function buildLights(scene) {
  const hemi = new THREE.HemisphereLight(C.sky, C.sand, 1.15);
  const sun = new THREE.DirectionalLight(C.sun, 2.1);
  sun.position.set(120, 180, 80);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const box = sun.shadow.camera;
  Object.assign(box, { left: -260, right: 260, top: 260, bottom: -260, near: 1, far: 620 });
  box.updateProjectionMatrix();
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.4;
  scene.add(hemi, sun, sun.target);
  return { hemi, sun };
}

function buildRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

// Sand, sea, promenade.
function buildWaterfront(scene) {
  const { half, sea: seaEdge } = CONFIG.world;
  rect(scene, C.sand, 0, 0, half * 2 + 240, half * 2 + 240, -0.05).receiveShadow = true;
  const sea = rect(scene, C.water, (-half + seaEdge) / 2, 0, seaEdge + half, half * 2 + 240, -0.28, { glassy: true });
  sea.material.shininess = 90;
  const startX = seaEdge + 1.5;
  const width = half - startX;
  for (let z = -half; z < half; z += 8) rect(scene, z % 16 === 0 ? C.sidewalk : C.sand, startX + width / 2, z + 4, width - 0.15, 7.85, 0.02);
  box(scene, C.sidewalk, seaEdge + 0.3, 0.55, 0, 0.6, 1.1, half * 2);
}

// Asphalt, dashes, sidewalks, crosswalk paint.
function buildStreets(scene, nodes) {
  const span = CONFIG.world.half * 2;
  const quad = (w, d) => new THREE.BoxGeometry(w, 0.08, d);
  const dashNS = quad(0.32, 4);
  const dashEW = quad(4, 0.32);
  const barNS = quad(0.9, HALF_ROAD * 2 - 1);
  const barEW = quad(HALF_ROAD * 2 - 1, 0.9);
  const paint = (geo, x, z) => scene.add(new THREE.Mesh(geo, STRIPE).translateX(x).translateY(0.08).translateZ(z));
  for (const node of nodes) {
    rect(scene, C.asphalt, node.x, 0, HALF_ROAD * 2, span, 0.05);
    rect(scene, C.asphalt, 0, node.z, span, HALF_ROAD * 2, 0.05);
    for (let s = -span / 2 + 2; s < span / 2; s += 10) {
      paint(dashNS, node.x, s);
      paint(dashEW, s, node.z);
    }
    for (let i = 0; i < 3; i += 1) for (const s of [-1, 1]) {
      paint(barNS, node.x + s * (HALF_ROAD + 1.4 + i * 1.6), node.z);
      paint(barEW, node.x, node.z + s * (HALF_ROAD + 1.4 + i * 1.6));
    }
    for (const side of [-1, 1]) {
      rect(scene, C.sidewalk, node.x + side * (HALF_ROAD + WALK / 2), 0, WALK, span, 0.12);
      rect(scene, C.sidewalk, 0, node.z + side * (HALF_ROAD + WALK / 2), span, WALK, 0.12);
    }
  }
}

export function initWorld(canvas) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.sky);
  scene.fog = new THREE.Fog(C.sky, 160, 640);
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.4, 900);
  const W = { scene, camera, half: CONFIG.world.half, colliders: [], roads: buildGraph(), yaw: Math.PI * 0.15, pitch: 0.34, zoom: 1 };
  Object.assign(W, { renderer: buildRenderer(canvas), lights: buildLights(scene), camPos: new THREE.Vector3(30, 46, 120), lookAt: new THREE.Vector3(0, 1, 0) });
  camera.position.copy(W.camPos);
  camera.lookAt(W.lookAt);
  buildWaterfront(scene);
  buildStreets(scene, W.roads.nodes);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    W.renderer.setSize(window.innerWidth, window.innerHeight);
  });
  return W;
}

// Solid box {minX,maxX,minZ,maxZ,h}.
export function addCollider(W, x, z, w, d, h) {
  const c = { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, h: h || 0 };
  W.colliders.push(c);
  return c;
}

// Shortest way out of one box for a circle, as a face normal plus the moved point.
function escape(px, pz, r, b) {
  const out = [[b.minX - r - px, -1, 0], [b.maxX + r - px, 1, 0], [b.minZ - r - pz, 0, -1], [b.maxZ + r - pz, 0, 1]];
  let pick = out[0];
  for (const o of out) if (Math.abs(o[0]) < Math.abs(pick[0])) pick = o;
  return { x: px + pick[0] * Math.abs(pick[1]), z: pz + pick[0] * Math.abs(pick[2]), nx: pick[1], nz: pick[2] };
}

// Sweep a circle by (dx,dz), sliding along faces.
export function resolveMove(W, px, pz, r, dx, dz) {
  let x = px + dx;
  let z = pz + dz;
  let hit = false;
  let nx = 0;
  let nz = 0;
  for (let pass = 0; pass < 2; pass += 1) {
    for (const b of W.colliders) {
      if (x + r < b.minX || x - r > b.maxX || z + r < b.minZ || z - r > b.maxZ) continue;
      const out = escape(x, z, r + 0.02, b);
      x = out.x;
      z = out.z;
      nx = out.nx;
      nz = out.nz;
      hit = true;
    }
  }
  if (x < SHORE + r || x > LIMIT) { nx = x < SHORE + r ? 1 : -1; x = x < SHORE + r ? SHORE + r : LIMIT; hit = true; }
  if (z < -LIMIT || z > LIMIT) { nz = z < -LIMIT ? 1 : -1; z = z < -LIMIT ? -LIMIT : LIMIT; hit = true; }
  return { x, z, hit, nx, nz };
}

// Is this point on asphalt?
export function isOnRoad(W, x, z) {
  for (const node of W.roads.nodes) {
    if (Math.abs(x - node.x) <= HALF_ROAD || Math.abs(z - node.z) <= HALF_ROAD) return true;
  }
  return false;
}

// Nearest road centre line {x,z,axis,dist}.
export function snapToLane(W, x, z) {
  let best = { x: 0, z: 0, axis: 'z', dist: Infinity };
  for (const node of W.roads.nodes) {
    if (Math.abs(x - node.x) < best.dist) best = { x: node.x, z, axis: 'z', dist: Math.abs(x - node.x) };
    if (Math.abs(z - node.z) < best.dist) best = { x, z: node.z, axis: 'x', dist: Math.abs(z - node.z) };
  }
  return best;
}

// Third person orbit, pitch clamped.
export function updateCamera(W, I, focus, dt) {
  const cam = CONFIG.camera;
  const mouse = I ? I.mouse() : { dx: 0, dy: 0, wheel: 0 };
  W.yaw -= mouse.dx * cam.sens;
  W.pitch = Math.max(cam.pitchMin, Math.min(cam.pitchMax, W.pitch + mouse.dy * cam.sens));
  W.zoom = Math.max(0.7, Math.min(1.6, W.zoom + (mouse.wheel || 0) * 0.08));
  const dist = (focus.dist || cam.distCar) * W.zoom;
  const flat = Math.cos(W.pitch) * dist;
  const k = 1 - Math.pow(1 - cam.lerp, Math.max(1, dt * 60));
  const tx = focus.x - Math.sin(W.yaw) * flat;
  const tz = focus.z - Math.cos(W.yaw) * flat;
  const ty = (focus.height || cam.heightCar) + Math.sin(W.pitch) * dist;
  W.camPos.x += (tx - W.camPos.x) * k;
  W.camPos.y = Math.max(1.2, W.camPos.y + (ty - W.camPos.y) * k);
  W.camPos.z += (tz - W.camPos.z) * k;
  W.lookAt.x += (focus.x - W.lookAt.x) * k;
  W.lookAt.y += ((focus.y === undefined ? 1.6 : focus.y) - W.lookAt.y) * k;
  W.lookAt.z += (focus.z - W.lookAt.z) * k;
  W.camera.position.copy(W.camPos);
  W.camera.lookAt(W.lookAt);
}

export function renderFrame(W) {
  W.renderer.render(W.scene, W.camera);
}
