// Solara Bay: the wallet, the Vine Mart shelf, the taxi meter and the local save file.

import { CONFIG } from './config.js';

const ECON = CONFIG.economy, RIFLE = CONFIG.weapons.rifle, CAP = 100, STOPPED = 1, ROUND = 10;
const HOP = [ECON.fareDestMin, ECON.fareDestMax];

export const SHOP = [
  { item: 'rifle', label: 'Rifle', price: 600 },
  { item: 'ammo', label: 'Ammo +60', price: 100 },
  { item: 'armor', label: 'Armor', price: 250 },
  { item: 'medkit', label: 'Medkit', price: 50 },
];

export function initEconomy(loaded) {
  const money = loaded && Number.isFinite(loaded.money) ? Math.max(0, Math.round(loaded.money)) : ECON.start;
  return { money, fares: false, fareState: null, savedAt: 0, pulse: 0 };
}

// Pays in, announces, never dips below zero.
export function addMoney(E, n, H) {
  if (!E) return 0;
  const amount = Math.round(n || 0);
  E.money = Math.max(0, E.money + amount);
  if (amount > 0) E.pulse = 1;
  H?.toast?.(`${amount < 0 ? '-' : '+'}$${Math.abs(amount)}`);
  return E.money;
}

export function buyItem(E, P, item, G) {
  const row = SHOP.find((r) => r.item === item);
  if (!row || !E || !P || (item === 'rifle' && P.rifle)) return false;
  if (E.money < row.price) {
    G?.H?.toast?.(`Not enough cash for the ${row.label.toLowerCase()}.`);
    return false;
  }
  E.money -= row.price;
  if (item === 'rifle') Object.assign(P, { rifle: true, ammo: P.ammo || RIFLE.ammoPerBuy });
  else if (item === 'ammo') P.ammo += RIFLE.ammoPerBuy;
  else if (item === 'armor') P.armor = CAP;
  else P.hp = CONFIG.player.hp;
  G?.sound?.chime?.();
  G?.H?.toast?.(`Bought ${row.label} -$${row.price}`);
  G?.saveSoon?.();
  return true;
}

// ---- Taxi meter ---------------------------------------------------------

const isCab = (car) => !!car && car.kind === 'taxi' && !car.wrecked;
const here = (G) => (G?.inCar ? { x: G.inCar.x, z: G.inCar.z } : { x: G?.P?.pos?.x ?? 0, z: G?.P?.pos?.z ?? 0 });
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const setFares = (E, on) => !!(E && (E.fares = !!on));
export const describeFare = (s) => (!s ? 'No fare.' : s.phase === 'pickup' ? 'Pick up the fare' : 'Drive the fare to the marker');

// Base pay, then ~35 cents a metre from 100 to 300 m, in tens inside 80..150.
export function farePay(distance) {
  const share = Math.min(1, Math.max(0, (distance - HOP[0]) / (HOP[1] - HOP[0])));
  const raw = Math.round((ECON.fareMin + (ECON.fareMax - ECON.fareMin) * share) / ROUND) * ROUND;
  return Math.max(ECON.fareMin, Math.min(ECON.fareMax, raw));
}

// A rider at the kerb, or the nearest walker if the city has no fare spawner.
function summonRider(G, cab) {
  let rider = typeof G.spawnFare === 'function' ? G.spawnFare(cab.x, cab.z) : null;
  if (!rider && G.peds?.length) rider = G.peds.filter((p) => !p.riding).sort((a, b) => gap(a.pos, cab) - gap(b.pos, cab))[0];
  return rider ? Object.assign(rider, { fare: true, state: 'wait', taxi: null, riding: false }) : null;
}

// A junction 100-300 m out, closest to a comfortable mid-length hop.
function pickDestination(W, G, cab) {
  const roll = () => (G?.rng ? G.rng.next() : Math.random());
  const nodes = (W?.roads?.nodes || []).map((n) => ({ x: n.x, z: n.z, d: gap(n, cab) }));
  const far = nodes.filter((n) => n.d >= HOP[0]);
  const band = far.filter((n) => n.d <= HOP[1]);
  const pool = band.length ? band : far;
  if (!pool.length) return null;
  const want = HOP[0] + (HOP[1] - HOP[0]) * (0.25 + roll() * 0.6);
  return pool.reduce((best, n) => (Math.abs(n.d - want) < Math.abs(best.d - want) ? n : best), pool[0]);
}

const waiting = (rider) => ({ phase: 'pickup', ped: rider, x: rider.pos.x, z: rider.pos.z, dest: null, dist: 0 });

