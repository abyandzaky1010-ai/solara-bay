// Solara Bay — cash, the Vine Mart counter, taxi fares and the save file.
// One job: turn every "you got paid" moment into a number, a toast and (when
// it counts) a write to localStorage.

import { CONFIG } from './config.js';
import { makeFarePed, fareDropped } from './peds.js';
import { carSpeedKmph } from './car.js';

const ECO = CONFIG.economy;
const SAVE_KEY = CONFIG.saveKey;
const PICKUP_RANGE = 4;      // metres from a waving passenger
const PICKUP_SPEED = 1;      // km/h — the cab has to be crawling
const STEP_OUT = 3;          // km/h allowed when the passenger gets out
const DEST_MIN = 100;
const DEST_MAX = 300;

/** What the counter sells. Order matches the buttons in index.html. */
export const SHOP = [
  { item: 'rifle', label: 'Rifle', price: 600 },
  { item: 'ammo', label: 'Ammo +60', price: 100 },
  { item: 'armor', label: 'Armor', price: 250 },
  { item: 'medkit', label: 'Medkit', price: 50 },
];

/* ------------------------------------------------------------------ ledger */

/** Start-of-run wallet, or the wallet the last save left behind. */
export function initEconomy(loaded) {
  const saved = loaded && Number.isFinite(loaded.money) ? loaded.money : ECO.start;
  return { money: Math.max(0, Math.round(saved)), fares: false, fareState: null };
}

/** Pay (or fine) the player. `H` is the HUD, so the toast rides along. */
export function addMoney(E, n, H) {
  const amount = Math.round(n);
  E.money = Math.max(0, E.money + amount);
  if (H && H.toast) H.toast(`${amount >= 0 ? '+' : '-'}$${Math.abs(amount)}`);
  return E.money;
}

/* -------------------------------------------------------------------- shop */

/** Buy one counter row; returns true when the cash was there and the effect landed. */
export function buyItem(E, P, item, G) {
  const row = SHOP.find((r) => r.item === item);
  if (!row || !P) return false;
  if (P.rifle && item === 'rifle') {
    if (G && G.toast) G.toast('You already carry the rifle.');
    return false;
  }
  if (E.money < row.price) {
    if (G && G.toast) G.toast('Not enough cash.');
    return false;
  }
  E.money -= row.price;
  applyEffect(P, item);
  if (G) {
    if (G.toast) G.toast(`Bought ${row.label} (-$${row.price})`);
    if (G.sound && G.sound.chime) G.sound.chime();
    if (G.sound && G.sound.cash) G.sound.cash();
    saveGame(G);
  }
  return true;
}

function applyEffect(P, item) {
  if (item === 'rifle') {
    P.rifle = true;
    P.weapon = 'rifle';
    if (!P.ammo) P.ammo = 0;
  } else if (item === 'ammo') {
    P.ammo = (P.ammo || 0) + CONFIG.weapons.rifle.ammoPerBuy;
    if (P.rifle) P.weapon = 'rifle';
  } else if (item === 'armor') {
    P.armor = 100;
  } else if (item === 'medkit') {
    P.hp = CONFIG.player.hp;
    P.dead = false;
  }
}

/* ------------------------------------------------------------------- fares */

/** T flips taxi duty on and off; the first fare stands on the kerb nearby. */
export function setFares(E, on, G) {
  if (!G) return false;
  const car = G.inCar;
  if (on && (!car || car.kind !== 'taxi')) {
    if (G.toast) G.toast('Taxi fares need a cab.');
    return false;
  }
  E.fares = !!on;
  if (!E.fares) {
    E.fareState = null;
    if (G.toast) G.toast('Taxi duty off.');
    return false;
  }
  E.fareState = { phase: 'waiting', ped: null, dest: null, payout: 0, timer: 0 };
  if (G.toast) G.toast('Taxi duty on. Fares pay.');
  requestFare(E, G, car);
  return true;
}

function requestFare(E, G, car) {
  const f = E.fareState;
  if (!f) return;
  f.phase = 'waiting';
  f.dest = null;
  if (G.spawnFare) {
    f.ped = G.spawnFare(car.x, car.z) || null;
  } else if (G.peds && G.rng) {
    f.ped = makeFarePed(G.W, G.city, G.rng, car.x, car.z);
    G.peds.push(f.ped);
  }
  if (G.toast) G.toast('Fare waiting nearby. Pull up and stop.');
}

