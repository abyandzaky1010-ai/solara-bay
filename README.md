[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/abyandzaky1010-ai/solara-bay/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/abyandzaky1010-ai/solara-bay/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
# SOLARA BAY

An open-world crime sandbox that runs in a browser. One HTML page, ES modules and a vendored copy of Three.js — all static files, no server logic, no network requests at runtime.

## The city

A compact 400 x 400 m sun-soaked bay town, fixed late-morning light, day only.

- **Meridian** (east): downtown glass and steel towers, 30-90 m tall.
- **Palm Ward** (west): low-rise pastel stucco blocks with roof slabs.
- **Verde Park**: grass, palms, a pond, benches, and a crate holding the rifle pickup.
- **Waterfront**: ocean west of x = -172, with a palm-lined promenade strip.
- Named places: Glass Orchid garage, Vine Mart shop, Cedar View hospital, Sable Row police station, and a taxi stand near the centre.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move / drive |
| Mouse | Look (click the canvas to capture the pointer) |
| Shift | Sprint |
| E | Enter or steal the nearest car / exit the car |
| F | Fire the current weapon |
| T | Toggle taxi fares (while driving a taxi) |
| R | Restart the mission at a fail screen |
| Escape | Pause |

## Systems

- **Traffic and pedestrians** — ambient cars on the street grid and walking civilians who flee from danger.
- **Wanted stars 1-5** — crimes raise the level; police cars and foot officers respond and chase; stars decay when nobody has eyes on you.
- **Story and missions** — three missions with a continuous story thread, given at the Glass Orchid, each with its own fail states.
- **Combat** — pistol from the start, a rifle pickup in the park, 60 rounds per ammo purchase, body armour.
- **Economy** — cash, a shop (rifle, ammo, armour, medkit), mission rewards, hospital and bust fees.
- **Taxi fares** — pick up a waiting passenger and drop them at the marked address for a fare between $80 and $150.
- **HUD** — wanted stars, money, health and armour bars, weapon and ammo, speedometer, objective line, toasts, and a canvas minimap with the city, cars, pedestrians and police.
- **Save** — progress (money, missions, rifle, ammo, armour) is kept in `localStorage` and restored by Continue.

## Run it

```
node serve.ts
```

Then open http://localhost:8080 . Node 22 or newer is required. The game loads nothing from the network — Three.js is vendored under `game/vendor/three/`.

## Hand-in

`node main.ts` copies `game/` and `screenshots/` into the output directory (`MAKEFUN_OUTPUT_DIR` or `/output`) and writes `dossier.json`. The four screenshots are described in `shots.json` and are produced from the `?shot=` query parameters.

## License

MIT — see `LICENSE`.
