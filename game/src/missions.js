// Solara Bay: the three-chapter story, its quest markers and its win/fail logic.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';

const MSG = CONFIG.missions;
const PIER = { x: -184, z: -96 };
const GIVER = { x: -30, z: -34 };
const NEAR = 8;      // m: close enough to the giver to start
const INSIDE = 5;    // m: inside a delivery lockup
const PARKED = 1;    // m/s or less counts as stopped
const TOUCH = 3;     // m on foot from the coupe to take it
const DONE = 'The story is done. The bay is yours.';

export const MISSIONS = [
  {
    id: 'm1',
    title: 'Wheels for Vesper',
    brief: 'Vesper wants the Coral coupe back. Take it, bring it to the Glass Orchid.',
    reward: MSG.m1,
    story: 'It runs. Vesper smiles like a knife.',
    retry: 'The coupe is waiting by the Glass Orchid. Go take it back.',
  },
  {
    id: 'm2',
    title: 'Shake the Heat',
    brief: 'Show Vesper you can take the heat. Get two stars, then lose them within 90 seconds.',
    reward: MSG.m2,
    story: 'The sirens fade. Somewhere out there, Otis is smiling.',
    retry: 'Lose the stars before the clock runs out. Keep moving, break the line of sight.',
  },
  {
    id: 'm3',
    title: 'Harbor Handoff',
    brief: 'Pick up Otis\u2019s last package at the pier and deliver it to the Glass Orchid in 120 s. Expect heat.',
    reward: MSG.m3,
    story: 'Solara Bay knows your name now. Free ride: fares pay, the shop sells, the bay stays warm.',
    retry: 'The package is still on the west pier. Bring it to the Glass Orchid.',
  },
];

export const INTRO = [
  'Vesper keeps the Glass Orchid running and her ledger clean.',
  'She needs one driver with cold hands and a warm engine.',
];

// index = chapter, active = the running stage, timer = the countdown the HUD shows.
export function initMissions() {
  return { index: 0, active: null, timer: 0, step: '', marker: null, target: null, beacon: null, retries: 0, lastPrompt: -1 };
}

const at = (G) => (G.inCar ? { x: G.inCar.x, z: G.inCar.z, speed: Math.abs(G.inCar.speed), car: G.inCar } : { x: G.P.pos.x, z: G.P.pos.z, speed: 0, car: null });
const dist = (p, x, z) => Math.hypot(p.x - x, p.z - z);
const coupe = (G, M) => M.car || (G.cars || []).find((c) => c.tag === 'm1car') || null;

// The gold beacon: a glowing column, a ring at the kerb and a pip on top (pulses in updateMissions).
function buildBeacon(scene) {
  const group = new THREE.Group();
  const column = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 7, 12, 1, true), new THREE.MeshBasicMaterial({ color: C.marker, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
  column.position.y = 3.5;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, 0.16, 6, 24).rotateX(Math.PI / 2), material(C.marker, { flat: true }));
  ring.position.y = 0.14;
  const pip = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), material(C.beacon, { flat: true }));
  pip.position.y = 7.4;
  group.add(column, ring, pip);
  group.userData = { column, ring, pip };
  scene.add(group);
  return group;
}

function aim(M, G, x, z) {
  if (!G.W) return;
  if (!M.beacon) M.beacon = buildBeacon(G.W.scene);
  M.beacon.visible = true;
  M.beacon.position.set(x, 0, z);
  M.marker = M.target = { x, z };
}

function clearAim(M) {
  if (M.beacon) M.beacon.visible = false;
  M.marker = M.target = null;
}

const STEP_TEXT = { steal: 'steal the Coral coupe', drive: 'drive it to the Glass Orchid and stop', arm: 'get two stars, then shake them', evade: 'lose the police before the clock runs out', pickup: 'pick up the package at the west pier', deliver: 'deliver it to the Glass Orchid and stop' };

// The line the HUD shows for the active stage.
const stageText = (active) => STEP_TEXT[active.stage] || active.def.brief;

// Start the current chapter: at the giver, or from a panel button.
export function startMission(M, G) {
  if (!M || !G || M.active || M.index >= MISSIONS.length) return false;
  if (!G.forceStart && dist(G.P.pos, GIVER.x, GIVER.z) > NEAR) return false;
  const def = MISSIONS[M.index];
  M.retries = 0;
  M.lastPrompt = -1;
  M.active = { def, stage: def.id === 'm1' ? 'steal' : def.id === 'm2' ? 'arm' : 'pickup', clock: 0, warned: false };
  M.step = stageText(M.active);
  M.timer = 0;
  G.objective = { title: def.title, text: M.step, dist: 0 };
  G.missionStart?.(M.index, def);
  // Chapter two gets no marker: the work is shaking the cops, not driving.
  if (def.id === 'm2') clearAim(M);
  else {
    const car = def.id === 'm1' ? coupe(G, M) : null;
    const spot = def.id === 'm3' ? PIER : car || G.city.markers.glassOrchid;
    aim(M, G, spot.x, spot.z);
  }
  return true;
}

function complete(M, G, car) {
  const def = M.active.def;
  clearAim(M);
  M.active = null;
  M.timer = 0;
  M.index += 1;
  M.step = M.index < MISSIONS.length ? MISSIONS[M.index].brief : DONE;
  // The coupe is yours now: it stops being a mark and nobody else wants the keys.
  if (car) Object.assign(car, { tag: null, occupied: null });
  G.missionComplete?.(def.reward, def.story);
}

