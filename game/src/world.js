import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';

// One job: the stage itself. Renderer, sky, sun, ground, sea, the street grid,
// box colliders with a sliding sweep, and the third-person camera.

const WORLD = CONFIG.world;

/** Street coordinates on both axes: five avenues each way, 80 m apart. */
export const STREETS = [-160, -80, 0, 80, 160];
const AVENUES = STREETS.length;
const PITCH = WORLD.pitch;
const ROAD_HALF = WORLD.roadHalf;
const WALK = WORLD.sidewalk;
const STRIP = ROAD_HALF + WALK;
const HALF = WORLD.half;
const SEA_X = WORLD.sea;
const LANE = 3.0;

const PITCH_MIN = -0.15;
const PITCH_MAX = 1.1;
const MOUSE_YAW = 0.0031;
const MOUSE_PITCH = 0.0024;
const MIN_DIST = 3.0;

/** Grid index for the intersection at column ix, row iz. */
export function id(ix, iz) {
  return iz * AVENUES + ix;
}

// ---------- renderer / scene plumbing ----------

function makeRenderer(canvas) {
  // A container (a div) cannot be a WebGL target: let Three make its own canvas
  // and we mount it into whatever element the boot code handed us.
  const host = canvas && typeof canvas.getContext === 'function' ? canvas : null;
  const renderer = new THREE.WebGLRenderer(host ? { canvas: host, antialias: true } : { antialias: true });
  if (!host && canvas && canvas.appendChild) {
    canvas.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  return renderer;
}

function makeCamera() {
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.4, 1400);
  camera.position.set(-30, 18, 46);
  return camera;
}

function makeSky(W) {
  W.scene.background = new THREE.Color(C.sky);
  W.scene.fog = new THREE.Fog(C.sky, 160, 640);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(900, 24, 12),
    new THREE.MeshBasicMaterial({ color: C.horizon, side: THREE.BackSide, fog: false }),
  );
  dome.position.y = -120;
  dome.renderOrder = -1;
  W.scene.add(dome);
  W.skyDome = dome;
}

function makeLights(W) {
  const hemi = new THREE.HemisphereLight(C.sky, C.sand, 0.95);
  W.scene.add(hemi);

  const sun = new THREE.DirectionalLight(C.sun, 1.55);
  sun.position.set(-90, 130, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const box = sun.shadow.camera;
  box.left = -260;
  box.right = 260;
  box.top = 260;
  box.bottom = -260;
  box.near = 10;
  box.far = 520;
  box.updateProjectionMatrix();
  sun.shadow.bias = -0.0009;
  sun.shadow.normalBias = 0.35;
  sun.target.position.set(0, 0, 0);
  W.scene.add(sun);
  W.scene.add(sun.target);
  W.sun = sun;
}

// ---------- ground: sand, sea, promenade ----------
function flatPlane(w, d, hex, opts) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material(hex, opts));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function makeGround(W) {
  const ground = flatPlane(400, 400, C.sand);
  ground.receiveShadow = true;
  ground.position.y = -0.04;
  W.scene.add(ground);

  // Shallow shelf in the sand where the beach meets the water.
  const shelf = flatPlane(26, 398, 0xe6dcc2);
  shelf.receiveShadow = true;
  shelf.position.set(SEA_X - 4, -0.02, 0);
  W.scene.add(shelf);

  const sea = flatPlane(228, 820, C.water, { glassy: true });
  sea.position.set(SEA_X - 114, 0.05, 0);
  sea.receiveShadow = true;
  W.scene.add(sea);

  const foam = flatPlane(3.2, 400, 0xe9f7f6, { flat: true });
  foam.position.set(SEA_X, 0.07, 0);
  W.scene.add(foam);

  // Promenade: pale tile strip along the waterfront edge of the city.
  const promStart = SEA_X;
  const promWidth = -164 - SEA_X;
  const walkway = flatPlane(promWidth, 330, 0xe4dccb);
  walkway.position.set(promStart + promWidth / 2, 0.01, 0);
  walkway.receiveShadow = true;
  W.scene.add(walkway);

  for (let i = 0; i < 30; i++) {
    const z = -160 + i * 11;
    const seam = new THREE.Mesh(new THREE.PlaneGeometry(promWidth, 0.3), material(0xcfc3ad));
    seam.rotation.x = -Math.PI / 2;
    seam.position.set(promStart + promWidth / 2, 0.02, z);
    W.scene.add(seam);
  }
}

// ---------- street grid ----------

