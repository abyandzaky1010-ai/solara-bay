// Solara Bay — HUD readouts, the 180 px minimap, notes, and the cards.

const ROAD = [-160, -80, 0, 80, 160]; // avenue lines, both axes
const WORLD = 440; // m the minimap covers
const SIZE = 180; // px of canvas
const S = SIZE / WORLD; // px per metre
const HALF = 200;
const SEA = -172; // ocean west of this line
const CURB = 9; // asphalt plus both sidewalks
const GOLD = '#ffd24a';
const NOTE_MS = 2500;

const el = (id) => (typeof document === 'undefined' ? null : document.getElementById(id));
const px = (v) => Math.round((v + WORLD / 2) * S);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const cash = (n) => `$${Math.round(Math.max(0, n || 0)).toLocaleString('en-US')}`;

/** createHUD() → H: every element grabbed once. */
export function createHUD() {
  const bar = (id) => el(id)?.querySelector('i') ?? null;
  const H = {
    root: el('hud'), stars: el('stars'), cash: el('money'), weapon: el('weapon'), hp: bar('healthbar'), armour: bar('armorbar'),
    speed: el('speed'), line: el('objective'), clock: el('timer'), notes: el('toasts'), crosshair: el('crosshair'), mini: el('minimap'),
    panels: {}, seen: {}, marks: [], banner: null, open: null, now: 0, purse: -1, starsSeen: -1,
  };
  H.ctx = H.mini?.getContext('2d') ?? null;
  for (const id of ['title', 'pause', 'shop', 'complete', 'busted', 'wasted']) H.panels[id] = el(id);
  return H;
}

/** Write text only when the node does not already say it. */
function put(H, node, text) {
  const key = node.id || node;
  if (!node || H.seen[key] === text) return;
  H.seen[key] = text;
  node.textContent = text;
}

/** updateHUD(H, G, dt): every readout, once a frame. */
export function updateHUD(H, G, dt) {
  if (!H || !G) return;
  const step = Math.min(0.25, dt || 0);
  const P = G.P;
  H.root.classList.toggle('on', G.screen !== 'title');
  H.crosshair.classList.toggle('on', G.screen === 'play' && !G.inCar);

  const want = Math.max(0, Math.round(G.E?.money ?? 0));
  H.purse = H.purse < 0 || Math.abs(want - H.purse) < 1 ? want : H.purse + (want - H.purse) * Math.min(1, step * 9);
  put(H, H.cash, cash(H.purse));
  const n = clamp(G.PO?.stars ?? 0, 0, 5);
  if (H.starsSeen !== n) {
    if (H.starsSeen >= 0 && n > H.starsSeen) {
      H.stars.classList.remove('pulse');
      void H.stars.offsetWidth; // restart the CSS animation
      H.stars.classList.add('pulse');
    }
    H.starsSeen = n;
    H.stars.innerHTML = [0, 1, 2, 3, 4].map((i) => (i < n ? '<b>\u2605</b>' : '\u2606')).join('');
  }

  if (P) {
    const bar = (n) => `${clamp(Math.round(n), 0, 100)}%`;
    H.hp.style.width = bar(P.hp);
    H.armour.style.width = bar(P.armor);
    put(H, H.weapon, P.weapon === 'rifle' && P.rifle ? `RIFLE  ${Math.max(0, P.ammo | 0)} rounds` : 'PISTOL  \u221e');
  }

  const o = G.objective;
  put(H, H.line, o ? `${o.title} — ${o.text}${o.dist > 6 ? `  ·  ${Math.round(o.dist)} m` : ''}`
    : G.M?.failed ? 'Job lost. R to try again.' : 'Vesper waits at the Glass Orchid.');
  put(H, H.clock, o?.timer > 0 ? `${Math.ceil(o.timer)}s` : '');
  put(H, H.speed, G.inCar ? `${Math.round(Math.abs(G.inCar.speed) * 3.6)} km/h${G.inCar.kind === 'taxi' && G.E?.fares ? ' · meter' : ''}` : '');

  H.now += step * 1000;
  for (let i = H.marks.length - 1; i >= 0; i -= 1) {
    const left = NOTE_MS - (H.now - H.marks[i].born);
    if (left <= 0) H.marks.splice(i, 1)[0].node.remove();
    else if (left < 600) H.marks[i].node.style.opacity = String(left / 600);
  }
  if (H.banner && H.now - H.banner.born > H.banner.ms) H.banner = null;
}

