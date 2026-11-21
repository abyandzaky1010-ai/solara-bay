// One job: the three jobs. Vesper's coupe, Vesper's test of nerve, Otis's
// package — plus the gold beacon that shows you where to go and the story beats
// that close each chapter. Mission state is plain data so a save can carry it.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C, material } from './palette.js';

const MDEF = CONFIG.missions;
const M1 = MDEF.m1;
const M2 = MDEF.m2;
const M3 = MDEF.m3;

const PICKUP_R = 6;        // an on-foot pickup grabs at this radius
const DELIVER_R = 5;       // delivery marker: park inside and stop
const STOP_KMH = 3.6;      // "stopped" for a delivery: under 1 m/s
const REACH_R = 34;        // the giver lets you start from this far away
const MARK_R = 8;          // the coupe's own marker is grabbed this close
const PIER = { x: -178, z: 112 };
const BEACON_H = 16;       // column height of the drop marker
const RING_R = 3.4;

// The three chapters, in order. `state` names the step inside a chapter, so the
// HUD can say "drive it to the Glass Orchid" without knowing the logic.
export const MISSIONS = [
  {
    id: 'm1',
    title: 'Wheels for Vesper',
    brief: 'Vesper wants the Coral coupe back. Take it, bring it to the Glass Orchid.',
    state: 'steal',
    reward: M1,
    stage: [
      'steal the coral coupe',
      'drive it to the Glass Orchid and stop',
    ],
    story: 'It runs. Vesper smiles like a knife.',
    intro: 'A coupe went missing with a client\u2019s money in the trunk. Get it back.',
  },
  {
    id: 'm2',
    title: 'Shake the Heat',
    brief: 'Show Vesper you can take the heat. Get two stars, then lose them within 90 seconds.',
    state: 'armed',
    reward: M2,
    stage: [
      'make some noise \u2014 get two stars',
      'lose the cops before the clock runs out',
    ],
    story: 'The sirens fade. Somewhere out there, Otis is smiling.',
    intro: 'Prove you can carry heat. Two stars, then gone, inside ninety seconds.',
  },
  {
    id: 'm3',
    title: 'Harbor Handoff',
    brief: 'Pick up Otis\u2019s last package at the pier and deliver it to the Glass Orchid in 120 s. Expect heat.',
    state: 'pickup',
    reward: M3,
    stage: [
      'collect the package at the west pier',
      'deliver it to the Glass Orchid before the clock dies',
    ],
    story: 'Solara Bay knows your name now. Free ride: fares pay, the shop sells, the bay stays warm.',
    intro: 'One last run for Otis: pier to lockup, and do not stop for anyone.',
  },
];

let beacon = null;

// ------------------------------------------------------------------ beacon

// Gold column plus a ground ring, both emissive by hand (no lights needed in a
// lit city), pulsing so it reads from across a block.
function buildBeacon(W) {
  const group = new THREE.Group();
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, BEACON_H, 14, 1, true),
    new THREE.MeshBasicMaterial({ color: C.beacon, transparent: true, opacity: 0.34, depthWrite: false }),
  );
  column.position.y = BEACON_H / 2;
  group.add(column);

  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(RING_R, RING_R, 0.3, 24),
    new THREE.MeshBasicMaterial({ color: C.marker, transparent: true, opacity: 0.9 }),
  );
  ring.position.y = 0.2;
  group.add(ring);

  const spike = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, BEACON_H, 6),
    new THREE.MeshBasicMaterial({ color: C.beacon }),
  );
  spike.position.y = BEACON_H / 2;
  group.add(spike);

  group.visible = false;
  W.scene.add(group);
  return { group, column, ring, spike, t: 0 };
}

function showBeacon(W, x, z) {
  if (!beacon) beacon = buildBeacon(W);
  beacon.group.visible = true;
  beacon.group.position.set(x, 0, z);
}

function hideBeacon() {
  if (beacon) beacon.group.visible = false;
}

function pulseBeacon(dt) {
  if (!beacon || !beacon.group.visible) return;
  beacon.t += dt;
  const k = 0.5 + 0.5 * Math.sin(beacon.t * 3.2);
  beacon.column.material.opacity = 0.2 + k * 0.3;
  beacon.ring.scale.setScalar(1 + k * 0.14);
  beacon.spike.material.opacity = 0.5 + k * 0.5;
}

