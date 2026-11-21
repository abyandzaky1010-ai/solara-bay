# SOLARA BAY

An open-world crime sandbox that runs in a browser. One HTML page plus ES
modules, rendered with Three.js (vendored locally). The city is compact: 400 by
400 metres of palm-lined avenues, a glass-tower downtown, a low-rise pastel
district, a park with a pond, and a waterfront promenade on the western sea.
Fixed late-morning sun, day only. The game makes no network requests; every
asset is code or a file inside `game/`. Sound is synthesised with WebAudio.

Original city, original story, original characters.

## Controls

| Key / input | Action |
| --- | --- |
| WASD | Move on foot / drive |
| Mouse | Look (click the world to lock the pointer) |
| Shift | Sprint on foot |
| E | Enter, steal or leave a car |
| F | Fire the current weapon |
| T | Toggle taxi fares while driving a taxi |
| R | Retry the mission after a fail screen |
| Escape | Pause |

## Systems

- **City** — two districts (Meridian downtown, Palm Ward), Verde Park, a
  waterfront promenade, roughly 40 buildings, parked cars, named places.
- **Traffic** — ambient cars driving the grid, eleven of them, right-hand lanes.
- **Pedestrians** — fifteen walkers on the sidewalks; they flee from gunfire
  and speeding cars.
- **Wanted level** — one to five stars. Theft, running people over, shooting,
  killing, and three kills in twenty seconds all raise it. Police respond with
  cars and foot officers, ram you, shoot, arrest and set up roadblocks. Stars
  decay when nobody has seen you for a while.
- **Story** — three missions in sequence plus story text between them.
- **Combat** — a pistol at all times plus one findable rifle (park crate or the
  shop), armour, and damage from cars, cops, explosions and falls through
  wanted escalation.
- **Economy** — money, a shop selling rifle, ammo, armour and medkits, mission
  rewards, and hospital or station fees.
- **Taxi fares** — drive a taxi, press T, pick up a waiting passenger and
  deliver them to a marked destination for 80 to 150 dollars.
- **HUD** — money, wanted stars, health and armour bars, weapon and ammo,
  speedometer, objective line with distance and timer, toasts, and a 180 px
  canvas minimap.
- **Save** — progress (money, mission index, weapons, armour, playtime) is kept
  in `localStorage`; the title screen offers Continue when a save exists.

## Run it

```
node serve.ts
```

Then open <http://localhost:8080>. Node 22 or newer, no dependencies to
install.

## Hand-in

`main.ts` copies `game/` and `screenshots/` into the output directory
(`MAKEFUN_OUTPUT_DIR`, default `/output`) and writes `dossier.json`. Screenshot
queries are listed in `shots.json`.

## License

MIT — see `LICENSE`.