// T inside a cab: duty on, off, or a reminder of where the fare stands.
export function toggleFareDuty(E, G) {
  if (!E || !G) return false;
  const cab = G.inCar;
  if (E.fares) {
    Object.assign(E, { fares: false, fareState: null });
    G.H?.toast?.('Fare duty off.');
    return false;
  }
  if (!isCab(cab)) {
    G.H?.toast?.('Fares pay in a taxi. Find a yellow cab.');
    return false;
  }
  if (E.fareState) {
    G.H?.toast?.(describeFare(E.fareState));
  } else {
    const rider = summonRider(G, cab);
    if (!rider) {
      G.H?.toast?.('No rider on this block.');
      return false;
    }
    E.fareState = waiting(rider);
    G.sound?.chime?.();
    G.H?.toast?.('Fare duty on. A rider waves nearby.');
    G.spawnFareMarker?.();
  }
  E.fares = true;
  return true;
}

// Cash over, rider out, the next one already waving.
function settle(E, G, cab) {
  const s = E.fareState, rider = summonRider(G, cab);
  addMoney(E, farePay(s.dist), G.H);
  G.sound?.chime?.();
  G.H?.toast?.('Fare paid.');
  if (s.ped) Object.assign(s.ped, { fare: false, riding: false, taxi: null });
  E.fareState = rider ? waiting(rider) : null;
  E.fares = !!rider;
  G.spawnFareMarker?.();
  G.saveSoon?.();
}

/** Pick up, ride, pay, repeat — one step per tick. */
export function updateFares(E, G, dt) {
  const s = E?.fareState;
  if (!s || !G || (G.screen && G.screen !== 'play')) return;
  const cab = G.inCar, speed = cab ? Math.abs(cab.speed) : 0;

  if (s.phase === 'pickup') {
    const ped = s.ped;
    // A rider who went down or boarded another cab ends the shift.
    if (!ped || ped.state === 'down' || ped.riding) {
      Object.assign(E, { fareState: null, fares: false });
      return;
    }
    Object.assign(s, { x: ped.pos.x, z: ped.pos.z });
    if (!cab || speed >= STOPPED || gap(ped.pos, cab) > ECON.farePickupDist) return;
    const dest = pickDestination(G.W, G, cab);
    if (!dest) return;
    const dist = Math.round(gap(dest, cab));
    // Aboard: the marker jumps to the drop-off and the meter counts the run.
    Object.assign(ped, { taxi: cab, riding: true, state: 'ride', fare: true });
    E.fareState = Object.assign(s, { phase: 'ride', x: dest.x, z: dest.z, dest, dist });
    G.sound?.honk?.();
    G.spawnFareMarker?.();
    G.H?.toast?.('Fare aboard. Follow the gold marker.');
    return;
  }

  if (!s.dest) {
    E.fareState = null;
    return;
  }
  const dist = cab ? gap(s.dest, cab) : s.dist;
  Object.assign(s, { x: s.dest.x, z: s.dest.z, dist: Math.round(dist) });
  if (cab && speed < STOPPED && dist <= ECON.farePickupDist + 1) settle(E, G, cab);
}

/** The gold dot the minimap draws while a fare is running. */
export function fareMarker(E) {
  const s = E?.fareState;
  return s ? { x: s.x, z: s.z, kind: s.phase === 'pickup' ? 'farePickup' : 'fareDrop' } : null;
}

// ---- Save file: localStorage can throw on file://, so every call is guarded ----

const store = () => {
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
};

const count = (v, fallback, top) => Math.max(0, Math.min(top, Math.round(Number.isFinite(v) ? v : fallback)));

export function saveGame(G) {
  const box = store();
  if (!G || !box) return false;
  const data = {
    money: count(G.E?.money, ECON.start, 9e6),
    missionIndex: count(G.M?.index, 0, 3),
    rifle: !!G.P?.rifle,
    ammo: count(G.P?.ammo, 0, 9999),
    armor: count(G.P?.armor, 0, CAP),
    playtime: count(G.time, 0, 9e6),
  };
  try {
    box.setItem(ECON.saveKey, JSON.stringify(data));
    if (G.E) G.E.savedAt = G.time || 0;
    return true;
  } catch {
    return false;
  }
}

export function loadGame() {
  let data = null;
  try {
    const raw = store()?.getItem(ECON.saveKey);
    data = raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  // Older or hand-edited slots fall back to the starting wallet field by field.
  return {
    money: count(data.money, ECON.start, 9e6),
    missionIndex: count(data.missionIndex, 0, 3),
    rifle: !!data.rifle,
    ammo: count(data.ammo, 0, 9999),
    armor: count(data.armor, 0, CAP),
    playtime: count(data.playtime, 0, 9e6),
  };
}

export function clearSave() {
  try {
    store()?.removeItem(ECON.saveKey);
    return true;
  } catch {
    return false;
  }
}

// Every 10 s of play, plus at milestones through G.saveSoon.
export function autosave(G) {
  if (!G?.E || (G.time || 0) - (G.E.savedAt || 0) < ECON.saveEvery) return false;
  return saveGame(G);
}

/** Busted and Wasted both bill you; the wallet never goes negative. */
export function chargeFee(E, amount, H) {
  if (!E) return 0;
  const fee = Math.min(E.money, Math.max(0, Math.round(amount)));
  E.money -= fee;
  if (fee > 0) H?.toast?.(`-$${fee}`);
  return fee;
}
