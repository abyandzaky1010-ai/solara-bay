// One job: the wallet. Starting cash, the Vine Mart counter, taxi fares, and the
// little save file that survives a reload. No Three.js here: fares use the ped and
// marker services that main puts on G.
import { CONFIG } from './config.js';

const ECON = CONFIG.economy;

/** What Vine Mart sells, in the order the shop panel lists it. */
export const SHOP = [
  { item: 'rifle', label: 'Rifle', price: 600 },
  { item: 'ammo', label: 'Ammo +60', price: 100 },
  { item: 'armor', label: 'Armor', price: 250 },
  { item: 'medkit', label: 'Medkit', price: 50 },
];

const AUTO_SAVE_EVERY = 10;   // seconds between quiet saves
const PICKUP_RANGE = 4;       // the cab must be this close to the kerb
const STOP_SPEED = 1;         // ...and rolling slower than this
const DROP_RANGE = 5;         // stop inside this circle and the ride ends
const FARE_NEAR = 100;        // shortest trip dispatched, metres
const FARE_FAR = 300;         // longest
const FARE_FLOOR = 80;
const FARE_CEIL = 150;
const KERB = 1.6;             // waiting fares stand this far off the asphalt

// ---------- money ----------

/** Fresh wallet, seeded from a save when there is one. */
export function initEconomy(loaded) {
  const saved = loaded && Number.isFinite(loaded.money) ? loaded.money : ECON.start;
  return {
    money: Math.max(0, Math.round(saved)),
    fares: false,
    fareState: null,
    marker: null,
    saveT: 0,
  };
}

/** Credit or debit the wallet and say so on screen. */
export function addMoney(E, n, H) {
  if (!E) return 0;
  const amount = Math.round(Number(n) || 0);
  E.money = Math.max(0, Math.round(E.money + amount));
  if (H && H.toast) H.toast((amount >= 0 ? '+' : '\u2212') + '$' + Math.abs(amount));
  return E.money;
}

function priceOf(item) {
  for (let i = 0; i < SHOP.length; i++) if (SHOP[i].item === item) return SHOP[i].price;
  return null;
}

/**
 * Buy one item: deduct, then apply it to the player. A refusal (short of cash,
 * rifle already carried) changes nothing and returns false.
 */
export function buyItem(E, P, item, G) {
  if (!E || !P) return false;
  const price = priceOf(item);
  if (price == null) return false;
  const H = G && G.H;

  if (E.money < price) {
    if (H && H.toast) H.toast('Not enough cash for ' + item);
    return false;
  }
  if (item === 'rifle' && P.rifle) {
    if (H && H.toast) H.toast('You already carry the rifle');
    return false;
  }

  E.money -= price;
  if (item === 'rifle') {
    P.rifle = true;
    if (!P.ammo) P.ammo = CONFIG.weapons.rifle.ammoPerBuy;   // first clip on the house
  } else if (item === 'ammo') P.ammo = (P.ammo || 0) + CONFIG.weapons.rifle.ammoPerBuy;
  else if (item === 'armor') P.armor = 100;
  else if (item === 'medkit') P.hp = CONFIG.player.hp;

  if (H && H.toast) H.toast('Bought ' + item + ' for $' + price);
  if (G && G.sound && G.sound.chime) G.sound.chime();
  if (G && G.saveNow) G.saveNow();
  return true;
}

// ---------- taxi fares ----------

/** A road corner 100-300 m away, for the drop-off. */
function pickDestination(W, x, z) {
  const nodes = W && W.roads && W.roads.nodes;
  if (!nodes) return null;
  const pool = [];
  for (let i = 0; i < nodes.length; i++) {
    const d = Math.hypot(nodes[i].x - x, nodes[i].z - z);
    if (d >= FARE_NEAR && d <= FARE_FAR) pool.push(nodes[i]);
  }
  if (pool.length) {
    const n = pool[Math.floor(Math.random() * pool.length) % pool.length];
    return { x: n.x, z: n.z };
  }
  // Corner of the map: head for the farthest one instead.
  let best = nodes[0];
  let bestD = -1;
  for (let i = 0; i < nodes.length; i++) {
    const d = Math.hypot(nodes[i].x - x, nodes[i].z - z);
    if (d > bestD) { bestD = d; best = nodes[i]; }
  }
  return { x: best.x, z: best.z };
}

/** A pavement corner 25-90 m from the cab, where a new fare waits. */
function pickFareSpot(W, x, z) {
  const nodes = W && W.roads && W.roads.nodes;
  if (!nodes) return { x: x + 14, z: z };
  let best = null;
  let bestD = -1;
  for (let i = 0; i < nodes.length; i++) {
    const d = Math.hypot(nodes[i].x - x, nodes[i].z - z);
    if (d > bestD && d > 24 && d <= 90) { bestD = d; best = nodes[i]; }
  }
  const n = best || nodes[0];
  const side = Math.random() < 0.5 ? 1 : -1;
  return { x: n.x + side * (CONFIG.world.roadHalf + KERB), z: n.z + (Math.random() < 0.5 ? KERB : -KERB) };
}