function buildNodes() {
  const nodes = [];
  for (let iz = 0; iz < AVENUES; iz++) {
    for (let ix = 0; ix < AVENUES; ix++) {
      nodes.push({ x: STREETS[ix], z: STREETS[iz], ix, iz, id: id(ix, iz), neighbors: [] });
    }
  }
  const links = [];
  for (let iz = 0; iz < AVENUES; iz++) {
    for (let ix = 0; ix < AVENUES; ix++) {
      const here = nodes[id(ix, iz)];
      if (ix + 1 < AVENUES) {
        const east = id(ix + 1, iz);
        here.neighbors.push(east);
        nodes[east].neighbors.push(here.id);
        links.push({ a: here.id, b: east, length: PITCH });
      }
      if (iz + 1 < AVENUES) {
        const south = id(ix, iz + 1);
        here.neighbors.push(south);
        nodes[south].neighbors.push(here.id);
        links.push({ a: here.id, b: south, length: PITCH });
      }
    }
  }
  return { nodes, links };
}

/** Nearest intersection to (x, z), the anchor for traffic and police spawns. */
function makeRoads(W) {
  const { nodes, links } = buildNodes();
  const roads = {
    nodes,
    links,
    coords: STREETS.slice(),
    /** Intersection nearest to (x, z); always returns a node. */
    at(x, z) {
      let best = nodes[0];
      let bestD = Infinity;
      for (let i = 0; i < nodes.length; i++) {
        const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
        if (d < bestD) { bestD = d; best = nodes[i]; }
      }
      return best;
    },
  };
  W.roads = roads;
  return roads;
}

/** One asphalt plate covering a whole avenue, from the waterfront to the far edge. */
function avenuePlates(W) {
  const span = HALF - SEA_X;
  const middle = (HALF + SEA_X) / 2;
  for (let i = 0; i < AVENUES; i++) {
    const c = STREETS[i];
    const band = flatPlane(span, ROAD_HALF * 2, C.asphalt);
    band.position.set(middle, 0, c);
    band.receiveShadow = true;
    W.scene.add(band);
    for (const side of [-1, 1]) addWalk(W, middle, c + side * (ROAD_HALF + WALK / 2), span, WALK);

    const lane = flatPlane(ROAD_HALF * 2, HALF * 2, C.asphalt);
    lane.position.set(c, 0.002, 0);
    lane.receiveShadow = true;
    W.scene.add(lane);
    for (const side of [-1, 1]) addWalk(W, c + side * (ROAD_HALF + WALK / 2), 0, WALK, HALF * 2);
  }
}

/** Kerbstones: a raised pale slab either side of the asphalt, so the edges read clean. */
function addWalk(W, x, z, w, d) {
  const walk = flatPlane(w, d, C.sidewalk);
  walk.position.set(x, 0.012, z);
  walk.receiveShadow = true;
  W.scene.add(walk);
}

/** Dashed paint down the middle of every avenue, skipping the junctions. */
function centreDashes(W) {
  const dash = 2.6;
  const gap = 2.6;
  const end = HALF - 4;
  for (let i = 0; i < AVENUES; i++) {
    const c = STREETS[i];
    for (const along of [true, false]) {
      for (let t = SEA_X + 8; t < end; t += dash + gap) {
        if (STREETS.some((s) => Math.abs(t + dash / 2 - s) < STRIP + dash)) continue;
        const at = t + dash / 2;
        const bar = along ? flatPlane(dash, 0.34, C.roadline) : flatPlane(0.34, dash, C.roadline);
        bar.position.set(along ? at : c, 0.03, along ? c : at);
        W.scene.add(bar);
      }
    }
  }
}

/** White zebra ticks on all four arms of every intersection. */
function crosswalks(W) {
  const span = ROAD_HALF * 2 - 1.8;
  for (let iz = 0; iz < AVENUES; iz++) {
    for (let ix = 0; ix < AVENUES; ix++) {
      const cx = STREETS[ix];
      const cz = STREETS[iz];
      for (const arm of [-1, 1]) {
        const away = ROAD_HALF + 1.1;
        for (let k = 0; k < 6; k++) {
          const off = -ROAD_HALF + 0.9 + (k * span) / 5;
          const tickA = flatPlane(2.2, 0.7, C.roadline);
          tickA.position.set(cx + off, 0.032, cz + arm * away);
          W.scene.add(tickA);
          const tickB = flatPlane(0.7, 2.2, C.roadline);
          tickB.position.set(cx + arm * away, 0.032, cz + off);
          W.scene.add(tickB);
        }
      }
    }
  }
}

// ---------- collision ----------

