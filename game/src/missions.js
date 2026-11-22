// Solara Bay — one job: Vesper's three jobs, their gold beacons, clocks and failure states.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { C } from './palette.js';
import { addStars, clearPolice } from './police.js';

const MS = CONFIG.missions, REACH = 5, STOPPED = 1, PULSE = 2.4;
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const chain = (m) => (m.next ? ['m2', 'm3'][m.next - 1] : null);

// The story beat that opens each job, shown on the title card and in panels.
const INTRO = ['The bay owes Vesper one favour. Tonight it starts paying.',
  'Three jobs, one lockup, and a city that never stops watching.'];

/**
 * Three jobs, in order, each a small state machine:
 * steal → deliver, arm → survive → evade, collect → deliver.
 */
const MISSIONS = [
  { id: 'm1', title: 'Wheels for Vesper', brief: 'Steal the Coral coupe, bring it to the Glass Orchid lockup and stop.', state: 'steal', reward: MS.m1, story: 'It runs. Vesper smiles like a knife.' },
  { id: 'm2', title: 'Shake the Heat', brief: 'Get two stars, then lose them before the clock runs out.', state: 'arm', reward: MS.m2, limit: MS.m2EvadeSec, story: 'The sirens fade. Somewhere out there, Otis is smiling.' },
  { id: 'm3', title: 'Harbor Handoff', brief: 'Pick up the package at the pier, deliver it to the Glass Orchid, expect heat.', state: 'collect', reward: MS.m3, limit: MS.m3DeliverySec, story: 'Solara Bay knows your name now. Free ride: fares pay, the shop sells, the bay stays warm.' },
];

export function initMissions() {
  return { index: 0, active: null, done: 0, marker: null, timer: 0, beacon: null, pulseT: 0, intro: INTRO, failed: null, step: '' };
}

