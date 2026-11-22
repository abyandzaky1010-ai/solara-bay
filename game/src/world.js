// Solara Bay — the stage everything else stands on: the WebGL frame, the sun and
// sky, the street grid as a walkable graph, the sea, and the circle-vs-box wall
// solver every character and car leans on.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';

const WORLD = CONFIG.world;
const HALF = WORLD.half;              // 200: the town spans x,z in [-200,200]
const SEA = WORLD.sea;                // -172: ocean west of this line
const PITCH = WORLD.pitch;            // 80: avenue spacing on both axes
const ROAD_HALF = WORLD.roadHalf;     // 6: asphalt half-width
const WALK = WORLD.sidewalk;          // 3: pavement either side
const CURB = ROAD_HALF + WALK;        // 9: block lots start here
const GRID = [-160, -80, 0, 80, 160]; // both axes
const SIDES = GRID.length;            // roads per axis

// Camera feel, all radians unless noted.
const SENSITIVITY = 0.0026;
const PITCH_MIN = -0.15;
const PITCH_MAX = 1.1;
const PITCH_START = 0.28;
const NEAR_WALL = 0.8;                // how far the lens may come before a facade

// ------------------------------------------------------------------ street graph

/** One junction id from its street slots (either axis order). */
function junctionId(ix, iz) {
  return `${ix}${iz}`;
}

/** The road coordinate nearest `value`, snapped down to the grid. */
function nearestStreet(value) {
  let best = GRID[0];
  let gap = Math.abs(value - best);
  for (let i = 1; i < GRID.length; i += 1) {
    const d = Math.abs(value - GRID[i]);
    if (d < gap) { gap = d; best = GRID[i]; }
  }
  return best;
}

/** Junctions plus the two-way links between neighbours on both axes. */
function buildRoadGraph() {
  const nodes = [];
  const byId = new Map();
  for (let i = 0; i < SIDES; i += 1) {
    for (let j = 0; j < SIDES; j += 1) {
      const node = { id: junctionId(i, j), ix: i, iz: j, x: GRID[i], z: GRID[j], neighbors: [] };
      byId.set(node.id, nodes.length);
      nodes.push(node);
    }
  }
  const links = [];
  const join = (a, b) => {
    const na = nodes[a];
    const nb = nodes[b];
    na.neighbors.push(b);
    nb.neighbors.push(a);
    links.push([a, b]);
  };
  for (let i = 0; i < SIDES; i += 1) {
    for (let j = 0; j < SIDES; j += 1) {
      if (i + 1 < SIDES) join(byId.get(junctionId(i, j)), byId.get(junctionId(i + 1, j)));
      if (j + 1 < SIDES) join(byId.get(junctionId(i, j)), byId.get(junctionId(i, j + 1)));
    }
  }

  // Nearest junction by squared distance — used by police spawns and lane snapping.
  const at = (x, z) => {
    let best = nodes[0];
    let bestD = Infinity;
    for (const node of nodes) {
      const d = (node.x - x) * (node.x - x) + (node.z - z) * (node.z - z);
      if (d < bestD) { bestD = d; best = node; }
    }
    return best;
  };

  return { nodes, links, at, grid: GRID.slice(), pitch: PITCH, roadHalf: ROAD_HALF };
}

// ------------------------------------------------------------------ stage dressing

const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const dashBox = new THREE.BoxGeometry(0.32, 0.02, 3.6);
const tickBox = new THREE.BoxGeometry(0.4, 0.02, ROAD_HALF - 0.6);
const boltBox = new THREE.BoxGeometry(0.06, 0.06, 0.06);

