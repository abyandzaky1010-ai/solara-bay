// Missions and the story thread with Mara Vox, plus the repeatable taxi activity.
// A mission has phases, a glowing marker, an objective line on the HUD, a timer where set,
// a money reward, and a fail state. The cab (roof sign) doubles as the taxi.
import * as THREE from 'three';
import { CFG } from './config.js';
import { PAL } from './palette.js';
import { rr, pick } from './random.js';
import { W, dist, say, saveGame } from './world.js';
import { makeCar } from './car.js';
import { sfx } from './sfx.js';

export const MISSIONS = [
  {
    id: 'm1', name: 'First Run',
    brief: 'Mara: "Package at the pawn shop, west side. Get it to the docks before the timer dies."',
    pickup: 'pawn', drop: 'docks', time: 90, reward: CFG.rewards[0],
  },
  {
    id: 'm2', name: 'Hot Wheels',
    brief: 'Mara: "There\'s a cab parked in Hillcrest. Bring it to my garage, north-west. Cops will notice."',
    cab: 'cab', drop: 'garage', reward: CFG.rewards[1],
  },
  {
    id: 'm3', name: 'Payback',
    brief: 'Mara: "The Dusk Line marked three cars around town. Wreck all three."',
    spots: [{ x: -50, z: -94.6 }, { x: 105.4, z: 50 }, { x: 5.4, z: -150 }],
    reward: CFG.rewards[2],
  },
];

let marker = null;

export function setMarker(pos) {
  if (!marker) {
    marker = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, 30, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffc857, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    );
    W.scene.add(marker);
  }
  marker.position.set(pos.x, 15, pos.z);
  marker.visible = true;
  W.markerPos = pos;
}

export function hideMarker() {
  if (marker) marker.visible = false;
  W.markerPos = null;
}

function randomSpot() {
  const r = W.rng;
  const p = pick(r, CFG.roadAt);
  if (r() < 0.5) return { x: p + 3.6, z: rr(r, -140, 140) };
  return { x: rr(r, -140, 140), z: p - 3.6 };
}

function complete(m) {
  W.money += m.def.reward;
  sfx.cash();
  W.missionIdx++;
  W.story = W.missionIdx;
  saveGame();
  W.mission = null;
  hideMarker();
  W.mdone = { title: m.def.name.toUpperCase() + ' — COMPLETE', text: `Mara paid $${m.def.reward}. Cash: $${W.money}.` };
  say(m.def.id === 'm3' ? 'Debt cleared. Solara Bay is yours, kid.' : 'Good work. Come see me when you\'re free.');
}

function fail(m, why) {
  W.mission = null;
  hideMarker();
  if (m.cab) { W.scene.remove(m.cab.mesh); W.cars.splice(W.cars.indexOf(m.cab), 1); }
  for (const g of (m.gangs || [])) if (!g.dead) { W.scene.remove(g.mesh); W.cars.splice(W.cars.indexOf(g), 1); }
  say(why);
}

export function startMission(i) {
  const def = MISSIONS[i];
  const m = { def, phase: 'pickup', t: def.time || 0, cab: null, gangs: [] };
  W.mission = m;
  say(def.brief);
  if (def.id === 'm1') { setMarker(W.spot.pawn); W.objective = 'Collect the package at the pawn shop'; }
  if (def.id === 'm2') {
    m.cab = makeCar(PAL.taxi, 'target', W.spot.cab.x, W.spot.cab.z, Math.PI / 2);
    setMarker(W.spot.cab);
    W.objective = 'Steal the marked cab (E next to it)';
  }
  if (def.id === 'm3') {
    for (const s of def.spots) m.gangs.push(makeCar(PAL.gang, 'gang', s.x, s.z, 0));
    setMarker(def.spots[0]);
    W.objective = 'Wreck the 3 Dusk Line cars';
  }
}

