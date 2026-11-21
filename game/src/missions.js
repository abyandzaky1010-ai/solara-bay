// One job: the three jobs. Story beats, stage machines, gold beacons and the
// objective line the HUD reads. Mission state is plain data so a save can carry it.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';
import { addStars } from './police.js';

// ---------- definitions ----------

/** The story, in order. Each def carries its own stages, timers and payoff. */
export const MISSIONS = [
  {
    id: 'm1',
    title: 'Wheels for Vesper',
    brief: 'Vesper wants the Coral coupe back. Take it, bring it to the Glass Orchid.',
    hint: 'Steal the coral coupe downtown, then drive it into the Glass Orchid lockup',
    reward: CONFIG.missions.m1,
    story: 'It runs. Vesper smiles like a knife.',
    stages: ['steal', 'deliver'],
    retry: 'Press R to re-arm the coupe',
  },
  {
    id: 'm2',
    title: 'Shake the Heat',
    brief: 'Show Vesper you can take the heat. Get two stars, then lose them within 90 seconds.',
    hint: 'Draw two stars, then break sight for long enough to shed them',
    reward: CONFIG.missions.m2,
    story: 'The sirens fade. Somewhere out there, Otis is smiling.',
    stages: ['armed', 'evade'],
    seconds: CONFIG.missions.m2EvadeSec,
    retry: 'Press R to try the run again',
  },
  {
    id: 'm3',
    title: 'Harbor Handoff',
    brief: 'Pick up Otis\u2019s last package at the pier and deliver it to the Glass Orchid in 120 s. Expect heat.',
    hint: 'Collect the package on the west pier, then reach the Glass Orchid',
    reward: CONFIG.missions.m3,
    story: 'Solara Bay knows your name now. Free ride: fares pay, the shop sells, the bay stays warm.',
    stages: ['pickup', 'deliver'],
    seconds: CONFIG.missions.m3DeliverySec,
    retry: 'Press R to pick the job up again',
  },
];

/** Two lines of flavour for a fresh save, shown on the title card. */
export const INTRO = [
  'Vesper runs the Glass Orchid garage. She pays on time and remembers everything.',
  'Otis left one package on the west pier. The bay wants it back.',
];

const PIER_X = -178;
const PIER_Z = -40;
const PICKUP_RADIUS = 4;
const STOP_SPEED = 1;
const BEACON_H = 9;
const BEACON_R = 1.5;

// ---------- state ----------

/** A clean mission book. `index` is which def is next, `active` the running one. */
export function initMissions() {
  return {
    index: 0,
    active: null,
    done: 0,
    timer: 0,
    stage: 0,
    marker: null,
    target: null,
    beacon: null,
    fail: null,
    timerArmed: false,
    introShown: false,
  };
}

function defOf(M) {
  if (!M) return null;
  return MISSIONS[M.index] || null;
}

/**
 * Stage as a number. Internal runs count 0,1; demo scenes and saves may carry the
 * stage name ('steal', 'deliver', 'armed', 'evade', 'pickup') instead.
 */
function stageOf(M, def) {
  if (!M) return 0;
  const s = M.stage;
  if (typeof s === 'number') return s;
  const rows = (def && def.stages) || [];
  const i = rows.indexOf(s);
  return i >= 0 ? i : 0;
}

/** Where the job is handed out, plus the two fixed goals. */
function landmarks(G) {
  const m = (G && G.city && G.city.markers) || {};
  return {
    giver: m.glassOrchid || { x: 40, z: -40 },
    orchid: m.glassOrchid || { x: 40, z: -40 },
    pier: { x: PIER_X, z: PIER_Z },
  };
}

function playerCar(G) {
  return (G && G.inCar) || null;
}

/** The coupe the first job is about: main flags it, otherwise find it by label. */
function coupeOf(G) {
  if (!G) return null;
  if (G.m1Car) return G.m1Car;
  const cars = G.cars || [];
  for (let i = 0; i < cars.length; i++) {
    if (cars[i] && (cars[i].missionCar || cars[i].label === 'm1car')) return cars[i];
  }
  return null;
}

function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

// ---------- beacons ----------

/** A gold column with a ring around its foot, built once and then moved. */
function ensureBeacon(M, G) {
  if (M.beacon || !G || !G.W || !G.W.scene) return M.beacon;
  const g = new THREE.Group();
  g.name = 'mission-beacon';
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(BEACON_R, BEACON_R, BEACON_H, 14, 1, true),
    new THREE.MeshBasicMaterial({ color: C.marker, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
  );
  column.position.y = BEACON_H / 2;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.2, 0.16, 8, 26),
    new THREE.MeshBasicMaterial({ color: C.marker, transparent: true, opacity: 0.85 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.12;
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, BEACON_H * 1.05, 10),
    material(C.beacon, { flat: true }),
  );
  core.position.y = BEACON_H * 0.52;
  g.add(column, ring, core);
  g.visible = false;
  g.userData = { column, ring, core };
  G.W.scene.add(g);
  M.beacon = g;
  return g;
}