// ------------------------------------------------------------------ helpers

function distance(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

function ridden(G) {
  return G.inCar || null;
}

// Speed of whatever the player is moving with, in m/s.
function carriedSpeed(G) {
  const car = ridden(G);
  return car ? Math.abs(car.speed || 0) : (G.P ? G.P.speed || 0 : 0);
}

// Where the player is, car or foot.
function playerSpot(G) {
  const car = ridden(G);
  if (car) return { x: car.x, z: car.z };
  return G.P && G.P.pos ? { x: G.P.pos.x, z: G.P.pos.z } : { x: 0, z: 0 };
}

// The Coral coupe: the parked sport car city.js tags 'm1car'. Two lookups,
// because the tag rides either on the spawn list or on the car itself.
function findCoupe(G) {
  if (G.m1Car) return G.m1Car;
  const list = G.cars || [];
  for (const car of list) {
    if (car && car.label === 'm1car') return car;
    if (car && car.tag === 'm1car') return car;
  }
  return null;
}

function coupeVisible(car) {
  return !!(car && !car.wrecked && car.hp > 0);
}

// Walk a few nodes down the grid from the Glass Orchid toward a walking
// distance, so a retried coupe is never waiting on the next corner.
function relocateCoupe(G, car) {
  const W = G.W;
  const city = G.city;
  if (!car || !W || !W.roads || !city) return;
  const giver = city.markers.glassOrchid;
  const nodes = W.roads.nodes;
  let best = null;
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    const d = distance(n.x, n.z, giver.x, giver.z);
    if (d > 90 && d < 170) { best = n; break; }
  }
  if (!best) return;
  car.x = best.x + 4;
  car.z = best.z;
  car.speed = 0;
  car.hp = CONFIG.car.hp;
  if (car.mesh) {
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.visible = true;
  }
}

// ------------------------------------------------------------------ start

function resetChapter(def) {
  return {
    id: def.id,
    title: def.title,
    state: def.state,
    stage: def.stage,
    stageIndex: 0,
    timer: 0,
    elapsed: 0,
    markX: 0,
    markZ: 0,
    armed: false,
    fail: null,
    coupe: null,
  };
}

// Point the chapter at its first objective and hand it the world handles it
// needs. Only the marker positions come from the city; the logic lives below.
function primeChapter(M, G, chapter) {
  const city = G.city || { markers: {} };
  const giver = city.markers.glassOrchid || { x: 40, z: -60 };
  M.giver = giver;

  if (chapter.id === 'm1') {
    const coupe = findCoupe(G);
    chapter.coupe = coupe;
    if (coupe) {
      chapter.markX = coupe.x;
      chapter.markZ = coupe.z;
    } else {
      chapter.markX = giver.x + 20;
      chapter.markZ = giver.z + 20;
    }
    G.objective = { title: chapter.title, text: chapter.stage[0], dist: 0 };
    if (G.toast) G.toast(chapter.title);
  }

  if (chapter.id === 'm2') {
    chapter.timer = 0;
    chapter.armed = false;
    M.timer = 0;
    chapter.markX = giver.x;
    chapter.markZ = giver.z;
    G.objective = { title: chapter.title, text: chapter.stage[0], dist: 0 };
    if (G.toast) G.toast('Get two stars');
  }

  if (chapter.id === 'm3') {
    chapter.markX = PIER.x;
    chapter.markZ = PIER.z;
    chapter.timer = MDEF.m3DeliverySec;
    M.timer = chapter.timer;
    G.objective = { title: chapter.title, text: chapter.stage[0], dist: 0 };
    if (G.toast) G.toast('Pier pickup');
  }
}

function openChapter(M, G) {
  const def = MISSIONS[M.index];
  if (!def) return false;
  M.active = resetChapter(def);
  M.step = def.stage[0];
  M.target = { x: 0, z: 0 };
  M.marker = null;
  M.timer = 0;
  M.fail = null;
  primeChapter(M, G, M.active);
  if (M.active.coupe) M.active.coupe.missionCar = true;
  if (G.missionStart) G.missionStart(def);
  return true;
}

