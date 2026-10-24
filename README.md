# SineRally Engine – FUEL-style free-roam driving (engine branch)
Live: https://leck-games.github.io/sinerally-engine/  · No build step: static files, three.js r160 vendored (`js/three.module.js`, importmap).
Run locally: `python3 -m http.server 8000` in this folder → http://localhost:8000 (phone on same Wi-Fi: http://<LAN-IP>:8000).

## Controls
- Keyboard: W/↑ throttle, S/↓ brake/reverse, A/D or ←/→ steer, **Space handbrake (drift)**, Shift boost, **Q/E pitch in the air** (also ↑/↓ while airborne), R reset/recover, F debug overlay.
- Touch: left joystick (X = steer, Y = air pitch), GAS / BRAKE / BOOST / DRIFT buttons, optional Tilt steering.
- URL: `?q=low` force mobile quality (auto on touch devices), `?dbg` debug overlay, `?auto=1|drift|boost` headless test driver.

## Features
- **Vehicle physics** (`js/vehicle.js`): 6-DOF rigid body (1450 kg, diagonal inertia tensor), 120 Hz fixed substeps, 4 raycast wheels with spring/damper + bump stops + anti-roll bars, Pacejka magic-formula tyres with combined slip & load sensitivity, per-surface grip/rolling resistance (asphalt, dirt, grass, sand, rock, snow, mud), engine torque curve, automatic 6-speed gearbox (road-speed rpm, no hunting), RWD-biased AWD, handbrake drift, weight transfer, air control (pitch/roll/yaw), landing impacts, stability assist, rollover auto-recover, boost refilled by airtime.
- **Terrain** (`js/world.js`): pure math, 5 blended regions (rolling hills, plains with rivers & lakes, sand dunes, canyons/mesas with terraced cliffs, alpine ridges with snow line). One `sample()` returns height, road deck, road type, region and surface type – used by physics, rendering, grass and scenery alike.
- **Roads**: infinite procedural road graph (lattice nodes, highways + dirt trails + the original race loops). Terrain is flattened and banked along roads; highways are asphalt with edge lines & dashed yellow centre line, trails have wheel ruts & grass centre strip; bridges with deck, rails and pillars where roads cross water.
- **Rendering**: two-level ring-buffer terrain (4 m near grid + 16 m far grid to ~1.7 km, only new rows/cols re-sampled), GPU-instanced grass (3-blade clumps, wind sway, density from terrain, distance fade; 7k clumps on mobile), region-aware trees/cacti/rocks, dust particles per surface, chase camera with speed FOV + landing shake, minimap with roads, speed/RPM/gear gauge.
- Race loops & gates kept: white gate starts a lap, best laps in localStorage.
