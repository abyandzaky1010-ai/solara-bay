# Solara Bay

An original open-world crime game that plays in a desktop browser from static files — no build
step, no network request. Explore a sun-soaked coastal city on foot or behind the wheel: steal
cars, run errands for the fixer Mara Vox, drive a cab for fares, buy gear at the mart, and keep
your wanted stars down when the Solara Bay police come looking.

## Play it

```
node serve.ts            # serves game/ on http://localhost:8080
```

Open http://localhost:8080 in desktop Chrome and click "New game" (or "Continue" to load the
localStorage save: money, missions done, position).

## Controls

| Input | Action |
| --- | --- |
| W A S D | move / drive |
| Mouse | look (click the game to lock the pointer) |
| Shift | sprint |
| Space | jump / handbrake |
| E | enter or exit a car, talk to Mara |
| Left click | shoot the pistol |
| R | reload |
| B | shop at the Solara Mart |
| Esc | pause |

## What's in the game

- **City**: a 400 x 400 m procedural street grid (~40 buildings in two districts, a park, a
  waterfront promenade with a pier and the bay), sun-soaked day lighting with shadows and fog.
- **On foot and by car**: third-person chase camera, WASD walking/sprinting/jumping, arcade car
  handling, E to steal any parked or traffic car (theft raises your wanted level).
- **Street life**: 10 traffic cars following lanes and braking for obstacles, 14 pedestrians on
  the sidewalks who flee gunfire, 6 parked cars.
- **Wanted 1-5 stars + police**: crimes raise stars, calm time lowers them; police cars spawn,
  chase and ram, foot cops arrest on contact, light bars flash — BUSTED costs cash and a clinic
  respawn.
- **3 missions + a story thread**: package run, cab delivery, wrecking the Dusk Line's cars —
  started at Mara Vox's marker, with objective marker, HUD objective line, timer, reward, fail.
- **Combat**: pistol with ammo pool, tracers and muzzle flash; shooting peds or cops raises stars.
- **Economy**: mission and taxi-fare money, the Solara Mart (medkit / ammo / car repair), medkit
  pickups around town.
- **Activity**: the roof-signed cab runs taxi fares — pick up the marker, drop the passenger.
- **HUD**: canvas minimap (streets, blocks, park, bay, player arrow, traffic, flashing police,
  mission marker, north), wanted stars, money, health, ammo, speed, prompts, dialog lines,
  start screen, pause, mission-complete, shop and busted/wasted panels. Progress saves to
  localStorage.

## Repo layout

- `main.ts` — the entry program (Node 22, stdlib only): copies `game/` and `screenshots/` to the
  output dir and writes `dossier.json` with the kit library. `MAKEFUN_OUTPUT_DIR=out node main.ts`
  runs it locally.
- `serve.ts` — dev static server for `game/`.
- `game/` — the game: `index.html` + ES modules in `game/src/` (one job per file: `city`, `car`,
  `traffic`, `peds`, `police`, `missions`, `economy`, `player`, `world`, `render`, `hud`, `input`,
  `shots`, `sfx`, `config`, `random`, `palette`, `main`), plus the vendored three.js build under
  `game/vendor/three/`.
- `screenshots/` — 4 real in-browser captures (cover first), staged via the `?shot=` modes.
- `shots.json` — the shot list and their query strings.
- `vendor/makefun-game.ts` — the kit's dossier library, byte-for-byte unchanged.

## License

MIT — see `LICENSE`.