export function startMission(M, G) {
  if (!M || !G) return false;
  if (M.index >= MISSIONS.length) return false;
  if (M.active) {
    if (G.toast) G.toast('Finish the job first');
    return false;
  }
  const giver = (G.city && G.city.markers && G.city.markers.glassOrchid) || null;
  if (giver) {
    const here = playerSpot(G);
    if (distance(here.x, here.z, giver.x, giver.z) > REACH_R) {
      if (G.toast) G.toast('See Vesper at the Glass Orchid');
      return false;
    }
  }
  return openChapter(M, G);
}

// Called after a failure: same chapter, fresh state, coupe pulled back into
// town if that is what broke.
export function retryMission(M, G) {
  if (!M || !M.fail) return false;
  const def = MISSIONS[M.index];
  if (!def) return false;
  if (def.id === 'm1') relocateCoupe(G, findCoupe(G));
  M.active = null;
  M.fail = null;
  return openChapter(M, G);
}

// ------------------------------------------------------------------ finish

function finish(M, G, def, note) {
  M.index += 1;
  M.done = M.index;
  M.active = null;
  M.step = '';
  M.timer = 0;
  M.marker = null;
  M.target = null;
  hideBeacon();

  if (def.id === 'm3' && G.PO) {
    G.PO.stars = 0;
    G.PO.noSeeT = 0;
    if (G.sound && G.sound.siren) G.sound.siren(false);
  }
  if (G.sound && G.sound.jingle) G.sound.jingle(true);
  if (G.economyBonus) G.economyBonus(def.reward);

  if (G.missionComplete) {
    G.missionComplete({ title: def.title, story: note || def.story, reward: def.reward, index: M.index });
  }
  if (M.index >= MISSIONS.length && G.toast) G.toast('All jobs done. The bay is yours.');
}

function failChapter(M, G, def, why) {
  M.fail = { title: def.title, hint: why };
  M.timer = 0;
  M.active.state = 'failed';
  if (G.toast) G.toast(why);
  if (G.missionFail) G.missionFail(def.title, why);
}

// ------------------------------------------------------------------ steps

function stepCoupe(M, G, chapter) {
  const def = MISSIONS[0];
  const car = chapter.coupe || findCoupe(G);
  chapter.coupe = car;

  if (!coupeVisible(car)) {
    failChapter(M, G, def, 'The coupe is wrecked. Try again.');
    return;
  }

  if (chapter.state === 'steal') {
    const here = playerSpot(G);
    chapter.markX = car.x;
    chapter.markZ = car.z;
    if (G.inCar === car) {
      chapter.state = 'deliver';
      chapter.stageIndex = 1;
      M.step = def.stage[1];
      if (G.toast) G.toast('Now the Glass Orchid');
      return;
    }
    // Being right beside it and on foot is close enough to call it taken.
    if (!G.inCar && distance(here.x, here.z, car.x, car.z) < MARK_R) {
      chapter.state = 'deliver';
      chapter.stageIndex = 1;
      M.step = def.stage[1];
      if (G.toast) G.toast('Take the wheel');
    }
    return;
  }

  // Deliver: park the coupe inside the lockup marker and stop.
  const giver = G.city.markers.glassOrchid;
  chapter.markX = giver.x;
  chapter.markZ = giver.z;
  M.step = def.stage[1];
  const inside = G.inCar === car && distance(car.x, car.z, giver.x, giver.z) < DELIVER_R;
  if (inside && carriedSpeed(G) < 1) {
    finish(M, G, def); // clears M.active and M.marker
  }
}

function stepHeat(M, G, chapter) {
  const def = MISSIONS[1];
  const stars = G.PO ? G.PO.stars || 0 : 0;
  chapter.markX = 0;
  chapter.markZ = 0;

  if (!chapter.armed) {
    M.step = def.stage[0];
    if (stars >= 2) {
      chapter.armed = true;
      chapter.timer = MDEF.m2EvadeSec;
      chapter.elapsed = 0;
      M.step = def.stage[1];
      if (G.toast) G.toast('Ninety seconds');
    }
    return;
  }

  // The clock only runs once two stars are on the board.
  M.step = def.stage[1];
  chapter.elapsed += 1 / 60;
  chapter.timer = Math.max(0, MDEF.m2EvadeSec - chapter.elapsed);
  M.timer = chapter.timer;

  if (stars <= 0) {
    finish(M, G, def);
    return;
  }
  if (chapter.timer <= 0) {
    failChapter(M, G, def, 'The clock beat you. Shake them faster.');
  }
}

