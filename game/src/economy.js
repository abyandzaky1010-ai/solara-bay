// Solara Bay — money, the Vine Mart, the taxi meter, the save file.

import { CONFIG } from './config.js';

const ECO = CONFIG.economy;
const KEY = CONFIG.saveKey;
const ROAD = [-160, -80, 0, 80, 160]; // the avenues a fare can use
const LIMIT = CONFIG.world.half - 8;
const CATCH = 100; // m: nearest drop-off
const BAND = 300; // m: furthest ride
const STOP = 0.6; // m/s: stopped

const gap = (a, b) => Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.z ?? 0) - (b?.z ?? 0));
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const purse = (E) => Math.max(0, Math.round(E?.money ?? 0));
const where = (G) => (G?.inCar ? G.inCar : G?.P?.pos ?? { x: 0, z: 0 });

/** A HUD note that never throws out of a money call. */
function say(H, text) {
  try {
    H?.toast?.(text);
  } catch (err) {
    return null;
  }
  return true;
}

/** A save's cash wins; otherwise the spec's $200. */
export function initEconomy(saved) {
  const n = Number(saved?.money);
  return { money: Number.isFinite(n) && n >= 0 ? Math.round(n) : ECO.start, fares: false, fareState: null, saveT: 0 };
}

/** Add (or subtract) dollars and say so; returns the new total. */
export function addMoney(E, n, H) {
  if (!E) return 0;
  const d = Math.round(Number(n) || 0);
  E.money = Math.max(0, purse(E) + d);
  if (d) say(H, `${d > 0 ? '+' : '−'}$${Math.abs(d)}`);
  return purse(E);
}

/** A fee with no receipt: booking desk, hospital. */
export const chargeFee = (E, fee, H) => addMoney(E, -Math.abs(Math.round(Number(fee) || 0)), H);

/** The Vine Mart's four lines, at the spec's prices. */
export const SHOP = [
  { item: 'rifle', label: 'Rifle', price: ECO.rifle },
  { item: 'ammo', label: 'Ammo +60', price: ECO.ammo },
  { item: 'armor', label: 'Armor', price: ECO.armor },
  { item: 'medkit', label: 'Medkit', price: ECO.medkit },
];

/** Cash first, counter required, armor capped, one rifle only. */
export function buyItem(E, P, item, G) {
  const line = SHOP.find((s) => s.item === item);
  if (!E || !line) return false;
  const mart = G?.city?.markers?.vineMart;
  const no = (msg) => (say(G?.H, msg), false);
  if (mart && gap(where(G), mart) > ECO.shopRadius) return no('The Vine Mart is on the Meridian kerb.');
  if (P && item === 'rifle' && P.rifle) return no('You already carry the rifle.');
  if (P && item === 'armor' && P.armor >= ECO.armorCap) return no('Your armor is full.');
  if (purse(E) < line.price) return no(`Not enough cash ($${line.price}).`);
  E.money = purse(E) - line.price;
  if (item === 'rifle') Object.assign(P, { rifle: true, weapon: 'rifle' });
  else if (item === 'ammo') P.ammo = (P.ammo | 0) + CONFIG.weapons.rifle.ammoPerBuy;
  else if (item === 'armor') P.armor = Math.min(ECO.armorCap, P.armor + ECO.armorCap);
  else P.hp = CONFIG.player.hp;
  G?.sound?.chime?.();
  say(G?.H, `${line.label} bought — $${line.price}.`);
  return true;
}

/** The nearest avenue point: fares wait on kerbs, not in gardens. */
function kerb(x, z) {
  let bx = ROAD[0];
  let bz = ROAD[0];
  for (const line of ROAD) {
    if (Math.abs(x - line) < Math.abs(x - bx)) bx = line;
    if (Math.abs(z - line) < Math.abs(z - bz)) bz = line;
  }
  return Math.abs(x - bx) <= Math.abs(z - bz) ? { x: bx, z: clamp(z, -LIMIT, LIMIT) } : { x: clamp(x, -LIMIT, LIMIT), z: bz };
}

/** A passenger on the kerb, spawned via G. */
function hail(G) {
  const cab = G?.inCar;
  const side = (cab?.heading ?? 0) + Math.PI / 2;
  const at = kerb((cab?.x ?? 0) + Math.sin(side) * 7, (cab?.z ?? 0) + Math.cos(side) * 7);
  return { at, ped: (typeof G?.spawnFare === 'function' && G.spawnFare(at.x, at.z)) || null };
}

/** A drop-off 100-300 m out, near 200 best. */
function dropFor(cab) {
  let best = null;
  for (const rx of ROAD) {
    for (const rz of ROAD) {
      for (const a of [{ x: rx, z: rz }, { x: rx, z: cab.z }, { x: cab.x, z: rz }]) {
        const p = { x: clamp(a.x, -LIMIT, LIMIT), z: clamp(a.z, -LIMIT, LIMIT) };
        const d = gap(p, cab);
        if (d >= CATCH && d <= BAND && (!best || Math.abs(d - 200) < Math.abs(best.d - 200))) best = { ...p, d };
      }
    }
  }
  return best || { ...kerb(cab.x + 180, cab.z + 180), d: 200 };
}