/** A flat quad of `w` by `d` at ground height `y`, centred on x,z. */
function slab(parent, mat, x, z, w, d, y = 0) {
  const mesh = new THREE.Mesh(plane, mat);
  mesh.scale.set(w, 1, d);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Asphalt ribbons under each avenue, then lane paint on top. */
function layStreets(root) {
  const asphalt = material(C.asphalt);
  const paint = material(C.roadline, { flat: true });
  const span = HALF * 2 + 40;

  for (const line of GRID) {
    slab(root, asphalt, 0, line, span, ROAD_HALF * 2, 0.02); // east-west avenue
    slab(root, asphalt, line, 0, ROAD_HALF * 2, span, 0.02); // north-south avenue
  }

  // Dashed centre lines: skip the junction squares so crossings stay clean.
  for (const line of GRID) {
    for (let t = -HALF; t < HALF; t += 7) {
      if (GRID.some((g) => Math.abs(t - g) < CURB + 2)) continue;
      const a = new THREE.Mesh(dashBox, paint);
      a.position.set(t, 0.05, line);
      root.add(a);
      const b = new THREE.Mesh(dashBox, paint);
      b.position.set(line, 0.05, t);
      b.rotation.y = Math.PI / 2;
      root.add(b);
    }
  }

  // Zebra ticks at all four mouths of every crossing.
  for (const gx of GRID) {
    for (const gz of GRID) {
      for (const side of [-1, 1]) {
        for (let k = -ROAD_HALF + 1.4; k <= ROAD_HALF - 1.4; k += 1.6) {
          const e = new THREE.Mesh(tickBox, paint);
          e.position.set(gx + side * (ROAD_HALF + 1.6), 0.05, gz + k);
          e.rotation.y = Math.PI / 2;
          root.add(e);
          const s = new THREE.Mesh(tickBox, paint);
          s.position.set(gx + k, 0.05, gz + side * (ROAD_HALF + 1.6));
          root.add(s);
        }
      }
    }
  }
}

/** Paving strips run beside every avenue out to the block edge. */
function laySidewalks(root) {
  const walk = material(C.sidewalk);
  const reach = HALF * 2 + 40;
  for (const line of GRID) {
    slab(root, walk, 0, line + ROAD_HALF + WALK / 2, reach, WALK, 0.14);
    slab(root, walk, 0, line - ROAD_HALF - WALK / 2, reach, WALK, 0.14);
    slab(root, walk, line + ROAD_HALF + WALK / 2, 0, WALK, reach, 0.14);
    slab(root, walk, line - ROAD_HALF - WALK / 2, 0, WALK, reach, 0.14);
  }
  // Curb beads: a slim lip where the asphalt meets the pavement.
  const curb = material(C.horizon);
  for (const line of GRID) {
    slab(root, curb, 0, line + ROAD_HALF, reach, 0.3, 0.13);
    slab(root, curb, 0, line - ROAD_HALF, reach, 0.3, 0.13);
    slab(root, curb, line + ROAD_HALF, 0, 0.3, reach, 0.13);
    slab(root, curb, line - ROAD_HALF, 0, 0.3, reach, 0.13);
  }
}

/** Sand ground, the water plane, a foam edge and promenade tiles on the west rim. */
function layWaterfront(root) {
  const sand = material(C.sand);
  slab(root, sand, 0, 0, HALF * 2, HALF * 2, 0);

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(228, HALF * 2 + 400).rotateX(-Math.PI / 2),
    material(C.water, { glassy: true }),
  );
  sea.position.set(SEA - 114, -0.3, 0);
  sea.receiveShadow = true;
  root.add(sea);

  const foam = new THREE.Mesh(plane, material(C.horizon, { flat: true }));
  foam.scale.set(1.6, 1, HALF * 2);
  foam.position.set(SEA + 0.4, 0.05, 0);
  root.add(foam);

  // Promenade: four tile bands in alternating shades, x in [-200,-172].
  const narrow = SEA - HALF; // 28 m of boardwalk
  const tiles = [C.horizon, C.sidewalk, C.horizon, C.sidewalk];
  const band = narrow / tiles.length;
  for (let i = 0; i < tiles.length; i += 1) {
    slab(root, material(tiles[i]), HALF + band * (i + 0.5), 0, band, HALF * 2, 0.16);
  }
  // Bollards down the coast edge: the sea ends where the walking starts.
  const bolt = material(C.roof);
  const count = 26;
  for (let i = 0; i < count; i += 1) {
    const b = new THREE.Mesh(boltBox, bolt);
    b.scale.set(2.4, 12, 2.4);
    b.position.set(SEA - 1.2, 0.4, -HALF + (i / (count - 1)) * HALF * 2);
    b.castShadow = true;
    root.add(b);
  }

  // A darker cut where the promenade meets the sand: the pier foot.
  slab(root, material(C.asphalt), HALF + narrow / 2, -150, narrow, 10, 0.17);
}

/** Emissive pins floating over the intersections: enough light to sell the daylight. */
function dressSkyline(root) {
  const beacon = material(C.beacon, { flat: true });
  for (const line of GRID) {
    for (const cross of [GRID[0], GRID[4]]) {
      const lamp = new THREE.Mesh(boltBox, beacon);
      lamp.scale.set(4, 26, 4);
      lamp.position.set(line + ROAD_HALF + 1, 3.4, cross + ROAD_HALF + 1);
      root.add(lamp);
    }
  }
  // The horizon hills: two soft boxes past the north and east edges.
  const ridge = material(C.horizon);
  slab(root, ridge, 0, HALF + 180, HALF * 6, 160, -4);
  slab(root, ridge, HALF + 190, 0, 160, HALF * 6, -4);
}