/** Put the beacon on a spot (or hide it), and tell the HUD / minimap where to point. */
export function placeMarker(M, G, x, z) {
  const b = ensureBeacon(M, G);
  if (!b || x == null) {
    if (b) b.visible = false;
    if (M) { M.marker = null; M.target = null; }
    return null;
  }
  b.visible = true;
  b.position.set(x, 0, z);
  M.marker = { x, z };
  M.target = { x, z };
  return b;
}

function pulseBeacon(M, t) {
  const b = M.beacon;
  if (!b || !b.visible) return;
  const wave = 0.5 + 0.5 * Math.sin(t * 3.4);
  const u = b.userData;
  u.column.material.opacity = 0.16 + wave * 0.22;
  u.ring.scale.setScalar(1 + wave * 0.16);
  u.ring.rotation.z = t * 0.9;
  u.core.scale.y = 0.9 + wave * 0.2;
}

// ---------- staging ----------

export function startMission(M, G) {
  if (!M || !G) return false;
  if (M.active || M.fail) return false;
  const def = defOf(M);
  if (!def) return false;
  const marks = landmarks(G);

  // The giver: press at the garage, or accept from the panel anywhere.
  const P = G.P;
  if (P && !G.inCar && dist2(P.pos.x, P.pos.z, marks.giver.x, marks.giver.z) > 12 * 12) {
    if (!M.forceStart) {
      if (G.hud) G.hud.toast('Vesper is at the Glass Orchid garage');
      return false;
    }
  }

  M.active = def;
  M.stage = 0;
  M.timer = def.seconds || 0;
  M.timerArmed = false;
  M.fail = null;
  M.startT = G.time || 0;
  M.introShown = false;

  if (def.id === 'm1') armCoupe(M, G);
  else if (def.id === 'm2') placeMarker(M, G, null);
  else if (def.id === 'm3') placeMarker(M, G, marks.pier.x, marks.pier.z);

  if (G.hud) {
    G.hud.toast(def.title);
    if (G.hud.setBanner) G.hud.setBanner(def.title, 2600);
  }
  if (G.sound && G.sound.chime) G.sound.chime();
  if (G.missionStart) G.missionStart(def);
  return true;
}

/** M1 setup: the coupe goes coral, gets its beacon, and waits to be stolen. */
function armCoupe(M, G) {
  const car = coupeOf(G);
  if (!car) {
    placeMarker(M, G, null);
    return;
  }
  car.missionCar = true;
  car.wrecked = false;
  car.hp = CONFIG.car.hp;
  car.speed = 0;
  if (stageOf(M, MISSIONS[0]) === 0) placeMarker(M, G, car.x, car.z);
}

/** Whole-job teardown: beacon off, timer zeroed, index moved on. */
function finishMission(M, G, def, story) {
  const reward = def.reward;
  M.active = null;
  M.timer = 0;
  M.timerArmed = false;
  M.index += 1;
  M.done = M.index;
  M.fail = null;
  placeMarker(M, G, null);
  if (G.addMoney) G.addMoney(reward);
  if (G.onMissionComplete) G.onMissionComplete({ ...def, story: story || def.story, reward });
  if (G.saveNow) G.saveNow();
}

/** Failure: freeze the job, remember why, and let R pick it back up. */
function failMission(M, G, def, why, hint) {
  M.fail = { title: def.title, why, hint: hint || def.retry, id: def.id };
  M.timer = 0;
  if (G.hud) {
    G.hud.toast('Job failed: ' + why);
    if (G.hud.setBanner) G.hud.setBanner(why + ' \u2014 ' + (hint || def.retry), 3200);
  }
  if (G.sound && G.sound.jingle) G.sound.jingle(false);
}

export function retryMission(M, G) {
  if (!M || !M.fail) return false;
  const def = MISSIONS[M.index];
  M.fail = null;
  M.active = null;
  if (G && G.hud) G.hud.toast('Try again: ' + (def ? def.title : 'the job'));
  return true;
}

// ---------- the step ----------

export function updateMissions(M, G, dt) {
  if (!M || !G) return;
  const def = M.active;
  pulseBeacon(M, G.time || 0);
  if (G.freezeMissions) return;        // demo scenes pose the job by hand

  if (!def) {
    // Idle: the garage carries the giver marker until the story runs out.
    const next = defOf(M);
    if (next && !M.fail) {
      const marks = landmarks(G);
      M.target = marks.giver;
      M.marker = null;
    }
    return;
  }

  const P = G.P;
  const car = playerCar(G);
  const px = car ? car.x : P.pos.x;
  const pz = car ? car.z : P.pos.z;

  if (def.id === 'm1') stepCoupeJob(M, G, def, px, pz, dt);
  else if (def.id === 'm2') stepEvadeJob(M, G, def, dt);
  else if (def.id === 'm3') stepHandoffJob(M, G, def, px, pz, car, dt);
}

