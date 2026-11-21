// Three.js setup: renderer, sun-soaked day lights, shadows, camera, and the mesh factories
// (humanoid characters, box-built cars) every other system uses.
import * as THREE from 'three';
import { PAL } from './palette.js';
import { W } from './world.js';

export function initRender(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.sky);
  scene.fog = new THREE.Fog(PAL.fog, 130, 460);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
  camera.position.set(0, 40, 80);

  const sun = new THREE.DirectionalLight(PAL.sun, 2.6);
  sun.position.set(120, 190, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -230; sc.right = 230; sc.top = 230; sc.bottom = -230; sc.far = 600;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 1.15));
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));

  W.renderer = renderer; W.scene = scene; W.camera = camera;
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  return { renderer, scene, camera };
}

// Low-poly humanoid facing +z: legs, torso, head.
export function makeHumanoid(shirt, pants = 0x2c3242, skin = 0xd9a06b) {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.75, 0.34), new THREE.MeshLambertMaterial({ color: shirt }));
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), new THREE.MeshLambertMaterial({ color: skin }));
  head.position.y = 1.68;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.3), new THREE.MeshLambertMaterial({ color: pants }));
  legs.position.y = 0.35;
  for (const m of [torso, head, legs]) { m.castShadow = true; g.add(m); }
  return g;
}

// Box-built car: body, cabin, four wheels, lights; police light bar / taxi roof sign optional.
export function makeCarMesh(color, opts = {}) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.75, 4.4), new THREE.MeshLambertMaterial({ color }));
  body.position.y = 0.62; body.castShadow = true; g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.65, 2.3), new THREE.MeshLambertMaterial({ color: 0x222a36 }));
  cab.position.set(0, 1.3, -0.25); cab.castShadow = true; g.add(cab);
  const wheelG = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  const wheelM = new THREE.MeshLambertMaterial({ color: 0x15161a });
  const wheels = [];
  for (const [x, z] of [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]]) {
    const w = new THREE.Mesh(wheelG, wheelM);
    w.rotation.z = Math.PI / 2; w.position.set(x, 0.38, z);
    g.add(w); wheels.push(w);
  }
  const hl = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.08), new THREE.MeshBasicMaterial({ color: 0xfff6c8 }));
  hl.position.set(0, 0.66, 2.21); g.add(hl);
  const tl = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.16, 0.08), new THREE.MeshBasicMaterial({ color: 0xd8323c }));
  tl.position.set(0, 0.66, -2.21); g.add(tl);
  let bar = null;
  if (opts.police) {
    bar = new THREE.Group();
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2038 }));
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.3), new THREE.MeshBasicMaterial({ color: 0x2050ff }));
    r.position.x = -0.32; b.position.x = 0.32;
    bar.add(r, b); bar.position.set(0, 1.78, -0.25); g.add(bar);
  }
  if (opts.taxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.25), new THREE.MeshBasicMaterial({ color: 0xf5c518 }));
    sign.position.set(0, 1.78, -0.25); g.add(sign);
  }
  return { group: g, wheels, bar };
}