// ------------------------------------------------------------------ lights and camera

function lightStage(scene) {
  // Kept below clipping on purpose: sun-facing faces stay in the material's own
  // hue instead of burning to white, and shaded faces stay a cool second colour.
  const hemi = new THREE.HemisphereLight(C.sky, C.sand, 0.85);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(C.horizon, 0.4));

  const sun = new THREE.DirectionalLight(0xfff0d2, 1.85);
  sun.position.set(-150, 230, 160); // light from the south-west, so camera-facing faces are lit
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const box = sun.shadow.camera;
  box.left = -260;
  box.right = 260;
  box.top = 260;
  box.bottom = -260;
  box.near = 20;
  box.far = 700;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  scene.add(sun);
  scene.add(sun.target);
  return sun;
}

// ------------------------------------------------------------------ public API

/** Build the renderer, sky, sun, streets, sea, road graph and camera. */
export function initWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.sky);
  scene.fog = new THREE.Fog(C.sky, 160, 640);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.4, 900);
  camera.position.set(12, 18, 22);

  const sun = lightStage(scene);

  const streets = new THREE.Group();
  streets.name = 'streets';
  scene.add(streets);
  layStreets(streets);
  laySidewalks(streets);
  layWaterfront(streets);
  dressSkyline(streets);

  const W = {
    scene,
    camera,
    renderer,
    sun,
    colliders: [],
    roads: buildRoadGraph(),
    half: HALF,
    sea: SEA,
    pitch: PITCH,
    roadHalf: ROAD_HALF,
    sidewalk: WALK,
    blockUsable: WORLD.blockUsable,
    parkRect: { minX: WORLD.parkRect.x0, maxX: WORLD.parkRect.x1, minZ: WORLD.parkRect.z0, maxZ: WORLD.parkRect.z1 },
    yaw: Math.PI,
    pitchAngle: PITCH_START,
    dist: CONFIG.player.camDistFoot,
    camPos: new THREE.Vector3(),
    look: new THREE.Vector3(),
    focus: new THREE.Vector3(0, 1.6, 0),
    ready: false,
  };

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return W;
}

/** Register a solid box at x,z with a footprint w (x) by d (z) rising h metres. */
export function addCollider(W, x, z, w, d, h = 20) {
  const collider = {
    x,
    z,
    w,
    d,
    h,
    minX: x - w / 2,
    maxX: x + w / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2,
  };
  W.colliders.push(collider);
  return collider;
}

/**
 * Slide a circle from (px,pz) by (dx,dz) against the boxes in W.colliders.
 * Axis-separated: try x first (holding z), then z — whichever face the circle
 * would breach clamps it back out, so movement along a wall keeps its speed.
 */
export function resolveMove(W, px, pz, r, dx, dz) {
  let x = px + dx;
  let z = pz + dz;
  let hit = false;
  const boxes = W.colliders;

  for (let i = 0; i < boxes.length; i += 1) {
    const b = boxes[i];
    const nearX = x > b.minX - r && x < b.maxX + r;
    const nearZ = z > b.minZ - r && z < b.maxZ + r;
    if (!nearX || !nearZ) continue;

    // Push out along whichever axis is the cheaper escape.
    const pushLeft = x - (b.minX - r);
    const pushRight = b.maxX + r - x;
    const pushBack = z - (b.minZ - r);
    const pushFront = b.maxZ + r - z;
    const ix = Math.min(pushLeft, pushRight);
    const iz = Math.min(pushBack, pushFront);

    if (ix < iz) {
      x = pushLeft < pushRight ? b.minX - r : b.maxX + r;
    } else {
      z = pushBack < pushFront ? b.minZ - r : b.maxZ + r;
    }
    hit = true;
  }

  return { x, z, hit };
}

/** True when x sits on an asphalt lane (any avenue, either axis). */
export function isOnRoad(W, x, z) {
  const onX = x >= -HALF && x <= HALF && verticalStreet(x) !== null && Math.abs(z) <= HALF;
  const onZ = z >= -HALF && z <= HALF && verticalStreet(z) !== null && Math.abs(x) <= HALF;
  return Boolean(onX || onZ);
}

/** The street coordinate a value is within a road's width of, else null. */
function verticalStreet(value) {
  for (const line of GRID) {
    if (Math.abs(value - line) <= ROAD_HALF) return line;
  }
  return null;
}

