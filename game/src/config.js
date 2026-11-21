// Every tunable number in Solara Bay lives here, so balance changes stay in one place.
// Units: metres, seconds, degrees/second as noted, money in dollars.

export const CONFIG = {
  world: {
    half: 200,          // playable ground spans [-half, half] on x and z
    sea: -172,          // ocean starts west of this x
    pitch: 80,          // distance between parallel streets on each axis
    roadHalf: 6,        // asphalt half-width (12 m streets)
    sidewalk: 3,        // sidewalk depth either side of the asphalt
    blockUsable: 68,    // buildable inner size of one city block
    parkRect: { minX: -74, maxX: -6, minZ: -74, maxZ: -6 },
  },

  player: {
    walk: 4.4,          // m/s on foot
    sprint: 7.0,
    hp: 100,
    camDistFoot: 5.5,   // third-person camera distance on foot
    camHeight: 1.6,     // eye height
  },

  weapons: {
    pistol: { dmg: 34, rate: 3, spread: 0.012, infinite: true },
    rifle:  { dmg: 25, rate: 8, spread: 0.02, ammoPerBuy: 60 },
  },

  car: {
    hp: 100,
    radius: 1.4,
    kinds: {
      sport:  { max: 28, accel: 14, turn: 1.9 },
      sedan:  { max: 22, accel: 9,  turn: 1.6 },
      taxi:   { max: 23, accel: 9,  turn: 1.6 },
      police: { max: 31, accel: 16, turn: 2.0 },
    },
  },

  traffic: {
    count: 11,
    speed: 9,           // cruising m/s
    laneOffset: 3.2,    // right-hand lane offset from road centre
    probeAhead: 6,      // braking probe distance
  },

  peds: {
    count: 15,
    speed: 1.4,
    flee: 5.2,
    hp: 40,
  },

  wanted: {
    decay: { 1: 30, 2: 60, 3: 60, 4: 60, 5: 60 }, // seconds unseen before losing a star
    crime: {
      theftOccupied: 1,
      policeCar: 2,
      hitPed: 2,
      shootPed: 3,
      killPed: 3,
      killCop: 3,
      rampageKills: 3,   // kills within rampageWindow add one extra star
      rampageWindow: 20,
    },
  },

  police: {
    counts: {
      1: [1, 0],
      2: [2, 1],
      3: [3, 2],
      4: [4, 3],
      5: [5, 4],
    },
    foot: {
      hp: 60,
      run: 6.5,
      dmgMin: 8,
      dmgMax: 12,
      fireEvery: 1.0,
      range: 22,
      arrestDist: 3.0,
      arrestHpBelow: 25,
    },
    carChase: {
      ram: 6,           // damage per ram
      dropDist: 260,    // give up / despawn beyond this
    },
  },

  economy: {
    start: 200,
    rifle: 600,
    ammo: 100,
    armor: 250,
    medkit: 50,
    fareMin: 80,
    fareMax: 150,
    hospitalFee: 100,
    bustedFee: 150,
    saveKey: 'solara-bay-save-v1',
  },

  missions: {
    m1: 500,
    m2: 800,
    m3: 1500,
    m2EvadeSec: 90,
    m3DeliverySec: 120,
  },
};

export const STEP = 1 / 60;
