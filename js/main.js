// SineRally ENGINE build: rigid-body 4x4 (vehicle.js), multi-region math terrain + road graph (world.js),
// cached ring-buffer terrain grids (near 4 m / far 16 m), GPU grass (grass.js), road meshes (roads.js), HUD gauge.
import * as THREE from 'three';
import * as W from './world.js';
import { Vehicle, CFG } from './vehicle.js';
import { createRoads } from './roads.js';
import { createGrass } from './grass.js';
const { WATER, nearTrack, trackPoint, hash2, sample, surfaceOf, colourOf, grassDensity, normal, height, ground } = W;
const $ = id => document.getElementById(id);
const QS = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
const LOW = QS.get('q') === 'low' || (isTouch && QS.get('q') !== 'high');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, LOW ? 1.3 : 1.5));
renderer.setSize(innerWidth, innerHeight); document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const FOG = new THREE.Color(0xc4e4f6); scene.fog = new THREE.Fog(FOG, 240, 760);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.4, 1700);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
const ramp = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 180, 180, 180, 255, 255, 255, 255, 255]), 3, 1);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
const toon = (c, o = {}) => new THREE.MeshToonMaterial({ color: c, gradientMap: ramp, ...o });
scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(0.5, 1, 0.3); scene.add(sun);
const sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 16, 8), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying float h;void main(){h=normalize(position).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: 'varying float h;void main(){vec3 a=vec3(.77,.89,.96),b=vec3(.25,.55,.95);gl_FragColor=vec4(mix(a,b,clamp(h*1.6,0.,1.)),1.);}' }));
sky.renderOrder = -1; scene.add(sky);

// ---------- terrain: ring-buffer grid; only rows/cols that scroll into view are sampled ----------
const SO = { h: 0, hn: 0, deck: 0, road: 0, rtype: 0, dom: 0, riv: 0, rd: 0 }, nv = [0, 0, 0], cv = [0, 0, 0];
class Grid {
  constructor(N, step, mat, withTex) {
    const n = this.n = N + 1; this.N = N; this.step = step;
    this.H = new Float32Array(n * n); this.NRM = new Float32Array(n * n * 3); this.COL = new Float32Array(n * n * 3);
    this.gi0 = this.gj0 = null;
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * n * 3); this.nor = new Float32Array(n * n * 3); this.col = new Float32Array(n * n * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const idx = new (n * n > 65535 ? Uint32Array : Uint16Array)(N * N * 6); let q = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { // same split as PlaneGeometry (grass shader relies on it)
      const a = j * n + i, b = (j + 1) * n + i, c = (j + 1) * n + i + 1, d = j * n + i + 1;
      idx[q++] = a; idx[q++] = b; idx[q++] = d; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; scene.add(this.mesh);
    if (withTex) { this.tdata = new Float32Array(n * n * 4); this.tex = new THREE.DataTexture(this.tdata, n, n, THREE.RGBAFormat, THREE.FloatType); this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter; this.tex.needsUpdate = true; }
  }
  ri(g) { const n = this.n; return ((g % n) + n) % n; }
  compute(gi, gj) {
    const s = this.step, x = gi * s, z = gj * s, k = this.ri(gj) * this.n + this.ri(gi);
    sample(x, z, SO); normal(x, z, nv); const surf = surfaceOf(x, z, SO, nv[1]); colourOf(x, z, SO, nv[1], surf, cv);
    const j = 0.94 + 0.12 * hash2(gi, gj, 3); // per-vertex tint jitter (stylised texture)
    this.H[k] = SO.h; this.NRM.set(nv, k * 3); this.COL[k * 3] = cv[0] * j; this.COL[k * 3 + 1] = cv[1] * j; this.COL[k * 3 + 2] = cv[2] * j;
    if (this.tdata) {
      const d = grassDensity(x, z, SO, nv[1], surf), o = k * 4;
      this.tdata[o] = SO.h; this.tdata[o + 1] = d;
      this.tdata[o + 2] = Math.min(255, cv[0] * 0.9 * 255 | 0) * 256 + Math.min(255, cv[1] * 1.08 * 255 | 0); this.tdata[o + 3] = Math.min(255, cv[2] * 0.85 * 255 | 0);
    }
  }
  update(px, pz, force) {
    const N = this.N, n = this.n, s = this.step, gi0 = Math.round(px / s) - N / 2, gj0 = Math.round(pz / s) - N / 2;
    if (!force && gi0 === this.gi0 && gj0 === this.gj0) return false;
    const o0 = this.gi0, p0 = this.gj0, fresh = o0 === null || force;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const gi = gi0 + i, gj = gj0 + j;
      if (fresh || gi < o0 || gi > o0 + N || gj < p0 || gj > p0 + N) this.compute(gi, gj);
    }
    this.gi0 = gi0; this.gj0 = gj0;
    let v = 0;
    for (let j = 0; j < n; j++) { const rj = this.ri(gj0 + j) * n; for (let i = 0; i < n; i++, v++) {
      const k = rj + this.ri(gi0 + i), v3 = v * 3, k3 = k * 3;
      this.pos[v3] = (gi0 + i) * s; this.pos[v3 + 1] = this.H[k]; this.pos[v3 + 2] = (gj0 + j) * s;
      this.nor[v3] = this.NRM[k3]; this.nor[v3 + 1] = this.NRM[k3 + 1]; this.nor[v3 + 2] = this.NRM[k3 + 2];
      this.col[v3] = this.COL[k3]; this.col[v3 + 1] = this.COL[k3 + 1]; this.col[v3 + 2] = this.COL[k3 + 2];
    } }
    const a = this.geo.attributes; a.position.needsUpdate = a.normal.needsUpdate = a.color.needsUpdate = true;
    if (this.tex) this.tex.needsUpdate = true;
    return true;
  }
}
const nearMat = toon(0xffffff, { vertexColors: true });
const farMat = toon(0xffffff, { vertexColors: true });
const NEAR_N = LOW ? 112 : 128, NEAR_S = 4, FAR_N = LOW ? 80 : 96, FAR_S = 16;
const farU = { uNear: { value: new THREE.Vector3() } };
farMat.onBeforeCompile = sh => { // sink far-grid vertices that lie under the near grid
  sh.uniforms.uNear = farU.uNear;
  sh.vertexShader = 'uniform vec3 uNear;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vec2 dd = abs(position.xz - uNear.xy); float m = max(dd.x, dd.y); transformed.y -= 8.0 * clamp((uNear.z - 10.0 - m) / 10.0, 0.0, 1.0);`);
};
const far = new Grid(FAR_N, FAR_S, farMat, false), near = new Grid(NEAR_N, NEAR_S, nearMat, true);
const water = new THREE.Mesh(new THREE.PlaneGeometry(3400, 3400).rotateX(-Math.PI / 2), toon(0x3a9ee0, { transparent: true, opacity: 0.82 }));
water.position.y = WATER; scene.add(water);
const roads = createRoads(scene, ramp);
const grass = createGrass(scene, near, { count: LOW ? 7000 : 16000, tile: LOW ? 64 : 76 });