/** Ask the street for one more waving pedestrian. */
function spawnWaitingFare(E, G) {
  if (!G) return null;
  const taxi = G.inCar;
  const at = taxi ? { x: taxi.x, z: taxi.z } : G.P && G.P.pos ? G.P.pos : { x: 0, z: 0 };
  const spot = pickFareSpot(G.W, at.x, at.z);
  let ped = null;
  if (G.spawnFare) {
    try { ped = G.spawnFare(spot.x, spot.z); } catch (err) { ped = null; }
  }
  if (ped) {
    ped.fare = true;
    if (ped.state !== 'down') ped.state = 'wait';
  }
  return ped;
}

/** Drop the beacon on a fare stop, if the game has markers wired. */
function placeFareMarker(E, G, x, z) {
  E.marker = x == null ? null : { x, z };
  if (G && G.setFareMarker) G.setFareMarker(x, z);
}

/**
 * Taxi duty on or off. Switching on puts a fare on the nearest pavement corner, so
 * the job can start without touring the whole city.
 */
export function setFares(E, on, G) {
  if (!E) return false;
  if (on && !E.fares) {
    E.fares = true;
    E.fareState = { phase: 'cruise', ped: null, dest: null, timer: 0, payout: 0 };
    const ped = spawnWaitingFare(E, G);
    if (ped) {
      E.fareState.phase = 'pickup';
      E.fareState.ped = ped;
      placeFareMarker(E, G, ped.pos.x, ped.pos.z);
      if (G && G.H && G.H.toast) G.H.toast('Fare waving on the next corner');
    }
  } else if (!on && E.fares) {
    E.fares = false;
    dropPassenger(E, G);
    E.fareState = null;
    placeFareMarker(E, G, null, null);
    if (G && G.H && G.H.toast) G.H.toast('Taxi duty off');
  }
  return E.fares;
}

/** Let the current fare go: back on the pavement, beacon cleared. */
function dropPassenger(E, G) {
  const fs = E && E.fareState;
  if (!fs) return;
  if (fs.ped) {
    fs.ped.taxi = null;
    if (fs.ped.state === 'ride') fs.ped.state = 'walk';
    fs.ped.fare = false;
  }
  fs.ped = null;
  fs.dest = null;
  placeFareMarker(E, G, null, null);
}

/** Nearest waving pedestrian that is not already riding with us. */
function nearestWaitingFare(G, x, z) {
  const peds = (G && G.peds) || [];
  const riding = G && G.E && G.E.fareState ? G.E.fareState.ped : null;
  let best = null;
  let bestD = PICKUP_RANGE;
  for (let i = 0; i < peds.length; i++) {
    const ped = peds[i];
    if (!ped || ped === riding || !ped.fare || ped.state !== 'wait' || !ped.pos) continue;
    const d = Math.hypot(ped.pos.x - x, ped.pos.z - z);
    if (d < bestD) { bestD = d; best = ped; }
  }
  return best;
}

/** Money for a trip, banded by distance and rounded to $10. */
function payoutFor(dist) {
  const t = Math.max(0, Math.min(1, (dist - FARE_NEAR) / (FARE_FAR - FARE_NEAR)));
  const raw = ECON.fareMin + (ECON.fareMax - ECON.fareMin) * t;
  return Math.max(FARE_FLOOR, Math.min(FARE_CEIL, Math.round(raw / 10) * 10));
}

/**
 * One step of taxi duty: take a waving fare, drive to the beacon, stop on it, get
 * paid, then a fresh call comes in. Suspended silently whenever the cab is lost.
 */
