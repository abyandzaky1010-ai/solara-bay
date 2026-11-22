// Solara Bay — wallet, Vine Mart counter, taxi meter, save file.

import { CONFIG } from './config.js';

const ECO = CONFIG.economy;
const HALF = CONFIG.world.half;
const WEST = Math.max(CONFIG.world.sea + 6, -HALF + 8);
const AVES = [-160, -80, 0, 80, 160];
const PICKUP = 4; // m
const DROP = 5; // m
const STOPPED = 1; // m/s

export const SHOP = [
  { item: 'rifle', label: 'Rifle', price: 600 },
  { item: 'ammo', label: 'Ammo +60', price: 100 },
  { item: 'armor', label: 'Armor', price: 250 },
  { item: 'medkit', label: 'Medkit', price: 50 },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const bank = (n) => `$${Math.max(0, Math.round(n)).toLocaleString('en-US')}`;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const cabReady = (G) => !!G?.inCar && G.inCar.kind === 'taxi' && !G.inCar.wrecked;

/** Fresh wallet at the stake, or the balance the save remembers. */
export const initEconomy = (loaded) => ({
  money: loaded && Number.isFinite(loaded.money) ? Math.max(0, Math.round(loaded.money)) : ECO.start,
  fares: false,
  fareState: null,
});

// Every credit; from $25 up a toast explains it and the counter rolls.
export function addMoney(E, n, H) {
  if (!E) return 0;
  const amount = Math.round(n || 0);
  if (amount < 0) return takeMoney(E, -amount, H);
  E.money += amount;
  if (amount >= 25 && H) {
    E.shown = Math.min(Number.isFinite(E.shown) ? E.shown : E.money - amount, E.money - amount);
    toast(H, `+${bank(amount)}`);
  }
  return E.money;
}

// Fines and hospital bills, clipped to the wallet.
export function takeMoney(E, n, H) {
  if (!E) return 0;
  const paid = Math.min(E.money, Math.max(0, Math.round(n || 0)));
  E.money -= paid;
  E.shown = E.money;
  if (paid && H) toast(H, `-${bank(paid)}`);
  return paid;
}

export const chargeFee = (E, fee, H) => takeMoney(E, fee, H);

// Roll the shown balance toward the true one.
export function rollMoney(E, dt) {
  if (!E) return 0;
  if (!Number.isFinite(E.shown)) E.shown = E.money;
  const gap = E.money - E.shown;
  if (Math.abs(gap) < 1.5) return (E.shown = E.money);
  E.shown += Math.sign(gap) * Math.min(Math.abs(gap), Math.max(24, Math.abs(gap) * Math.min(1, dt * 5)));
  return Math.round(E.shown);
}

export const formatMoney = (E) => bank(Number.isFinite(E?.shown) ? E.shown : E?.money ?? 0);

// One line off the counter: cash out, effect, receipt.
export function buyItem(E, P, item, G) {
  const row = SHOP.find((entry) => entry.item === item);
  if (!row || !E || !P) return false;
  if (E.money < row.price) {
    if (G?.H) toast(G.H, 'Not enough cash.');
    return false;
  }
  E.money -= row.price;
  E.shown = Math.min(Number.isFinite(E.shown) ? E.shown : E.money, E.money);
  if (item === 'rifle') P.rifle = true;
  else if (item === 'ammo') P.ammo = (P.ammo | 0) + CONFIG.weapons.rifle.ammoPerBuy;
  else if (item === 'armor') P.armor = 100;
  else if (item === 'medkit') P.hp = CONFIG.player.hp;
  G?.sound?.chime?.();
  if (G?.H) toast(G.H, `${row.label} — bought`);
  saveGame(G);
  return true;
}

// A point on an avenue: the real junction when the world is up, else the nearest lane.
function roadPoint(G, x, z) {
  const node = G?.W?.roads?.at?.(x, z);
  if (node) return { x: node.x, z: node.z };
  const near = (v) => AVES.reduce((b, s) => (Math.abs(v - s) < Math.abs(v - b) ? s : b), AVES[0]);
  const span = HALF - CONFIG.world.roadHalf;
  return Math.abs(x - near(x)) <= Math.abs(z - near(z)) ? { x: near(x), z: clamp(z, -span, span) } : { x: clamp(x, -span, span), z: near(z) };
}

const geometry = (G) => (G?.inCar
  ? { x: G.inCar.x, z: G.inCar.z, speed: Math.abs(G.inCar.speed || 0) }
  : { x: G?.P?.pos?.x ?? 0, z: G?.P?.pos?.z ?? 0, speed: 0 });

// Stand a waving fare on a kerb a short hop from (from).
function callFare(E, G, from) {
  const spots = [];
  for (let i = 0; i < 8; i += 1) {
    const a = i * 0.79 + 0.7;
    const r = 40 + (i % 4) * 18;
    spots.push(roadPoint(G, from.x + Math.cos(a) * r, from.z + Math.sin(a) * r));
  }
  const spot = spots.find((p) => dist(p, from) > 25 && dist(p, from) < 110) || roadPoint(G, from.x + 30, from.z);
  E.fareState = { stage: 'await', ped: G?.spawnFare?.(spot.x, spot.z) || null, dest: null, dist: 0, waited: 0 };
  if (G?.H) toast(G.H, 'A fare is waving up the block. Yellow cab only.');
  G?.sound?.chime?.();
  return E.fareState;
}

// A kerb 100-300 m out, never the one the passenger is standing on.
function w(G, from) {
  for (let i = 0; i < 12; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = 100 + Math.random() * 200;
    const p = roadPoint(G, from.x + Math.cos(a) * r, from.z + Math.sin(a) * r);
    const d = dist(p, from);
    if (d >= 100 && d <= 300 && p.x > WEST && Math.abs(p.x) < HALF - 4 && Math.abs(p.z) < HALF - 4) return { ...p, dist: d };
  }
  const p = roadPoint(G, from.x + 140, from.z + 140);
  return { ...p, dist: dist(p, from) };
}

// Start band plus distance, stepped to ten, kept inside 80..150.
function farePay(distance) {
  const raw = ECO.fareMin + (ECO.fareMax - ECO.fareMin) * clamp(distance / 200, 0, 1);
  return clamp(Math.round(raw / 10) * 10, ECO.fareMin, ECO.fareMax);
}

function q(ped, car) {
  if (!ped) return;
  if (car) ped.pos.set(car.x + 1.6, 0, car.z + 1.2);
  Object.assign(ped, { fare: false, state: 'walk', riding: false, taxi: null, fleeT: 0, speed: CONFIG.peds.speed });
  if (ped.mesh) {
    ped.mesh.visible = true;
    ped.mesh.rotation.set(0, ped.yaw || 0, 0);
    ped.mesh.position.copy(ped.pos);
  }
  if (ped.shadow) ped.shadow.visible = true;
}

// Taxi duty on or off; a cab is required, the first call-out plants a fare.
export function setFares(E, on, G) {
  if (!E) return false;
  const want = !!on;
  if (want && !cabReady(G)) {
    E.fares = false;
    if (G?.H) toast(G.H, 'Taxi duty needs a yellow cab.');
  } else if (E.fares !== want) {
    E.fares = want;
    if (!want) {
      if (G?.H) toast(G.H, 'Taxi off duty.');
    } else if (!E.fareState) callFare(E, G, geometry(G));
    else if (G?.H) toast(G.H, 'Taxi on duty. Lights go round.');
  }
  return E.fares;
}

export function toggleFareDuty(E, G) {
  if (cabReady(G)) return setFares(E, !E.fares, G);
  if (G?.H) toast(G.H, 'You need a taxi to run fares.');
  return false;
}

// One tick of the meter: wait, ride, pay, next fare.
export function updateFares(E, G, dt) {
  const F = E?.fareState;
  if (!E?.fares || !F) return null;
  const me = geometry(G);
  const cab = cabReady(G) ? G.inCar : null;
  switch (F.stage) {
    case 'await': {
      const ped = F.ped;
      if (!ped || ped.state === 'down' || !ped.pos) {
        F.ped = G?.spawnFare?.(me.x + 20, me.z + 20) || null;
        return F;
      }
      const reach = dist(me, ped.pos);
      if (cab && reach <= PICKUP && me.speed <= STOPPED) {
        Object.assign(ped, { fare: true, state: 'ride', riding: true, taxi: cab, speed: 0 });
        if (ped.mesh) ped.mesh.visible = false;
        if (ped.shadow) ped.shadow.visible = false;
        F.dest = w(G, ped.pos);
        F.fare = F.paid = farePay(F.dest.dist);
        Object.assign(F, { stage: 'ride', dist: F.dest.dist, waited: 0 });
        if (G?.H) toast(G.H, `Passenger aboard. ${Math.round(F.dist)} m to the drop.`);
        G?.sound?.chime?.();
      } else if (cab && reach <= PICKUP * 2.5 && (F.waited += dt) > 6) {
        F.waited = 0;
        if (G?.H) toast(G.H, 'Roll up and stop to pick them up.');
      }
      return F;
    }
    case 'ride': {
      if (!cab) {
        Object.assign(F, { stage: 'abandoned', waited: 0 });
        return F;
      }
      if (F.ped?.taxi) F.ped.pos.set(cab.x, 0, cab.z);
      F.left = dist(me, F.dest);
      if (F.left > DROP || me.speed > STOPPED) return F;
      addMoney(E, F.paid, G?.H);
      q(F.ped, cab);
      if (G?.H) toast(G.H, `Fare paid: ${bank(F.paid)}`);
      G?.sound?.jingle?.(true);
      G?.milestone?.('fare');
      E.fareState = null;
      if (E.fares) callFare(E, G, me);
      return null;
    }
    default: {
      // Abandoned midway: the passenger waits until the cab is back on duty.
      if (cab || (F.waited += dt) > 4) {
        q(F.ped, cab);
        Object.assign(F, { stage: 'await', dest: null, waited: 0 });
        if (cab && G?.H) toast(G.H, 'Fare back on the kerb.');
      }
      return F;
    }
  }
}

// What the minimap draws for the meter, or null.
export function fareMarker(E, G) {
  const F = E?.fareState;
  if (!F || !E.fares) return null;
  const me = geometry(G);
  if (F.stage === 'await' && F.ped?.pos) return { kind: 'fare', x: F.ped.pos.x, z: F.ped.pos.z, dist: dist(me, F.ped.pos) };
  if (F.dest) return { kind: 'destination', x: F.dest.x, z: F.dest.z, dist: dist(me, F.dest), pay: F.paid };
  return null;
}

// ------------------------------------------------------------------ save

// localStorage when the browser allows it (sandboxed file:// throws), else null.
function store() {
  try {
    const ls = window.localStorage;
    if (!ls) return null;
    ls.setItem('__sb_probe__', '1');
    ls.removeItem('__sb_probe__');
    return ls;
  } catch (err) {
    return null;
  }
}

const read = (ls) => {
  try {
    const d = JSON.parse(ls.getItem(ECO.saveKey) || 'null');
    return d && typeof d === 'object' ? d : null;
  } catch (err) {
    return null;
  }
};

export function saveGame(G) {
  const ls = store();
  if (!ls || !G) return false;
  const P = G.P || {};
  const data = {
    money: Math.max(0, Math.round(G.E?.money || 0)),
    missionIndex: clamp(((G.M?.index | 0) || 0) + (G.M?.active ? 1 : 0), 0, 3),
    rifle: !!P.rifle,
    ammo: Math.max(0, P.ammo | 0),
    armor: Math.max(0, P.armor | 0),
    playtime: Math.max(0, Math.round(G.playtime || G.time || 0)),
  };
  try {
    ls.setItem(ECO.saveKey, JSON.stringify(data));
    return true;
  } catch (err) {
    return false;
  }
}

export function loadGame() {
  const ls = store();
  const d = ls && read(ls);
  if (!d) return null;
  return {
    money: Math.max(0, Number(d.money) || 0),
    missionIndex: clamp(Number(d.missionIndex) | 0, 0, 3),
    rifle: !!d.rifle,
    ammo: Math.max(0, Number(d.ammo) | 0),
    armor: clamp(Number(d.armor) | 0, 0, 100),
    playtime: Math.max(0, Number(d.playtime) | 0),
    savedAt: Number(d.savedAt) || 0,
  };
}

export function clearSave() {
  const ls = store();
  if (!ls) return false;
  try {
    ls.removeItem(ECO.saveKey);
    return true;
  } catch (err) {
    return false;
  }
}

// Autosave beat: once every ten seconds of play.
export function dueSave(E, G, dt) {
  if (!E || !G) return false;
  if ((E.saveT = (E.saveT || 0) + dt) < 10) return false;
  E.saveT = 0;
  return saveGame(G);
}

// Pause-panel line about the file on disk.
export function saveSummary() {
  const d = loadGame();
  const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  return d ? `Saved: ${bank(d.money)} · job ${Math.min(d.missionIndex + 1, 3)} of 3 · ${mmss(d.playtime)} played` : 'No save yet. The bay forgets fast.';
}

// Local toast, so the counter works even before the HUD is wired.
function toast(H, txt) {
  if (!H) return;
  if (typeof H.toast === 'function') return void H.toast(txt);
  const box = H.toasts;
  if (!box) return;
  const row = document.createElement('div');
  row.className = 'toast';
  row.textContent = txt;
  box.appendChild(row);
  while (box.children.length > 3) box.removeChild(box.firstChild);
  setTimeout(() => row.remove(), 2500);
}
