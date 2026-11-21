// Shared mutable world state, AABB collision and the localStorage save. Every system reads W.
import { CFG } from './config.js';

export const W = {
  renderer: null, scene: null, camera: null,
  mode: 'start',            // start | play | pause | busted | wasted
  time: 0, seed: 1, rng: null, shot: null, freeze: false, steps: 0,
  player: null,             // set by player.js
  cars: [],                 // every car: traffic, parked, police, gang, taxi, target
  peds: [], cops: [], fx: [], pickups: [],
  colliders: [],            // {x0, z0, x1, z1, h}
  blocks: [],               // {x, z, build} block centres (minimap + ped patrols)
  park: null,               // {x, z} the park block
  spot: {},                 // named locations: spawn, pawn, docks, garage, mara, shop, cab
  wanted: 0, lastCrime: -99, decayT: 0,
  money: CFG.startMoney,
  missionIdx: 0, mission: null, taxi: null, story: 0,
  markerPos: null, talkTarget: false, objective: '', prompt: '',
  keys: {}, pressed: {}, mouseDX: 0, mouseDY: 0, clicked: false,
  camYaw: 0.6, camPitch: 0.34,
  gunshotT: -99, alertPos: null,
  shopOpen: false, shopNear: false,
  dialog: [], dialogT: 0,
  shake: 0, arrestT: 0, overT: 0, saveT: 0,
};

export function addCollider(x0, z0, x1, z1, h = 40) {
  W.colliders.push({ x0, z0, x1, z1, h });
}

// Push a circle (x, z, r) out of every AABB collider. Returns the resolved {x, z, hit}.
export function collideCircle(x, z, r) {
  let hit = false;
  for (const c of W.colliders) {
    const nx = Math.max(c.x0, Math.min(x, c.x1));
    const nz = Math.max(c.z0, Math.min(z, c.z1));
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    hit = true;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      x = nx + (dx / d) * r; z = nz + (dz / d) * r;
    } else {
      const px0 = x - c.x0, px1 = c.x1 - x, pz0 = z - c.z0, pz1 = c.z1 - z;
      const m = Math.min(px0, px1, pz0, pz1);
      if (m === px0) x = c.x0 - r; else if (m === px1) x = c.x1 + r;
      else if (m === pz0) z = c.z0 - r; else z = c.z1 + r;
    }
  }
  return { x, z, hit };
}

// Keep an entity inside the city and out of the bay.
export function clampWorld(x, z, r) {
  const h = CFG.world / 2 - r;
  return [Math.max(-h, Math.min(h, x)), Math.max(-h, Math.min(CFG.beachZ - 1 - r, z))];
}

export const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export function say(line) { W.dialog.push(line); }

export function saveGame() {
  try {
    localStorage.setItem(CFG.saveKey, JSON.stringify({
      money: W.money, story: W.story, missionIdx: W.missionIdx,
      px: W.player.pos.x, pz: W.player.pos.z,
    }));
  } catch { /* storage unavailable */ }
}

export function loadSave() {
  try {
    const s = localStorage.getItem(CFG.saveKey);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
