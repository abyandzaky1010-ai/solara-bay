export function updateTraffic() {
  for (let i = 0; i < trafficCars.length; i++) {
    const car = trafficCars[i];
    let shouldMove = true;
    
    // Check distance to other cars
    for (let j = 0; j < trafficCars.length; j++) {
      if (i === j) continue;
      const otherCar = trafficCars[j];
      const dist = car.car.position.distanceTo(otherCar.car.position);
      if (dist < TRAFFIC_DISTANCE) {
        shouldMove = false;
        break;
      }
    }
    
    if (shouldMove) {
      car.car.position.z += car.speed * car.direction;
      
      // Reset position when car goes out of bounds
      if (car.car.position.z > 50) {
        car.car.position.z = -50;
      } else if (car.car.position.z < -50) {
        car.car.position.z = 50;
      }
    }
  }
}

export function spawnTrafficCars(sceneArg) {
  scene = sceneArg;
  // Create 3 traffic cars with different colors and speeds
  const colors = [0x3366cc, 0x33cc33, 0xcc3333, 0xcca133, 0x9999cc];
  const speeds = [0.015, 0.02, 0.018, 0.012, 0.025];
  const positions = [
    { x: -30, z: 10 },
    { x: -30, z: -10 },
    { x: 30, z: 10 },
    { x: 30, z: -10 },
    { x: 0, z: 25 }
  ];
  const directions = [1, -1, 1, -1, 1];
  
  for (let i = 0; i < 5; i++) {
    const carGroup = new THREE.Group();
    const color = colors[i];
    const speed = speeds[i];
    const pos = positions[i];
    const dir = directions[i];
    
    const bodyGeo = new THREE.BoxGeometry(1.8, 0.8, 4);
    const bodyMat = new THREE.MeshStandardMaterial({ color: color });
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
    wheelPositions.forEach(wp => {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(...wp);
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
    
    carGroup.position.set(pos.x, 0, pos.z);
    carGroup.rotation.y = dir === 1 ? 0 : Math.PI;
    scene.add(carGroup);
    
    trafficCars.push({
      car: carGroup,
      speed: speed,
      direction: dir
    });
  }
}

// Car: parked car that can be entered/exited
import * as THREE from 'three';
import { PALETTE } from './palette.js';

let scene, player;
let parkedCar = null;
let trafficCars = [];
const TRAFFIC_SPEED = 0.02;
const TRAFFIC_DISTANCE = 5;
let trafficDirection = 1; // 1 for forward, -1 for backward

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
