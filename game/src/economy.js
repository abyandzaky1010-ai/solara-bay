// Solara Bay — money, the Vine Mart counter, the taxi meter and the save file.
// One clear job: everything the player earns, spends and gets to keep.

import { CONFIG } from './config.js';
import { snapToLane } from './world.js';
import { fareDropped } from './peds.js';

const ECO = CONFIG.economy;
const SAVE = CONFIG.saveKey;
const AUTOSAVE_SEC = 10;
const REACH = 4; // metres: board or settle on this
const SLOW = 1; // the cab has to be crawling to do either
const NEAR_M = 100; // shortest fare
const FAR_M = 300; // longest fare
const PATIENCE = 180; // seconds a hand stays up at the kerb

/** The four things Vine Mart sells, in the order the shop list shows them. */
export const SHOP = [
  { item: 'rifle', label: 'Rifle', price: 600 },
  { item: 'ammo', label: 'Ammo +60', price: 100 },
  { item: 'armor', label: 'Armor', price: 250 },
  { item: 'medkit', label: 'Medkit', price: 50 },
];

/* -------------------------------------------------------------------- storage */

/** localStorage throws when the page is opened from disk: swallow it, always. */
function readStore(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key));
  } catch (err) {
    return null;
  }
}

function writeStore(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    return false;
  }
}

/* --------------------------------------------------------------------- wallet */

/** A fresh two-hundred, or whatever the last game left in the glovebox. */
export function initEconomy(loaded) {
  const cash = loaded && Number.isFinite(loaded.money) ? Math.max(0, Math.round(loaded.money)) : ECO.start;
  return { money: cash, fares: false, fareState: null, earned: 0, spent: 0, playtime: (loaded && loaded.playtime) || 0 };
}

/** Credit or debit the purse and say so on the HUD. Returns the new balance. */
export function addMoney(E, n, H) {
  if (!E) return 0;
  const amount = Math.round(Number(n) || 0);
  E.money = Math.max(0, E.money + amount);
  if (amount > 0) E.earned += amount;
  else E.spent += -amount;
  if (H && H.toast) H.toast(`${amount >= 0 ? '+' : '-'}$${Math.abs(amount)}`);
  return E.money;
}

/* ----------------------------------------------------------------------- shop */

/**
 * Pay for a row of the shop and apply it. True only when something changed:
 * no sale without cash, no rifle twice, no armor over full, no pointless kit.
 */
export function buyItem(E, P, item, G) {
  const row = SHOP.find((r) => r.item === item);
  if (!E || !P || !row) return false;
  const tell = (line) => {
    if (G && G.toast) G.toast(line);
    return false;
  };
  if (E.money < row.price) return tell('Not enough cash.');
  if (item === 'rifle' && P.rifle) return tell('You already carry the rifle.');
  if (item === 'armor' && P.armor >= 100) return tell('Armor is already full.');
  if (item === 'medkit' && P.hp >= CONFIG.player.hp) return tell('Nothing to patch up.');

  E.money -= row.price;
  E.spent += row.price;
  if (item === 'rifle') {
    P.rifle = true;
    P.weapon = 'rifle';
  } else if (item === 'ammo') {
    P.ammo = (P.ammo || 0) + CONFIG.weapons.rifle.ammoPerBuy;
  } else if (item === 'armor') {
    P.armor = 100;
  } else {
    P.hp = CONFIG.player.hp;
  }
  tell(`${row.label} bought: -$${row.price}.`);
  if (G && G.sound && G.sound.chime) G.sound.chime();
  if (G && G.saveGame) G.saveGame();
  return true;
}

/* ---------------------------------------------------------------------- fares */

/** Nearest lane centre, so a destination always sits on drivable asphalt. */
function laneAt(W, x, z) {
  const spot = snapToLane(W, x, z);
  return { x: spot.x, z: spot.z };
}

/** A drop 100-300 m out: far enough to drive, close enough to quote. */
function rollDestination(W, x, z) {
  let spot = laneAt(W, x + NEAR_M, z);
  for (let i = 0; i < 10; i++) {
    const turn = Math.random() * Math.PI * 2;
    const reach = NEAR_M + Math.random() * (FAR_M - NEAR_M);
    const at = laneAt(W, x + Math.cos(turn) * reach, z + Math.sin(turn) * reach);
    spot = { x: at.x, z: at.z, dist: Math.hypot(at.x - x, at.z - z) };
    if (spot.dist >= NEAR_M && spot.dist <= FAR_M) break;
  }
  return spot;
}

/**
 * The meter: fareMin base, fareMax at 300 m, scaled straight by distance,
 * rounded to ten, clamped. Always a note, never coin.
 */
function meterFor(dist) {
  const share = Math.min(1, Math.max(0, (dist - NEAR_M) / (FAR_M - NEAR_M)));
  const raw = (ECO.fareMin + (ECO.fareMax - ECO.fareMin) * share) / 10;
  return Math.max(ECO.fareMin, Math.min(ECO.fareMax, Math.round(raw) * 10));
}

function stopped(car) {
  return car && Math.abs(car.speed || 0) < SLOW;
}