export function updateFares(E, G, dt) {
  if (!E || !E.fares || !G || G.freezeFares) return;
  const fs = E.fareState || (E.fareState = { phase: 'cruise', ped: null, dest: null, timer: 0, payout: 0 });
  const taxi = G.inCar;
  if (!taxi || taxi.kind !== 'taxi') return;

  const speed = Math.abs(taxi.speed || 0);
  const tx = taxi.x;
  const tz = taxi.z;

  if (fs.phase === 'ride') {
    fs.timer += dt;
    const ped = fs.ped;
    if (!ped || ped.state !== 'ride' || ped.taxi !== taxi || !fs.dest) {
      dropPassenger(E, G);
      fs.phase = 'cruise';
      return;
    }
    // The passenger is inside: their marker follows the cab until they are dropped.
    placeFareMarker(E, G, fs.dest.x, fs.dest.z);
    const d = Math.hypot(fs.dest.x - tx, fs.dest.z - tz);
    if (d < DROP_RANGE && speed < STOP_SPEED) {
      const fare = Math.max(FARE_FLOOR, Math.min(FARE_CEIL, fs.payout || payoutFor(d)));
      addMoney(E, fare, G.H);
      if (G.sound && G.sound.jingle) G.sound.jingle(true);
      ped.state = 'walk';
      ped.fare = false;
      ped.taxi = null;
      if (ped.parts && ped.parts.root) ped.parts.root.visible = true;
      E.fareState = { phase: 'cruise', ped: null, dest: null, timer: 0, payout: 0 };
      if (G.saveNow) G.saveNow();
      const next = spawnWaitingFare(E, G);
      if (next) {
        E.fareState.ped = next;
        E.fareState.phase = 'pickup';
        placeFareMarker(E, G, next.pos.x, next.pos.z);
      }
    }
    return;
  }

  // Looking for someone to pick up.
  let ped = fs.ped;
  if (ped && (ped.state === 'down' || (!ped.fare && ped.state !== 'ride'))) ped = null;
  if (!ped) ped = nearestWaitingFare(G, tx, tz);
  if (!ped) {
    fs.phase = 'cruise';
    fs.ped = null;
    // Nobody waving nearby: the street sends one every few seconds.
    if ((fs.timer += dt) > 6) {
      fs.timer = 0;
      const fresh = spawnWaitingFare(E, G);
      if (fresh) { fs.ped = fresh; fs.phase = 'pickup'; }
    }
    return;
  }
  fs.ped = ped;
  fs.phase = 'pickup';
  placeFareMarker(E, G, ped.pos.x, ped.pos.z);
  if (Math.hypot(ped.pos.x - tx, ped.pos.z - tz) < PICKUP_RANGE && speed < STOP_SPEED) {
    const dest = pickDestination(G.W, tx, tz);
    if (!dest) return;
    ped.state = 'ride';
    ped.taxi = taxi;
    fs.dest = dest;
    fs.phase = 'ride';
    fs.timer = 0;
    fs.payout = payoutFor(Math.hypot(dest.x - tx, dest.z - tz));
    placeFareMarker(E, G, dest.x, dest.z);
    if (G.sound && G.sound.chime) G.sound.chime();
    if (G.H && G.H.toast) G.H.toast('Fare aboard: $' + fs.payout + ' to the gold marker');
  }
}

/** Distance from the cab to whatever the current fare wants, in metres. */
export function fareDistance(E, G) {
  const fs = E && E.fareState;
  if (!fs || !G) return 0;
  const taxi = G.inCar;
  const here = taxi ? taxi : G.P && G.P.pos;
  const goal = fs.phase === 'ride' ? fs.dest : fs.ped && fs.ped.pos;
  if (!here || !goal) return 0;
  return Math.hypot(goal.x - here.x, goal.z - here.z);
}

// ---------- save / load ----------

/** localStorage throws on sandboxed file:// pages; that simply means "no save". */
function storage() {
  try {
    return window.localStorage || null;
  } catch (err) {
    return null;
  }
}

/** Snapshot of everything worth keeping across a reload. */
export function saveGame(G) {
  const store = G && storage();
  if (!store) return false;
  const P = G.P || {};
  const data = {
    money: G.E ? Math.max(0, Math.round(G.E.money || 0)) : ECON.start,
    missionIndex: G.M ? G.M.index | 0 : 0,
    rifle: !!P.rifle,
    ammo: Math.max(0, P.ammo | 0),
    armor: Math.max(0, P.armor | 0),
    playtime: Math.round(G.time || 0),
  };
  try {
    store.setItem(ECON.saveKey, JSON.stringify(data));
  } catch (err) {
    return false;
  }
  if (G.E) G.E.saveT = 0;
  return true;
}

/** The stored snapshot, or null when there is none or it is unreadable. */
export function loadGame() {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(ECON.saveKey);
    const data = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== 'object') return null;
    return {
      money: Number.isFinite(data.money) ? data.money : ECON.start,
      missionIndex: Number.isFinite(data.missionIndex) ? data.missionIndex : 0,
      rifle: !!data.rifle,
      ammo: Number.isFinite(data.ammo) ? data.ammo : 0,
      armor: Number.isFinite(data.armor) ? data.armor : 0,
      playtime: Number.isFinite(data.playtime) ? data.playtime : 0,
    };
  } catch (err) {
    return null;
  }
}

/** Quiet automatic save, driven by the frame clock. */
export function tickSave(E, G, dt) {
  if (!E || !G) return;
  E.saveT = (E.saveT || 0) + dt;
  if (E.saveT >= AUTO_SAVE_EVERY) saveGame(G);
}
