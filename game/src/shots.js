import { CONFIG } from './config.js';
import { makeRng } from './random.js';
import { updateCamera, renderFrame } from './world.js';
import { makeCar } from './car.js';
import { addStars } from './police.js';
import { startMission } from './missions.js';
import { spawnTracer } from './render.js';
import { showHUD, showPanel } from './hud.js';

const NAMES = ['chase', 'city', 'mission', 'start'];

function look(W, x, z, y, yaw, pitch, dist) {
  W.view.yaw = yaw;
  W.view.pitch = pitch;
  W.view.ready = false;
  updateCamera(W, null, { x, z, y, dist }, 0.5);
}

function spot(car, x, z, h) {
  Object.assign(car, { x, z, heading: h, speed: 0, leg: null });
  car.mesh.position.set(x, 0, z);
  car.mesh.rotation.y = h;
}

function add(G, kind, x, z, h, color, tag) {
  const car = makeCar(kind, x, z, h, color);
  if (tag) car.tag = tag;
  G.W.scene.add(car.mesh);
  G.cars.push(car);
  return car;
}

function sit(G, car) {
  Object.assign(car, { occupant: 'player', player: true });
  G.inCar = car;
  Object.assign(G.P.pos, { x: car.x, z: car.z });
  G.P.group.visible = false;
}

function stand(G, x, z, yaw) {
  G.inCar = null;
  Object.assign(G.P.pos, { x, z, y: 0 });
  Object.assign(G.P, { yaw, dead: false });
  Object.assign(G.P.group, { visible: true });
  G.P.group.position.set(x, 0, z);
  G.P.group.rotation.set(0, yaw, 0);
}

function pose(list, rows) {
  list.slice(0, rows.length).forEach((c, i) => { if (c && !c.wrecked) spot(c, rows[i].x, rows[i].z, rows[i].h); });
}

function crowd(G, rows) {
  G.peds.slice(0, rows.length).forEach((p, i) => {
    if (!p || p.gone) return;
    const s = rows[i];
    Object.assign(p.pos, { x: s.x, z: s.z });
    Object.assign(p, { state: s.state || 'walk', hp: CONFIG.peds.hp, heading: s.h || 0, leg: null });
    p.mesh.visible = true;
    p.mesh.rotation.y = p.heading;
    p.mesh.position.set(s.x, 0, s.z);
  });
}

function cruiser(G, x, z, h, speed) {
  const car = add(G, 'police', x, z, h);
  Object.assign(car, { occupant: 'npc', police: true, siren: true, speed: speed || 0 });
  car.ai = { stuck: 0, rev: 0, ramT: 0, deploying: false, hold: true };
  G.PO.cars.push(car);
}

function officer(G, x, z, down) {
  const body = makeCar('police', x, z, 0).mesh;
  body.scale.set(0.45, 0.5, 0.28);
  body.position.set(x, down ? 0.4 : 0, z);
  body.rotation.set(down ? -Math.PI / 2 : 0, 0.3, 0);
  G.W.scene.add(body);
}

function stage(G, gen, name) {
  const H = G.H;
  const cam = CONFIG.player.camHeight;
  if (name === 'chase') {
    const coupe = add(G, 'sport', 12, 88, Math.PI, 0xd94f4f);
    sit(G, coupe);
    addStars(G.PO, 3, G);
    G.PO.noSeeT = 0;
    cruiser(G, 24, 100, Math.PI, 12);
    cruiser(G, 18, 126, Math.PI, 8);
    pose(G.traffic, [{ x: 6, z: 40, h: 0 }, { x: 6, z: -30, h: 0 }, { x: 86, z: 96, h: Math.PI }, { x: -6, z: 140, h: 0 }]);
    crowd(G, [{ x: 16, z: 70, state: 'flee' }, { x: -4, z: 74 }]);
    G.screen = 'play';
    showHUD(H, true);
    look(G.W, coupe.x, coupe.z, 1.3, Math.PI, 0.26, 8.5);
  } else if (name === 'city') {
    stand(G, 30, 6, -Math.PI / 2);
    add(G, 'taxi', 36, 74, Math.PI);
    pose(G.traffic, [{ x: 74, z: 6, h: -Math.PI / 2 }, { x: 18, z: 6, h: Math.PI / 2 }]);
    crowd(G, [{ x: 34, z: -3, h: 3 }, { x: 26, z: 3 }, { x: 33, z: 13, h: 2 }, { x: 22, z: -4, h: 1 }]);
    startMission(G.M, G, { force: true });
    if (G.M.active) Object.assign(G.M.active, { stage: 'deliver' });
    G.screen = 'play';
    showHUD(H, true);
    look(G.W, 30, 6, cam, -Math.PI / 2, 0.2, 5.5);
  } else if (name === 'mission') {
    const crate = G.city.pickup || { x: -18, z: -24 };
    stand(G, crate.x, crate.z - 4, Math.PI);
    Object.assign(G.P, { rifle: true, weapon: 'rifle', ammo: 60 });
    addStars(G.PO, 2, G);
    G.PO.noSeeT = 0;
    officer(G, crate.x + 2, crate.z - 14, false);
    officer(G, crate.x - 3.4, crate.z - 11, true);
    spawnTracer({ x: crate.x + 2, y: 1.35, z: crate.z - 14 }, { x: crate.x, y: 1.15, z: crate.z - 4 });
    cruiser(G, -20, -66, 0.4, 4);
    crowd(G, [{ x: crate.x - 8, z: crate.z - 6, state: 'flee' }, { x: crate.x + 6, z: crate.z - 10 }]);
    G.screen = 'play';
    showHUD(H, true);
    look(G.W, crate.x, crate.z - 4, cam, Math.PI, 0.18, 5.5);
  } else {
    add(G, 'sport', -30, -18, 0.6, 0xe88f6f);
    stand(G, -44, -20, 0.4);
    G.screen = 'title';
    showHUD(H, false);
    showPanel(H, 'title');
    look(G.W, -30, -20, 7, 0.7, 0.4, 30);
  }
  renderFrame(G.W);
}

// Poses one of the four demo scenes instantly. Returns its name, or '' when it
// threw (the title already says why); main.js flips __shotReady after two frames.
export function applyShot(name, G) {
  try {
    if (NAMES.indexOf(name) < 0) throw new Error('unknown shot ' + name);
    stage(G, makeRng(1), name);
    return name;
  } catch (err) {
    document.title = 'SB-error-' + String((err && err.message) || err).slice(0, 100);
    return '';
  }
}