/** Pick a road point roughly (dist) metres from (x,z). */
function pickDestination(G, x, z, dist) {
  if (G.destPoint) return G.destPoint(x, z, dist);
  const W = G.W;
  const nodes = W && W.roads ? W.roads.nodes : [];
  if (!nodes.length) return { x: x + dist * 0.7, z: z };
  const grid = nodes.filter((n) => n && typeof n.x === 'number');
  const near = grid.filter((n) => {
    const d = Math.hypot(n.x - x, n.z - z);
    return d >= DEST_MIN && d <= DEST_MAX;
  });
  const pool = near.length ? near : grid;
  let best = pool[0];
  let bestGap = Infinity;
  for (const n of pool) {
    const gap = Math.abs(Math.hypot(n.x - x, n.z - z) - dist);
    if (gap < bestGap) { bestGap = gap; best = n; }
  }
  const at = W.roads.at ? W.roads.at(best.x + 2, best.z + 2) : null;
  if (at && typeof at.x === 'number') return { x: at.x, z: at.z };
  return { x: best.x, z: best.z };
}

/** Fare math: longer trip, bigger note, always rounded to ten between 80 and 150. */
function fareFor(distance) {
  const raw = ECO.fareMin + (ECO.fareMax - ECO.fareMin) * (distance / 300);
  const rounded = Math.round(raw / 10) * 10;
  return Math.max(ECO.fareMin, Math.min(ECO.fareMax, rounded));
}

/** One tick of the meter: wait, load, drive, pay out. */
export function updateFares(E, G, dt) {
  if (!E || !E.fares || !E.fareState || !G) return;
  const f = E.fareState;
  const car = G.inCar;
  if (!car || car.kind !== 'taxi') {
    E.fares = false;
    if (f.ped && f.phase !== 'riding') fareDropped(f.ped);
    E.fareState = null;
    return;
  }
  const speed = carSpeedKmph(car);

  if (f.phase === 'waiting') {
    const ped = f.ped;
    if (!ped || ped.gone) { requestFare(E, G, car); return; }
    const d = Math.hypot(car.x - ped.pos.x, car.z - ped.pos.z);
    if (d > 120) { f.ped = null; requestFare(E, G, car); return; }
    if (d < PICKUP_RANGE && speed < PICKUP_SPEED && G.P && !G.P.dead) {
      f.phase = 'riding';
      ped.state = 'ride';
      ped.fare = true;
      if (ped.mesh) ped.mesh.visible = false;
      const dist = DEST_MIN + Math.random() * (DEST_MAX - DEST_MIN);
      const spot = pickDestination(G, car.x, car.z, Math.round(dist * 0.7));
      f.dest = spot;
      f.payout = fareFor(Math.round(dist));
      f.timer = 0;
      if (G.toast) G.toast(`Fare on board. $${f.payout} to the drop.`);
      if (G.sound && G.sound.chime) G.sound.chime();
    }
    return;
  }

  if (f.phase === 'riding' && f.dest) {
    f.timer += dt;
    const d = Math.hypot(car.x - f.dest.x, car.z - f.dest.z);
    if (d < 5 && speed < STEP_OUT) {
      const paid = f.payout || fareFor(120);
      f.phase = 'paid';
      if (f.ped) { fareDropped(f.ped); f.ped = null; }
      addMoney(E, paid, G.H);
      if (G.toast) G.toast(`Fare paid: $${paid}`);
      if (G.sound && G.sound.cash) G.sound.cash();
      f.dest = null;
      f.timer = 0;
      if (G.saveGame) G.saveGame();
      requestFare(E, G, car);
    }
  }
}

/* -------------------------------------------------------------------- save */

function store() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (err) {
    return null;
  }
}

/** Snapshot the run: wallet, story progress, kit, clock. */
export function saveGame(G) {
  const ls = store();
  if (!ls || !G) return false;
  const blob = {
    money: G.E ? G.E.money : ECO.start,
    missionIndex: G.M ? G.M.index : 0,
    rifle: !!(G.P && G.P.rifle),
    ammo: G.P && G.P.ammo ? G.P.ammo : 0,
    armor: G.P && G.P.armor ? Math.round(G.P.armor) : 0,
    playtime: Math.round(G.time || 0),
  };
  try {
    ls.setItem(SAVE_KEY, JSON.stringify(blob));
    return true;
  } catch (err) {
    return false;
  }
}

/** Read the last save back, or null when the browser refuses storage. */
export function loadGame() {
  const ls = store();
  if (!ls) return null;
  try {
    const raw = ls.getItem(SAVE_KEY);
    if (!raw) return null;
    const blob = JSON.parse(raw);
    if (!blob || typeof blob !== 'object') return null;
    return {
      money: Number.isFinite(blob.money) ? blob.money : ECO.start,
      missionIndex: Number.isFinite(blob.missionIndex) ? blob.missionIndex : 0,
      rifle: !!blob.rifle,
      ammo: Number.isFinite(blob.ammo) ? blob.ammo : 0,
      armor: Number.isFinite(blob.armor) ? blob.armor : 0,
      playtime: Number.isFinite(blob.playtime) ? blob.playtime : 0,
    };
  } catch (err) {
    return null;
  }
}

/** Clear the slot (a fresh run beats an old wallet). */
export function clearSave() {
  const ls = store();
  if (!ls) return;
  try { ls.removeItem(SAVE_KEY); } catch (err) { /* storage blocked */ }
}
