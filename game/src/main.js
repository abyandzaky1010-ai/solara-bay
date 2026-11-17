// Main game loop for the GTA-style open world
import * as THREE from 'three';
import { createWorld } from './world.js';
import { initPlayer, getCamera, getCar, getBody, setCar, update } from './player.js';
import { initCar, checkInteraction } from './car.js';
import { createHUD, updateHUD } from './hud.js';
import { initInput, keys, updateMouseLocked } from './input.js';

initInput();

const canvas = document.getElementById('game');
if (!canvas) {
  console.error('Canvas not found!');
  throw new Error('Canvas not found');
}

const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const world = createWorld(scene);

initPlayer(scene);
initCar(scene, { getBody, setCar });
const hudCanvas = document.createElement('canvas');
hudCanvas.id = 'hud';
hudCanvas.style.cssText = 'position: absolute; top: 0; right: 0; z-index: 50;';
document.body.appendChild(hudCanvas);
const { healthBar, moneyLabel } = createHUD();

window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  if (getCamera()) {
    getCamera().aspect = width / height;
    getCamera().updateProjectionMatrix();
  }
});

let lastTime = performance.now();
let accumulator = 0;
const STEP = 1 / 60;
const MAX_FRAME = 0.25;

function gameLoop(now) {
  requestAnimationFrame(gameLoop);
  const deltaTime = Math.min((now - lastTime) / 1000, MAX_FRAME);
  lastTime = now;
  updateMouseLocked();
  update(deltaTime);
  updateHUD();
  renderer.render(scene, getCamera());
}

requestAnimationFrame(gameLoop);