function updateTaxi(dt) {
  const t = W.taxi;
  if (!t || !W.player.inCar || W.player.inCar.kind !== 'taxi') { if (t) hideMarkerWhenTaxi(); return; }
  const car = W.player.inCar;
  if (t.phase === 'pickup') {
    setMarker(t.spot);
    W.objective = `Taxi: pick up the fare at the marker ($${t.fare || '…'} fare)`;
    if (dist(car.pos.x, car.pos.z, t.spot.x, t.spot.z) < 6) {
      t.phase = 'drop';
      t.dest = randomSpot();
      t.fare = Math.round(CFG.taxiBase + dist(t.spot.x, t.spot.z, t.dest.x, t.dest.z) * CFG.taxiPerM);
      const ped = W.peds.find((p) => !p.dead && !p.rider);
      if (ped) { ped.rider = true; t.rider = ped; }
      say(`Fare accepted. Drive to the marker — pays $${t.fare}.`);
    }
  } else if (t.phase === 'drop') {
    setMarker(t.dest);
    W.objective = `Taxi: drop the fare at the marker ($${t.fare})`;
    if (dist(car.pos.x, car.pos.z, t.dest.x, t.dest.z) < 6) {
      W.money += t.fare;
      sfx.cash();
      say(`Fare paid: $${t.fare}. Cash: $${W.money}.`);
      if (t.rider) { t.rider.rider = false; t.rider.pos.x = t.dest.x + 2; t.rider.pos.z = t.dest.z; t.rider = null; }
      t.phase = 'pickup';
      t.spot = randomSpot();
      t.fare = 0;
    }
  }
}

function hideMarkerWhenTaxi() { /* marker ownership returns to missions next frame */ }

export function updateMissions(dt) {
  // car enter/exit hooks
  if (W.justEntered) {
    const c = W.justEntered;
    W.justEntered = null;
    if (c.kind === 'taxi' && !W.taxi) { W.taxi = { phase: 'pickup', spot: randomSpot(), dest: null, fare: 0, rider: null }; say('Cab radio: fares around town. Pick up the marker.'); }
    if (c.kind === 'taxi' && W.taxi && W.taxi.phase === 'drop') { /* resume handled in updateTaxi */ }
    const m = W.mission;
    if (m && m.def.id === 'm2' && m.phase === 'take' && c === m.cab) {
      m.phase = 'drop';
      setMarker(W.spot[m.def.drop]);
      W.objective = 'Deliver the cab to the garage (north-west)';
      say('Nice. Now drive it to the garage. Don\'t wreck it.');
    }
  }
  W.justExited = null;

  const m = W.mission;
  if (!m) {
    if (W.missionIdx < MISSIONS.length) {
      const s = W.spot.mara;
      setMarker(s);
      const near = dist(W.player.pos.x, W.player.pos.z, s.x, s.z) < 5 && !W.player.inCar;
      W.talkTarget = near;
      W.objective = near ? 'Talk to Mara Vox (E)' : 'Go to Mara Vox (yellow marker)';
    } else {
      hideMarker();
      W.talkTarget = false;
      W.objective = W.taxi ? W.objective : 'Free roam — drive the cab for fares, or cause trouble';
    }
    updateTaxi(dt);
    return;
  }

  const p = W.player;
  const pp = p.inCar ? p.inCar.pos : p.pos;
  if (m.def.id === 'm1') {
    if (m.phase === 'pickup') {
      setMarker(W.spot[m.def.pickup]);
      W.objective = 'Collect the package at the pawn shop';
      if (dist(pp.x, pp.z, W.spot.pawn.x, W.spot.pawn.z) < 4.5) {
        m.phase = 'drop'; m.t = m.def.time;
        setMarker(W.spot[m.def.drop]);
        say('Package secured. Docks, before the timer dies!');
      }
    } else {
      m.t -= dt;
      setMarker(W.spot[m.def.drop]);
      W.objective = `Deliver the package to the docks — ${Math.max(0, Math.ceil(m.t))}s`;
      if (m.t <= 0) fail(m, 'Too slow. Mara is not happy. Try again.');
      else if (dist(pp.x, pp.z, W.spot.docks.x, W.spot.docks.z) < 6) complete(m);
    }
  }
  if (m && m.def.id === 'm2') {
    if (m.cab.dead) fail(m, 'The cab is wrecked. Mara wants it in one piece.');
    else if (m.phase === 'drop' && p.inCar === m.cab && dist(pp.x, pp.z, W.spot.garage.x, W.spot.garage.z) < 7) complete(m);
  }
  if (m && m.def.id === 'm3') {
    const alive = m.gangs.filter((g) => !g.dead);
    if (alive.length === 0) complete(m);
    else {
      setMarker(alive[0].pos);
      W.objective = `Wreck the Dusk Line cars — ${alive.length} left (ram or shoot them)`;
    }
  }
}