// ---------- scenery: hash per 14 m cell, region-dependent; cells cached ----------
const SC = 14, SR = LOW ? 240 : 300, cellCache = new Map();
const pineGeo = new THREE.ConeGeometry(2.6, 9, 6).translate(0, 7.2, 0), leafGeo = new THREE.IcosahedronGeometry(3.4, 0).translate(0, 6.2, 0);
const trunkGeo = new THREE.CylinderGeometry(.5, .7, 4, 5).translate(0, 2, 0), rockGeo = new THREE.DodecahedronGeometry(2.2, 0);
const cactGeo = new THREE.CylinderGeometry(.45, .5, 4.5, 6).translate(0, 2.2, 0);
const KINDS = [['pine', pineGeo, 0x2d8a4a, 1500], ['leaf', leafGeo, 0x5aa83c, 1200], ['trunk', trunkGeo, 0x7a5030, 2700], ['rock', rockGeo, 0x9a95a5, 900], ['cact', cactGeo, 0x4f9a50, 400]];
const inst = {}; for (const [k, g, c, n] of KINDS) { const m = new THREE.InstancedMesh(g, toon(c), n); m.frustumCulled = false; m.count = 0; scene.add(m); inst[k] = m; }
const rockMat = inst.rock.material, canyonRock = toon(0xc0805a);
const Mx = new THREE.Matrix4(), Qt = new THREE.Quaternion(), Vt = new THREE.Vector3(), St = new THREE.Vector3(), Et = new THREE.Euler();
const forest = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.0021 + Math.cos(z * 0.0017) * 2) * Math.cos(z * 0.0025 + Math.sin(x * 0.0013));
function cellObj(ci, cj) {
  const key = ci * 1e5 + cj; let o = cellCache.get(key); if (o !== undefined) return o;
  o = null;
  const h = hash2(ci, cj, 9), x = (ci + hash2(ci, cj, 7)) * SC, z = (cj + hash2(ci, cj, 8)) * SC;
  sample(x, z, SO);
  if (SO.h > WATER + 1.2 && SO.road < 0.05 && SO.rd > 2.5) {
    normal(x, z, nv); const ny = nv[1], f = forest(x, z), s = 0.7 + hash2(ci, cj, 6) * 0.8, d = SO.dom, R = W.REG;
    let kind = null;
    if (d === R.ALPINE) { if (SO.h < W.snowLine(x, z) - 8 && ny > 0.8 && h < 0.15 + 0.5 * f) kind = 'pine'; else if (h > 0.9) kind = 'rock'; }
    else if (d === R.HILLS) { if (ny > 0.82 && h < 0.08 + 0.45 * f * f) kind = h < 0.22 * f ? 'leaf' : 'pine'; else if (h > 0.95) kind = 'rock'; }
    else if (d === R.PLAINS) { if (ny > 0.9 && h < 0.04 + 0.2 * f * f * f) kind = 'leaf'; else if (h > 0.985) kind = 'rock'; }
    else if (d === R.DUNES) { if (h > 0.975 && ny > 0.8) kind = 'cact'; else if (h < 0.015) kind = 'rock'; }
    else { if (h > 0.88) kind = 'rock'; else if (h < 0.04 && ny > 0.85) kind = 'cact'; }
    if (kind) o = { kind, x, z, y: SO.h, s, h, canyon: d === R.CANYON || d === R.DUNES };
  }
  if (cellCache.size > 60000) cellCache.clear();
  cellCache.set(key, o); return o;
}
let scx = 1e9, scz = 1e9; const colliders = [];
function updateScenery(px, pz) {
  const cx = Math.round(px / 28), cz = Math.round(pz / 28); if (cx === scx && cz === scz) return; scx = cx; scz = cz;
  const cnt = { pine: 0, leaf: 0, trunk: 0, rock: 0, cact: 0 }; colliders.length = 0; const r = Math.ceil(SR / SC), ox = Math.floor(px / SC), oz = Math.floor(pz / SC);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    if (i * i + j * j > r * r) continue; const o = cellObj(ox + i, oz + j); if (!o) continue;
    const k = o.kind, m = inst[k]; if (cnt[k] >= m.instanceMatrix.count) continue; const s = o.s;
    if (k === 'rock') { Qt.setFromEuler(Et.set(o.h * 9, o.h * 30, o.h * 3)); const big = o.canyon ? 1.8 : 1; Mx.compose(Vt.set(o.x, o.y - 0.3, o.z), Qt, St.set(s * 1.3 * big, s * big, s * 1.2 * big)); colliders.push(o.x, o.z, 2.2 * s * big); }
    else { Qt.setFromEuler(Et.set(0, o.h * 40, 0)); Mx.compose(Vt.set(o.x, o.y - 0.4, o.z), Qt, St.set(s, s * (0.85 + o.h * 0.6), s)); colliders.push(o.x, o.z, k === 'cact' ? 0.6 : 0.8 * s);
      if (k !== 'cact' && cnt.trunk < inst.trunk.instanceMatrix.count) inst.trunk.setMatrixAt(cnt.trunk++, Mx); }
    m.setMatrixAt(cnt[k]++, Mx);
  }
  for (const k in inst) { inst[k].count = cnt[k]; inst[k].instanceMatrix.needsUpdate = true; }
}