/** A .toast div, optionally styled. */
function noteBox(css) {
  const node = Object.assign(document.createElement('div'), { className: 'toast' });
  if (css) node.style.cssText = css;
  return node;
}

/** toast(H, txt): newest at the bottom, three at most. */
export function toast(H, txt) {
  if (!H?.notes || !txt) return null;
  const node = noteBox();
  node.textContent = String(txt);
  H.notes.appendChild(node);
  H.marks.push({ node, born: H.now });
  while (H.marks.length > 3) H.marks.shift().node.remove();
  return node;
}

/** setBanner(H, txt, ms): one line near the middle of the screen. */
export function setBanner(H, txt, ms = 1800) {
  if (!H?.root) return null;
  if (!H.banner) {
    H.banner = { node: noteBox('position:absolute;left:50%;top:56%;transform:translateX(-50%);font-size:19px') };
    H.root.appendChild(H.banner.node);
  }
  Object.assign(H.banner, { born: H.now, ms: Math.max(300, ms || 1800) });
  H.banner.node.textContent = String(txt ?? '');
  return H.banner.node;
}

// ------------------------------------------------------------------ minimap

function dot(c, at, ink, r, ring) {
  const x = clamp(px(at.x), 3, SIZE - 3);
  const y = clamp(px(at.z), 3, SIZE - 3);
  c.fillStyle = ink;
  c.beginPath();
  c.arc(x, y, r, 0, 6.2832);
  c.fill();
  if (!ring) return;
  c.strokeStyle = ring;
  c.strokeRect(x - r - 1.5, y - r - 1.5, r * 2 + 3, r * 2 + 3);
}

/** A square turned 45°: the gold marker, an arrow when off-map. */
function diamond(c, at, ink) {
  const tx = px(at.x);
  const ty = px(at.z);
  const x = clamp(tx, 7, SIZE - 7);
  const y = clamp(ty, 7, SIZE - 7);
  c.save();
  c.translate(x, y);
  c.rotate(x === tx && y === ty ? 0 : Math.atan2(ty - y, tx - x) + Math.PI / 4);
  c.fillStyle = ink || GOLD;
  c.strokeStyle = 'rgba(60,40,0,.8)';
  c.fillRect(-4, -4, 8, 8);
  c.strokeRect(-4, -4, 8, 8);
  c.restore();
}

/** A capital on a coin: the shop's S, the giver's !. */
function stamp(c, at, letter, ink) {
  c.fillStyle = ink;
  c.beginPath();
  c.arc(px(at.x), px(at.z), 5.4, 0, 6.2832);
  c.fill();
  c.fillStyle = '#0e1a26';
  c.font = 'bold 8px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(letter, px(at.x), px(at.z) + 0.5);
}

