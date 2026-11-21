// Solara Bay — Vesper's three errands: a coupe to bring home, a tail to shake,
// and one package off the pier. A gold beacon always points at the next move.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';

const MS = CONFIG.missions;
const STOP = 1;   // "stopped" = a car under 1 m/s inside the ring
const REACH = 5;  // lockup and drop-off radius

/* ------------------------------------------------------------------ stories */

export const INTRO = [
  'Vesper runs the Glass Orchid lockup on Ivy Street and owes nothing to nobody.',
  'You owe her. Three errands and the ledger closes.',
];

/** The three jobs in order; the HUD prints title, step, reward and story. */
export const MISSIONS = [
  {
    id: 'm1',
    title: 'Wheels for Vesper',
    brief: 'Take the coral coupe from the corner and park it in the Glass Orchid lockup.',
    steps: { steal: 'steal the coral coupe', deliver: 'drive it to the Glass Orchid and stop' },
    reward: MS.m1,
    story: 'It runs. Vesper smiles like a knife.',
  },
  {
    id: 'm2',
    title: 'Shake the Heat',
    brief: 'Get two stars on you, then lose the whole tail inside ninety seconds.',
    steps: { arm: 'get two stars', evade: 'lose the heat' },
    reward: MS.m2,
    story: 'The sirens fade. Somewhere out there, Otis is smiling.',
  },
  {
    id: 'm3',
    title: 'Harbor Handoff',
    brief: 'Pry the package off the west pier and run it back to the Glass Orchid. Expect heat.',
    steps: { pickup: 'collect the package at the pier', deliver: 'deliver it to the Glass Orchid' },
    reward: MS.m3,
    story: 'Solara Bay knows your name now. Free ride: fares pay, the shop sells, the bay stays warm.',
  },
];

const land = (m, dx, dz) => ({ x: m.x + dx, z: m.z + dz });
const lockup = (G) => (G.city && G.city.markers && G.city.markers.glassOrchid) || { x: 32, z: -30 };
const giver = (G) => land(lockup(G), -3, 10);   // Vesper's table, behind the pad
const pier = () => ({ x: -186, z: -104 });      // west pier, top of the bay

/* --------------------------------------------------------------------- state */

/** Mission bookkeeping: which job is live, its clock and its beacon. */
export function initMissions() {
  return { index: 0, active: null, done: 0, marker: null, timer: 0, stage: null };
}

/* ------------------------------------------------------------------- beacon */

/** Gold cylinder of light, a ground ring and a spinning pip — moved, not remade. */
function makeBeacon() {
  const g = new THREE.Group();
  g.name = 'missionBeacon';
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 9, 18, 1, true),
    new THREE.MeshBasicMaterial({ color: C.beacon, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
  );
  column.position.y = 4.5;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.9, 2.7, 28),
    new THREE.MeshBasicMaterial({ color: C.marker, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  const pip = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), material(C.beacon, { flat: true }));
  pip.position.y = 3.8;
  g.add(column, ring, pip);
  Object.assign(g.userData, { column, ring, pip, t: 0 });
  return g;
}

/** Park the beacon on the target, or hide it for jobs with nothing to touch. */
function beacon(M, W, at) {
  if (!at) { if (M.marker) M.marker.visible = false; return null; }
  if (!M.marker) {
    M.marker = makeBeacon();
    if (W && W.scene) W.scene.add(M.marker);
  }
  M.marker.visible = true;
  M.marker.position.set(at.x, 0, at.z);
  return M.marker;
}

function pulse(M, dt) {
  const b = M.marker;
  if (!b || !b.visible) return;
  const u = b.userData;
  u.t += dt;
  u.column.material.opacity = 0.2 + Math.sin(u.t * 2.4) * 0.08;
  u.pip.rotation.y += dt * 1.9;
  u.pip.position.y = 3.8 + Math.sin(u.t * 2.2) * 0.25;
  const k = 1 + Math.sin(u.t * 2.6) * 0.12;
  u.ring.scale.set(k, k, 1);
}

/* ------------------------------------------------------------------ mission 1 */

/** The coral coupe: city.js tags it, else the first loose sport car. */
function markedCar(G) {
  if (G.m1Car && !G.m1Car.wrecked) return G.m1Car;
  G.m1Car = (G.cars || []).find((c) => c.tag === 'm1car' || c.missionCar) || null;
  return G.m1Car;
}

function m1(M, G) {
  const def = MISSIONS[0];
  const car = markedCar(G);
  if (!car) { fail(M, G, def, 'The coupe is in pieces. Give it another go — Vesper is not patient.'); return; }

  if (M.stage === 'steal') {
    beacon(M, G.W, car);
    M.active.at = { x: car.x, z: car.z };
    if (car.wrecked) { fail(M, G, def, 'You wrecked the coral coupe. Restart and bring it home in one piece.'); return; }
    if (G.inCar === car) {
      M.stage = 'deliver';
      if (G.toast) G.toast('Now park it in the Glass Orchid lockup.');
    }
    return;
  }

  const drop = lockup(G);
  beacon(M, G.W, drop);
  M.active.at = drop;
  const d = Math.hypot(car.x - drop.x, car.z - drop.z);
  if (car.wrecked) fail(M, G, def, 'The coupe is a burnt shell. Restart and keep the paint on.');
  else if (d < REACH && Math.abs(car.speed) < STOP) finish(M, G, def);
}

/* ------------------------------------------------------------------ mission 2 */