function stepPackage(M, G, chapter) {
  const def = MISSIONS[2];
  chapter.elapsed += 1 / 60;
  chapter.timer = Math.max(0, MDEF.m3DeliverySec - chapter.elapsed);
  M.timer = chapter.timer;

  if (chapter.state === 'pickup') {
    M.step = def.stage[0];
    chapter.markX = PIER.x;
    chapter.markZ = PIER.z;
    const here = playerSpot(G);
    if (distance(here.x, here.z, PIER.x, PIER.z) < PICKUP_R) {
      chapter.state = 'deliver';
      chapter.stageIndex = 1;
      M.step = def.stage[1];
      if (G.addStars) G.addStars(3);
      else if (G.PO) G.PO.stars = Math.max(G.PO.stars || 0, 3);
      if (G.sound && G.sound.siren) G.sound.siren(true);
      if (G.toast) G.toast('Package in hand \u2014 three stars');
    }
  }

  if (M.active !== chapter || chapter.state !== 'deliver') return;

  M.step = def.stage[1];
  const giver = G.city.markers.glassOrchid;
  chapter.markX = giver.x;
  chapter.markZ = giver.z;
  const car = ridden(G);
  const stopX = car ? car.x : G.P.pos.x;
  const stopZ = car ? car.z : G.P.pos.z;
  if (distance(stopX, stopZ, giver.x, giver.z) < DELIVER_R && carriedSpeed(G) < 1) {
    finish(M, G, def);
    return;
  }

  if (M.active.state !== 'failed' && chapter.timer <= 0) {
    failChapter(M, G, def, 'Out of time. Otis is going to hear about this.');
  }
}

// --------------------------------------------------------------- the step

export function updateMissions(M, G, dt) {
  if (!M || !G) return;
  pulseBeacon(dt);
  if (!M.active) {
    M.timer = 0;
    hideBeacon();
    if (M.index < MISSIONS.length) {
      const giver = G.city && G.city.markers ? G.city.markers.glassOrchid : null;
      if (giver) {
        M.target = giver;
        M.marker = giver;
        if (!M.step) M.step = 'see Vesper at the Glass Orchid';
      }
    }
    return;
  }

  const chapter = M.active;
  if (chapter.state === 'failed') {
    hideBeacon();
    return;
  }

  if (chapter.id === 'm1') stepCoupe(M, G, chapter);
  else if (chapter.id === 'm2') stepHeat(M, G, chapter);
  else if (chapter.id === 'm3') stepPackage(M, G, chapter);

  if (M.active && M.active.state !== 'failed') {
    M.target = { x: chapter.markX, z: chapter.markZ };
    M.marker = M.target;
    if (chapter.id === 'm2') hideBeacon();
    else showBeacon(G.W, chapter.markX, chapter.markZ);

    // A conclusion this frame already closed the chapter: do not resurrect it.
    if (M.active !== chapter) return;

    const here = playerSpot(G);
    const dist = distance(here.x, here.z, chapter.markX, chapter.markZ);
    G.objective = { title: chapter.title, text: M.step, dist: Math.round(dist), timer: M.timer };
  }
}

// ---------------------------------------------------------------- panel

// What the job panel shows: the current chapter, or a closing line when the
// three of them are done and the city is yours.
export function missionPanelText(M, G) {
  if (!M) return { title: 'Solara Bay', text: '', timer: 0 };
  if (M.fail) {
    return { title: M.fail.title, text: M.fail.hint + ' Press R to retry.', timer: 0, fail: true };
  }
  if (!M.active) {
    if (M.index >= MISSIONS.length) {
      return { title: 'Solara Bay', text: 'All three jobs done. Run fares, shop, enjoy the sun.', timer: 0 };
    }
    const def = MISSIONS[M.index];
    return {
      title: def.title,
      text: 'See Vesper at the Glass Orchid \u2014 ' + def.brief,
      timer: 0,
      brief: def.brief,
    };
  }
  const def = MISSIONS[M.index] || M.active;
  return { title: M.active.title, text: M.step || (def.stage ? def.stage[0] : ''), timer: M.timer || 0 };
}

export function missionTitle(index) {
  const def = MISSIONS[index];
  return def ? def.title : '';
}

// ---------------------------------------------------------------- setup

export function initMissions() {
  return {
    index: 0,
    active: null,
    done: 0,
    marker: null,
    target: null,
    timer: 0,
    step: '',
    fail: null,
    giver: null,
  };
}