/** Distance/2 rounded to 10, held in 80..150. */
const meter = (d) => clamp(Math.round(d / 2 / 10) * 10, ECO.fareMin, ECO.fareMax);

/** Meter on or off. */
export function setFares(E, on) {
  if (on) E.fares = true;
  else {
    const fare = E.fareState;
    Object.assign(E, { fares: false, fareState: null });
    if (fare?.ped) Object.assign(fare.ped, { fare: false, riding: false, state: 'walk' });
  }
  return Boolean(E?.fares);
}

/** The T key and leaving a car; only a taxi. */
export function toggleFareDuty(E, G) {
  if (!E) return false;
  const cab = G?.inCar;
  if (cab?.kind !== 'taxi') return setFares(E, false), say(G?.H, 'Only a taxi runs a meter.'), false;
  if (E.fares) return setFares(E, false), say(G.H, 'Meter off.'), false;
  setFares(E, true);
  E.fareState = { stage: 'wait', wait: 0, ...hail(G) };
  G.sound?.honk?.();
  say(G.H, 'Meter on. Fares pay $80 to $150 a ride.');
  return true;
}

/** One meter step: hail, board, ride, pay out, hail the next. */
export function updateFares(E, G, dt) {
  const cab = G?.inCar;
  if (!E?.fares || cab?.kind !== 'taxi') {
    if (E?.fares) setFares(E, false);
    return null;
  }
  const s = E.fareState || (E.fareState = { stage: 'wait', wait: 0, ...hail(G) });
  if (s.stage === 'wait') {
    s.wait += dt;
    // A passenger who wandered off or fell over is replaced.
    if (!s.ped || s.ped.state === 'down') Object.assign(s, hail(G));
    if (gap(cab, s.at) < ECO.fareNear && Math.abs(cab.speed) < STOP) {
      if (s.ped) Object.assign(s.ped, { riding: true, taxi: cab, state: 'wait' });
      if (s.ped) s.ped.mesh.visible = false;
      const drop = dropFor(cab);
      Object.assign(s, { stage: 'ride', drop: { x: drop.x, z: drop.z }, pay: meter(drop.d) });
      G.sound?.chime?.();
      say(G.H, 'Fare aboard. Drive on.');
    } else if (s.wait > 14 && gap(cab, s.at) > 18) Object.assign(s, hail(G));
    return s;
  }
  // The ride: the passenger sits invisibly in the back until the meter stops.
  if (s.ped) s.ped.pos.set(cab.x, 0, cab.z);
  if (gap(cab, s.drop) < ECO.shopRadius + 1 && Math.abs(cab.speed) < STOP + 1.4) {
    if (s.ped) Object.assign(s.ped, { riding: false, taxi: null, fare: false, state: 'walk' });
    if (s.ped) s.ped.mesh.visible = true;
    if (s.ped) s.ped.pos.set(cab.x + 2.2, 0, cab.z);
    addMoney(E, Math.max(ECO.fareMin, s.pay), G.H);
    G.sound?.chime?.();
    E.fareState = { stage: 'wait', wait: 0, ...hail(G) };
  }
  return s;
}

/** localStorage, guarded: a private window or full quota means no save. */
function store() {
  try {
    return window.localStorage;
  } catch (err) {
    return null;
  }
}

/** Cash, story progress, the gun, armour and the clock. */
function snapshot(G) {
  const P = G?.P;
  return {
    money: purse(G?.E),
    missionIndex: clamp(G?.M?.index | 0, 0, 3),
    rifle: Boolean(P?.rifle),
    ammo: Math.max(0, P?.ammo | 0),
    armor: clamp(Math.round(P?.armor ?? 0), 0, ECO.armorCap),
    playtime: Math.round(G?.time ?? 0),
  };
}

/** Write the snapshot under CONFIG.saveKey; null when it cannot. */
export function saveGame(G) {
  const box = store();
  if (!box || !G) return null;
  const data = snapshot(G);
  try {
    box.setItem(KEY, JSON.stringify(data));
  } catch (err) {
    return null;
  }
  if (G.E) G.E.saveT = 0;
  return data;
}

/** Read it back, or null when there is no save or it is unreadable. */
export function loadGame() {
  try {
    const d = JSON.parse(store()?.getItem(KEY));
    if (!d || typeof d !== 'object') return null;
    return {
      money: Math.max(0, Math.round(Number(d.money) || 0)),
      missionIndex: clamp(d.missionIndex | 0, 0, 3),
      rifle: Boolean(d.rifle),
      ammo: Math.max(0, d.ammo | 0),
      armor: clamp(Math.round(Number(d.armor) || 0), 0, ECO.armorCap),
      playtime: Math.max(0, Number(d.playtime) || 0),
    };
  } catch (err) {
    return null;
  }
}

/** Quiet autosave: called every frame, writes every 10 s. */
export function dueSave(E, G, dt) {
  if (!E) return false;
  if ((E.saveT = (E.saveT ?? 0) + (dt || 0)) < CONFIG.saveEvery) return false;
  E.saveT = 0;
  return Boolean(saveGame(G));
}
