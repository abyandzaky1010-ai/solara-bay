// Solara Bay — the frame everything else hangs on: renderer, sky, sun,
// sea, the street grid, the collision solver and the third-person camera.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';

const AXES = [-160, -80, 0, 80, 160];
const SIDES = 5;
const SEA_EDGE_Z = -CONFIG.world.half;

function gridId(ix, iz) {
  if (ix < 0 || iz < 0 || ix >= SIDES || iz >= SIDES) return -1;
  return iz * SIDES + ix;
}

function lonelyMesh(geometry, paint) {
  const mesh = new THREE.Mesh(geometry, paint);
  return mesh;
}

// Lays a horizontal quad flat at height y, spanning [x0,x1] x [z0,z1].
function groundSlab(W, x0, z0, x1, z1, y, paint, { receive = true } = {}) {
  const mesh = lonelyMesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), paint);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((x0 + x1) * 0.5, y, (z0 + z1) * 0.5);
  mesh.receiveShadow = receive;
  W.scene.add(mesh);
  return mesh;
}

// One InstancedMesh for every tick of a repeated street mark.
function stampRun(W, boxes, paint) {
  if (!boxes.length) return;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 1), paint, boxes.length);
  const m = new THREE.Matrix4();
  boxes.forEach((b, i) => {
    m.identity();
    m.scale(new THREE.Vector3(b.w, 1, b.d));
    m.setPosition(b.x, b.y, b.z);
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  W.scene.add(mesh);
}

// Axes at {-160,-80,0,80,160} on both axes: 25 nodes, orthogonal links only.
// Each neighbour is also reachable by name through routes["ix,iz"], which is what
// the traffic and police AI use to pick an exit at a junction.
function buildRoadGraph(half) {
  const nodes = [];
  const links = [];

  for (let iz = 0; iz < SIDES; iz++) {
    for (let ix = 0; ix < SIDES; ix++) {
      nodes.push({
        x: AXES[ix],
        z: AXES[iz],
        ix,
        iz,
        neighbors: [],
        routes: {},
        compass: { east: null, west: null, near: null, far: null },
      });
    }
  }

  const walk = (ix, iz, sx, sz) => {
    for (let step = 1; step < SIDES; step++) {
      const other = gridId(ix + sx * step, iz + sz * step);
      if (other >= 0) return other;
    }
    return -1;
  };

  for (let iz = 0; iz < SIDES; iz++) {
    for (let ix = 0; ix < SIDES; ix++) {
      const self = nodes[gridId(ix, iz)];
      const exits = [
        ['east', 1, 0],
        ['west', -1, 0],
        ['far', 0, 1],
        ['near', 0, -1],
      ];
      for (const [dir, sx, sz] of exits) {
        const other = walk(ix, iz, sx, sz);
        if (other < 0) continue;
        const reach = nodes[other];
        if (self.neighbors.indexOf(other) === -1) self.neighbors.push(other);
        self.compass[dir] = other;
        self.routes[`${reach.ix},${reach.iz}`] = {
          dir,
          dx: sx,
          dz: sz,
          len: CONFIG.world.pitch,
          heading: Math.atan2(sx, sz),
        };
        if (!links.some((l) => l.a === gridId(ix, iz) && l.b === other)) {
          links.push({
            a: gridId(ix, iz),
            b: other,
            from: self,
            to: reach,
            length: CONFIG.world.pitch,
            dir,
          });
        }
      }
    }
  }

  const at = (x, z) => {
    for (const node of nodes) {
      if (Math.abs(node.x - x) < 0.6 && Math.abs(node.z - z) < 0.6) return node;
    }
    return null;
  };

  return { nodes, links, at, span: half, axes: AXES };
}

// View state lives on W so nothing else has to keep a copy of the aim.
function seedView(W) {
  W.view = { yaw: 0.72, pitch: 0.34, dist: 5.5, ready: false };
  W.focus = { x: 0, y: 1.6, z: 0 };
}

function buildSky(W) {
  W.renderer = new THREE.WebGLRenderer({ canvas: W.canvas, antialias: true });
  W.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  W.renderer.setSize(window.innerWidth, window.innerHeight, false);
  W.renderer.shadowMap.enabled = true;
  W.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  W.renderer.outputColorSpace = THREE.SRGBColorSpace;

  W.scene = new THREE.Scene();
  W.scene.background = new THREE.Color(C.sky);
  W.scene.fog = new THREE.Fog(C.sky, 160, 640);

  W.camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.4, 1200);
  W.camera.position.set(-90, 40, 120);

  const sky = new THREE.HemisphereLight(C.sky, C.sand, 0.95);
  W.scene.add(sky);

  const sun = new THREE.DirectionalLight(C.sun, 1.9);
  sun.position.set(-80, 130, 90);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.orthographicSize = 260;
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 620;
  sun.shadow.bias = -0.0006;
  W.scene.add(sun);
  W.scene.add(sun.target);
  W.sun = sun;

  const fill = new THREE.DirectionalLight(C.horizon, 0.22);
  fill.position.set(120, 60, -100);
  W.scene.add(fill);

  window.addEventListener('resize', () => {
    W.camera.aspect = window.innerWidth / window.innerHeight;
    W.camera.updateProjectionMatrix();
    W.renderer.setSize(window.innerWidth, window.innerHeight, false);
  });
}

