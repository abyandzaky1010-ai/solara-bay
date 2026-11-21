// Money, the mart shop (B near the storefront) and the medkit pickup spots.
import * as THREE from 'three';
import { CFG } from './config.js';
import { W, dist, say } from './world.js';
import { sfx } from './sfx.js';

export function addMoney(n) { W.money += n; }

export function spend(n) {
  if (W.money < n) { sfx.denied(); say('Not enough cash.'); return false; }
  W.money -= n;
  return true;
}

// One pickup type, respawning: the medkit (green box).
export function spawnPickups() {
  const spots = [{ x: -59, z: -59 }, { x: 59, z: 159 }, { x: -169, z: 75 }];
  for (const s of spots) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshLambertMaterial({ color: 0x3ad06a }));
    m.position.set(s.x, 0.85, s.z);
    m.castShadow = true;
    W.scene.add(m);
    W.pickups.push({ mesh: m, spot: s, t: 0 });
  }
}

function buyMedkit() {
  if (W.player.hp >= CFG.playerHp) { say('HP is already full.'); return; }
  if (spend(CFG.price.medkit)) { W.player.hp = CFG.playerHp; sfx.pickup(); say('Medkit bought. HP full.'); }
}

function buyAmmo() {
  if (spend(CFG.price.ammo)) { W.player.pool += 24; sfx.pickup(); say('+24 pistol rounds.'); }
}

function buyRepair() {
  const c = W.player.inCar;
  if (!c || c.hp >= CFG.carHp) { say('No car to repair here.'); return; }
  if (spend(CFG.price.repair)) { c.hp = CFG.carHp; sfx.pickup(); say('Car repaired.'); }
}

export function updateEconomy(dt) {
  const p = W.player;
  for (const pk of W.pickups) {
    if (!pk.mesh.visible) {
      pk.t -= dt;
      if (pk.t <= 0) pk.mesh.visible = true;
      continue;
    }
    pk.mesh.rotation.y += dt * 2;
    if (!p.inCar && dist(p.pos.x, p.pos.z, pk.spot.x, pk.spot.z) < 1.7 && p.hp < CFG.playerHp) {
      p.hp = Math.min(CFG.playerHp, p.hp + 50);
      pk.mesh.visible = false;
      pk.t = 25;
      sfx.pickup();
      say('Medkit: +50 HP.');
    }
  }
  W.shopNear = !p.inCar && dist(p.pos.x, p.pos.z, W.spot.shop.x, W.spot.shop.z) < 8;
  if (W.shopNear && W.pressed.KeyB) W.shopOpen = !W.shopOpen;
  if (W.shopOpen) {
    if (W.pressed.Digit1) buyMedkit();
    if (W.pressed.Digit2) buyAmmo();
    if (W.pressed.Digit3) buyRepair();
    if (W.pressed.KeyB || W.pressed.Escape) W.shopOpen = false;
  }
}
