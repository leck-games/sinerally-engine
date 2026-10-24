# Merge notes – engine branch (sinerally-engine) → graphics branch (sinerally)
Base commit: `0326ea6 Sine Rally prototype` (same as graphics branch start).

## New files (no conflicts expected)
- `js/vehicle.js` – `CFG`, `class Vehicle { spawn, basis, engineTorque, ratio, applyF, groundNormal, step(dt, inp), recover, collideCircles }`. Events in `veh.events` ('land','scrape','crash','recover'). Uses `ground`, `sample`, `OUT`, `SURF_PARAMS` from world.js.
- `js/roads.js` – `createRoads(scene, rampTexture)` → `{ meshes, update(px, pz, force) }`. Ribbon meshes (asphalt / dirt) + bridge mesh, MeshToonMaterial with polygonOffset.
- `js/grass.js` – `createGrass(scene, grid, {count, tile})` → `{ mesh, update(t, cx, cz, fogColor) }`. Custom ShaderMaterial; reads the near-grid DataTexture (RGBA32F: h, density, packed rg colour, b).
- `MERGE_NOTES.md`, new `shots/engine_*.png`.

## Rewritten: `js/world.js` (API superset – old names kept)
- Kept (signatures compatible): `WATER`, `WORLD`, `height(x,z)`, `normal(x,z,out)`, `colour(x,z,y,ny,out)`, `trackOf`, `trackR`, `trackPoint`, `nearTrack`, `trackW`, `snowLine`, `patch`, `hash2`.
- New: `SURF`, `SURF_NAMES`, `SURF_PARAMS`, `REG`, `REG_NAMES`, `regionWeights`, `naturalHeight`, `OUT`, `sample(x,z,o)`, `ground(x,z)` (includes bridge decks), `surfaceOf/surfaceAt`, `grassDensity`, `colourOf`, `pathsNear`, `pathPoint`, `PP`, `HWY/TRAIL/LOOP`.
- Internal: region height functions `hHills/hPlains/hDunes/hCanyon/hAlpine`, `river`, `natural`, road graph `nodeAt/edgeType/edgeAt/cellEdges/buildProfile/pathDist`.
- Graphics merge: if the graphics branch changed colours in `colour()`, port those tweaks into `colourOf()` (colour() now delegates to it).

## Rewritten: `js/main.js` (largest conflict)
Structure now: renderer/quality setup (LOW on touch or `?q=low`) → sky/fog/lights → `class Grid` (ring-buffer near/far terrain, far grid sunk under near via `onBeforeCompile` uniform `uNear`) → grass → roads → scenery (`cellObj`, `updateScenery`, colliders) → car mesh + wheels + dust (`emitDust`, `updateDust`) → input (`readInput`, `joyMove`, keys, buttons, tilt) → race (`cpPos`, `buildGates`, `raceUpdate`) → `minimap`, `gauge` → `updateWorld` → `frame` (120 Hz physics substeps, chase camera).
- Graphics pass integration points: materials created near the top (`ramp` toon texture, terrain `MeshToonMaterial` per Grid, scenery InstancedMesh materials in the scenery block, car materials in the car block). Post-processing / outline passes should wrap `renderer.render(scene, cam)` at the end of `frame()`.
- Terrain shader hook: the far Grid material already uses `onBeforeCompile`; chain any new graphics `onBeforeCompile` rather than replacing it (keep the `uNear` vertex sink).
- `window.__st` test hook (stats, teleport) – keep for headless tests.

## `index.html`
- Added `<canvas id="gauge">` + its CSS rule, `<link rel="icon" href="data:,">`, title "SineRally Engine". `#speed` div now shows only the AIR timer.
