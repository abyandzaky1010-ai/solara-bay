// Solara Bay — the three jobs Vesper hands out, the gold beacons that point at them,
// the clock on the ones that hurry, and the ways a job goes wrong.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C } from './palette.js';
import { addStars, clearPolice } from './police.js';

const MREWARD = CONFIG.missions;
const MARK_REACH = 5; // m: close enough to touch the beacon
const STOPPED = 1; // m/s: "stopped" for a delivery
const COLUMN_H = 14;

/**
 * The story in three beats. `leads` names the marker each running stage points at,
 * `steps` holds the line the HUD shows, `story` is what the complete panel prints.
 */
export const MISSIONS = [
  {
    id: 'm1',
    title: 'Wheels for Vesper',
    brief: 'Vesper wants the Coral coupe back. Take it, bring it to the Glass Orchid.',
    giver: 'glassOrchid',
    reward: MREWARD.m1,
    story: 'It runs. Vesper smiles like a knife.',
    retry: 'The Coral coupe is back in its bay. Take it again when you are ready.',
    steps: { steal: 'Steal the coral coupe', deliver: 'Drive it to the Glass Orchid and stop' },
  },
  {
    id: 'm2',
    title: 'Shake the Heat',
    brief: 'Show Vesper you can take the heat. Get two stars, then lose them within 90 seconds.',
    giver: 'glassOrchid',
    reward: MREWARD.m2,
    story: 'The sirens fade. Somewhere out there, Otis is smiling.',
    retry: 'The clock ran out with the sirens still howling. Run it again.',
    steps: { armed: 'Make some noise: get two stars', evade: 'Lose the police before the clock runs out' },
  },
  {
    id: 'm3',
    title: 'Harbor Handoff',
    brief: 'Pick up the package at the west pier and deliver it to the Glass Orchid in 120 s. Expect heat.',
    giver: 'glassOrchid',
    reward: MREWARD.m3,
    story: 'Solara Bay knows your name now. Free ride: fares pay, the shop sells, the bay stays warm.',
    retry: 'The package is still on the pier. The Glass Orchid is still waiting.',
    steps: { pickup: 'Pick up the package at the west pier', deliver: 'Deliver the package to the Glass Orchid' },
  },
];

/** The two lines under the title screen. */
export const INTRO = [
  'Vesper runs the Glass Orchid, and every favour in the bay gets paid back there.',
  'Three jobs. One city with a short memory and a long nightstick.',
];

/** Fresh mission record: chapter index, running job, its clock, its beacon. */
export function initMissions() {
  return { index: 0, active: null, timer: 0, step: '', marker: null, beacon: null, retries: 0, lastPrompt: -1 };
}

const currentDef = (M) => MISSIONS[Math.min(M.index, MISSIONS.length - 1)];
const at = (x, z) => (x === undefined ? null : { x, z });
const stepText = (A) => (A ? A.def.steps[A.stage] || A.def.brief : '');

// Where a lead points right now. Live car positions, so m1's marker follows the coupe.
function leadPoint(M, G, key) {
  const city = G.city || {};
  const marks = city.markers || {};
  if (key === 'pier') return at(city.pier?.x ?? -194, city.pier?.z ?? -150);
  if (key === 'lockup') return marks.glassOrchid ? at(marks.glassOrchid.x, marks.glassOrchid.z) : null;
  const coupe = G.m1car || (G.cars || []).find((c) => c.tag === 'm1car');
  return coupe && !coupe.wrecked ? at(coupe.x, coupe.z) : null;
}

// ------------------------------------------------------------------ the beacon

