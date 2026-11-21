// Solara Bay — the Vesper thread: three jobs, one gold beacon, and the story
// lines that close each of them. One clear job: story, missions and markers.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';

const MONEY = CONFIG.missions;

// Where the gold beacon lives when a job wants the Glass Orchid drop.
const BUST_RANGE = 5; // the coupe has to be this close to the lockup door
const STOP_SPEED = 1; // and this slow before Vesper counts it delivered
const PICKUP_RANGE = 6; // a car is a long way round: the pier pad is small
const PICKUP_SPEED = 1;
const TIMER_HURRY = 15;

/* --------------------------------------------------------------- definitions */

/**
 * The three jobs, in order. `step` names are the states each job walks through:
 * m1 walk → steal → deliver, m2 arm → evade, m3 collect → deliver.
 */
export const MISSIONS = [
  {
    id: 'm1',
    title: 'Wheels for Vesper',
    reward: MONEY.m1,
    prize: `$${MONEY.m1}`,
    brief: 'The coral coupe went missing from the Orchid forecourt. Take it back and leave it at the lockup. Do not scratch it.',
    story: 'It runs. Vesper smiles like a knife.',
    steps: {
      steal: 'steal the coral coupe',
      deliver: 'drive it to the Glass Orchid and stop',
    },
  },
  {
    id: 'm2',
    title: 'Shake the Heat',
    reward: MONEY.m2,
    prize: `$${MONEY.m2}`,
    brief: 'Show Vesper you can take the heat. Get two stars, then lose them inside ninety seconds. No crowds, no roadblocks waiting.',
    story: 'The sirens fade. Somewhere out there, Otis is smiling.',
    steps: {
      arm: 'get two stars — make some noise',
      evade: 'shake them off — no cop in sight',
    },
  },
  {
    id: 'm3',
    title: 'Harbor Handoff',
    reward: MONEY.m3,
    prize: `$${MONEY.m3}`,
    brief: 'Otis left a package on the west pier. Collect it, get it to the Orchid in two minutes, and expect company the whole way.',
    story: 'Solara Bay knows your name now. Free ride: fares pay, the shop sells, the bay stays warm.',
    steps: {
      collect: 'pick up the package at the west pier',
      deliver: 'get the package to the Glass Orchid and stop',
    },
  },
];

/* -------------------------------------------------------------------- marker */

/** A gold cylinder with a pulsing ring at its foot: the mission beacon. */
function buildBeacon() {
  const root = new THREE.Group();
  const skin = new THREE.MeshBasicMaterial({
    color: C.beacon,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const column = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 5.5, 20, 1, true), skin);
  column.position.y = 2.9;
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.3, 3.05, 28), skin.clone());
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.14;
  const coreBase = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 12), material(C.beacon));
  coreBase.position.y = 0.12;
  root.add(column, ring, coreBase);
  root.visible = false;
  root.userData = { column, ring, skin, coreBase };
  return root;
}

/* ---------------------------------------------------------------- utilities */