/** Nearest avenue centre point to x,z — where traffic and spawns belong. */
export function snapToLane(W, x, z) {
  const roadX = nearestStreet(x);
  const roadZ = nearestStreet(z);
  const gapX = Math.abs(x - roadX);
  const gapZ = Math.abs(z - roadZ);
  if (gapX <= gapZ) return { x: roadX, z, onX: true };
  return { x, z: roadZ, onX: false };
}

// ------------------------------------------------------------------ camera and frame

/** Distance a focus point may sit from its camera before a facade blocks the view. */
function openLane(W, fx, fz, cx, cz) {
  let limit = Infinity;
  const sx = fx - cx;
  const sz = fz - cz;
  const len = Math.hypot(sx, sz) || 1;
  const ux = sx / len;
  const uz = sz / len;
  for (const b of W.colliders) {
    // Ray/box slab test in 2D, never mind height: a tower blocks the lens.
    let t0 = 0;
    let t1 = limit;
    const axes = [[cx, ux, b.minX, b.maxX], [cz, uz, b.minZ, b.maxZ]];
    let miss = false;
    for (const [o, d, lo, hi] of axes) {
      if (Math.abs(d) < 1e-6) {
        if (o < lo || o > hi) { miss = true; break; }
      } else {
        let a = (lo - o) / d;
        let c = (hi - o) / d;
        if (a > c) { const t = a; a = c; c = t; }
        t0 = Math.max(t0, a);
        t1 = Math.min(t1, c);
        if (t0 > t1) { miss = true; break; }
      }
    }
    if (!miss && t0 > 0 && t0 < limit) limit = t0;
  }
  return limit;
}

/**
 * Third-person orbit: yaw and pitch from the mouse, the lens eases to a point
 * behind the focus, and a wall between the two pulls it in so the view stays clear.
 */
export function updateCamera(W, I, focus, dt) {
  const mouse = I && I.mouse ? I.mouse() : { dx: 0, dy: 0 };
  W.yaw -= mouse.dx * SENSITIVITY;
  W.pitchAngle = Math.max(PITCH_MIN, Math.min(PITCH_MAX, W.pitchAngle + mouse.dy * SENSITIVITY));
  if (W.yaw > Math.PI * 2) W.yaw -= Math.PI * 2;
  if (W.yaw < 0) W.yaw += Math.PI * 2;

  const wantDist = (focus && focus.dist) || CONFIG.player.camDistFoot;
  const target = focus || { x: 0, y: 1.6, z: 0 };
  const pitch = W.pitchAngle;
  const flat = Math.cos(pitch);

  // W.yaw is where the camera looks (player.js steers and aims with it), so the
  // lens hangs back along the opposite heading and tilts up by `pitch`.
  const fwdX = Math.sin(W.yaw);
  const fwdZ = Math.cos(W.yaw);
  const rise = Math.sin(pitch) + 0.3;

  const lane = openLane(W, target.x, target.z, target.x - fwdX * wantDist * flat, target.z - fwdZ * wantDist * flat);
  const dist = Math.min(wantDist, Math.max(NEAR_WALL, lane - 0.4));

  const wantX = target.x - Math.sin(W.yaw) * dist * flat;
  const wantZ = target.z - Math.cos(W.yaw) * dist * flat;
  const wantY = target.y + dist * rise;

  if (!W.ready) {
    W.camPos.set(wantX, wantY, wantZ);
    W.look.set(target.x, target.y, target.z);
    W.ready = true;
  } else {
    const ease = Math.min(1, dt * 9);
    W.camPos.x += (wantX - W.camPos.x) * ease;
    W.camPos.y += (wantY - W.camPos.y) * Math.min(1, dt * 6);
    W.camPos.z += (wantZ - W.camPos.z) * ease;
  }

  W.focus.set(target.x, target.y, target.z);
  W.camera.position.copy(W.camPos);
  W.look.x += (target.x - W.look.x) * Math.min(1, dt * 14);
  W.look.y += (target.y - W.look.y) * Math.min(1, dt * 14);
  W.look.z += (target.z - W.look.z) * Math.min(1, dt * 14);
  W.camera.lookAt(W.look.x + fwdX * 2.5, W.look.y + 0.55, W.look.z + fwdZ * 2.5);

  // Keep the sun's shadow box riding with the player so 2048 px stays sharp.
  if (W.sun) {
    W.sun.position.set(W.focus.x - 150, 230, W.focus.z + 160);
    W.sun.target.position.set(W.focus.x, 0, W.focus.z);
    W.sun.target.updateMatrixWorld();
  }
}

/** Draw one frame. */
export function renderFrame(W) {
  W.renderer.render(W.scene, W.camera);
}