function m2(M, G, dt) {
  const def = MISSIONS[1];
  const stars = (G.PO && G.PO.stars) || 0;
  beacon(M, G.W, null); // the heat is the target, no marker

  if (M.stage === 'arm') {
    if (stars >= 2) {
      M.stage = 'evade';
      M.timer = MS.m2EvadeSec;
      if (G.toast) G.toast('Two stars. Now lose them — ninety seconds.');
    }
    return;
  }
  M.timer = Math.max(0, M.timer - dt);
  if (stars === 0) finish(M, G, def);
  else if (M.timer === 0) fail(M, G, def, 'The tail outlasted you. Get two stars and shake them within ninety next go.');
}

/* ------------------------------------------------------------------ mission 3 */

function m3(M, G, dt) {
  const def = MISSIONS[2];
  M.timer = Math.max(0, M.timer - dt);
  if (M.timer === 0) { fail(M, G, def, 'Out of time. The package never waited for anybody.'); return; }

  if (M.stage === 'pickup') {
    const p = pier();
    beacon(M, G.W, p);
    M.active.at = p;
    const d = Math.hypot(G.P.pos.x - p.x, G.P.pos.z - p.z);
    if (d < 4 && !G.inCar) {
      M.stage = 'deliver';
      if (G.toast) G.toast('Package in hand. Otis called the cops himself.');
      if (G.addStars) G.addStars(3);
      if (G.sound) G.sound.siren(true);
    }
    return;
  }

  const drop = lockup(G);
  beacon(M, G.W, drop);
  M.active.at = drop;
  const d = Math.hypot(G.P.pos.x - drop.x, G.P.pos.z - drop.z);
  const stopped = !G.inCar || Math.abs(G.inCar.speed) < STOP;
  if (d < REACH && stopped) {
    if (G.clearWanted) G.clearWanted();
    finish(M, G, def);
  }
}

/* ---------------------------------------------------------------- lifecycle */

/** Start the job at the head of the queue; `force` skips the giver distance. */
export function startMission(M, G, opts = {}) {
  if (!M || !G || M.index >= MISSIONS.length) return false;
  const def = MISSIONS[M.index];
  const spot = giver(G);
  const near = G.P && G.P.pos && Math.hypot(G.P.pos.x - spot.x, G.P.pos.z - spot.z) < 9;
  if (!near && !opts.force) {
    if (G.toast) G.toast('Vesper waits behind the Glass Orchid.');
    return false;
  }
  if (def.id === 'm1' && !markedCar(G)) {
    if (G.toast) G.toast('No coupe on the street. Try again in a moment.');
    return false;
  }

  M.active = { def, id: def.id, at: null };
  M.stage = def.id === 'm1' ? 'steal' : def.id === 'm2' ? 'arm' : 'pickup';
  M.timer = def.id === 'm3' ? MS.m3DeliverySec : 0;
  if (G.toast) G.toast(`Mission: ${def.title}`);
  if (G.missionStart) G.missionStart(def);
  if (G.sound) G.sound.chime();
  return true;
}

function finish(M, G, def) {
  M.active = null;
  M.stage = null;
  M.timer = 0;
  M.done += 1;
  M.index = Math.min(MISSIONS.length, M.index + 1);
  if (M.marker) M.marker.visible = false;
  if (G.missionComplete) G.missionComplete(def.reward, def.story);
  else if (G.addMoney) G.addMoney(def.reward);
  if (G.sound) G.sound.chime();
  if (G.saveGame) G.saveGame();
}

function fail(M, G, def, hint) {
  if (!M.active) return;
  M.active = null;
  M.stage = null;
  M.timer = 0;
  if (G.missionFail) G.missionFail(def.title, hint);
  else if (G.toast) G.toast(hint);
}

/** R on the fail screen: run the same job again without walking back to Vesper. */
export function retryMission(M, G) {
  if (!M || !G || M.index >= MISSIONS.length) return false;
  if (M.marker) M.marker.visible = false;
  return startMission(M, G, { force: true });
}

/* --------------------------------------------------------------------- tick */

/** One tick: run the live job, or idle at Vesper; feed G.objective for the HUD. */
export function updateMissions(M, G, dt) {
  if (!M || !G) return;
  if (M.active) {
    if (M.active.id === 'm1') m1(M, G);
    else if (M.active.id === 'm2') m2(M, G, dt);
    else m3(M, G, dt);
  } else if (M.index >= MISSIONS.length) {
    beacon(M, G.W, null);
    G.objective = null;
    return;
  } else {
    beacon(M, G.W, giver(G));
  }
  pulse(M, dt);
  G.objective = objective(M, G);
}

/** {title, text, dist, timer} — the diamond and distance are HUD business. */
function objective(M, G) {
  const here = G.P && G.P.pos ? G.P.pos : { x: 0, z: 0 };
  if (!M.active) {
    if (M.index >= MISSIONS.length) return null;
    const spot = giver(G);
    return {
      title: MISSIONS[M.index].title,
      text: 'meet Vesper behind the Glass Orchid',
      dist: Math.hypot(spot.x - here.x, spot.z - here.z),
      timer: 0,
      at: spot,
    };
  }
  const def = M.active.def;
  const at = M.active.at;
  return {
    title: def.title,
    text: def.steps[M.stage] || def.brief,
    dist: at ? Math.hypot(at.x - here.x, at.z - here.z) : 0,
    timer: M.timer,
    at,
  };
}

/** Copy for the complete and pause panels: reward, story beat, next job. */
export function missionPanelText(M) {
  if (!M || M.index >= MISSIONS.length) {
    return { title: 'The ledger is closed', reward: 0, story: MISSIONS[MISSIONS.length - 1].story, next: false };
  }
  const def = MISSIONS[M.index];
  return { title: def.title, reward: def.reward, story: def.story, brief: def.brief, next: true };
}