function distTo(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

/** The nearest point out of the way to put a final drop: the Orchid when it exists. */
function orchid(city) {
  const m = city && city.markers && city.markers.glassOrchid;
  if (m) return { x: m.x, z: m.z };
  return { x: 48, z: -11 };
}

/** The west pier: promenade edge, south of the harbour mouth. */
function westPier(city) {
  const m = city && city.markers;
  if (m && m.pier) return { x: m.pier.x, z: m.pier.z };
  const sea = CONFIG.world.sea;
  return { x: sea + 9, z: 36 };
}

/** The coupe m1 wants: tagged by the city spawn, resolved lazily. */
function coupe(M, G) {
  if (M.car && !M.car.wrecked) return M.car;
  const tagged = ((G && G.cars) || []).find((c) => c && c.tag === 'm1car');
  M.car = tagged || null;
  return M.car;
}

function playerSpot(G) {
  const car = G && G.inCar;
  if (car && !car.wrecked) return { x: car.x, z: car.z, car, onFoot: false };
  const p = (G && G.P && G.P.pos) || { x: 0, z: 0 };
  return { x: p.x, z: p.z, car: null, onFoot: true };
}

function beaconAt(M, G, x, z) {
  if (!M.beacon && G && G.W) {
    M.beacon = buildBeacon();
    G.W.scene.add(M.beacon);
  }
  if (!M.beacon) return;
  M.beacon.visible = true;
  M.beacon.position.set(x, 0, z);
  M.marker = { x, z };
}

function beaconOff(M) {
  if (M.beacon) M.beacon.visible = false;
  M.marker = null;
}

/** Slow shimmer: the column breathes and the ring pushes outward once a second. */
function pulseBeacon(M, time) {
  if (!M.beacon || !M.beacon.visible) return;
  const ud = M.beacon.userData;
  const beat = (time * 0.8) % 1;
  ud.column.material.opacity = 0.22 + Math.sin(time * 3.2) * 0.09;
  ud.ring.material.opacity = 0.5 * (1 - beat);
  const grow = 1 + beat * 0.5;
  ud.ring.scale.set(grow, grow, grow);
  M.beacon.position.y = Math.sin(time * 2) * 0.06;
}

/* --------------------------------------------------------------------- flow */

/** Fresh state for a new game: nothing running, everything still owed. */
export function initMissions() {
  return {
    index: 0,
    active: null,
    done: 0,
    marker: null,
    beacon: null,
    timer: 0,
    car: null,
    step: null,
  };
}

/**
 * Begin the job at M.index. Normally the player has to be standing on Vesper's
 * mark outside the Glass Orchid; `opts.force` skips that (retries, panels, shots).
 */
export function startMission(M, G, opts) {
  if (!M || !G) return false;
  const force = !!(opts && opts.force);
  if (M.index >= MISSIONS.length) {
    if (force && G.toast) G.toast('No jobs left. The bay is yours.');
    return false;
  }

  // Standing at the giver: the player has to reach the Orchid unless forced.
  if (!force) {
    const give = orchid(G.city);
    const here = playerSpot(G);
    if (distTo(here.x, here.z, give.x, give.z) > 9) return false;
  }

  const def = MISSIONS[M.index];
  M.active = {
    index: M.index,
    def,
    id: def.id,
    startedAt: (G.time || 0),
    stage: def.id === 'm1' ? 'steal' : def.id === 'm2' ? 'arm' : 'collect',
    armed: false,
    car: null,
    target: null,
    heat: 0,
  };
  M.timer = 0;
  M.step = M.active.stage;
  M.car = null;

  if (def.id === 'm1') {
    M.active.car = coupe(M, G);
    if (!M.active.car) {
      M.active = null;
      if (G.toast) G.toast('The coupe is not here. Try again later.');
      return false;
    }
    beaconAt(M, G, M.active.car.x, M.active.car.z);
  } else if (def.id === 'm2') {
    beaconOff(M);
  } else {
    const pier = westPier(G.city);
    beaconAt(M, G, pier.x, pier.z);
  }

  if (G.sound && G.sound.chime) G.sound.chime();
  if (G.missionStart) G.missionStart(def);
  else if (G.toast) G.toast(def.title);
  return true;
}

/** The job is done: pay, tell the story, move the thread forward. */
function finish(M, G) {
  const def = M.active ? M.active.def : MISSIONS[M.index];
  if (M.active && M.active.id === 'm3' && G.PO && G.clearWanted) G.clearWanted(G.PO, G);
  M.active = null;
  M.timer = 0;
  M.step = null;
  M.marker = null;
  beaconOff(M);
  M.done += 1;
  M.index = Math.min(MISSIONS.length, M.index + 1);
  if (G.missionComplete) G.missionComplete(def.reward, def.story);
  else if (G.toast) G.toast(`${def.title}: ${def.story}`);
}

/** The job slipped: toast the hint and reopen it from the top. */
function fail(M, G, hint) {
  if (!M.active) return;
  const def = M.active.def;
  if (G.missionFail) G.missionFail(def.title, hint);
  else if (G.toast) G.toast(hint);
  startMission(M, G, { force: true });
}

/* ---------------------------------------------------------------- the jobs */

function stepM1(M, G, here) {
  const job = M.active;
  const drop = orchid(G.city);

  if (job.stage === 'steal') {
    const car = coupe(M, G);
    if (!car || car.wrecked) {
      fail(M, G, 'The coupe is gone. Vesper wants it back in one piece.');
      return;
    }
    // The coupe's live position is the marker until she is sitting in it.
    if (G.inCar === car) {
      job.stage = 'deliver';
      M.step = 'deliver';
      beaconAt(M, G, drop.x, drop.z);
      if (G.toast) G.toast('Coupe taken. Bring it to the Glass Orchid.');
      if (G.sound && G.sound.chime) G.sound.chime();
      return;
    }
    beaconAt(M, G, car.x, car.z);
    return;
  }

  // deliver: the coupe, stopped, at the door.
  const car = coupe(M, G);
  if (!car || car.wrecked) {
    fail(M, G, 'You wrecked Vesper\'s coupe. She will make you try again.');
    return;
  }
  beaconAt(M, G, drop.x, drop.z);
  const driving = G.inCar === car;
  const near = distTo(here.x, here.z, drop.x, drop.z) < BUST_RANGE;
  const slow = driving && Math.abs(car.speed) < STOP_SPEED;
  if (near && slow) finish(M, G);
}

function stepM2(M, G, here, dt) {
  const job = M.active;
  const stars = G.PO ? G.PO.stars || 0 : 0;

  if (job.stage === 'arm') {
    beaconOff(M);
    if (stars >= 2) {
      job.stage = 'evade';
      job.armed = true;
      M.step = 'evade';
      M.timer = MONEY.m2EvadeSec;
      if (G.toast) G.toast(`${MONEY.m2EvadeSec} seconds to lose them.`);
      if (G.sound && G.sound.chime) G.sound.chime();
    }
    return;
  }

  // evade: the clock runs from the moment the second star landed.
  M.timer = Math.max(0, M.timer - dt);
  if (stars <= 0) {
    finish(M, G);
    return;
  }
  if (M.timer <= 0) fail(M, G, 'The clock beat you. Two stars, one more try.');
}

function stepM3(M, G, here, dt) {
  const job = M.active;
  const pier = westPier(G.city);
  const drop = orchid(G.city);

  if (job.stage === 'collect') {
    beaconAt(M, G, pier.x, pier.z);
    const close = distTo(here.x, here.z, pier.x, pier.z) < PICKUP_RANGE;
    const slow = !G.inCar || Math.abs(G.inCar.speed) < PICKUP_SPEED;
    if (!close || !slow) return;

    job.stage = 'deliver';
    job.car = G.inCar || null;
    M.step = 'deliver';
    M.timer = MONEY.m3DeliverySec;
    beaconAt(M, G, drop.x, drop.z);
    if (G.PO && G.addStars) G.addStars(G.PO, 3, G);
    if (G.toast) G.toast('Package in hand. Three stars behind you — go.');
    if (G.sound && G.sound.chime) G.sound.chime();
    return;
  }

  M.timer = Math.max(0, M.timer - dt);
  beaconAt(M, G, drop.x, drop.z);
  if (M.timer <= 0) {
    fail(M, G, 'Two minutes were not enough. Otis still wants that package.');
    return;
  }
  // The drop only counts in the car that carried the package up the coast road.
  const riding = !job.car || G.inCar === job.car;
  const close = riding && distTo(here.x, here.z, drop.x, drop.z) < BUST_RANGE;
  const slow = !G.inCar || Math.abs(G.inCar.speed) < STOP_SPEED;
  if (close && slow) finish(M, G);
}

/* ------------------------------------------------------------------ the HUD */

/** What the objective line says and which distance rides beside it. */
function objectiveFor(M, G, here) {
  const job = M.active;
  const def = job.def;
  const line = { title: def.title, text: def.steps[job.stage] || def.brief, dist: null, timer: 0, at: null };

  if (def.id === 'm1') {
    const target = job.stage === 'steal' ? coupe(M, G) : orchid(G.city);
    if (target) {
      line.dist = Math.round(distTo(here.x, here.z, target.x, target.z));
      line.at = { x: target.x, z: target.z };
    }
  } else if (def.id === 'm2') {
    // No distance to a feeling: the clock is the whole objective.
    line.text = job.stage === 'arm'
      ? `get two stars (${G.PO ? G.PO.stars || 0 : 0}/2)`
      : 'shake them off — no cop in sight';
    line.timer = M.timer;
  } else {
    const target = job.stage === 'collect' ? westPier(G.city) : orchid(G.city);
    line.dist = Math.round(distTo(here.x, here.z, target.x, target.z));
    line.at = { x: target.x, z: target.z };
    line.timer = M.timer;
    if (job.stage === 'deliver' && M.timer < TIMER_HURRY) line.text = 'get the package to the Glass Orchid — hurry';
  }
  return line;
}

/** Idle line: where to go next, distance included. */
function idleObjective(M, G, here) {
  if (M.index >= MISSIONS.length) return null;
  const def = MISSIONS[M.index];
  const give = orchid(G.city);
  return {
    title: def.title,
    text: 'see Vesper at the Glass Orchid',
    dist: Math.round(distTo(here.x, here.z, give.x, give.z)),
    timer: 0,
    at: { x: give.x, z: give.z },
  };
}

/** One line for a panel: what's next, or what's finished. */
export function missionPanelText(M) {
  if (!M) return 'No jobs.';
  if (M.index >= MISSIONS.length) return 'All three jobs done. Solara Bay knows your name now.';
  const def = MISSIONS[M.index];
  if (M.active) return `${def.title} (${M.active.stage}) — ${def.steps[M.active.stage] || def.brief}`;
  return `${def.title} — ${def.brief} Reward ${def.prize}.`;
}

/* --------------------------------------------------------------------- tick */

/**
 * Every step: run the live job, or point her at the next giver, and publish
 * G.objective for the HUD and the minimap diamond.
 */
export function updateMissions(M, G, dt) {
  if (!M || !G) return;
  const time = G.time || 0;
  const here = playerSpot(G);

  pulseBeacon(M, time);

  if (!M.active) {
    // Jobs open at the Orchid pad; the gold diamond marks the door.
    const idle = idleObjective(M, G, here);
    if (idle) {
      const give = orchid(G.city);
      beaconAt(M, G, give.x, give.z);
      G.objective = idle;
      // Standing on the mark opens the next job.
      if (here.onFoot && distTo(here.x, here.z, give.x, give.z) < 4.5) startMission(M, G);
    } else {
      beaconOff(M);
      G.objective = null;
    }
    return;
  }

  const job = M.active;
  if (job.id === 'm1') stepM1(M, G, here);
  else if (job.id === 'm2') stepM2(M, G, here, dt);
  else stepM3(M, G, here, dt);

  // The job may have ended on this tick; never publish a dead objective.
  if (!M.active) return;
  const line = objectiveFor(M, G, here);
  G.objective = line;
  if (M.timer > 0) line.timer = M.timer;
  else delete line.timer;
}

/* ------------------------------------------------------------- save/restore */

/** Continue a saved game: the index comes back, the timers start clean. */
export function restoreMissions(M, saved) {
  if (!M) return M;
  M.index = Math.max(0, Math.min(MISSIONS.length, (saved && saved.missionIndex) || 0));
  M.active = null;
  M.timer = 0;
  M.step = null;
  return M;
}