// Back to the giver with a hint: nothing is lost but time.
function fail(M, G, why) {
  const def = M.active.def;
  M.retries += 1;
  M.active = null;
  M.timer = 0;
  M.step = def.retry;
  clearAim(M);
  G.missionFail?.(def.title, why || def.retry);
}

// Chapter one: take the coupe, then park it in the Orchid's lockup.
function actOnWheels(M, G, here, dt) {
  const active = M.active;
  const car = coupe(G, M);
  const lockup = G.city.markers.glassOrchid;
  if (car && car.wrecked) return fail(M, G, 'the coupe is scrap');
  active.clock += dt;
  if (active.stage === 'steal') {
    if (car) aim(M, G, car.x, car.z);
    if (here.car && here.car === car) {
      active.stage = 'drive';
      return;
    }
    // Walk up to the coupe and the main loop hands it over.
    if (car && dist(here, car.x, car.z) < TOUCH) G.stolen?.(car, M);
    return;
  }
  aim(M, G, lockup.x, lockup.z);
  // The coupe itself has to be inside the lockup and stopped, whoever drove it there.
  if (car && dist(car, lockup.x, lockup.z) < INSIDE && Math.abs(car.speed) < PARKED) complete(M, G, car);
}

// Chapter two: two stars, then ninety seconds to lose them.
function actShakeHeat(M, G, dt) {
  const active = M.active;
  clearAim(M);
  if (active.stage === 'arm') {
    if (G.PO.stars >= 2) {
      active.stage = 'evade';
      active.clock = 0;
      M.timer = MSG.m2EvadeSec;
      G.toast?.('Two stars. Lose them in 90 seconds.');
    }
    return;
  }
  active.clock += dt;
  M.timer = Math.max(0, MSG.m2EvadeSec - active.clock);
  if (G.PO.stars === 0) complete(M, G);
  else if (active.clock >= MSG.m2EvadeSec) fail(M, G, 'the clock ran out and the sirens stayed');
}

// Chapter three: the package on the west pier, then home with heat on the tail.
function actHandoff(M, G, here, dt) {
  const active = M.active;
  if (active.stage === 'pickup') {
    aim(M, G, PIER.x, PIER.z);
    if (dist(here, PIER.x, PIER.z) < 6) {
      active.stage = 'deliver';
      active.clock = 0;
      M.timer = MSG.m3DeliverySec;
      G.addStars?.(3);
      G.toast?.('Package secured. Sirens inbound.');
      aim(M, G, G.city.markers.glassOrchid.x, G.city.markers.glassOrchid.z);
    }
    return;
  }
  const lockup = G.city.markers.glassOrchid;
  aim(M, G, lockup.x, lockup.z);
  active.clock += dt;
  if (dist(here, lockup.x, lockup.z) < INSIDE && here.speed < PARKED) {
    G.PO.stars = 0;
    G.sound?.siren?.(false);
    return complete(M, G);
  }
  // Out of time with the package still in hand: Otis waits, and Vesper notices.
  if (active.clock >= MSG.m3DeliverySec) fail(M, G, 'Otis is waiting and the clock is empty');
}

// The one frame call: marker, stage logic, countdown, HUD objective.
export function updateMissions(M, G, dt) {
  if (!M || !G || !G.P || (G.screen && G.screen !== 'play')) return;
  const here = at(G);
  const active = M.active;

  if (!active) {
    M.step = M.index < MISSIONS.length ? MISSIONS[M.index].brief : DONE;
    if (M.index < MISSIONS.length) {
      // Chapter one points at the coupe itself, later chapters at Vesper's door.
      const car = M.index === 0 ? coupe(G, M) : null;
      aim(M, G, car ? car.x : GIVER.x, car ? car.z : GIVER.z);
      G.objective = { title: MISSIONS[M.index].title, text: M.step, dist: M.target ? Math.round(dist(here, M.target.x, M.target.z)) : 0 };
      if (dist(here, GIVER.x, GIVER.z) < NEAR && M.lastPrompt !== M.index) {
        M.lastPrompt = M.index;
        G.missionPrompt?.(M.index);
      }
    } else {
      clearAim(M);
      G.objective = { title: 'Solara Bay', text: 'free ride \u2014 fares, the shop, the sunshine', dist: 0 };
    }
  } else if (active.def.id === 'm1') actOnWheels(M, G, here, dt);
  else if (active.def.id === 'm2') actShakeHeat(M, G, dt);
  else actHandoff(M, G, here, dt);

  // A wrecked ride in either driving chapter ends it on the spot.
  if (M.active && here.car && here.car.wrecked && M.active.def.id !== 'm2') fail(M, G, 'the ride is wrecked');

  // Beacon breathing, then the HUD line.
  if (M.beacon && M.beacon.visible && G.time !== undefined) {
    const ud = M.beacon.userData;
    ud.ring.scale.setScalar(1 + Math.sin(G.time * 3) * 0.14);
    ud.pip.rotation.y = G.time * 1.6;
    ud.column.material.opacity = 0.26 + Math.sin(G.time * 3) * 0.1;
  }
  if (M.active) G.objective = { title: M.active.def.title, text: M.step, dist: M.target ? Math.round(dist(here, M.target.x, M.target.z)) : 0, timer: M.timer };
}

// Panel copy for the pause screen and the shop sign: title, brief, step, pay.
export function missionPanelText(M) {
  const def = M?.active?.def || MISSIONS[Math.min(M?.index || 0, MISSIONS.length - 1)];
  // Panels and the shop read the title from here.
  return { title: def.title, brief: def.brief, step: M?.step || def.brief, reward: def.reward, count: `${Math.min((M?.index || 0) + 1, MISSIONS.length)} / ${MISSIONS.length}` };
}
