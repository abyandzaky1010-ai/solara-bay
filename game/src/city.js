// Procedural city of Solara Bay: street grid with lanes, blocks and sidewalks, ~40 buildings with
// canvas-painted windows, a park, a waterfront promenade with pier, streetlights, the mart, and the
// named spots missions use. Fills W.colliders / W.blocks / W.park / W.spot.
import * as THREE from 'three';
import { CFG } from './config.js';
import { PAL } from './palette.js';
import { rr, ri, pick } from './random.js';
import { W, addCollider } from './world.js';

// Painted window texture so plain boxes read as buildings in the sun.
function windowTexture(rng, baseCss) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = baseCss;
  g.fillRect(0, 0, 128, 128);
  for (let y = 10; y < 122; y += 18) {
    for (let x = 10; x < 122; x += 18) {
      g.fillStyle = rng() < 0.22 ? PAL.windowLit : PAL.windowDark;
      g.fillRect(x, y, 10, 11);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function box(w, h, d, color, x, y, z, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  if (shadow) { m.castShadow = true; m.receiveShadow = true; }
  W.scene.add(m);
  return m;
}

export function buildCity(rng) {
  const scene = W.scene;
  const H = CFG.world / 2;

  // ground, sand promenade, the bay
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(CFG.world, CFG.world), new THREE.MeshLambertMaterial({ color: PAL.ground }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(CFG.world, H - CFG.beachZ), new THREE.MeshLambertMaterial({ color: PAL.sand }));
  sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0.02, (CFG.beachZ + H) / 2); sand.receiveShadow = true; scene.add(sand);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(CFG.world + 600, 600), new THREE.MeshLambertMaterial({ color: PAL.water }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, -0.25, H + 300); scene.add(water);

  // roads + centre lines (vertical roads stop at the promenade)
  for (const p of CFG.roadAt) {
    const len = CFG.beachZ + H;
    const rv = new THREE.Mesh(new THREE.PlaneGeometry(CFG.roadW, len), new THREE.MeshLambertMaterial({ color: PAL.road }));
    rv.rotation.x = -Math.PI / 2; rv.position.set(p, 0.05, (-H + CFG.beachZ) / 2); rv.receiveShadow = true; scene.add(rv);
    const rh = new THREE.Mesh(new THREE.PlaneGeometry(CFG.world, CFG.roadW), new THREE.MeshLambertMaterial({ color: PAL.road }));
    rh.rotation.x = -Math.PI / 2; rh.position.set(0, 0.05, p); rh.receiveShadow = true; scene.add(rh);
    const lv = new THREE.Mesh(new THREE.PlaneGeometry(0.4, len), new THREE.MeshBasicMaterial({ color: PAL.lane }));
    lv.rotation.x = -Math.PI / 2; lv.position.set(p, 0.07, (-H + CFG.beachZ) / 2); scene.add(lv);
    const lh = new THREE.Mesh(new THREE.PlaneGeometry(CFG.world, 0.4), new THREE.MeshBasicMaterial({ color: PAL.lane }));
    lh.rotation.x = -Math.PI / 2; lh.position.set(0, 0.07, p); scene.add(lh);
  }

  // block centres (8x8 grid of 36 m blocks; the z=+175 row is the promenade)
  const centers = [];
  for (const x of [-175, -125, -75, -25, 25, 75, 125, 175]) {
    for (const z of [-175, -125, -75, -25, 25, 75, 125, 175]) centers.push({ x, z });
  }
  const parkAt = { x: -75, z: -75 };
  const shopAt = { x: 125, z: -25 };
  const spawnAt = { x: -25, z: 25 };
  W.park = parkAt;
  for (const b of centers) {
    if (b.z === 175) { b.build = false; continue; }             // waterfront promenade
    if (b.x === parkAt.x && b.z === parkAt.z) { b.build = false; continue; }
    if (b.x === shopAt.x && b.z === shopAt.z) { b.build = false; continue; }
    if (b.x === spawnAt.x && b.z === spawnAt.z) { b.build = false; continue; }
    b.build = true;
    // sidewalk slab
    const sw = new THREE.Mesh(new THREE.BoxGeometry(CFG.blockHalf * 2, 0.3, CFG.blockHalf * 2), new THREE.MeshLambertMaterial({ color: PAL.walk }));
    sw.position.set(b.x, 0.15, b.z); sw.receiveShadow = true; scene.add(sw);
  }
  W.blocks = centers.filter((b) => b.z !== 175);

  // park: green + trees
  const parkPlane = new THREE.Mesh(new THREE.PlaneGeometry(CFG.blockHalf * 2, CFG.blockHalf * 2), new THREE.MeshLambertMaterial({ color: PAL.park }));
  parkPlane.rotation.x = -Math.PI / 2; parkPlane.position.set(parkAt.x, 0.08, parkAt.z); parkPlane.receiveShadow = true; scene.add(parkPlane);
  for (let i = 0; i < 9; i++) {
    const tx = parkAt.x + rr(rng, -15, 15), tz = parkAt.z + rr(rng, -15, 15);
    box(0.36, 2.2, 0.36, 0x7a5230, tx, 1.1, tz);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(rr(rng, 1.1, 1.7), 8, 6), new THREE.MeshLambertMaterial({ color: 0x3f9142 }));
    leaf.position.set(tx, 3, tz); leaf.castShadow = true; scene.add(leaf);
    addCollider(tx - 0.5, tz - 0.5, tx + 0.5, tz + 0.5, 4);
  }

  // buildings: fill blocks until we have nBuildings, taller in Hillcrest (north), low in Marina (south)
  const buildBlocks = centers.filter((b) => b.build);
  let made = 0, guard = 0;
  while (made < CFG.nBuildings && guard++ < 400) {
    const b = pick(rng, buildBlocks);
    if (b.used) continue;
    b.used = true;
    const w = rr(rng, 15, 29), d = rr(rng, 15, 29);
    const h = b.z >= 75 ? rr(rng, 6, 15) : b.z <= -75 ? rr(rng, 16, 44) : rr(rng, 9, 26);
    const ox = rr(rng, -3, 3), oz = rr(rng, -3, 3);
    const base = new THREE.Color(pick(rng, PAL.builds));
    const tex = windowTexture(rng, '#' + base.getHexString());
    tex.repeat.set(Math.max(1, Math.round(w / 7)), Math.max(1, Math.round(h / 6)));
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ map: tex }));
    m.position.set(b.x + ox, h / 2, b.z + oz);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.kind = 'building';
    scene.add(m);
    box(Math.min(w, d) * 0.55, 0.7, Math.min(w, d) * 0.55, pick(rng, PAL.trim), b.x + ox, h + 0.35, b.z + oz);
    addCollider(b.x + ox - w / 2, b.z + oz - d / 2, b.x + ox + w / 2, b.z + oz + d / 2, h);
    made++;
    if (rng() < 0.3 && made < CFG.nBuildings) { // second smaller tower on the same block
      const w2 = rr(rng, 8, 13), h2 = rr(rng, 5, Math.max(6, h * 0.6));
      const ox2 = ox > 0 ? -w / 4 - w2 / 2 : w / 4 + w2 / 2;
      const m2 = new THREE.Mesh(new THREE.BoxGeometry(w2, h2, w2), new THREE.MeshLambertMaterial({ color: pick(rng, PAL.builds) }));
      m2.position.set(b.x + ox2, h2 / 2, b.z + oz); m2.castShadow = true; m2.userData.kind = 'building'; scene.add(m2);
      addCollider(b.x + ox2 - w2 / 2, b.z + oz - w2 / 2, b.x + ox2 + w2 / 2, b.z + oz + w2 / 2, h2);
      made++;
    }
  }

  // streetlights at a dozen intersections
  for (let i = 0; i < 12; i++) {
    const p = pick(rng, CFG.roadAt), q = pick(rng, CFG.roadAt);
    box(0.22, 6, 0.22, 0x555c66, p + 6.4, 3, q + 6.4);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
    head.position.set(p + 6.4, 6.1, q + 6.4); scene.add(head);
  }

  // pier + lighthouse in the bay
  box(5, 0.5, 26, PAL.pier, 0, 0.4, CFG.beachZ + 11, false);
  box(3, 13, 3, 0xf2f2f2, 60, 6.5, CFG.waterZ + 10);
  box(3.4, 1.6, 3.4, 0xd84b4b, 60, 13.6, CFG.waterZ + 10);

  // the mart (shop) on its block, facing the road
  box(12, 5, 9, 0x3f7fc1, shopAt.x, 2.5, shopAt.z + 8);
  addCollider(shopAt.x - 6, shopAt.z + 3.5, shopAt.x + 6, shopAt.z + 12.5, 5);
  const signC = document.createElement('canvas'); signC.width = 256; signC.height = 48;
  const sg = signC.getContext('2d');
  sg.fillStyle = '#10233a'; sg.fillRect(0, 0, 256, 48);
  sg.fillStyle = '#ffc857'; sg.font = 'bold 28px sans-serif'; sg.textAlign = 'center';
  sg.fillText('SOLARA MART', 128, 34);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(signC) }));
  sign.position.set(shopAt.x, 5.6, shopAt.z + 8.6); scene.add(sign);

  // named spots
  W.spot = {
    spawn: { x: spawnAt.x, z: spawnAt.z },
    pawn: { x: -125, z: -75 },
    docks: { x: -25, z: 170 },
    garage: { x: 175, z: -125 },
    mara: { x: 75, z: 125 },
    shop: { x: shopAt.x, z: shopAt.z + 13 },
    cab: { x: 125, z: -144.6 },
  };
}
