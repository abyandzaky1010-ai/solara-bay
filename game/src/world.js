// Lighting, sky, fog and the map colliders: a fixed late-afternoon sun with
// shadows, a hemispheric fill, warm pale fog for depth, and an AABB list of
// every solid box (buildings, trees) plus the playable bounds and the water
// edge. AABB only — no physics engine.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { buildCity, CITY } from './city.js';

export function createWorld(scene) {
  const sunPosition = new THREE.Vector3(180, 260, -120);
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 220, 620);

  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x8a7a5f, 0.85);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(PALETTE.sun, 1.7);
  sun.position.copy(sunPosition);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 50;
  sun.shadow.camera.far = 900;
  const s = 300;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0006;
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(0xffe0b0, 0.3);
  fill.position.set(-140, 200, 160);
  scene.add(fill);

  buildCity(scene);
  return { sun, sunPosition, hemi, colliders: CITY.colliders, water: CITY.water, bounds: CITY.bounds };
}
