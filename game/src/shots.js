// ?shot=<mode>&seed=<n> stages a deterministic scene for the 4 entry screenshots, and the boot /
// error hooks write status into the DOM (data-boot / data-error) so a headless capture run can
// verify the game booted clean. Modes: start | city | chase | mission.
import { PAL } from './palette.js';
import { W } from './world.js';
import { makeCar } from './car.js';
import { startMission } from './missions.js';

export function parseShot() {
  const q = new URLSearchParams(location.search);
  return { shot: q.get('shot'), seed: Number(q.get('seed') || 1) };
}

export function installErrorHooks() {
  const report = (msg) => {
    document.body.dataset.error = ((document.body.dataset.error || '') + ' | ' + msg).slice(0, 600);
  };
  window.addEventListener('error', (e) => report(`${e.message} @${String(e.filename).split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => report('rejection: ' + e.reason));
}

function placeCar(c, x, z, heading) {
  c.pos.x = x; c.pos.z = z; c.heading = heading;
  c.mesh.position.set(x, 0, z);
  c.mesh.rotation.y = heading;
}

export function stageShot(shot) {
  const p = W.player;
  if (shot === 'city') {
    // on foot at the central intersection, traffic ahead both ways, peds and a parked car nearby
    p.pos.x = -3.6; p.pos.z = 8; p.pos.y = 0;
    W.camYaw = Math.PI; W.camPitch = 0.14; // face north up the road
    const t = W.cars.filter((c) => c.kind === 'traffic');
    if (t[0]) { t[0].axis = 'z'; t[0].at = 0; t[0].dir = 1; t[0].cruise = 9; t[0].speed = 9; placeCar(t[0], -3.6, -24, 0); }
    if (t[1]) { t[1].axis = 'z'; t[1].at = 0; t[1].dir = -1; t[1].cruise = 9; t[1].speed = 9; placeCar(t[1], 3.6, -55, Math.PI); }
    if (t[2]) { t[2].axis = 'x'; t[2].at = 0; t[2].dir = 1; t[2].cruise = 8; t[2].speed = 8; placeCar(t[2], -62, -3.6, Math.PI / 2); }
    const pk = W.cars.find((c) => c.kind === 'parked');
    if (pk) placeCar(pk, -55.4, -20, 0);
    const pedSpots = [[-9, -9], [-41, -41], [12, -20], [30, -45], [-20, -60]];
    W.peds.forEach((ped, i) => { if (i < pedSpots.length && !ped.dead) { ped.pos.x = pedSpots[i][0]; ped.pos.z = pedSpots[i][1]; ped.block = { x: -25, z: -25 }; } });
    startMission(0);
  } else if (shot === 'chase') {
    // driving up the central road at 3 stars; police cars cutting ahead with light bars flashing
    let car = W.cars.find((c) => c.kind === 'parked');
    if (!car) car = makeCar(0xd84b4b, 'parked', 0, 0, 0);
    placeCar(car, 3.6, -30, 0);
    car.speed = 0;
    p.inCar = car;
    p.mesh.visible = false;
    W.wanted = 3;
    W.lastCrime = -1;
    const pspots = [[-3.6, 8], [3.6, 24], [-3.6, 42]];
    for (const [x, z] of pspots) {
      const pc = makeCar(PAL.police, 'police', x, z, Math.PI);
      pc.speed = 12;
    }
    const t = W.cars.filter((c) => c.kind === 'traffic');
    if (t[0]) { t[0].axis = 'z'; t[0].at = 0; t[0].dir = 1; t[0].cruise = 9; t[0].speed = 9; placeCar(t[0], -3.6, -70, 0); }
    startMission(0);
    W.keys.KeyW = true; // hold the throttle through the staged sim
    W.camYaw = 0; W.camPitch = 0.42;
    W.freezeAfter = 45; // freeze before the ram happens
  } else if (shot === 'mission') {
    // mission 2 staged: on foot next to the marked cab on the Hillcrest road, 1 star up
    startMission(1);
    p.pos.x = 117; p.pos.z = -138; p.pos.y = 0;
    W.camYaw = Math.atan2(W.spot.cab.x - 117, W.spot.cab.z + 138);
    W.camPitch = 0.2;
    W.wanted = 1;
    W.lastCrime = -1;
  }
}
