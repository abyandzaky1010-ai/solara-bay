// Player: on-foot movement with WASD and third-person camera
import * as THREE from 'three';
import { keys, mouse, requestPointerLock, releasePointerLock, updateMouseLocked } from './input.js';

const SPEED = 8;
const SPRINT_MULTIPLIER = 1.8;
const MOUSE_SENSITIVITY = 0.002;
const CAMERA_HEIGHT = 4;
const CAMERA_DISTANCE = 10;

let scene, camera, playerObj, playerBody, playerMesh;
let isOnFoot = true;
let inCar = null;

export function initPlayer(sceneArg) {
  scene = sceneArg;
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  playerBody = new THREE.Group();
  playerMesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.8), new THREE.MeshStandardMaterial({ color: 0x3a4a5f }));
  playerMesh.position.y = 0.9;
  playerBody.add(playerMesh);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe8b48a }));
  head.position.y = 1.1;
  playerMesh.add(head);
  scene.add(playerBody);
  playerBody.position.set(0, 0, 0);
  playerBody.rotation.y = 0;
  requestPointerLock();
}

export function setCar(carObj) {
  inCar = carObj;
  isOnFoot = !carObj;
  if (isOnFoot) {
    playerBody.visible = true;
    playerBody.position.copy(carObj.position);
    playerBody.position.y = 0;
    releasePointerLock();
  } else {
    playerBody.visible = false;
    requestPointerLock();
  }
}

export function getCar() {
  return inCar;
}

export function getBody() {
  return playerBody;
}

export function update(deltaTime) {
  updateMouseLocked();
  if (isOnFoot && playerBody) {
    let moveSpeed = SPEED;
    if (keys['ShiftLeft'] || keys['ShiftRight']) moveSpeed *= SPRINT_MULTIPLIER;
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), playerBody.rotation.y);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), playerBody.rotation.y);
    const moveDir = new THREE.Vector3();
    if (keys['KeyW']) moveDir.add(forward);
    if (keys['KeyS']) moveDir.sub(forward);
    if (keys['KeyD']) moveDir.add(right);
    if (keys['KeyA']) moveDir.sub(right);
    if (moveDir.length() > 0) {
      moveDir.normalize().multiplyScalar(moveSpeed * deltaTime);
      playerBody.position.add(moveDir);
    }
    playerBody.position.x = Math.max(-180, Math.min(180, playerBody.position.x));
    playerBody.position.z = Math.max(-180, Math.min(180, playerBody.position.z));
    camera.position.set(playerBody.position.x - Math.sin(mouse.x * MOUSE_SENSITIVITY) * CAMERA_DISTANCE, CAMERA_HEIGHT, playerBody.position.z - Math.cos(mouse.x * MOUSE_SENSITIVITY) * CAMERA_DISTANCE);
    camera.lookAt(playerBody.position.x, 1, playerBody.position.z);
    playerBody.rotation.y = mouse.x * MOUSE_SENSITIVITY;
  }
  if (!isOnFoot && inCar) {
    let moveSpeed = 0;
    if (keys['KeyW']) moveSpeed = 30;
    if (keys['KeyS']) moveSpeed = -20;
    if (keys['KeyA']) inCar.rotation.y += 3 * deltaTime;
    if (keys['KeyD']) inCar.rotation.y -= 3 * deltaTime;
    const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), inCar.rotation.y);
    inCar.position.add(forward.multiplyScalar(moveSpeed * deltaTime));
    inCar.position.x = Math.max(-180, Math.min(180, inCar.position.x));
    inCar.position.z = Math.max(-180, Math.min(180, inCar.position.z));
    camera.position.set(inCar.position.x - Math.sin(mouse.x * MOUSE_SENSITIVITY) * CAMERA_DISTANCE, CAMERA_HEIGHT, inCar.position.z - Math.cos(mouse.x * MOUSE_SENSITIVITY) * CAMERA_DISTANCE);
    camera.lookAt(inCar.position.x, 0.5, inCar.position.z);
  }
}

export function getCamera() {
  return camera;
}