/**
 * Register a solid box. (x, z) is the centre, w and d the footprint, h the height.
 * The returned box is what resolveMove, traffic probes and bullet rays test against.
 */
export function addCollider(W, x, z, w, d, h) {
  const box = {
    minX: x - w / 2,
    maxX: x + w / 2,
    minZ: z - d / 2,
    maxZ: z + d / 2,
    h: h == null ? 20 : h,
  };
  W.colliders.push(box);
  return box;
}

/** Circle-to-box overlap test used by the sweep below. */
function circleHits(cx, cz, r, b) {
  const nx = Math.max(b.minX, Math.min(cx, b.maxX));
  const nz = Math.max(b.minZ, Math.min(cz, b.maxZ));
  return (cx - nx) ** 2 + (cz - nz) ** 2 < r * r;
}

/**
 * Move a circle from (px, pz) by (dx, dz) against every collider.
 * Slides along the face it touched instead of stopping dead, so walls feel smooth.
 */
export function resolveMove(W, px, pz, r, dx, dz) {
  let x = px;
  let z = pz;
  let hit = false;
  const boxes = W.colliders;

  // X axis first.
  if (dx) {
    x += dx;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!circleHits(x, z, r, b)) continue;
      hit = true;
      x = dx > 0 ? b.minX - r - 0.001 : b.maxX + r + 0.001;
    }
  }

  // Then Z, using the already-corrected x so corners resolve cleanly.
  if (dz) {
    z += dz;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!circleHits(x, z, r, b)) continue;
      hit = true;
      z = dz > 0 ? b.minZ - r - 0.001 : b.maxZ + r + 0.001;
    }
  }

  // If a diagonal step wedged us into a corner, nudge out along the shorter escape.
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!circleHits(x, z, r, b)) continue;
    hit = true;
    const left = x - b.minX;
    const right = b.maxX - x;
    const back = z - b.minZ;
    const front = b.maxZ - z;
    const shortest = Math.min(left, right, back, front);
    if (shortest === left) x = b.minX - r - 0.001;
    else if (shortest === right) x = b.maxX + r + 0.001;
    else if (shortest === back) z = b.minZ - r - 0.001;
    else z = b.maxZ + r + 0.001;
  }

  return { x, z, hit };
}

// ---------- road queries ----------

function nearStreet(v) {
  for (let i = 0; i < AVENUES; i++) {
    if (Math.abs(v - STREETS[i]) <= ROAD_HALF) return true;
  }
  return false;
}

/** True on any asphalt, including the overlap inside an intersection. */
export function isOnRoad(W, x, z) {
  if (x > HALF || x < SEA_X || z > HALF || z < -HALF) return false;
  return nearStreet(x) || nearStreet(z);
}

/**
 * Nearest point on a road centre to (x, z), pushed into the right-hand lane for
 * traffic heading the natural way along that avenue. Spawns and fares use this.
 */
export function snapToLane(W, x, z) {
  let bestX = STREETS[0];
  let dxBest = Infinity;
  let bestZ = STREETS[0];
  let dzBest = Infinity;
  for (let i = 0; i < AVENUES; i++) {
    const s = STREETS[i];
    if (Math.abs(x - s) < dxBest) { dxBest = Math.abs(x - s); bestX = s; }
    if (Math.abs(z - s) < dzBest) { dzBest = Math.abs(z - s); bestZ = s; }
  }
  const clampX = Math.max(SEA_X + 4, Math.min(HALF - 4, x));
  const clampZ = Math.max(-HALF + 4, Math.min(HALF - 4, z));
  if (dxBest <= dzBest) return { x: clampX, z: bestZ + LANE * (clampZ >= bestZ ? 1 : -1) };
  return { x: bestX - LANE * (clampX >= bestX ? 1 : -1), z: clampZ };
}

// ---------- camera ----------

const WANT = new THREE.Vector3();
const LOOK = new THREE.Vector3();

/** World metres the view is allowed to travel before a box stops it, capped at maxLen. */
function clearRun(W, ax, az, ay, bx, bz, by, maxLen) {
  const len = Math.hypot(bx - ax, bz - az) || 1e-3;
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  const slope = (by - ay) / len;
  const boxes = W.colliders;
  let limit = maxLen;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    let t0 = 0;
    let t1 = limit;
    if (Math.abs(ux) < 1e-5) {
      if (ax < b.minX || ax > b.maxX) continue;
    } else {
      let a = (b.minX - ax) / ux;
      let c = (b.maxX - ax) / ux;
      if (a > c) { const s = a; a = c; c = s; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
    }
    if (Math.abs(uz) < 1e-5) {
      if (az < b.minZ || az > b.maxZ) continue;
    } else {
      let a = (b.minZ - az) / uz;
      let c = (b.maxZ - az) / uz;
      if (a > c) { const s = a; a = c; c = s; }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
    }
    if (t0 < t1 && t1 > 0) {
      // Only block when the box is tall enough at the height the view passes through.
      const y = ay + slope * Math.max(0, t0);
      if (b.h > y) limit = Math.min(limit, Math.max(0, t0 - 0.4));
    }
  }
  return limit;
}

