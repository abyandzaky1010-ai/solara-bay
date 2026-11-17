// Player: on-foot movement with WASD and third-person camera
import * as THREE from 'three';
import { keys, mouse, requestPointerLock, releasePointerLock, updateMouseLocked } from './input.js';
import { PALETTE } from './palette.js';

const SPEED = 8;
const SPRINT_MULTIPLIER = 1.8;
const MOUSE_SENSITIVITY = 0.002;
const CAMERA_HEIGHT = 4;
const CAMERA_DISTANCE = 10;

let scene, camera, playerObj, playerBody, playerMesh;
let isOnFoot = true;
let inCar = null;
let nearbyCars = [];
let wasInteractionPressed = false;
let exitPosition = null;

export function initPlayer(sceneArg, cameraArg, carsArg = []) {
  scene = sceneArg;
  camera = cameraArg || new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  nearbyCars = carsArg;
  playerBody = new THREE.Group();
  playerMesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.8), new THREE.MeshStandardMaterial({ color: PALETTE.player }));
  playerMesh.position.y = 0.9;
  playerBody.add(playerMesh);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshStandardMaterial({ color: PALETTE.playerSkin }));
  head.position.y = 1.1;
  playerMesh.add(head);
  scene.add(playerBody);
  playerBody.position.set(0, 0, 0);
  playerBody.rotation.y = 0;
  requestPointerLock();
}

export function setCar(carObj) {
  if (inCar === carObj) return;

  if (inCar) {
    inCar.userData.playerDriving = false;
    exitPosition = inCar.position.clone().add(new THREE.Vector3(2.5, 0, 0));
  }

  inCar = carObj;
  isOnFoot = !carObj;
  if (carObj) {
    carObj.userData.playerDriving = true;
    playerBody.visible = false;
    mouse.x = carObj.rotation.y / MOUSE_SENSITIVITY;
  } else {
    if (exitPosition) playerBody.position.copy(exitPosition);
    playerBody.position.y = 0;
    playerBody.visible = true;
  }
}

export function setCars(cars) {
  nearbyCars = Array.isArray(cars) ? cars : [];
}

export function findNearbyCar(maxDistance = 5) {
  if (!isOnFoot || !playerBody) return null;
  let closestCar = null;
  let closestDistance = maxDistance * maxDistance;
  for (const candidateCar of nearbyCars) {
    if (!candidateCar || candidateCar.userData.playerDriving) continue;
    const distanceSquared = candidateCar.position.distanceToSquared(playerBody.position);
    if (distanceSquared <= closestDistance) {
      closestDistance = distanceSquared;
      closestCar = candidateCar;
    }
  }
  return closestCar;
}

export function updateInteraction() {
  const interactionPressed = keys['KeyE'];
  if (interactionPressed && !wasInteractionPressed) {
    if (isOnFoot) {
      const carToEnter = findNearbyCar();
      if (carToEnter) setCar(carToEnter);
    } else {
      setCar(null);
    }
  }
  wasInteractionPressed = interactionPressed;
}

export function updatePlayer(deltaTime) {
  const cameraYaw = mouse.x * MOUSE_SENSITIVITY;
  let moveSpeed = keys['ShiftLeft'] || keys['ShiftRight'] ? SPEED * SPRINT_MULTIPLIER : SPEED;
  const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw);
  const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw);
  const moveDirection = new THREE.Vector3();
  if (keys['KeyW']) moveDirection.add(forward);
  if (keys['KeyS']) moveDirection.sub(forward);
  if (keys['KeyD']) moveDirection.add(right);
  if (keys['KeyA']) moveDirection.sub(right);

  if (moveDirection.lengthSq() > 0) {
    moveDirection.normalize().multiplyScalar(moveSpeed * deltaTime);
    playerBody.position.add(moveDirection);
    playerBody.rotation.y = cameraYaw;
    playerMesh.position.y = 0.9 + Math.sin(performance.now() * 0.012) * 0.03;
  } else {
    playerMesh.position.y = 0.9;
  }

  playerBody.position.x = Math.max(-180, Math.min(180, playerBody.position.x));
  playerBody.position.z = Math.max(-180, Math.min(180, playerBody.position.z));
}

function updateOnFootCamera() {
  const cameraYaw = mouse.x * MOUSE_SENSITIVITY;
  camera.position.set(
    playerBody.position.x - Math.sin(cameraYaw) * CAMERA_DISTANCE,
    playerBody.position.y + CAMERA_HEIGHT,
    playerBody.position.z - Math.cos(cameraYaw) * CAMERA_DISTANCE,
  );
  camera.lookAt(playerBody.position.x, playerBody.position.y + 1, playerBody.position.z);
}

function updateDriving(deltaTime) {
  let throttle = 0;
  if (keys['KeyW']) throttle = 30;
  if (keys['KeyS']) throttle = -20;
  if (keys['KeyA']) inCar.rotation.y += 3 * deltaTime;
  if (keys['KeyD']) inCar.rotation.y -= 3 * deltaTime;
  const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), inCar.rotation.y);
  inCar.position.add(forward.multiplyScalar(throttle * deltaTime));
  inCar.position.x = Math.max(-180, Math.min(180, inCar.position.x));
  inCar.position.z = Math.max(-180, Math.min(180, inCar.position.z));
  camera.position.set(
    inCar.position.x - Math.sin(inCar.rotation.y) * 14,
    6,
    inCar.position.z - Math.cos(inCar.rotation.y) * 14,
  );
  camera.lookAt(inCar.position.x, 0.8, inCar.position.z);
}

export function update(deltaTime) {
  updateMouseLocked();
  updateInteraction();
  if (isOnFoot && playerBody) {
    updatePlayer(deltaTime);
    updateOnFootCamera();
  }
  if (!isOnFoot && inCar) {
    updateDriving(deltaTime);
  }
}

export function getCar() {
  return inCar;
}

export function getBody() {
  return playerBody;
}

export function getCamera() {
  return camera;
}