/** A gold cylinder on the street, pulsing so a beacon reads from across the road. */
function beacon(W) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 9, 14, 1, true),
    new THREE.MeshBasicMaterial({ color: C.beacon, transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false }));
  shaft.position.y = 4.5;
  const pad = new THREE.Mesh(new THREE.CircleGeometry(2.1, 20),
    new THREE.MeshBasicMaterial({ color: C.beacon, transparent: true, opacity: 0.65, depthWrite: false }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.06;
  g.add(shaft, pad);
  g.userData.shaft = shaft;
  g.userData.pad = pad;
  if (W && W.scene) W.scene.add(g);
  return g;
}

/** Put the beacon on a world spot and breathe its scale. */
function plant(M, W, at) {
  if (!M.beacon) M.beacon = beacon(W);
  M.beacon.visible = Boolean(at);
  if (at) M.beacon.position.set(at.x, 0, at.z);
}

/** Where the current step wants her, from the city's named places. */
function targetFor(M, job, G) {
  const marks = G.city.markers;
  if (job.id === 'm1') return M.step === 'steal' ? (G.m1car ? { x: G.m1car.x, z: G.m1car.z } : marks.glassOrchid) : marks.glassOrchid;
  if (job.id === 'm3') return M.step === 'collect' ? G.city.pier : marks.glassOrchid;
  return null;
}

/** Can she touch the giver's kerb right now? */
export function atGiver(M, G) {
  const at = G.city.markers.glassOrchid;
  return !G.inCar && gap(G.P.pos, at) <= MS.giverRadius;
}

/** Start the job at M.index, but only standing at the Glass Orchid with a job left. */
export function startMission(M, G) {
  const job = MISSIONS[M.index];
  if (!job || M.active) return false;
  M.active = job;
  M.step = job.state;
  M.timer = job.limit || 0;
  M.failed = null;
  const at = targetFor(M, job, G);
  plant(M, G.W, at);
  M.marker = at ? { x: at.x, z: at.z } : null;
  panel(M, G, `${job.title} — ${job.brief}`);
  return true;
}

/** Line the HUD shows while a job is live. */
function panel(M, G, text) {
  const job = M.active;
  G.objective = job ? { title: job.title, text, dist: M.marker ? Math.round(gap(G.P.pos, M.marker)) : 0, timer: M.timer, kind: M.step } : null;
}

/** Give up on a job: clear the beacon, keep the index, offer a retry. */
function fail(M, G, why) {
  M.failed = { id: M.active.id, why };
  M.active = null;
  M.timer = 0;
  M.marker = null;
  plant(M, G.W, null);
  G.objective = null;
  G.sound?.chime?.();
  if (typeof G.failPanel === 'function') G.failPanel(`${why} Press R to try again.`);
}

/** Pay the job out and advance the story. */
function finish(M, G, job) {
  M.done += 1;
  M.index = Math.min(MISSIONS.length, M.index + 1);
  M.active = null;
  M.timer = 0;
  M.marker = null;
  plant(M, G.W, null);
  G.objective = null;
  G.sound?.chime?.();
  if (job.id === 'm3') clearPolice(G.PO, G);
  if (typeof G.missionComplete === 'function') G.missionComplete(job.reward, job.story);
}

/** m1: the coupe is taken and parked in the lockup. */
function checkSteal(M, G, job) {
  const coupe = G.m1car;
  if (!coupe) return;
  if (coupe.wrecked) return fail(M, G, 'The Coral coupe is a burnt shell.');
  if (M.step === 'steal' && G.inCar === coupe) { M.step = 'deliver'; M.marker = G.city.markers.glassOrchid; plant(M, G.W, M.marker); panel(M, G, 'Deliver the coupe to the Glass Orchid and stop.'); return; }
  if (M.step === 'deliver' && gap(coupe, G.city.markers.glassOrchid) <= MS.deliverRadius && Math.abs(coupe.speed) < STOPPED) finish(M, G, job);
}

/** m2: show two stars, then shake them inside the window. */
function checkEvade(M, G, job) {
  const stars = G.PO ? G.PO.stars : 0;
  if (M.step === 'arm' && stars >= 2) {
    M.step = 'evade';
    M.timer = job.limit;
    panel(M, G, 'Lose the police before the clock runs out.');
    return;
  }
  if (M.step === 'evade' && stars === 0) return finish(M, G, job);
  if (M.timer <= 0) return fail(M, G, 'Still wanted when the clock ran out.');
}

/** m3: collect at the pier, then survive the handoff home. */
function checkHandoff(M, G, job) {
  if (M.step === 'collect') {
    const pier = G.city.pier;
    if (gap(G.inCar || G.P.pos, pier) <= MS.deliverRadius) {
      M.step = 'deliver';
      M.timer = job.limit;
      M.marker = G.city.markers.glassOrchid;
      plant(M, G.W, M.marker);
      addStars(G.PO, 3, G);
      panel(M, G, 'Deliver the package to the Glass Orchid. You have company.');
    }
    return;
  }
  if (gap(G.inCar || G.P.pos, G.city.markers.glassOrchid) <= MS.deliverRadius) finish(M, G, job);
}

const CHECKS = { m1: checkSteal, m2: checkEvade, m3: checkHandoff };

/** Per-frame: clock, beacon pulse, marker, HUD line, completion and failure. */
export function updateMissions(M, G, dt) {
  if (M.failed && !atGiver(M, G)) M.failed = null;
  const job = M.active;
  if (!job) return;
  if (M.timer > 0) {
    M.timer = Math.max(0, M.timer - dt);
    if (M.timer === 0 && (job.id === 'm2' || job.id === 'm3')) return fail(M, G, 'Out of time.');
  }
  const at = M.step === 'm2' ? null : targetFor(M, job, G);
  if (at) { M.marker = { x: at.x, z: at.z }; plant(M, G.W, at); }
  M.pulseT += dt;
  if (M.beacon && M.beacon.visible) {
    const s = 1 + Math.sin(M.pulseT * PULSE) * 0.18;
    M.beacon.scale.set(1, s, 1);
    M.beacon.userData.shaft.material.opacity = 0.26 + Math.sin(M.pulseT * PULSE) * 0.12;
  }
  panel(M, G, M.step === 'steal' ? 'Steal the Coral coupe.' : M.step === 'deliver' ? 'Deliver it to the Glass Orchid and stop.' : M.step === 'arm' ? 'Wanted, two stars: make some noise.' : M.step === 'evade' ? 'Lose the police before the clock runs out.' : 'Pick up the package at the pier.');
  const check = CHECKS[job.id];
  if (check && M.active === job) check(M, G, job);
}

/** Copy for the mission panel: the live job, or what is next. */
export function missionPanelText(M) {
  const job = M.active || MISSIONS[Math.min(M.index, MISSIONS.length - 1)];
  if (!job) return `${INTRO[0]}\n${INTRO[1]}`;
  if (M.failed) return `${job.title} — ${M.failed.why}\nPress R to try again.`;
  const step = M.active ? (M.timer > 0 ? ` ${Math.ceil(M.timer)} s` : '') : ' Talk to Vesper at the Glass Orchid.';
  return `${job.title}\n${job.brief}${step}`;
}

export { MISSIONS, INTRO, chain, fail, finish };