// ---------- vehicle + visuals ----------
const veh = new Vehicle();
const car = new THREE.Group(); scene.add(car);
const paint = toon(0xff4a3d), dark = toon(0x2a2a33), cream = toon(0xfff2d0), metal = toon(0xb8bcc8);
const addBox = (w, h, l, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), m); b.position.set(x, y, z); car.add(b); return b; };
addBox(2.0, 0.55, 4.3, 0, 0.05, 0, paint);            // tub
addBox(1.9, 0.25, 1.5, 0, 0.42, 1.35, paint);          // bonnet
addBox(1.7, 0.7, 1.9, 0, 0.68, -0.35, cream);          // cab
addBox(1.6, 0.08, 0.06, 0, 1.05, 0.62, dark);          // windscreen frame
addBox(2.1, 0.14, 0.22, 0, -0.05, 2.22, metal);        // bumper
addBox(1.3, 0.5, 0.1, 0, 0.3, 2.3, dark);              // bull bar
addBox(2.1, 0.14, 0.22, 0, -0.05, -2.22, metal);
for (const x of [-0.8, 0.8]) { addBox(0.08, 0.9, 0.08, x, 1.1, -1.35, dark); addBox(0.32, 0.18, 0.06, x * 0.85, 0.32, 2.3, new THREE.MeshBasicMaterial({ color: 0xffffcc })); }
addBox(1.68, 0.08, 0.08, 0, 1.55, -1.35, dark); addBox(1.9, 0.1, 0.8, 0, 1.2, -2.05, dark); // roll bar + wing
const flame = new THREE.Mesh(new THREE.ConeGeometry(.3, 1.4, 6).rotateX(-Math.PI / 2).translate(0, .1, -2.9), new THREE.MeshBasicMaterial({ color: 0xffaa22 })); car.add(flame);
const tyreGeo = new THREE.CylinderGeometry(CFG.wheelR, CFG.wheelR, 0.42, 10).rotateZ(Math.PI / 2), hubGeo = new THREE.BoxGeometry(0.44, 0.16, 0.6);
const wheelMeshes = veh.wheels.map(() => { const g = new THREE.Group(); g.add(new THREE.Mesh(tyreGeo, dark)); g.add(new THREE.Mesh(hubGeo, metal)); scene.add(g); return g; });
// dust particles
const DN = 260, dpos = new Float32Array(DN * 3), dcol = new Float32Array(DN * 3), dvel = new Float32Array(DN * 3), dlife = new Float32Array(DN); let dhead = 0;
const dgeo = new THREE.BufferGeometry(); dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3)); dgeo.setAttribute('color', new THREE.BufferAttribute(dcol, 3));
const puffTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const dust = new THREE.Points(dgeo, new THREE.PointsMaterial({ map: puffTex, size: 2.2, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false })); dust.frustumCulled = false; scene.add(dust);
const DUSTC = [[.5, .5, .5], [.75, .62, .45], [.5, .62, .35], [.95, .85, .62], [.7, .66, .62], [1, 1, 1], [.45, .35, .25]];
function emitDust(p, surf, vx, vz) { const i = dhead++ % DN, c = DUSTC[surf]; dpos[i * 3] = p.x; dpos[i * 3 + 1] = p.y - 0.2; dpos[i * 3 + 2] = p.z; dvel[i * 3] = vx * 0.3 + (Math.random() - .5) * 2; dvel[i * 3 + 1] = 1 + Math.random() * 2; dvel[i * 3 + 2] = vz * 0.3 + (Math.random() - .5) * 2; dlife[i] = 1.2; dcol.set(c, i * 3); }
function updateDust(dt) { for (let i = 0; i < DN; i++) { if (dlife[i] <= 0) { dpos[i * 3 + 1] = -1e4; continue; } dlife[i] -= dt; for (let k = 0; k < 3; k++) dpos[i * 3 + k] += dvel[i * 3 + k] * dt; dvel[i * 3 + 1] -= 1.5 * dt; } dgeo.attributes.position.needsUpdate = dgeo.attributes.color.needsUpdate = true; }

