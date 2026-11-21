# SOLARA BAY

An open-world crime sandbox that runs in a browser. You walk, steal and drive cars through a
sun-soaked coastal city, pick up work from the people who run it, and try to stay one step ahead
of the police.

Built with Three.js (vendored into `game/vendor/`) and plain ES modules. The game is entirely
static files, makes no network requests, and uses only code-generated geometry plus synthesised
WebAudio blips — there are no external assets.

## Run it

```
node serve.ts
```

Then open <http://localhost:8080>. Any static file server pointed at `game/` works the same way.
A modern desktop browser with WebGL is required.

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` | move / drive |
| mouse | look |
| `Shift` | sprint |
| `E` | enter, steal or leave a car |
| `F` | fire |
| `T` | toggle taxi fares (while driving a taxi) |
| `R` | retry a failed mission |
| `Escape` | pause |

Click the view to capture the mouse; `Escape` releases it.

## The city

- 400 x 400 m ground with five avenues in each direction, sidewalks and crosswalks.
- **Meridian** (east) is downtown glass and steel, towers 30-90 m tall.
- **Palm Ward** (west) is low-rise pastel stucco, 8-24 m tall with roof slabs.
- **Verde Park** in the middle: grass, pond, palms, benches and one crate holding a rifle.
- Waterfront to the west with a tiled promenade lined with palms and the sea beyond.
- Named places: the Glass Orchid garage (mission giver), Vine Mart (shop), Cedar View hospital
  and the Sable Row police station. They are flat pads with sign plates — there are no interiors.

## Systems

- **On foot and driving.** Third-person camera both ways. Six parked cars to steal (sport, sedan,
  taxi) plus ambient traffic. Arched handling per car kind, damage, smoke at low health, wrecks
  that explode.
- **Traffic and pedestrians.** 11 ambient cars follow the street grid in the right-hand lane and
  stop for obstacles. 15 pedestrians walk the block edges, flee gunfire and speeding cars, and
  can be hailed as taxi fares.
- **Wanted level.** One to five stars, earned by stealing an occupied car, attacking citizens or
  police, and by rampages. Stars decay once the police lose sight of you. Higher levels bring more
  police cars and foot officers, ramming chases, roadblocks at four stars and above.
- **Three missions.** *Wheels for Vesper* (return a stolen coupe), *Shake the Heat* (earn two
  stars, then lose them inside 90 seconds) and *Harbor Handoff* (collect a package at the pier and
  deliver it under heat). Each has its own briefing, objective marker, timer and story beat.
- **Combat.** A pistol (unlimited ammo) plus a rifle findable in the park and bought at the shop.
  Armour absorbs part of incoming damage.
- **Economy.** Cash HUD, a shop selling the rifle, ammo, armour and a medkit, mission rewards, and
  taxi fares that pay 80-150 for a short run.
- **HUD and minimap.** Wanted stars, money, health and armour bars, weapon and ammo, speed,
  objective and timer, toast messages, and a 180 px canvas minimap that shows the city, roads,
  park, water and every live blip.
- **Save.** Money, mission progress, rifle, ammo, armour and playtime are stored in `localStorage`
  (`solara-bay-save-v1`) and restored by *Continue* on the title screen.

## Layout

```
game/index.html        HUD markup, CSS, import map, module entry
game/src/main.js       boot, fixed-step loop, screens, shared game state
game/src/config.js     every tunable number
game/src/world.js      renderer, camera, lights, roads, collision
game/src/city.js       buildings, districts, park, props, spawn points
game/src/player.js     character, on-foot control, weapons
game/src/car.js        car meshes and arcade driving
game/src/traffic.js    ambient cars on the grid
game/src/peds.js       pedestrians and fares
game/src/police.js     wanted level and police AI
game/src/missions.js   story, missions and markers
game/src/economy.js    money, shop, fares, save/load
game/src/hud.js        HUD, minimap and panels
game/src/sfx.js        WebAudio blips and engine
game/src/render.js     pooled visual effects
game/src/shots.js      deterministic screenshot scenes
main.ts                hand-in program: copies the build and writes dossier.json
serve.ts               local static server on port 8080
```

## License

MIT — see `LICENSE`.