/** Put a new hand up at the kerb beside the cab. */
function nextWaitingFare(E, G, car) {
  const f = E.fareState;
  if (!f) return;
  f.phase = 'waiting';
  f.ped = G && G.spawnFare ? G.spawnFare(car.x, car.z) : null;
  f.dest = null;
  f.payout = 0;
  f.timer = PATIENCE;
}

/** Wave a waiting fare off: they go back to walking. */
function sendHome(ped) {
  if (!ped) return;
  ped.state = 'walk';
  ped.fare = false;
}

/**
 * Flip taxi duty. On: a passenger appears at the kerb waving. Off: the meter
 * closes and the waiting face walks away.
 */
export function setFares(E, on, G) {
  if (!E) return false;
  const car = G && G.inCar;
  if (!on) {
    if (E.fareState) sendHome(E.fareState.ped);
    E.fares = false;
    E.fareState = null;
    if (G && G.toast) G.toast('Meter off.');
    return false;
  }
  if (!car || car.kind !== 'taxi' || car.wrecked) {
    if (G && G.toast) G.toast('You need a taxi to run fares.');
    return false;
  }
  E.fares = true;
  if (!E.fareState) E.fareState = { phase: 'waiting', ped: null, dest: null, payout: 0, timer: PATIENCE, trips: 0 };
  nextWaitingFare(E, G, car);
  if (G && G.toast) G.toast('Taxi duty on. Collect the fare at the kerb.');
  if (G && G.sound && G.sound.honk) G.sound.honk();
  return true;
}

/**
 * The meter, every step: waiting → board when the cab crawls alongside;
 * riding → pay when the cab stops on the destination. Losing the taxi ends it.
 */
export function updateFares(E, G, dt) {
  if (!E || !G) return;
  E.playtime += dt;
  const f = E.fareState;
  if (!E.fares || !f) return;
  const car = G.inCar;

  if (!car || car.kind !== 'taxi' || car.wrecked) {
    if (f.phase === 'waiting') sendHome(f.ped);
    E.fares = false;
    E.fareState = null;
    if (G.toast) G.toast('Taxi duty over.');
    return;
  }

  if (f.phase === 'waiting') {
    const spot = f.ped && !f.ped.gone ? f.ped.pos : null;
    if (spot && stopped(car) && Math.hypot(car.x - spot.x, car.z - spot.z) < REACH) {
      const dest = rollDestination(G.W, car.x, car.z);
      if (f.ped) {
        f.ped.state = 'ride';
        f.ped.mesh.visible = false;
      }
      f.phase = 'riding';
      f.dest = dest;
      f.payout = meterFor(dest.dist);
      f.timer = 0;
      if (G.toast) G.toast(`Fare aboard. ${Math.round(dest.dist)} m to go.`);
      if (G.sound && G.sound.chime) G.sound.chime();
      return;
    }
    f.timer -= dt;
    if (!spot || f.timer <= 0) {
      // Nobody came, or the hand gave up: a fresh one goes up near the cab.
      sendHome(f.ped);
      nextWaitingFare(E, G, car);
    }
    return;
  }

  if (f.dest && stopped(car) && Math.hypot(car.x - f.dest.x, car.z - f.dest.z) < REACH) {
    fareDropped(f.ped);
    addMoney(E, f.payout, null);
    if (G.toast) G.toast(`Fare paid $${f.payout}.`);
    if (G.sound && G.sound.chime) G.sound.chime();
    if (G.saveGame) G.saveGame();
    f.trips += 1;
    nextWaitingFare(E, G, car);
  }
}

/* ----------------------------------------------------------------- save/load */

/** The whole persistent game in six fields. */
function snapshot(G) {
  const P = G.P || {};
  return {
    money: G.E ? Math.round(G.E.money) : ECO.start,
    missionIndex: G.M ? G.M.index || 0 : 0,
    rifle: !!P.rifle,
    ammo: Math.max(0, Math.round(P.ammo || 0)),
    armor: Math.max(0, Math.round(P.armor || 0)),
    playtime: Math.round((G.E && G.E.playtime) || G.time || 0),
  };
}

/** Write the save. Ten-second autosave, mission ends, purchases, fare payouts. */
export function saveGame(G) {
  return G ? writeStore(SAVE, snapshot(G)) : false;
}

/** The save if one exists, else null. Never throws. */
export function loadGame() {
  const saved = readStore(SAVE);
  if (!saved || typeof saved !== 'object') return null;
  return {
    money: Number.isFinite(saved.money) ? saved.money : ECO.start,
    missionIndex: Number.isFinite(saved.missionIndex) ? saved.missionIndex : 0,
    rifle: !!saved.rifle,
    ammo: Math.max(0, Math.round(saved.ammo || 0)),
    armor: Math.max(0, Math.min(100, Math.round(saved.armor || 0))),
    playtime: Math.max(0, Math.round(saved.playtime || 0)),
  };
}

/** A new game forgets the old one. */
export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE);
  } catch (err) {
    // nothing stored, nothing lost
  }
}

/** Metronome helper: true on the tick that wrote the file. */
export function tickSave(G, dt) {
  G.saveT = (G.saveT || 0) + dt;
  if (G.saveT < AUTOSAVE_SEC) return false;
  G.saveT = 0;
  return saveGame(G);
}
