// Road meshes: ribbons generated along the same math paths used by world.height() (road graph edges + race loops).
// Asphalt highways get edge lines + dashed centre line, dirt trails/loops get wheel ruts; bridges get a deck slab, rails and pillars.
import * as THREE from 'three';
import { pathsNear, pathPoint, PP, HWY, LOOP, WATER } from './world.js';

function canvasTex(draw) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d'); draw(g);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function noise(g, base, amp, n = 900) { g.fillStyle = base; g.fillRect(0, 0, 64, 256); for (let i = 0; i < n; i++) { const v = (Math.random() - 0.5) * amp; g.fillStyle = `rgba(${v > 0 ? '255,255,255' : '0,0,0'},${Math.abs(v)})`; g.fillRect(Math.random() * 64, Math.random() * 256, 2, 2); } }
export function createRoads(scene, ramp) {
  const asphaltTex = canvasTex(g => {
    noise(g, '#45464b', 0.25);
    g.fillStyle = '#eee'; g.fillRect(3, 0, 3, 256); g.fillRect(58, 0, 3, 256);
    g.fillStyle = '#f2c230'; g.fillRect(30.5, 0, 3, 140);
  });
  const dirtTex = canvasTex(g => {
    noise(g, '#9a7652', 0.3, 1400);
    const gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, 'rgba(110,140,60,0.9)'); gr.addColorStop(0.1, 'rgba(110,140,60,0)'); gr.addColorStop(0.9, 'rgba(110,140,60,0)'); gr.addColorStop(1, 'rgba(110,140,60,0.9)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 256);
    g.fillStyle = 'rgba(70,50,32,0.55)'; g.fillRect(14, 0, 7, 256); g.fillRect(43, 0, 7, 256); // ruts
    g.fillStyle = 'rgba(120,150,70,0.35)'; g.fillRect(29, 0, 6, 256); // centre grass strip
  });
  const mk = map => new THREE.MeshToonMaterial({ map, gradientMap: ramp, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const matA = mk(asphaltTex), matD = mk(dirtTex), matB = new THREE.MeshToonMaterial({ color: 0x9a9aa2, gradientMap: ramp });
  const meshes = [new THREE.Mesh(new THREE.BufferGeometry(), matA), new THREE.Mesh(new THREE.BufferGeometry(), matD), new THREE.Mesh(new THREE.BufferGeometry(), matB)];
  meshes.forEach(m => { m.frustumCulled = false; scene.add(m); });
  let lx = 1e9, lz = 1e9; const RAD = 650, STEP = 5;
  function build(px, pz) {
    const buf = [{ p: [], uv: [], idx: [] }, { p: [], uv: [], idx: [] }, { p: [], n: [], idx: [] }];
    const paths = pathsNear(px, pz, RAD);
    for (const e of paths) {
      const len = e.len, n = Math.ceil(len / STEP), b = buf[e.type === HWY ? 0 : 1], hw = e.hw;
      let run = -1, vlen = 0, prev = null;
      for (let i = 0; i <= n; i++) {
        const t = i / n; pathPoint(e, t);
        const dx = PP.x - px, dz = PP.z - pz, inside = dx * dx + dz * dz < RAD * RAD;
        if (!inside) { run = -1; prev = null; continue; }
        const bank = e.loop ? 0 : Math.max(-0.07, Math.min(0.07, -PP.curv * 45));
        const nx = -PP.tz, nz = PP.tx, y = PP.y + 0.12; // normal (left)
        const base = b.p.length / 3;
        b.p.push(PP.x + nx * hw, y + hw * bank, PP.z + nz * hw, PP.x - nx * hw, y - hw * bank, PP.z - nz * hw);
        vlen += prev ? Math.hypot(PP.x - prev[0], PP.z - prev[1]) : 0; prev = [PP.x, PP.z];
        b.uv.push(0, vlen / 14, 1, vlen / 14);
        if (run >= 0) b.idx.push(base - 2, base, base - 1, base - 1, base, base + 1);
        run = base;
        if (PP.bridge) addBridge(buf[2], e, t, len / n, hw, nx, nz, PP.x, PP.y, PP.z, i);
      }
    }
    for (let k = 0; k < 2; k++) {
      const g = new THREE.BufferGeometry(), b = buf[k];
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      const nrm = new Float32Array(b.p.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1; g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setIndex(b.idx); meshes[k].geometry.dispose(); meshes[k].geometry = g;
    }
    const g = new THREE.BufferGeometry(), b = buf[2];
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3)); g.setIndex(b.idx); g.computeVertexNormals();
    meshes[2].geometry.dispose(); meshes[2].geometry = g;
  }
  // bridge pieces: slab under the deck, side rails, a pillar every ~25 m
  function box(b, cx, cy, cz, ax, az, hx, hy, hz) { // oriented box: (ax,az) = forward dir
    const lx = -az, lz = ax, base = b.p.length / 3;
    for (const sy of [-1, 1]) for (const sl of [-1, 1]) for (const sf of [-1, 1]) b.p.push(cx + lx * sl * hx + ax * sf * hz, cy + sy * hy, cz + lz * sl * hx + az * sf * hz);
    const F = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
    for (const f of F) b.idx.push(base + f[0], base + f[1], base + f[2], base + f[0], base + f[2], base + f[3]);
  }
  function addBridge(b, e, t, ds, hw, nx, nz, x, y, z, i) {
    const ax = nz, az = -nx; // forward = tangent
    box(b, x, y - 0.6, z, PP.tx, PP.tz, hw + 0.6, 0.55, ds * 0.5 + 0.05);
    box(b, x + nx * (hw + 0.4), y + 0.6, z + nz * (hw + 0.4), PP.tx, PP.tz, 0.15, 0.5, ds * 0.5 + 0.05);
    box(b, x - nx * (hw + 0.4), y + 0.6, z - nz * (hw + 0.4), PP.tx, PP.tz, 0.15, 0.5, ds * 0.5 + 0.05);
    if (i % 5 === 0) { const bot = WATER - 4, h = (y - 1.1 - bot) / 2; if (h > 0.5) box(b, x, bot + h, z, PP.tx, PP.tz, hw * 0.7, h, 0.8); }
  }
  return {
    meshes,
    update(px, pz, force) { if (!force && Math.hypot(px - lx, pz - lz) < 140) return; lx = px; lz = pz; build(px, pz); },
  };
}