function spawn(x, z, yaw = 0) { for (let k = 0; k < 200 && height(x, z) < WATER + 2; k++) { x += 37; z += 23; } veh.spawn(x, z, yaw); }
{ const t = nearTrack(0, 0), p = trackPoint(t, 0), q = trackPoint(t, 0.02); spawn(p[0], p[1], Math.atan2(q[0] - p[0], q[1] - p[1])); }

// ---------- input ----------
const key = {}; addEventListener('keydown', e => { key[e.code] = 1; if (e.code === 'KeyR') reset(); if (e.code === 'KeyF') toggleDbg(); });
addEventListener('keyup', e => key[e.code] = 0);
const touch = { steer: 0, pitch: 0, gas: 0, brk: 0, bst: 0, drf: 0 }; let tilt = false, tiltSteer = 0;
if (isTouch) { $('joy').style.display = 'block'; ['bGas', 'bBrk', 'bBst', 'bDrf'].forEach(b => $(b).style.display = 'flex'); }
const joy = $('joy'), knob = $('knob'); let joyId = null;
joy.addEventListener('touchstart', e => { joyId = e.changedTouches[0].identifier; joyMove(e); e.preventDefault(); }, { passive: false });
joy.addEventListener('touchmove', e => { joyMove(e); e.preventDefault(); }, { passive: false });
const joyEnd = e => { for (const t of e.changedTouches) if (t.identifier === joyId) { joyId = null; touch.steer = touch.pitch = 0; knob.style.transform = ''; } };
joy.addEventListener('touchend', joyEnd); joy.addEventListener('touchcancel', joyEnd);
function joyMove(e) { for (const t of e.changedTouches) if (t.identifier === joyId) { const r = joy.getBoundingClientRect(); const cl = v => Math.max(-1, Math.min(1, v));
  const dx = cl((t.clientX - r.left - r.width / 2) / 55), dy = cl((t.clientY - r.top - r.height / 2) / 55); touch.steer = dx; touch.pitch = -dy; knob.style.transform = `translate(${dx * 45}px,${dy * 45}px)`; } }
