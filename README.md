[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/abyandzaky1010-ai/solara-bay/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/abyandzaky1010-ai/solara-bay/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# SOLARA BAY

An open-world crime sandbox that runs in a browser. You play a driver working for Vesper in Solara Bay, a compact sun-lit city of 400 x 400 metres: glass towers in Meridian on the east side, pastel low-rise in Palm Ward on the west, Verde Park in the middle, and the ocean off the west promenade.

The game is static files plus Three.js (vendored in `game/vendor/three/`). It makes no network requests and runs fully offline.

## Run it

```
node serve.ts
```

Then open <http://localhost:8080>.

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move on foot, or drive / steer |
| Mouse | Look (click the canvas to lock the pointer) |
| Shift | Sprint on foot |
| E | Enter, steal or leave a car |
| F | Fire the pistol or the rifle |
| T | Start / stop taxi fares (while in a taxi) |
| Escape | Pause |

## Systems

- **City** — a road grid at 80 m pitch, ~40 buildings, a park with a pond, a beach promenade, and named places: the Glass Orchid garage, Vine Mart shop, Cedar View hospital and the Sable Row police station.
- **Vehicles** — sports cars, sedans, taxis and police cruisers. Steal parked cars or pull off a carjacking; every car has health and can catch fire and explode.
- **Traffic and pedestrians** — ambient traffic that follows the grid in the right-hand lane, and pedestrians who walk the sidewalks and flee from gunfire or speeding cars.
- **Wanted stars 1–5 and police** — crimes raise the wanted level; police cars intercept and ram you, foot officers pursue and fire, and at four stars they set up roadblocks. Stay out of sight and the level decays one star at a time.
- **Story** — three missions: *Wheels for Vesper*, *Shake the Heat* and *Harbor Handoff*, each with a reward and a line of story.
- **Combat** — a pistol from the start, a rifle found in a crate at Verde Park, armour, and a medkit for sale.
- **Economy** — money from mission rewards, taxi fares ($80–$150 per run) and the Vine Mart shop (rifle, ammo, armour, medkit). Hospital and police fees are charged when you are wasted or busted.
- **HUD** — money, wanted stars, health and armour bars, weapon and ammo, speed, the current objective with distance and timer, and a canvas minimap.
- **Save** — money, mission progress, rifle ammo and armour are saved to `localStorage` (`solara-bay-save-v1`), so the title screen offers *Continue*.

## Hand-in

`node main.ts` copies `game/` and `screenshots/` to `$MAKEFUN_OUTPUT_DIR` (default `/output`) and writes `dossier.json` with `buildDossier` from `vendor/makefun-game.ts`. `shots.json` lists the four screenshot URLs.

## Licence

MIT — see `LICENSE`. Solara Bay is an original setting; it uses no names or marks of any commercial game.