// A gold column with a ring at its foot, built on first use and moved afterwards.
function buildBeacon(W) {
  const group = new THREE.Group();
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, COLUMN_H, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: C.marker, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide }),
  );
  column.position.y = COLUMN_H / 2;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.8, 0.14, 6, 20),
    new THREE.MeshBasicMaterial({ color: C.marker, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  Object.assign(ring.rotation, { x: -Math.PI / 2 });
  ring.position.y = 0.25;
  group.add(column, ring);
  group.userData = { column, ring };
  W.scene.add(group);
  return group;
}

function placeBeacon(M, G, point) {
  if (!point) {
    if (M.beacon) M.beacon.visible = false;
    return;
  }
  if (!M.beacon) M.beacon = buildBeacon(G.W);
  M.beacon.visible = true;
  M.beacon.position.set(point.x, 0, point.z);
}

// Breath in and out: opacity rides a slow sine, the ring spins with the clock.
function pulseBeacon(M, t) {
  if (!M.beacon?.visible) return;
  const { column, ring } = M.beacon.userData;
  const beat = 0.5 + 0.5 * Math.sin(t * 2.4);
  column.material.opacity = 0.18 + beat * 0.16;
  ring.material.opacity = 0.6 + beat * 0.35;
  ring.rotation.z = t * 0.9;
}

// ------------------------------------------------------------------ the job board

/** Start the next job: from the tablet at the Glass Orchid, or the panel button. */
export function startMission(M, G) {
  if (!M || !G || M.index >= MISSIONS.length || M.active) return null;
  const def = currentDef(M);
  const stage = def.id === 'm1' ? 'steal' : def.id === 'm2' ? 'armed' : 'pickup';
  M.active = { def, stage, clock: 0, warned: 0 };
  M.step = stepText(M.active);
  M.timer = 0;
  M.retries = 0;
  M.marker = def.id === 'm2' ? null : leadPoint(M, G, stage);
  placeBeacon(M, G, M.marker);
  G.sound?.chime?.();
  G.H?.toast?.(`${def.title}: ${M.step}`);
  return M.active;
}

// The job goes back on the board, unpaid, with the reason on screen.
function failMission(M, G, why) {
  const def = M.active.def;
  Object.assign(M, { active: null, marker: null, timer: 0, step: '', lastPrompt: M.index });
  if (M.beacon) M.beacon.visible = false;
  G.objective = null;
  G.H?.toast?.(`Job failed: ${def.title}`);
  if (G.missionFail) G.missionFail(def.title, why || def.retry);
  else G.showPanel?.('complete');
}

// Pay out, log the story, turn the page.
function completeMission(M, G) {
  const def = M.active.def;
  Object.assign(M, { active: null, marker: null, timer: 0, step: '' });
  M.index += 1;
  if (M.beacon) M.beacon.visible = false;
  G.objective = null;
  G.sound?.jingle?.(true);
  if (G.missionComplete) G.missionComplete(def.reward, def.story);
  else G.addMoney?.(def.reward);
  // The last job ends with a clean record.
  if (def.id === 'm3' && G.PO) clearPolice(G.PO, G);
  return def;
}

// ------------------------------------------------------------------ stage tests

// Is she inside the beacon's reach, and standing still?
function delivered(G, point) {
  if (!point) return false;
  if (G.inCar) return Math.abs(G.inCar.speed) < STOPPED && Math.hypot(G.inCar.x - point.x, G.inCar.z - point.z) <= MARK_REACH;
  const P = G.P;
  return !P.dead && (P.speed || 0) < STOPPED && Math.hypot(P.pos.x - point.x, P.pos.z - point.z) <= MARK_REACH;
}

// m1: steal the coupe, then park it inside the lockup.
function runWheels(M, G) {
  const A = M.active;
  if (A.stage === 'steal') {
    M.marker = leadPoint(M, G, 'steal');
    const coupe = G.m1car;
    if (coupe?.wrecked) return failMission(M, G, 'The Coral coupe is a wreck. Vesper wants it whole.');
    if (coupe?.player) {
      Object.assign(A, { stage: 'deliver' });
      G.sound?.chime?.();
      G.H?.toast?.('Coupe taken. Glass Orchid, and parked.');
    }
    return;
  }
  M.marker = leadPoint(M, G, 'lockup');
  const car = G.inCar;
  if (!car || car.wrecked || car.tag !== 'm1car') {
    if (G.m1car?.wrecked) return failMission(M, G, MISSIONS[0].retry);
    M.marker = G.m1car ? at(G.m1car.x, G.m1car.z) : M.marker;
    return;
  }
  if (delivered(G, M.marker)) completeMission(M, G);
}

// m2: two stars, then ninety seconds to shake them.
function runShake(M, G, dt) {
  const A = M.active;
  M.marker = null;
  const stars = G.PO?.stars | 0;
  if (A.stage === 'armed') {
    if (stars < 2) return;
    Object.assign(A, { stage: 'evade', clock: MREWARD.m2EvadeSec });
    M.timer = Math.ceil(A.clock);
    G.sound?.chime?.();
    G.H?.toast?.('Two stars. Ninety seconds. Go dark.');
    return;
  }
  A.clock -= dt;
  M.timer = Math.max(0, Math.ceil(A.clock));
  if (stars <= 0) completeMission(M, G);
  else if (A.clock <= 0) failMission(M, G, MISSIONS[1].retry);
}

// m3: the pier package, three stars of chase, the lockup inside the clock.
function runHarbor(M, G, dt) {
  const A = M.active;
  if (A.stage === 'pickup') {
    M.marker = leadPoint(M, G, 'pier');
    if (!delivered(G, M.marker)) return;
    Object.assign(A, { stage: 'deliver', clock: MREWARD.m3DeliverySec });
    M.timer = Math.ceil(A.clock);
    if (G.PO) (G.PO.stars = 0) || addStars(G.PO, 3, G);
    G.sound?.siren?.(true);
    G.H?.toast?.('Package aboard. The dock is full of cruisers.');
    return;
  }
  M.marker = leadPoint(M, G, 'lockup');
  A.clock -= dt;
  M.timer = Math.max(0, Math.ceil(A.clock));
  // The heat stays on while she runs the package.
  if (G.PO && (G.PO.stars | 0) < 2 && A.clock > 6) addStars(G.PO, 1, G);
  if (delivered(G, M.marker)) completeMission(M, G);
  else if (A.clock <= 0) failMission(M, G, MISSIONS[2].retry);
}

// ------------------------------------------------------------------ the frame

/**
 * One tick of the job tablet: beacon glow, the running step, the clock, wins and losses.
 * With nothing running, the marker sits on the giver so the map can point there.
 */
export function updateMissions(M, G, dt) {
  if (!M || !G?.P) return M;
  pulseBeacon(M, G.time || 0);

  if (!M.active) {
    if (M.index >= MISSIONS.length) return M;
    const giver = (G.city?.markers || {})[currentDef(M).giver];
    if (giver) placeBeacon(M, G, at(giver.x, giver.z));
    return M;
  }

  const def = M.active.def;
  if (def.id === 'm1') runWheels(M, G);
  else if (def.id === 'm2') runShake(M, G, dt);
  else runHarbor(M, G, dt);
  if (!M.active) return M;

  M.step = stepText(M.active);
  placeBeacon(M, G, M.marker);
  const me = G.inCar && !G.inCar.wrecked ? G.inCar : G.P.pos;
  G.objective = {
    title: def.title,
    text: M.step,
    dist: M.marker ? Math.round(Math.hypot(me.x - M.marker.x, me.z - M.marker.z)) : 0,
    timer: M.timer || 0,
    kind: M.active.stage,
  };
  return M;
}

/** One line for the pause and complete panels: the chapter, the step, the clock. */
export function missionPanelText(M) {
  if (!M) return '';
  if (M.active) {
    const s = M.timer;
    const clock = s ? ` · ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : '';
    return `${M.active.def.title}: ${M.step}${clock}`;
  }
  if (M.index >= MISSIONS.length) return 'All three jobs done. The bay is yours.';
  const def = currentDef(M);
  return `Next: ${def.title}: ${def.brief}`;
}

/** A short label for the title screen and save panel. */
export function missionLabel(M) {
  if (!M) return '';
  if (M.active) return missionPanelText(M);
  return M.index >= MISSIONS.length ? 'All jobs done.' : `Next: ${currentDef(M).title}`;
}

/** How far through the story, 0..1. */
export function missionProgress(M) {
  return M ? Math.min(1, M.index / MISSIONS.length) : 0;
}