[['bGas', 'gas'], ['bBrk', 'brk'], ['bBst', 'bst'], ['bDrf', 'drf']].forEach(([id, k]) => {
  const el = $(id); el.addEventListener('touchstart', e => { touch[k] = 1; e.preventDefault(); }, { passive: false });
  el.addEventListener('touchend', () => touch[k] = 0); el.addEventListener('touchcancel', () => touch[k] = 0);
});
$('tTilt').onclick = async () => {
  if (!tilt && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) { try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return; } catch (e) { return; } }
  tilt = !tilt; $('tTilt').textContent = 'Tilt: ' + (tilt ? 'on' : 'off');
};
addEventListener('deviceorientation', e => { const a = (screen.orientation && screen.orientation.angle) || window.orientation || 0; const v = a === 90 ? e.beta : a === -90 || a === 270 ? -e.beta : e.gamma; tiltSteer = Math.max(-1, Math.min(1, (v || 0) / 25)); });
$('tReset').onclick = () => reset(); $('tDbg').onclick = () => toggleDbg();
let dbg = QS.has('dbg'); function toggleDbg() { dbg = !dbg; if (!dbg) $('dbg').textContent = ''; }
function reset() { const n = [0, 0, 0]; let x = veh.p.x, z = veh.p.z, yaw = veh.yaw; for (let k = 0; k < 40; k++) { normal(x, z, n); if (n[1] > 0.9 && height(x, z) > WATER + 2) break; x += 6 * Math.sin(yaw + k); z += 6 * Math.cos(yaw + k); } spawn(x, z, yaw); }
const inp = { gas: 0, brake: 0, steer: 0, hand: 0, boost: 0, pitch: 0 };
const auto = QS.get('auto'); // test driver: ?auto=1 drives itself (headless tests / screenshots)
let simT = 0;
function readInput() {
  let s = (key.KeyA || key.ArrowLeft ? 1 : 0) - (key.KeyD || key.ArrowRight ? 1 : 0) - touch.steer - (tilt ? tiltSteer : 0);
  inp.steer = Math.max(-1, Math.min(1, s));
  inp.gas = key.KeyW || key.ArrowUp || touch.gas ? 1 : 0; inp.brake = key.KeyS || key.ArrowDown || touch.brk ? 1 : 0;
  inp.hand = key.Space || touch.drf ? 1 : 0; inp.boost = key.ShiftLeft || key.ShiftRight || touch.bst ? 1 : 0;
  inp.pitch = Math.max(-1, Math.min(1, (key.KeyE ? 1 : 0) - (key.KeyQ ? 1 : 0) + touch.pitch));
  if (auto) { inp.gas = 1; inp.steer = 0.35 * Math.sin(simT * 0.5) + (auto === 'drift' && simT % 6 > 4.5 ? 0.9 : 0); inp.hand = auto === 'drift' && simT % 6 > 4.5 ? 1 : 0; inp.boost = auto === 'boost' ? 1 : 0; }
}