/** drawMinimap(H, G): water, grid, blocks, park, blips, markers, the player. */
export function drawMinimap(H, G) {
  const ctx = H?.ctx;
  if (!ctx || !G) return;
  const city = G.city || {};
  const wide = Math.round(12 * S) || 2;
  const band = (x, z, w, h, ink) => (ctx.fillStyle = ink, ctx.fillRect(px(x), px(z), w, h));

  band(-WORLD / 2, -WORLD / 2, (SEA + WORLD / 2) * S, SIZE, '#9fc7d6');
  band(SEA, -WORLD / 2, (HALF - SEA) * S, SIZE, '#e9e2ce');
  band(-HALF, -WORLD / 2, HALF * 2 * S, SIZE, '#dfe9f2');

  for (const [i, a] of ROAD.entries()) {
    for (const [j, b] of ROAD.entries()) {
      const w = ((ROAD[i + 1] ?? HALF) - CURB - a - CURB) * S;
      const h = ((ROAD[j + 1] ?? HALF) - CURB - b - CURB) * S;
      if (w > 0 && h > 0) ctx.fillRect(px(a + CURB), px(b + CURB), w, h);
    }
  }
  ctx.fillStyle = '#4a5058';
  for (const line of ROAD) {
    ctx.fillRect(0, px(line) - wide / 2, SIZE, wide);
    ctx.fillRect(px(line) - wide / 2, 0, wide, SIZE);
  }

  const park = city.park?.bounds;
  if (park) band(park.minX, park.minZ, (park.maxX - park.minX) * S, (park.maxZ - park.minZ) * S, '#74b463');
  for (const b of city.buildings) band(b.x - b.w / 2, b.z - b.d / 2, Math.max(1, b.w * S), Math.max(1, b.d * S), '#485666');

  for (const c of G.traffic || []) if (!c.wrecked) dot(ctx, c, '#fff', 1.3);
  for (const c of G.cars || []) if (!c.wrecked) dot(ctx, c, '#8fb8f0', 1.5);
  ctx.fillStyle = '#8d99a5';
  for (const q of G.peds) if (!q.riding && q.state !== 'down') dot(ctx, q.pos, '#8d99a5', 0.7);
  for (const c of G.PO?.cars || []) dot(ctx, c.car || c, '#ff3b30', 2, 'rgba(255,59,48,.5)');
  for (const c of G.PO?.foot || []) if (!c.down) dot(ctx, c.pos, '#ff3b30', 1.6);
  if (G.inCar) dot(ctx, G.inCar, GOLD, 2.2, '#12202e');

  const fare = G.E?.fareState;
  if (G.M.marker) diamond(ctx, G.M.marker);
  if (fare?.drop) diamond(ctx, fare.drop, '#fff0c2');
  else if (fare?.at) dot(ctx, fare.at, '#fff0c2', 2);
  if (city.markers?.vineMart) stamp(ctx, city.markers.vineMart, 'S', '#7ede8f');
  if (city.markers?.glassOrchid) stamp(ctx, city.markers.glassOrchid, '!', GOLD);

  const me = G.inCar;
  const p = me && G.P;
  if (p) {
    ctx.save();
    ctx.translate(px(me ? me.x : p.pos.x), px(me ? me.z : p.pos.z));
    ctx.rotate(-(me ? me.heading : p.yaw ?? 0) + Math.PI);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4, 5);
    ctx.lineTo(-4, 5);
    ctx.closePath();
    ctx.fillStyle = '#ff3b30';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(255,255,255,.5)';
  ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
}

// ------------------------------------------------------------------ cards

/** One card up, the rest down. */
export function showPanel(H, id) {
  const node = H?.panels[id] || el(id);
  if (!node) return false;
  hidePanels(H);
  node.classList.add('on');
  H.open = id;
  return true;
}

/** Every card down. */
export function hidePanels(H) {
  if (!H) return;
  for (const id of Object.keys(H.panels)) H.panels[id]?.classList.remove('on');
  H.open = null;
}

/** The Vine Mart's rows, priced from SHOP. */
export function fillShop(H, shop, have) {
  const list = el('shop-items');
  if (!list) return;
  list.innerHTML = '';
  for (const line of shop || []) {
    const row = Object.assign(document.createElement('div'), { className: 'item' });
    const buy = Object.assign(document.createElement('button'), { textContent: 'Buy', disabled: have < line.price });
    buy.dataset.buy = line.item;
    row.innerHTML = `<span>${line.label}</span><span class="price">$${line.price}</span>`;
    row.appendChild(buy);
    list.appendChild(row);
  }
  const note = el('shop-note');
  if (note) note.textContent = `You have ${cash(have)}.`;
}