function buildGround(W) {
  const half = W.half;
  groundSlab(W, -half, SEA_EDGE_Z, half, half, -0.02, material(C.sand));

  // The bay: shallow shelf near the promenade, deep water further out.
  groundSlab(W, -400, SEA_EDGE_Z, CONFIG.world.sea, half, -0.38, material(C.water, { flat: false }));
  groundSlab(W, -480, SEA_EDGE_Z, -390, half, -0.5, material(0x2f7389));

  // Promenade tiles: alternating light/dark checker bands along the waterfront.
  const tileW = 4;
  for (let x = CONFIG.world.sea, band = 0; x < -half; x += tileW, band++) {
    const even = band % 2 === 0;
    groundSlab(
      W, x, SEA_EDGE_Z, Math.min(x + tileW, -half), half, 0.03,
      material(even ? 0xe4dccd : 0xd2c8b6),
    );
  }
  // Low sea wall between the tiles and the water.
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, half * 2), material(0xbfb6a4));
  wall.position.set(CONFIG.world.sea + 0.45, 0.5, 0);
  wall.castShadow = true;
  wall.receiveShadow = true;
  W.scene.add(wall);
  addCollider(W, CONFIG.world.sea + 0.45, 0, 0.9, half * 2, 1.1);
}

function buildStreets(W) {
  const asphalt = material(C.asphalt);
  const walk = material(C.sidewalk);
  const curb = material(0xd9d0be);
  const half = W.half;
  const roadHalf = CONFIG.world.roadHalf;
  const walkw = CONFIG.world.sidewalk;
  const reach = half;

  // Full-width asphalt ribbons on both axes, plus the pavement band outside them.
  for (const axis of AXES) {
    groundSlab(W, axis - roadHalf, -reach, axis + roadHalf, reach, 0.05, asphalt);
    groundSlab(W, -reach, axis - roadHalf, reach, axis + roadHalf, 0.05, asphalt);

    for (const side of [-1, 1]) {
      const outer = side * (roadHalf + walkw);
      groundSlab(W, axis + Math.min(0, outer), -reach, axis + Math.max(0, outer), reach, 0.07, walk);
      groundSlab(W, -reach, axis + Math.min(0, outer), reach, axis + Math.max(0, outer), 0.07, walk);

      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, reach * 2), curb);
      lip.position.set(axis + side * roadHalf, 0.07, 0);
      lip.receiveShadow = true;
      W.scene.add(lip);
      const lipZ = new THREE.Mesh(new THREE.BoxGeometry(reach * 2, 0.14, 0.24), curb);
      lipZ.position.set(0, 0.07, axis + side * roadHalf);
      lipZ.receiveShadow = true;
      W.scene.add(lipZ);
    }
  }

  // Dashed lane marks, laid between intersections only.
  const dashes = [];
  const segments = [];
  for (let i = 0; i < AXES.length - 1; i++) segments.push([AXES[i], AXES[i + 1]]);
  for (const axis of AXES) {
    for (const [a, b] of segments) {
      const start = a + roadHalf + 2;
      const stop = b - roadHalf - 2;
      for (let t = start; t + 1.7 <= stop; t += 4.4) {
        const mid = t + 0.85;
        dashes.push({ x: axis, y: 0.11, z: mid, w: 0.34, d: 1.7 });
        dashes.push({ x: mid, y: 0.11, z: axis, w: 1.7, d: 0.34 });
      }
    }
  }
  stampRun(W, dashes, material(C.roadline));

  // Crosswalk ticks on the four approaches of every intersection.
  const ticks = [];
  for (const cx of AXES) {
    for (const cz of AXES) {
      for (const side of [-1, 1]) {
        const bandZ = cz + side * (roadHalf + 1.1);
        const bandX = cx + side * (roadHalf + 1.1);
        for (let k = -roadHalf + 0.9; k <= roadHalf - 0.9; k += 1.8) {
          ticks.push({ x: cx + k, y: 0.12, z: bandZ, w: 1.1, d: 2.6 });
          ticks.push({ x: bandX, y: 0.12, z: cz + k, w: 2.6, d: 1.1 });
        }
      }
    }
  }
  stampRun(W, ticks, material(0xf7f2e2));
}

export function addCollider(W, x, z, w, d, h) {
  const halfW = w / 2;
  const halfD = d / 2;
  W.colliders.push({
    minX: x - halfW,
    maxX: x + halfW,
    minZ: z - halfD,
    maxZ: z + halfD,
    h,
  });
}