// ---------- race: gates on nearest loop (kept from v1) ----------
const NCP = 8, gateGeo = new THREE.BoxGeometry(1, 7, 1).translate(0, 3.5, 0), barGeo = new THREE.BoxGeometry(22, 1.2, 1).translate(0, 7.3, 0);
const gates = new THREE.Group(); scene.add(gates); const gateMat = toon(0xffd23c), startMat = toon(0xffffff), doneMat = toon(0x55dd66);
let curTrack = null, race = null; const best = JSON.parse(localStorage.getItem('sinerally_best') || '{}');
function cpPos(t, i) { const th = i / NCP * Math.PI * 2, p = trackPoint(t, th), q = trackPoint(t, th + 0.01); return { x: p[0], z: p[1], ang: Math.atan2(q[0] - p[0], q[1] - p[1]) }; }
function buildGates(t) {
  gates.clear(); curTrack = t;
  for (let i = 0; i < NCP; i++) { const c = cpPos(t, i), y = ground(c.x, c.z), g = new THREE.Group(), m = i ? gateMat : startMat;
    [-11, 11].forEach(o => { const p = new THREE.Mesh(gateGeo, m); p.position.x = o; g.add(p); }); g.add(new THREE.Mesh(barGeo, m));
    g.position.set(c.x, y, c.z); g.rotation.y = c.ang + Math.PI / 2; g.userData = c; gates.add(g); }
}
let msgT = 0; function msg(s) { $('msg').textContent = s; msgT = 2; }
const fmt = t => (t / 60 | 0) + ':' + (t % 60).toFixed(2).padStart(5, '0');
function raceUpdate(dt) {
  const px = veh.p.x, pz = veh.p.z, t = nearTrack(px, pz); if (t !== curTrack) { buildGates(t); race = null; }
  const near = i => { const c = gates.children[i].userData; return Math.hypot(px - c.x, pz - c.z) < 13; };
  if (!race) { if (near(0)) { race = { t: 0, next: 1 }; msg('GO!'); gates.children.forEach((g, i) => i && g.children.forEach(m => m.material = gateMat)); } }
  else { race.t += dt;
    if (race.next < NCP && near(race.next)) { gates.children[race.next].children.forEach(m => m.material = doneMat); race.next++; msg('CP ' + (race.next - 1) + '/' + (NCP - 1)); }
    else if (race.next === NCP && near(0)) { const b = best[t.id]; if (!b || race.t < b) { best[t.id] = race.t; localStorage.setItem('sinerally_best', JSON.stringify(best)); msg('NEW BEST ' + fmt(race.t)); } else msg('LAP ' + fmt(race.t));
      race = { t: 0, next: 1 }; gates.children.forEach((g, i) => i && g.children.forEach(m => m.material = gateMat)); }
    if (Math.hypot(px - t.cx, pz - t.cz) > t.R * 2.2) { race = null; msg('Race abandoned'); } }
  const b = best[t.id];
  $('race').innerHTML = race ? `LAP ${fmt(race.t)} · CP ${race.next - 1}/${NCP - 1}` + (b ? `<br>best ${fmt(b)}` : '') : (b ? `Track ${t.id} best ${fmt(b)}` : 'Free roam – white gate starts a race');
}

