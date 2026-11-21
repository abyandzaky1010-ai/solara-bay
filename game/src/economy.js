// Money, the Vine Mart shop, the taxi meter and the save slot.

import { CONFIG } from './config.js';

const ECO = CONFIG.economy;
const RIFLE = CONFIG.weapons.rifle;

export const SHOP = [
  { item: 'rifle', label: 'Rifle', price: 600 },
  { item: 'ammo', label: 'Ammo +60', price: 100 },
  { item: 'armor', label: 'Armor', price: 250 },
  { item: 'medkit', label: 'Medkit', price: 50 },
];

/** Fresh wallet: 200, or the saved purse when continuing. */
export function initEconomy(loaded) {
  const start = loaded && Number.isFinite(loaded.money) ? loaded.money : ECO.start;
  return { money: Math.max(0, Math.round(start)), fares: false, fareState: null, trips: 0, clock: 0 };
}

/** Credit or debit the wallet and say so on the HUD. */
export function addMoney(E, n, H) {
  const amt = Math.round(Number(n) || 0);
  if (!E || !amt) return E ? E.money : 0;
  E.money = Math.max(0, E.money + amt);
  if (H) toastMoney(H, (amt > 0 ? '+$' : '\u2212$') + Math.abs(amt));
  return E.money;
}

function toastMoney(H, txt) {
  if (H.toast) H.toast(txt);
  else if (H.setBanner) H.setBanner(txt, 1800);
}

/** Swap cash for goods; returns the row, or null when it did not happen. */
export function buyItem(E, P, item, G) {
  const row = SHOP.find((r) => r.item === item);
  if (!row || !E || !P) return null;
  if (E.money < row.price) return toastMoney(G.H, 'Not enough cash'), null;
  E.money -= row.price;
  if (item === 'rifle') Object.assign(P, { rifle: true, weapon: 'rifle', ammo: Math.max(P.ammo || 0, RIFLE.ammoPerBuy) });
  else if (item === 'ammo') P.ammo += RIFLE.ammoPerBuy;
  else if (item === 'armor') P.armor = ECO.armorCap;
  else P.hp = CONFIG.player.hp;
  if (G.sound) G.sound.chime();
  toastMoney(G.H, row.label + ' bought');
  return row;
}

// ------------------------------------------------------------------ fares

function mark(G, point) {
  G.setFareMarker(point ? point.x : null, point ? point.z : null);
}

/** Let a rider out of the cab (duty off, cab lost, fare paid). */
function drop(E) {
  const rider = E.passenger;
  if (!rider) return;
  Object.assign(rider, { state: 'walk', fare: false, taxi: null });
  if (rider.mesh) rider.mesh.visible = true;
  E.passenger = null;
}

/** Toggle taxi duty. Going on duty hails the cab's first rider. */
export function setFares(E, on, G) {
  if (!on) {
    Object.assign(E, { fares: false, fareState: null, trip: null });
    drop(E);
    return mark(G, null), false;
  }
  if (E.fares) return true;
  Object.assign(E, { fares: true, fareState: 'pickup' });
  G.spawnFare(G.inCar.x, G.inCar.z);
  toastMoney(G.H, 'Fare mode \u2014 pick up the rider');
  return true;
}

/** The closest rider waving within 4 m. */
function waiting(G, car) {
  let best = null, near = 4;
  for (const ped of G.peds) {
    if (ped.fare && ped.state === 'wait') {
      const d = Math.hypot(ped.pos.x - car.x, ped.pos.z - car.z);
      if (d < near) { near = d; best = ped; }
    }
  }
  return best;
}

/** A street point 100-300 m out; the real distance sets the payout. */
function dropoff(G, car) {
  const spin = G.rng.range(0, Math.PI * 2);
  const reach = G.rng.range(100, 300);
  const edge = Math.min(164, G.W.half - 36);
  const spot = G.W.roads.at(
    Math.max(-edge, Math.min(edge, car.x + Math.sin(spin) * reach)),
    Math.max(-edge, Math.min(edge, car.z + Math.cos(spin) * reach)),
  );
  return { x: spot.x, z: spot.z, ride: Math.hypot(spot.x - car.x, spot.z - car.z) };
}

/** 80 at 100 m, 150 at 300 m, to the nearest ten dollars. */
export function farePay(ride) {
  const t = Math.max(0, Math.min(1, (ride - 100) / 200));
  return Math.max(ECO.fareMin, Math.min(ECO.fareMax, Math.round((ECO.fareMin + (ECO.fareMax - ECO.fareMin) * t) / 10) * 10));
}

/** The meter: hail, board, drive, get paid, hail again. */
export function updateFares(E, G, dt) {
  void dt;
  if (!E.fares || G.freezeFares) return;
  const car = G.inCar;
  if (!car || car.wrecked || car.kind !== 'taxi') {
    drop(E);
    E.fareState = 'pickup';
    return mark(G, null);
  }
  const stopped = Math.abs(car.speed) < 1;
  if (E.fareState === 'pickup') {
    const rider = stopped && waiting(G, car);
    if (!rider) return mark(G, null);
    Object.assign(rider, { state: 'ride', taxi: car });
    rider.mesh.visible = false;
    Object.assign(E, { passenger: rider, trip: dropoff(G, car), fareState: 'ride' });
    G.sound.chime();
    return mark(G, E.trip);
  }
  mark(G, E.trip);
  const here = Math.hypot(car.x - E.trip.x, car.z - E.trip.z);
  if (here >= 6 || !stopped) return;
  const pay = farePay(E.trip.ride);
  addMoney(E, pay, G.H);
  drop(E);
  Object.assign(E, { trip: null, fareState: 'pickup', trips: E.trips + 1 });
  mark(G, null);
  toastMoney(G.H, 'Fare paid $' + pay);
}

// ------------------------------------------------------------------- save

export function loadGame() {
  try {
    const d = JSON.parse(localStorage.getItem(ECO.saveKey));
    return d && {
      money: Math.max(0, Math.round(d.money) || 0),
      missionIndex: Math.max(0, Math.min(3, d.missionIndex | 0)),
      rifle: !!d.rifle,
      ammo: Math.max(0, d.ammo | 0),
      armor: Math.max(0, Math.min(ECO.armorCap, d.armor | 0)),
      playtime: Number(d.playtime) || 0,
    };
  } catch (err) {
    return null;  // no slot, no storage (file://), or a broken file
  }
}

export function saveGame(G) {
  try {
    const M = G.M, P = G.P;
    localStorage.setItem(ECO.saveKey, JSON.stringify({
      money: Math.round(G.E.money) || 0,
      missionIndex: M.index | 0,
      rifle: !!P.rifle,
      ammo: P.ammo | 0,
      armor: Math.min(ECO.armorCap, P.armor | 0),
      playtime: Math.round(G.time || 0),
    }));
    return true;
  } catch (err) {
    return false;
  }
}

/** The ten-second autosave clock, called every fixed step. */
export function tickSave(E, G, dt) {
  E.clock += dt;
  if (E.clock < ECO.saveEvery) return false;
  E.clock = 0;
  return saveGame(G);
}