/** M1: steal the coupe (it must be moving or you must be in it), then park it. */
function stepCoupeJob(M, G, def, px, pz, dt) {
  const car = coupeOf(G);
  if (!car) { failMission(M, G, def, 'The coupe is gone', def.retry); return; }
  if (car.wrecked) { failMission(M, G, def, 'You killed the coupe', def.retry); return; }

  if (stageOf(M, def) === 0) {
    placeMarker(M, G, car.x, car.z);
    if (car.player || Math.abs(car.speed) > STOP_SPEED) {
      M.stage = 1;
      const marks = landmarks(G);
      placeMarker(M, G, marks.orchid.x, marks.orchid.z);
      if (G.hud) G.hud.toast('Coupe in hand. Bring it home and stop it in the lockup.');
    }
    return;
  }

  const marks = landmarks(G);
  placeMarker(M, G, marks.orchid.x, marks.orchid.z);
  const inside = dist2(car.x, car.z, marks.orchid.x, marks.orchid.z) <= 5 * 5;
  if (inside && Math.abs(car.speed) < STOP_SPEED) {
    if (!car.player) car.speed = 0;
    finishMission(M, G, def, def.story);
  }
}

/** M2: wait for two stars, then start the clock and watch them fall to zero. */
function stepEvadeJob(M, G, def, dt) {
  const stars = G.PO ? G.PO.stars : 0;
  M.target = null;
  M.marker = null;
  placeMarker(M, G, null);

  if (stageOf(M, def) === 0) {
    M.timer = 0;
    if (stars >= 2) {
      M.stage = 1;
      M.timer = CONFIG.missions.m2EvadeSec;
      if (G.hud) G.hud.toast('Two stars. Ninety seconds to lose them.');
    }
    return;
  }

  M.timer = Math.max(0, M.timer - dt);
  if (stars === 0) { finishMission(M, G, def, def.story); return; }
  if (M.timer <= 0) {
    failMission(M, G, def, 'The clock ran out with heat still on you', def.retry);
  }
}

/** M3: the package on the pier, three stars with it, then the lockup before the clock. */
function stepHandoffJob(M, G, def, px, pz, car, dt) {
  const marks = landmarks(G);
  M.timer = Math.max(0, M.timer - dt);

  if (stageOf(M, def) === 0) {
    placeMarker(M, G, marks.pier.x, marks.pier.z);
    const close = dist2(px, pz, marks.pier.x, marks.pier.z) <= PICKUP_RADIUS * PICKUP_RADIUS;
    if (close) {
      M.stage = 1;
      placeMarker(M, G, marks.orchid.x, marks.orchid.z);
      if (G.PO) addStars(G.PO, 3, G);
      if (G.hud) { G.hud.toast('Package secured. Every unit in the bay heard that.'); G.hud.starsPulse(); }
      if (G.sound && G.sound.chime) G.sound.chime();
    }
    if (M.timer <= 0) failMission(M, G, def, 'The package window closed', def.retry);
    return;
  }

  placeMarker(M, G, marks.orchid.x, marks.orchid.z);
  const inside = dist2(px, pz, marks.orchid.x, marks.orchid.z) <= 6 * 6;
  const slow = car ? Math.abs(car.speed) < STOP_SPEED : true;
  if (inside && slow) {
    if (G.PO) {
      G.PO.stars = 0;
      if (G.clearWanted) G.clearWanted();
    }
    finishMission(M, G, def, def.story);
    return;
  }
  if (M.timer <= 0) {
    failMission(M, G, def, 'The package never made it to the Orchid', def.retry);
  }
}

// ---------- what the HUD prints ----------

/** Line for #objective plus a countdown, or an empty pair when there is no work. */
export function missionPanelText(M, G) {
  const def = M && M.active;
  if (M && M.fail) {
    return { title: 'Job failed', text: M.fail.why + ' \u2014 ' + M.fail.hint, timer: 0 };
  }
  if (!def) {
    const next = M ? MISSIONS[M.index] : null;
    if (!next) return { title: '', text: '', timer: 0 };
    return { title: next.title, text: 'Next job: ' + next.title + ' \u2014 the Glass Orchid garage', timer: 0 };
  }

  const step = stepText(M, def, G);
  const who = G && G.inCar ? { x: G.inCar.x, z: G.inCar.z } : G && G.P ? { x: G.P.pos.x, z: G.P.pos.z } : null;
  let away = '';
  if (who && M.target) {
    away = ' \u00b7 ' + Math.round(Math.hypot(who.x - M.target.x, who.z - M.target.z)) + ' m';
  }
  return { title: def.title, text: def.title + ' \u2014 ' + step + away, timer: def.id === 'm2' && stageOf(M, def) === 0 ? 0 : M.timer };
}

function stepText(M, def, G) {
  if (def.id === 'm1') {
    return stageOf(M, def) === 0 ? 'steal the coral coupe' : 'drive it to the Glass Orchid and stop in the marker';
  }
  if (def.id === 'm2') {
    return stageOf(M, def) === 0 ? 'draw two stars of heat' : 'lose the police before the clock runs out';
  }
  return stageOf(M, def) === 0 ? 'pick up the package on the west pier' : 'deliver the package to the Glass Orchid';
}

/** Short name of the job after this one, for the complete panel's button. */
export function nextMissionTitle(M) {
  const next = M ? MISSIONS[M.index] : null;
  return next ? next.title : null;
}


