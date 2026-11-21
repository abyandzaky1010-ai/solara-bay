[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/abyandzaky1010-ai/solara-bay/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/abyandzaky1010-ai/solara-bay/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# SOLARA BAY

*Sun, chrome, and one last job.*

Solara Bay is an open-world crime sandbox that runs in a browser tab. You drive a 400 x 400 m coastal city on foot or behind the wheel of a stolen car, while traffic, pedestrians and the police keep the streets alive.

It is a single HTML page plus ES modules, rendered with Three.js (vendored at `game/vendor/three/three.module.min.js`). Everything is a static file: no build step, no backend, no network requests at runtime, no audio files.

## Run it

```
node serve.ts
```

Then open <http://localhost:8080>.

## Controls

| Key / input | Action |
| --- | --- |
| `W` `A` `S` `D` | Move on foot / drive |
| Mouse | Look (click the canvas to capture the pointer) |
| `Shift` | Sprint on foot |
| `E` | Enter, steal or leave a car |
| `F` | Fire the equipped weapon |
| `T` | Toggle taxi fares (while driving a taxi) |
| `R` | Restart a failed mission |
| `Escape` | Pause |

## Systems

- **City** — two districts. Meridian (downtown glass and steel towers) east of the main avenue, Palm Ward (low-rise pastel stucco) west of it. Verde Park in the south-west blocks, an ocean waterfront with a palm promenade on the west edge, and a 12 m street grid with sidewalks and crosswalks.
- **Traffic** — 11 ambient cars loop the grid in the right-hand lane, keep their distance, honk and give way.
- **Pedestrians** — 15 walkers circle blocks on sidewalks, cross at corners, flee gunfire and speeding cars, and go down when hit.
- **Wanted level** — 1 to 5 stars. Crimes (car theft, shooting, killing pedestrians or officers) raise it; staying out of sight bleeds it down one star at a time. Police respond with patrol cars that chase and ram, foot officers that fire, and roadblocks at four stars and above.
- **Story** — three missions from the Glass Orchid garage: steal the Coral coupe, shake the police within 90 seconds, then run a timed harbour handoff with heat on your tail.
- **Combat** — a pistol from the start, a rifle picked up from the crate in Verde Park, plus armour and medkits from the Vine Mart shop.
- **Money** — rewards, shop prices, hospital and station fees, and taxi fares between 80 and 150 dollars.
- **Taxi work** — drive a taxi, press `T`, pick up a waiting fare and drop them at the marker.
- **HUD** — wanted stars, money, health and armour bars, weapon and ammo, speedometer, mission objective with timer, toasts, and a canvas minimap with roads, buildings, park, blips and markers.
- **Save** — money, mission progress, rifle, ammo and armour are written to `localStorage` (`solara-bay-save-v1`) every ten seconds and on milestones.

## Layout

```
game/index.html        HUD DOM, CSS, import map
game/src/config.js     every tunable number
game/src/palette.js    colours and shared materials
game/src/random.js     seeded RNG helpers
game/src/input.js      keyboard, mouse, pointer lock
game/src/world.js      renderer, scene, lights, camera, roads, collisions
game/src/city.js       buildings, districts, park, waterfront, props, spawns
game/src/player.js     character, on-foot control, weapons
game/src/car.js        vehicles, driving, damage
game/src/traffic.js    ambient traffic
game/src/peds.js       pedestrians
game/src/police.js     wanted level and police AI
game/src/missions.js   story missions and markers
game/src/economy.js    money, shop, fares, save
game/src/hud.js        HUD, minimap, panels
game/src/sfx.js        WebAudio blips
game/src/render.js     pooled visual effects
game/src/shots.js      deterministic screenshot scenes
main.ts                dossier builder (Node 22, stdlib only)
serve.ts               static dev server on port 8080
```

Screenshot scenes for the submission are addressed by URL, for example `http://localhost:8080/?shot=chase&seed=1`.

## Licence

MIT — see `LICENSE`.