// ---------- minimap (roads + loop + start gate) ----------
const mc = $('mini').getContext('2d'); let mapPaths = [], mapAt = [1e9, 1e9];
function minimap(yaw) {
  const Wd = 130, sc = 0.08, px = veh.p.x, pz = veh.p.z; mc.clearRect(0, 0, Wd, Wd); mc.save(); mc.beginPath(); mc.arc(Wd / 2, Wd / 2, Wd / 2, 0, 7); mc.clip(); mc.translate(Wd / 2, Wd / 2); mc.rotate(yaw + Math.PI);
  if (Math.hypot(px - mapAt[0], pz - mapAt[1]) > 150) { mapAt = [px, pz]; mapPaths = W.pathsNear(px, pz, 1100); }
  for (const e of mapPaths) {
    mc.strokeStyle = e.type === W.HWY ? '#555c' : e.type === W.LOOP ? '#e0a050' : '#c8955acc'; mc.lineWidth = e.type === W.TRAIL ? 1.5 : 3; mc.beginPath();
    const n = e.loop ? 64 : 16; for (let i = 0; i <= n; i++) { W.pathPoint(e, i / n, false); const x = (W.PP.x - px) * sc, y = (W.PP.z - pz) * sc; i ? mc.lineTo(-x, y) : mc.moveTo(-x, y); } mc.stroke();
  }
  const t = curTrack, s = cpPos(t, 0); let sx = -(s.x - px) * sc, sz = (s.z - pz) * sc; const d = Math.hypot(sx, sz); if (d > 55) { sx *= 55 / d; sz *= 55 / d; }
  mc.fillStyle = '#fff'; mc.beginPath(); mc.arc(sx, sz, 5, 0, 7); mc.fill(); mc.restore();
  mc.fillStyle = '#ff4a3d'; mc.beginPath(); mc.moveTo(Wd / 2, Wd / 2 - 7); mc.lineTo(Wd / 2 - 5, Wd / 2 + 5); mc.lineTo(Wd / 2 + 5, Wd / 2 + 5); mc.fill();
  mc.fillStyle = '#fff'; mc.font = 'bold 10px sans-serif'; mc.fillText(Math.round(Math.hypot(s.x - px, s.z - pz)) + 'm', Wd / 2 - 14, Wd - 8);
}
// ---------- HUD gauge: tacho arc + speed + gear + boost ----------
const gc = $('gauge').getContext('2d');
function gauge() {
  const Wd = 200, Hd = 120, cx = 100, cy = 104, R = 86; gc.clearRect(0, 0, Wd, Hd);
  const a0 = Math.PI * 0.95, a1 = Math.PI * 2.05, rf = Math.min(1, veh.rpm / 8000), red = CFG.redline / 8000;
  gc.lineCap = 'round'; gc.lineWidth = 12; gc.strokeStyle = '#0005'; gc.beginPath(); gc.arc(cx, cy, R, a0, a1); gc.stroke();
  gc.strokeStyle = '#f44b'; gc.beginPath(); gc.arc(cx, cy, R, a0 + (a1 - a0) * red, a1); gc.stroke();
  gc.strokeStyle = veh.rpm > CFG.up ? '#ff5a3c' : '#fff'; gc.lineWidth = 8; gc.beginPath(); gc.arc(cx, cy, R, a0, a0 + (a1 - a0) * rf); gc.stroke();
  gc.fillStyle = '#fff'; gc.textAlign = 'center'; gc.shadowColor = '#0008'; gc.shadowOffsetY = 2;
  gc.font = '900 40px system-ui,sans-serif'; gc.fillText(Math.abs(Math.round(veh.v.dot(veh.fwd) * 3.6)), cx, cy - 22);
  gc.font = '800 12px system-ui,sans-serif'; gc.fillText('KM/H', cx, cy - 6);
  gc.font = '900 22px system-ui,sans-serif'; gc.fillText(veh.gear < 0 ? 'R' : veh.gear, cx, cy + 14);
  gc.font = '700 10px system-ui,sans-serif'; gc.fillText((veh.rpm / 1000).toFixed(1) + 'k rpm', cx - 62, cy + 14);
  gc.fillText(W.SURF_NAMES[veh.wheels[2].surf], cx + 62, cy + 14); gc.shadowOffsetY = 0;
  gc.fillStyle = '#0006'; gc.fillRect(cx - 40, cy - 78, 80, 6); gc.fillStyle = '#f90'; gc.fillRect(cx - 40, cy - 78, 80 * veh.boost, 6);
}

