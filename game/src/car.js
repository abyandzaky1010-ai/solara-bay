// Car: parked car that can be entered/exited
import * as THREE from 'three';
import { PALETTE } from './palette.js';

let scene, player;
let parkedCar = null;

export function initCar(sceneArg, playerArg) {
  scene = sceneArg;
  player = playerArg;
  createParkedCar();
}

function createParkedCar() {
  const carGroup = new THREE.Group();
  const bodyGeo = new THREE.BoxGeometry(1.8, 0.8, 4);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd84f3f });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.6;
  carGroup.add(body);
  const roofGeo = new THREE.BoxGeometry(1.6, 0.6, 2);
  const roof = new THREE.Mesh(roofGeo, bodyMat);
  roof.position.y = 1.4;
  roof.position.z = -0.3;
  carGroup.add(roof);
  const windshieldGeo = new THREE.BoxGeometry(1.5, 0.5, 0.1);
  const windshieldMat = new THREE.MeshStandardMaterial({ color: 0x87CEEB, transparent: true, opacity: 0.7 });
  const windshield = new THREE.Mesh(windshieldGeo, windshieldMat);
  windshield.position.set(0, 1.2, 0.95);
  windshield.rotation.x = -0.3;
  carGroup.add(windshield);
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: PALETTE.carTrim });
  const wheelPositions = [[-0.9, 0.35, 1.3], [0.9, 0.35, 1.3], [-0.9, 0.35, -1.3], [0.9, 0.35, -1.3]];
  wheelPositions.forEach(pos => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(...pos);
    carGroup.add(wheel);
  });
  const lightGeo = new THREE.BoxGeometry(0.4, 0.2, 0.1);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffaa, emissive: 0xffffaa, emissiveIntensity: 0.5 });
  const headlight1 = new THREE.Mesh(lightGeo, lightMat);
  headlight1.position.set(-0.5, 0.6, 2);
  carGroup.add(headlight1);
  const headlight2 = headlight1.clone();
  headlight2.position.set(0.5, 0.6, 2);
  carGroup.add(headlight2);
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.3 });
  const taillight1 = new THREE.Mesh(lightGeo, tailMat);
  taillight1.position.set(-0.5, 0.6, -2);
  carGroup.add(taillight1);
  const taillight2 = taillight1.clone();
  taillight2.position.set(0.5, 0.6, -2);
  carGroup.add(taillight2);
  carGroup.position.set(0, 0, 0);
  carGroup.rotation.y = 0;
  scene.add(carGroup);
  parkedCar = carGroup;
  carGroup.userData.inCar = false;
}

export function getCar() {
  return parkedCar;
}

export function enterCar() {
  if (!parkedCar) return false;
  player.setCar(parkedCar);
  return true;
}

export function exitCar() {
  if (!parkedCar) return false;
  player.setCar(null);
  return true;
}

export function checkInteraction() {
  if (!parkedCar) return null;
  const dist = player.getBody().position.distanceTo(parkedCar.position);
  return dist < 3 ? parkedCar : null;
}
export const GAME_TITLE = "Solara Bay";
