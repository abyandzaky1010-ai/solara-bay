// Solara Bay — tuning constants. One table the whole game balances around.
export const CFG = {
  world: 400,                                   // city square in metres, centred on origin
  roadAt: [-150, -100, -50, 0, 50, 100, 150],   // road centre lines on both axes
  roadW: 14,
  blockHalf: 18,                                // sidewalk half-size around each block
  beachZ: 176,                                  // sand promenade starts (south edge)
  waterZ: 186,                                  // the bay starts
  nBuildings: 40,
  nTraffic: 10,
  nPeds: 14,
  nParked: 6,
  walk: 5.2, sprint: 8.4, jumpV: 7,
  carAccel: 17, carMax: 30, carRev: 9, steer: 2.6,
  policeMaxSpeed: 26, copRun: 6.8,
  playerHp: 100, pedHp: 40, copHp: 70, carHp: 100,
  dmg: 34, mag: 12, reloadT: 1.4, range: 80, startPool: 48,
  startMoney: 200,
  price: { medkit: 50, ammo: 40, repair: 120 },
  taxiBase: 60, taxiPerM: 0.45,
  rewards: [500, 800, 1500],
  decayEvery: 12,                               // calm seconds before losing one wanted star
  saveKey: 'solarabay.save.v1',
  step: 1 / 60,
};