// Circle versus box, axis by axis. A blocked axis is pinned to the face and
// the other keeps its travel, so the body slides along walls instead of sticking.
export function resolveMove(W, px, pz, r, dx, dz) {
  let x = px + dx;
  let z = pz + dz;
  let hit = false;
  const boxes = W.colliders;

  // One pass per box: a blocked axis is pinned to the nearest face, the other
  // axis keeps its travel. Two boxes in sequence therefore slide, never stick.
  for (let i = 0; i < boxes.length; i++) {
    const wall = boxes[i];
    if (x + r <= wall.minX || x - r >= wall.maxX || z + r <= wall.minZ || z - r >= wall.maxZ) continue;
    const left = Math.abs(x + r - wall.minX);
    const right = Math.abs(wall.maxX - (x - r));
    const back = Math.abs(z + r - wall.minZ);
    const front = Math.abs(wall.maxZ - (z - r));
    const near = Math.min(left, right, back, front);
    if (near === left) x = wall.minX - r;
    else if (near === right) x = wall.maxX + r;
    else if (near === back) z = wall.minZ - r;
    else z = wall.maxZ + r;
    hit = true;
  }

  const lim = CONFIG.world.half - r;
  if (x < lim * -1) { x = -lim; hit = true; }
  if (x > lim) { x = lim; hit = true; }
  if (z < lim * -1) { z = -lim; hit = true; }
  if (z > lim) { z = lim; hit = true; }

  return { x, z, hit };
}

// On an asphalt ribbon (intersections included, since both bands overlap there).
export function isOnRoad(W, x, z) {
  const roadHalf = CONFIG.world.roadHalf;
  for (const axis of AXES) {
    if (Math.abs(x - axis) <= roadHalf || Math.abs(z - axis) <= roadHalf) return true;
  }
  return false;
}

// The nearest road centre: on the grid lines themselves, never between them.
export function snapToLane(W, x, z) {
  let bestX = AXES[0];
  let bestZ = AXES[0];
  for (const axis of AXES) {
    if (Math.abs(x - axis) < Math.abs(x - bestX)) bestX = axis;
    if (Math.abs(z - axis) < Math.abs(z - bestZ)) bestZ = axis;
  }
  const gapX = Math.abs(x - bestX);
  const gapZ = Math.abs(z - bestZ);
  const roadHalf = CONFIG.world.roadHalf;
  if (gapX < gapZ) {
    return { x: bestX, z: Math.max(-W.half, Math.min(W.half, z)) };
  }
  return { x: Math.max(-W.half, Math.min(W.half, x)), z: bestZ };
}

// Third-person orbit: mouse deltas turn and tilt, the camera trails the focus
// through boxes that would otherwise swallow it.
export function updateCamera(W, I, focus, dt) {
  const view = W.view;
  const mouse = I && I.mouse ? I.mouse() : { dx: 0, dy: 0 };
  const factor = view.ready ? 1 : 0;
  view.yaw -= mouse.dx * 0.0026 * factor;
  view.pitch += mouse.dy * 0.0022 * factor;
  view.pitch = Math.max(-0.15, Math.min(1.1, view.pitch));
  view.ready = true;

  const dist = focus.dist || CONFIG.player.camDistFoot;
  const eyeY = focus.y !== undefined ? focus.y : CONFIG.player.camHeight;
  view.dist = dist;

  const cosP = Math.cos(view.pitch);
  const sinP = Math.sin(view.pitch);
  const backX = Math.sin(view.yaw) * cosP * dist;
  const backZ = Math.cos(view.yaw) * cosP * dist;
  const lift = sinP * dist + eyeY * 0.4;

  const target = {
    x: focus.x + backX,
    z: focus.z + backZ,
    y: eyeY + lift,
  };

  // Pull the camera in when a wall sits between it and the shoulder.
  for (let i = 0; i < W.colliders.length; i++) {
    const b = W.colliders[i];
    if (target.x > b.minX - 0.4 && target.x < b.maxX + 0.4 && target.z > b.minZ - 0.4 && target.z < b.maxZ + 0.4) {
      target.y = Math.max(target.y, b.h + 1.2);
    }
  }
  target.y = Math.max(target.y, eyeY + 0.35);

  const ease = 1 - Math.pow(0.0025, Math.max(dt, 0));
  W.focus.x = focus.x;
  W.focus.y = eyeY;
  W.focus.z = focus.z;

  W.camera.position.x += (target.x - W.camera.position.x) * ease;
  W.camera.position.y += (target.y - W.camera.position.y) * ease;
  W.camera.position.z += (target.z - W.camera.position.z) * ease;

  W.camera.lookAt(focus.x, eyeY + 0.25, focus.z);

  W.sun.position.set(focus.x - 80, 130, focus.z + 90);
  W.sun.target.position.set(focus.x, 0, focus.z);
  W.sun.target.updateMatrixWorld();
}

export function renderFrame(W) {
  W.renderer.render(W.scene, W.camera);
}

export function initWorld(canvas) {
  const W = {
    canvas,
    scene: null,
    camera: null,
    renderer: null,
    sun: null,
    colliders: [],
    half: CONFIG.world.half,
    roads: null,
    view: null,
    focus: null,
    clockT: 0,
  };

  buildSky(W);
  buildGround(W);
  buildStreets(W);
  W.roads = buildRoadGraph(W.half);
  seedView(W);

  return W;
}