// ---------- loop ----------
const camPos = new THREE.Vector3(veh.p.x, veh.p.y + 6, veh.p.z - 12), look = new THREE.Vector3(), camDir = new THREE.Vector3(0, 0, 1);
const tv = new THREE.Vector3(), tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion(), AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
let last = performance.now(), acc = 0, fpsT = 0, frames = 0, fps = 0, shake = 0, airShow = 0, tFrame = 0;
const STEP = 1 / 120, stats = { fps: 0, physMs: 0, frameMs: 0, minFps: 999 };
function updateWorld(force) {
  const px = veh.p.x, pz = veh.p.z;
  far.update(px, pz, force);
  near.update(px, pz, force);
  farU.uNear.value.set((near.gi0 + NEAR_N / 2) * NEAR_S, (near.gj0 + NEAR_N / 2) * NEAR_S, NEAR_N * NEAR_S / 2);
  roads.update(px, pz, force); updateScenery(px, pz);
}
updateWorld(true);
function frame(now) {
  requestAnimationFrame(frame); const t0 = performance.now(); let dt = Math.min(0.1, (now - last) / 1000); last = now; tFrame += dt;
  readInput();
  acc += dt; let steps = 0; const tp = performance.now();
  while (acc >= STEP && steps < 12) { simT += STEP; veh.step(STEP, inp); veh.collideCircles(colliders); acc -= STEP; steps++; }
  if (steps === 12) acc = 0;
  stats.physMs = performance.now() - tp;
  for (const e of veh.events.splice(0)) {
    if (e[0] === 'land') { shake = Math.min(1, e[1] / 14); if (e[2] > 1) msg('AIR ' + e[2].toFixed(1) + 's'); }
    else if (e[0] === 'crash') shake = Math.min(1, e[1] / 12); else if (e[0] === 'recover') msg('Recovered');
  }
  updateWorld(false); raceUpdate(dt);
  // car visuals
  car.position.copy(veh.p); car.quaternion.copy(veh.q);
  for (let i = 0; i < 4; i++) { const wh = veh.wheels[i], m = wheelMeshes[i]; m.position.copy(wh.pos);
    tq.setFromAxisAngle(AY, wh.steer); tq2.setFromAxisAngle(AX, wh.rot); m.quaternion.copy(veh.q).multiply(tq).multiply(tq2);
    if (wh.contact && [1, 3, 5, 6].includes(wh.surf) && (Math.abs(wh.sl) > 0.15 || Math.abs(wh.sa) > 0.12 || veh.v.lengthSq() > 200) && Math.random() < 0.5) emitDust(wh.pos, wh.surf, veh.v.x, veh.v.z); }
  updateDust(dt);
  flame.visible = !!inp.boost && veh.boost > 0; flame.scale.setScalar(0.8 + Math.random() * 0.5);
  // chase camera: follows velocity direction when moving fast, heading otherwise
  const sp = veh.v.length(); veh.basis();
  tv.set(veh.fwd.x, 0, veh.fwd.z); if (veh.v.dot(veh.fwd) < -3) tv.negate(); tv.normalize();
  if (sp > 6 && veh.grounded) { const vv = new THREE.Vector3(veh.v.x, 0, veh.v.z).normalize(); tv.lerp(vv, 0.35).normalize(); }
  camDir.lerp(tv, Math.min(1, (veh.grounded ? 4 : 1.2) * dt)).normalize();
  const back = 8.5 + sp * 0.05, cx = veh.p.x - camDir.x * back, cz = veh.p.z - camDir.z * back;
  const tgt = tv.set(cx, Math.max(veh.p.y + 3.2, ground(cx, cz) + 2), cz);
  camPos.lerp(tgt, Math.min(1, 6 * dt)); camera.position.copy(camPos);
  if (shake > 0) { camera.position.x += (Math.random() - .5) * shake * 0.8; camera.position.y += (Math.random() - .5) * shake * 0.8; shake = Math.max(0, shake - dt * 2.5); }
  look.set(veh.p.x, veh.p.y + 1.3, veh.p.z); camera.lookAt(look);
  camera.fov += ((flame.visible ? 80 : 64 + Math.min(10, sp * 0.15)) - camera.fov) * Math.min(1, 3 * dt); camera.updateProjectionMatrix();
  sky.position.copy(camera.position); water.position.set(camera.position.x, WATER, camera.position.z);
  grass.update(tFrame, veh.p.x + camDir.x * 18, veh.p.z + camDir.z * 18, scene.fog);
  const air = veh.air; airShow = air > 0.5 ? air : 0;
  $('speed').textContent = (airShow ? 'AIR ' + airShow.toFixed(1) + 's' : '') ;
  if (msgT > 0 && (msgT -= dt) <= 0) $('msg').textContent = '';
  minimap(Math.atan2(camDir.x, camDir.z)); gauge(); renderer.render(scene, camera);
  stats.frameMs = performance.now() - t0;
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = stats.fps = frames / fpsT; if (tFrame > 3) stats.minFps = Math.min(stats.minFps, fps); frames = 0; fpsT = 0;
    if (dbg) { sample(veh.p.x, veh.p.z, SO); $('dbg').textContent = `${fps.toFixed(0)} fps  cpu ${stats.frameMs.toFixed(1)}ms (phys ${stats.physMs.toFixed(1)})\ncalls ${renderer.info.render.calls} tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k\n${veh.p.x.toFixed(0)},${veh.p.z.toFixed(0)} y${veh.p.y.toFixed(0)} ${W.REG_NAMES[SO.dom]}\ngear ${veh.gear} rpm ${veh.rpm.toFixed(0)} wheels ${veh.grounded}`; } }
}
requestAnimationFrame(frame);
window.__st = { veh, stats, inp, W, get x() { return veh.p.x; }, get z() { return veh.p.z; }, get y() { return veh.p.y; }, teleport(x, z, yaw = 0) { spawn(x, z, yaw); updateWorld(true); } };