/**
 * Third-person orbit. Mouse deltas swing the yaw and tilt the pitch (clamped to
 * [-0.15, 1.1]), the rig eases toward the player and pulls in when a tower sits
 * behind. focus = {x, z, inCar, distBonus}; W.camPos is public so shots can pose it.
 */
export function updateCamera(W, I, focus, dt) {
  if (!W.camPos) W.camPos = W.camera.position.clone();
  if (!isFinite(W.yaw)) W.yaw = 0;
  if (!isFinite(W.pitch)) W.pitch = 0.3;

  if (I) {
    if (I.mouse) {
      const m = I.mouse();
      if (m.dx) W.yaw -= m.dx * MOUSE_YAW;
      if (m.dy) W.pitch += m.dy * MOUSE_PITCH;
    }
    if (I.down) {
      if (I.down('ArrowLeft')) W.yaw += 2.2 * dt;
      if (I.down('ArrowRight')) W.yaw -= 2.2 * dt;
      if (I.down('ArrowUp')) W.pitch -= 1.1 * dt;
      if (I.down('ArrowDown')) W.pitch += 1.1 * dt;
    }
  }
  W.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, W.pitch));

  const inCar = !!(focus && focus.inCar);
  const distance = (inCar ? 9.5 : CONFIG.player.camDistFoot) + ((focus && focus.distBonus) || 0);
  const head = (focus && focus.y) || (inCar ? 1.4 : CONFIG.player.camHeight);
  const floor = Math.max(0.9, head + 0.45);

  LOOK.set(focus.x, head + 0.85, focus.z);
  const flat = Math.cos(W.pitch);
  WANT.set(
    LOOK.x + Math.sin(W.yaw) * distance * flat,
    Math.max(floor, LOOK.y - 0.5 + Math.sin(W.pitch) * distance),
    LOOK.z + Math.cos(W.yaw) * distance * flat,
  );

  const run = clearRun(W, LOOK.x, LOOK.z, LOOK.y, WANT.x, WANT.z, WANT.y, distance);
  if (run < distance) {
    const k = Math.max(MIN_DIST, run) / distance;
    WANT.set(LOOK.x + (WANT.x - LOOK.x) * k, LOOK.y + (WANT.y - LOOK.y) * k, LOOK.z + (WANT.z - LOOK.z) * k);
  }

  if (!isFinite(W.camPos.x) || !isFinite(W.camPos.y) || !isFinite(W.camPos.z)) W.camPos.copy(WANT);
  W.camPos.lerp(WANT, 1 - Math.pow(0.0008, Math.max(0.0001, dt)));
  W.camera.position.copy(W.camPos);
  W.camera.lookAt(LOOK);
}

// ---------- frame ----------

/** Resize the camera and canvas to the window. */
function onResize(W) {
  W.camera.aspect = window.innerWidth / window.innerHeight;
  W.camera.updateProjectionMatrix();
  W.renderer.setSize(window.innerWidth, window.innerHeight);
}

export function renderFrame(W) {
  W.renderer.render(W.scene, W.camera);
}

/** Build the world and return the handle the whole game shares. */
export function initWorld(canvas) {
  const W = {
    scene: new THREE.Scene(),
    camera: makeCamera(),
    renderer: makeRenderer(canvas),
    colliders: [],
    roads: null,
    half: HALF,
    yaw: 0,
    pitch: 0.3,
    camPos: null,
  };

  makeSky(W);
  makeLights(W);
  makeGround(W);
  makeRoads(W);
  avenuePlates(W);
  centreDashes(W);
  crosswalks(W);

  // Invisible walls so nobody drives into the sea or off the map edge.
  addCollider(W, SEA_X - 2, 0, 4, 420, 3);
  addCollider(W, 0, -HALF - 2, 420, 4, 3);
  addCollider(W, 0, HALF + 2, 420, 4, 3);
  addCollider(W, HALF + 2, 0, 4, 420, 3);

  W.camPos = W.camera.position.clone();
  window.addEventListener('resize', () => onResize(W));
  return W;
}
