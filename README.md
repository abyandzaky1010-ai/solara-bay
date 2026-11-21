[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/abyandzaky1010-ai/solara-bay/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/abyandzaky1010-ai/solara-bay/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# SOLARA BAY

An open-world crime sandbox that runs in the browser. One HTML page plus ES
modules on top of Three.js (vendored in `game/vendor/`). The whole game is
static files: no build step, no backend, no network requests at runtime.

## Run it

```
node serve.ts
```

then open http://localhost:8080.

## Controls

| Input | Action |
| --- | --- |
| W A S D | Move / drive |
| Mouse | Look |
| Shift | Sprint |
| E | Enter, steal or leave a car |
| F | Fire weapon |
| T | Toggle taxi fares (while in a taxi) |
| Escape | Pause |

## Systems

- **City** — 400 x 400 m, one late-morning look (day only). Five roads on each
  axis form the grid. `MERIDIAN` downtown in the east holds glass and steel
  towers; `PALM WARD` in the west is low-rise pastel stucco. Verde Park sits
  mid-city with a pond, palms and benches. An ocean and a palm promenade run
  along the west edge.
- **Traffic** — 11 ambient cars (sedans and taxis) follow the road grid in the
  right-hand lane, stop for obstacles and honk on contact.
- **Pedestrians** — 15 walkers patrol the block corners, sprint away from
  gunfire and go down when a car hits them.
- **Wanted** — 1 to 5 stars for theft, hits, shots and kills; police cars and
  foot officers respond in growing numbers, chase, ram and open fire. Stars
  decay when nobody has eyes on you. Getting arrested at low health ends in a
  busted screen; dying ends in a wasted screen.
- **Missions** — a three-mission story around the Glass Orchid garage:
  steal and deliver a coupe, shake a two-star chase inside 90 seconds, then
  run a timed harbor handoff. Rewards are $500, $800 and $1500.
- **Combat** — pistol by default, a rifle pickup waits in a crate in Verde
  Park, and a rifle plus ammo, armor and medkits are sold at the VINE MART shop.
- **Economy** — money HUD, shop, mission pay and taxi fares ($80-$150).
- **HUD** — money, wanted stars, health and armor bars, weapon and ammo,
  speedometer, objective line with distance and timer, toasts, and a canvas
  minimap that shows roads, blocks, the park, cars, peds, police blips and
  mission markers.
- **Save** — money, mission progress, rifle, ammo and armor are kept in
  localStorage and restored on Continue.

## Layout

```
main.ts      staging + dossier.json for the make.fun hand-in
serve.ts     local static server on :8080
shots.json   the four screenshot scenes (?shot=chase|city|mission|start)
game/        index.html, src/*.js, vendor/three/
```

MIT licensed — see `LICENSE`.
