[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/abyandzaky1010-ai/solara-bay/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/abyandzaky1010-ai/solara-bay/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# SOLARA BAY

Sun, chrome, and one last job.

A compact, sun-soaked crime sandbox in a browser: one 400 x 400 m city, one page,
one import map, no server, no network after the first load. Three districts —
MERIDIAN's glass towers, PALM WARD's pastel low-rise, VERDE PARK in the middle and
the ocean down the western edge — with traffic, pedestrians, a wanted ladder and
police who actually come looking for you.

Part of the [make.fun gta6-01 bounty](https://make.fun/bounty/gta6-01).

## Run it

The game is static files. Any static server works; the repo ships one:

```sh
node serve.ts                 # http://localhost:8080/game/index.html
PORT=9000 node serve.ts       # another port
```

Three.js is vendored at `game/vendor/three/three.module.min.js` and mapped by an
import map in `game/index.html`, so nothing leaves the machine. Opening
`game/index.html` from `file://` will not work: ES modules and import maps need
`http://`.

## Controls

| Key | On foot | In a car |
| --- | --- | --- |
| W A S D | walk | throttle / steer |
| Shift | sprint | brake |
| Mouse | look (click the canvas to lock the pointer) | look |
| E | enter or steal the nearest car | leave the car |
| F | fire (rifle when you carry one) | — |
| T | — | taxi: toggle the fare run |
| Escape | pause | pause |
| R | retry a failed mission | retry a failed mission |

Aim is always the third-person camera direction; there is no aim-down-sights mode.

## The city

- **MERIDIAN** (east): 30-90 m glass and steel towers, window bands, long warm shadows.
- **PALM WARD** (west): 8-24 m pastel stucco walk-ups with flat roof slabs and palms.
- **VERDE PARK** (centre): grass, a pond, eight palms, benches, and one crate with a rifle.
- **Promenade + ocean**: tiled waterfront strip along x = -200, sea west of the shore.
- About 40 buildings across the street grid (roads every 80 m, 12 m wide, sidewalks either side).

## Systems

- **On foot and by car.** A low-poly character with a walk swing, and arcade driving:
  four car kinds (sport, sedan, taxi, police) with their own top speed and turn rate.
  Stealing a car with somebody in it costs you a star; a police car costs two.
- **Traffic and people.** Ambient traffic drives the grid in the right lane, turns at
  junctions, stops for what is ahead and honks. Pedestrians walk sidewalk rings, cross
  at corners, flee from gunfire and fast cars, and go down when hit.
- **Wanted 1-5 stars.** Crimes add stars; staying out of sight drops them on a timer
  (30 s at one star, 60 s above). Police respond with patrol cars that intercept and ram,
  officers who dismount and shoot, an arrest when you are hurt and on foot, and a
  roadblock at four or five stars.
- **Combat.** Pistol (34 damage, unlimited ammo) plus a rifle pickup in the park
  (25 damage at eight rounds a second). Cars take damage, smoke, and explode.
- **Economy.** Money, a shop at VINE MART (rifle, ammo, armor, medkit), hospital and
  busted fees, mission rewards, and taxi fares you can pick up and run.
- **Story.** Three missions from the Glass Orchid garage — *Wheels for Vesper*,
  *Shake the Heat*, *Harbor Handoff* — with a line of story and a reward between them.
- **HUD.** Wanted stars, cash, health and armor bars, weapon and ammo, speed while
  driving, objective line with distance and timer, toasts, and a 180 px canvas minimap
  with buildings, the park, traffic, police and mission markers.
- **Save.** `localStorage` profile under `solara-bay-save-v1`: money, mission index,
  rifle, ammo, armor and playtime. Autosaves every ten seconds and on milestones;
  Continue appears on the title screen only when a save exists.
- **Sound.** WebAudio synthesis only (shots, crashes, sirens, engine, chimes). No audio
  files, no music, and every call is a no-op when an AudioContext is unavailable.

## Repository

```
game/index.html      page, HUD markup + CSS, import map
game/src/*.js        one module per job (config, palette, random, input, world, city,
                     player, car, traffic, peds, police, missions, economy, hud, sfx,
                     render, shots, main)
game/vendor/three/   vendored three.js (MIT)
main.ts              copies game/ and screenshots/ to the output, writes dossier.json
serve.ts             local static server on :8080
shots.json           the four demo scenes captured for the dossier
screenshots/         the four submission renders
```

Build the dossier:

```sh
node main.ts                               # -> /output
MAKEFUN_OUTPUT_DIR=./out node main.ts      # -> ./out
```

Running offline, forever: the page makes no request that is not a file of this repo.

## License

MIT — see `LICENSE`. three.js is MIT, its text in `game/vendor/three/LICENSE`.
