// Pure-math world: every height, surface, river, road and tree is a function of (x,z).
// No heightmaps are stored; only small per-road height profiles are cached (derived from the same functions).
export const WATER = 0, WORLD = 10000; // drivable +-10 km (20x20 km)
const S = Math.sin, C = Math.cos, A = Math.abs, mn = Math.min, mx = Math.max, fl = Math.floor;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smin = (a, b, k) => { const h = mx(k - A(a - b), 0) / k; return mn(a, b) - h * h * k * 0.25; };
function hash(i, j, k = 0) { const s = S(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return s - fl(s); }
export function hash2(i, j, k) { return hash(i, j, k); }

// ---------------- surfaces ----------------
export const SURF = { ASPHALT: 0, DIRT: 1, GRASS: 2, SAND: 3, ROCK: 4, SNOW: 5, MUD: 6 };
export const SURF_NAMES = ['asphalt', 'dirt', 'grass', 'sand', 'rock', 'snow', 'mud'];
// mu = peak friction, roll = rolling resistance coeff, bs = tyre stiffness scale (loose = lower)
export const SURF_PARAMS = [
  { mu: 1.10, roll: 0.012, bs: 1.00 }, // asphalt
  { mu: 0.84, roll: 0.028, bs: 0.75 }, // dirt
  { mu: 0.74, roll: 0.045, bs: 0.70 }, // grass
  { mu: 0.68, roll: 0.10, bs: 0.55 },  // sand
  { mu: 0.92, roll: 0.020, bs: 0.90 }, // rock
  { mu: 0.50, roll: 0.050, bs: 0.60 }, // snow
  { mu: 0.52, roll: 0.15, bs: 0.50 },  // mud
];

// ---------------- macro regions (low-frequency selector field) ----------------
export const REG = { HILLS: 0, PLAINS: 1, DUNES: 2, CANYON: 3, ALPINE: 4 };
export const REG_NAMES = ['hills', 'plains', 'dunes', 'canyon', 'alpine'];
const RC = [[0, 0], [0.62, 0.05], [-0.05, 0.62], [-0.62, -0.05], [0.05, -0.62]];
const RW = new Float32Array(5);
function selector(x, z) { // fills RW with normalised region weights
  const wx = x + 420 * S(z * 0.00071 + 1.3), wz = z + 420 * C(x * 0.00067 - 0.6);
  const a = 0.78 * S(wx * 0.00093 + 0.9) * C(wz * 0.00081 - 1.1) + 0.32 * S((wx - wz) * 0.00057 + 2.0);
  const b = 0.78 * C(wx * 0.00077 - 2.2) * S(wz * 0.00098 + 0.3) + 0.32 * C((wx + wz) * 0.00061 - 0.7);
  let s = 0;
  for (let i = 0; i < 5; i++) { const dx = a - RC[i][0], dz = b - RC[i][1], e = Math.exp(-16 * (dx * dx + dz * dz)); RW[i] = e; s += e; }
  let s2 = 0;
  for (let i = 0; i < 5; i++) { let w = RW[i] / s; w = w < 0.02 ? 0 : w; RW[i] = w; s2 += w; }
  for (let i = 0; i < 5; i++) RW[i] /= s2;
}
export function regionWeights(x, z, out) { selector(x, z); for (let i = 0; i < 5; i++) out[i] = RW[i]; return out; }

function base(x, z) { return 20 + 25 * S(x * 0.00023 + 1) * C(z * 0.00019 - 0.4) + 12 * S((x + z) * 0.00041); }
// rolling hills: 5 octaves of rotated sine*cosine with domain warp + escarpment cliffs
const OCT = [];
for (let i = 0; i < 5; i++) { const a = i * 1.27 + 0.3; OCT.push([34 / Math.pow(2.05, i), 0.0019 * Math.pow(2.03, i), C(a), S(a), i * 2.1]); }
function hHills(x, z, wx, wz, b) {
  let h = b;
  for (let i = 0; i < 5; i++) { const o = OCT[i], u = (wx * o[2] + wz * o[3]) * o[1], v = (wz * o[2] - wx * o[3]) * o[1]; h += o[0] * S(u + o[4]) * C(v * 0.83 - o[4]); }
  // escarpments: step function of a low-frequency field -> cliffs
  const e = S(x * 0.0011 + 0.3 * S(z * 0.003)) * C(z * 0.0009 + 1.7);
  h += 16 * sst(-0.04, 0.04, e) * sst(0.1, 0.5, S(x * 0.0005 - z * 0.0004 + 2));
  return h;
}
function hPlains(x, z, wx, wz, b) {
  let h = 4 + 0.25 * b + 4 * S(wx * 0.0031) * C(wz * 0.0027) + 1.5 * S(wx * 0.011 + 1) * C(wz * 0.009) + 0.6 * S(wx * 0.031) * C(wz * 0.027);
  // lakes: blobs where a slow sine product peaks
  h -= 16 * sst(0.42, 0.8, S(x * 0.0013 + 0.7) * C(z * 0.0011 + 2.1) + 0.3 * S(wx * 0.004));
  return h;
}
function hDunes(x, z, wx, wz, b) { // ridged anisotropic sine dunes
  const th = 0.6 + 0.35 * S(x * 0.0003 + z * 0.0002), ct = C(th), stt = S(th);
  const u = x * ct + z * stt, v = -x * stt + z * ct;
  const r = 1 - A(S(u * 0.021 + 1.6 * S(v * 0.0061) + 0.7 * S(v * 0.013 + 1)));
  const r2 = 1 - A(S(u * 0.05 + v * 0.021 + 2 * S(v * 0.011 + 3)));
  return 5 + 0.3 * b + 15 * Math.pow(r, 1.7) * (0.65 + 0.35 * S(v * 0.0041)) + 4 * r2 * r2 + 0.4 * S(u * 0.4) * S(v * 0.05);
}
function hCanyon(x, z, wx, wz, b) { // terraced mesas + canyon channels
  const n = 0.6 * b + 38 + 46 * S(wx * 0.0021) * C(wz * 0.0018) + 20 * S(wx * 0.0051 + 1) * C(wz * 0.0047) + 7 * S(wx * 0.013) * C(wz * 0.011 + 2);
  const step = 13, t = n / step, f = t - fl(t);
  let h = (fl(t) + sst(0.62, 0.92, f)) * step + f * 2.5; // flat tops, steep risers
  const c = A(S(wx * 0.0029 + 2.2 * S(wz * 0.0016 + 0.4)) + 0.25 * S(wz * 0.007));
  const floor = 6 + 0.15 * b + 2 * S(wx * 0.01) * C(wz * 0.012);
  h = floor + (h - floor) * sst(0.07, 0.24, c);
  return h;
}
function hAlpine(x, z, wx, wz, b) { // ridged multi-octave mountains
  let h = b + 22, a = 120, f = 0.0021;
  for (let i = 0; i < 4; i++) {
    const ang = i * 1.9 + 0.4, ca = C(ang), sa = S(ang), u = (wx * ca + wz * sa) * f, v = (wz * ca - wx * sa) * f;
    const r = 1 - A(S(u + i) * C(v * 0.9 - i));
    h += a * r * r; a *= 0.46; f *= 2.13;
  }
  return h - 30;
}
const HF = [hHills, hPlains, hDunes, hCanyon, hAlpine];
const BANK = [0.35, 0.13, 0.28, 2.2, 0.8]; // river bank slope per region (canyon = gorge)

// ---------------- rivers: distance to meandering sine curves, carved into the height ----------------
const RIV = { d: 1e9, hw: 0, p: 0 };
function river(x, z) {
  let best = 1e9, hw = 10, pres = 0;
  { // east-west family
    const k = Math.round(z / 3100), zc = k * 3100 + 400 * (hash(k, 1) - 0.5) + 220 * S(x * 0.0013 + k * 1.7) + 80 * S(x * 0.0037 + k),
      d1 = 220 * 0.0013 * C(x * 0.0013 + k * 1.7) + 80 * 0.0037 * C(x * 0.0037 + k), d = A(z - zc) / Math.sqrt(1 + d1 * d1);
    const p = sst(-0.35, 0.1, S(x * 0.00042 + k * 2.3));
    if (p > 0) { best = d; pres = p; hw = 9 + 5 * S(x * 0.002 + k); }
  }
  { // north-south family
    const k = Math.round((x - 1500) / 4300), xc = 1500 + k * 4300 + 500 * (hash(k, 2) - 0.5) + 260 * S(z * 0.0011 + k * 2.9) + 90 * S(z * 0.0033 - k),
      d1 = 260 * 0.0011 * C(z * 0.0011 + k * 2.9) + 90 * 0.0033 * C(z * 0.0033 - k), d = A(x - xc) / Math.sqrt(1 + d1 * d1);
    const p = sst(-0.35, 0.1, S(z * 0.00039 + k * 1.1 + 1));
    if (p > 0 && d + 1000 * (1 - p) < best + 1000 * (1 - pres)) { best = d; pres = p; hw = 8 + 5 * S(z * 0.0023 - k); }
  }
  RIV.d = best; RIV.hw = hw; RIV.p = pres;
}

// natural terrain (regions + rivers), no roads. Fills NAT.
const NAT = { h: 0, dom: 0, riv: 1e9 };
function natural(x, z) {
  selector(x, z);
  const wx = x + 60 * S(z * 0.0023 + 0.7), wz = z + 60 * C(x * 0.0019 - 0.3), b = base(x, z);
  let h = 0, bank = 0, dom = 0, dw = 0;
  for (let i = 0; i < 5; i++) { const w = RW[i]; if (w > 0) { h += w * HF[i](x, z, wx, wz, b); bank += w * BANK[i]; if (w > dw) { dw = w; dom = i; } } }
  river(x, z);
  let rd = 1e9;
  if (RIV.p > 0) {
    rd = RIV.d - RIV.hw;
    const bed = -2.6 + (1 - RIV.p) * 400; // channel bottom below water level; fades out where the river "ends"
    const q = rd < 0 ? rd / RIV.hw + 1 : 1;
    const hr = bed + mx(0, rd) * bank + 0.8 * q * q;
    h = smin(h, hr, 5);
  }
  NAT.h = h; NAT.dom = dom; NAT.riv = rd;
  return h;
}
export function naturalHeight(x, z) { return natural(x, z); }

// ---------------- road network: graph on a coarse jittered grid, sine-curve edges ----------------
const RG = 1400, HWY = 1, TRAIL = 2, LOOP = 3;
const nodes = new Map();
function nodeAt(i, j) {
  const key = (i + 5000) * 10000 + (j + 5000); let n = nodes.get(key);
  if (!n) {
    const x = (i + 0.5 + 0.55 * (hash(i, j, 11) - 0.5)) * RG, z = (j + 0.5 + 0.55 * (hash(i, j, 12) - 0.5)) * RG;
    let h = 0; for (const [ox, oz] of [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40]]) h += natural(x + ox, z + oz) / 5;
    n = { i, j, x, z, h: mx(h, WATER + 2.5) }; nodes.set(key, n);
  }
  return n;
}
const pmod = (a, m) => ((a % m) + m) % m;
function edgeType(i, j, dir) { // dir 0: (i,j)->(i+1,j) ; 1: (i,j)->(i,j+1)
  if (dir === 0) { if (pmod(j, 4) === 1) return HWY; return hash(i, j, 21) < 0.55 ? TRAIL : 0; }
  if (pmod(i, 5) === 2) return HWY; return hash(i, j, 22) < 0.5 ? TRAIL : 0;
}
const edges = new Map();
function edgeAt(i, j, dir) {
  const key = ((i + 5000) * 10000 + (j + 5000)) * 2 + dir; if (edges.has(key)) return edges.get(key);
  const type = edgeType(i, j, dir); let e = null;
  if (type) {
    const a = nodeAt(i, j), b = dir ? nodeAt(i, j + 1) : nodeAt(i + 1, j);
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), k = 1 + fl(hash(i, j, 23 + dir) * (type === HWY ? 2 : 3));
    const amp = (hash(i, j, 25 + dir) - 0.5) * 2 * (type === HWY ? 0.18 : 0.26) * L / (Math.PI * k);
    e = { id: key, type, a, b, ax: a.x, az: a.z, L, dx: dx / L, dz: dz / L, nx: -dz / L, nz: dx / L, amp, k, hw: type === HWY ? 6 : 3.6, loop: false };
    buildProfile(e);
  }
  edges.set(key, e); return e;
}
// path point: t in [0,1]; fills PP {x,z,tx,tz,y,curv,bridge}
const PP = { x: 0, z: 0, tx: 0, tz: 0, y: 0, curv: 0, bridge: 0 };
function pathPoint(e, t, wantY = true) {
  if (e.loop) {
    const th = t * 6.283185307, r = trackR(e.trk, th), dr = trackDR(e.trk, th);
    PP.x = e.trk.cx + r * C(th); PP.z = e.trk.cz + r * S(th);
    const tx = dr * C(th) - r * S(th), tz = dr * S(th) + r * C(th), l = Math.hypot(tx, tz); PP.tx = tx / l; PP.tz = tz / l; PP.curv = 0;
  } else {
    const w = Math.PI * e.k, o = e.amp * S(w * t), o1 = e.amp * w * C(w * t) / e.L, o2 = -e.amp * w * w * S(w * t) / (e.L * e.L);
    PP.x = e.ax + e.dx * t * e.L + e.nx * o; PP.z = e.az + e.dz * t * e.L + e.nz * o;
    const l = Math.sqrt(1 + o1 * o1); PP.tx = (e.dx + e.nx * o1) / l; PP.tz = (e.dz + e.nz * o1) / l; PP.curv = o2 / (l * l * l);
  }
  if (wantY) { const f = clamp(t, 0, 1) * e.M, i = mn(e.M - 1, fl(f)), u = f - i; PP.y = e.prof[i] + (e.prof[i + 1] - e.prof[i]) * u; PP.bridge = e.br[u < 0.5 ? i : i + 1]; }
  return PP;
}
function buildProfile(e) {
  const len = e.loop ? 6.283 * e.trk.R * 1.1 : e.L, M = e.M = mx(8, Math.ceil(len / 30)), ds = len / M;
  const p = new Float32Array(M + 1), wet = new Uint8Array(M + 1);
  for (let i = 0; i <= M; i++) { pathPoint(e, i / M, false); p[i] = natural(PP.x, PP.z); wet[i] = p[i] < WATER + 0.6 ? 1 : 0; }
  if (!e.loop) { p[0] = e.a.h; p[M] = e.b.h; }
  const q = new Float32Array(M + 1);
  for (let pass = 0; pass < 14; pass++) {
    for (let i = 0; i <= M; i++) {
      if (e.loop) { const a = p[(i + M - 1) % M], c = p[(i + 1) % M]; q[i] = 0.25 * a + 0.5 * p[i] + 0.25 * c; }
      else q[i] = i === 0 || i === M ? p[i] : 0.25 * p[i - 1] + 0.5 * p[i] + 0.25 * p[i + 1];
    }
    p.set(q); if (e.loop) p[M] = p[0];
  }
  for (let i = 0; i <= M; i++) p[i] = mx(p[i], WATER + 2.5);
  const g = (e.type === HWY ? 0.09 : 0.15) * ds;
  for (let i = 1; i <= M; i++) p[i] = clamp(p[i], p[i - 1] - g, p[i - 1] + g);
  for (let i = M - 1; i >= 0; i--) p[i] = clamp(p[i], p[i + 1] - g, p[i + 1] + g);
  // bridges over short wet runs (rivers); long wet runs become causeways
  const br = new Uint8Array(M + 1);
  if (!e.loop) for (let i = 0; i <= M;) {
    if (!wet[i]) { i++; continue; } let j = i; while (j <= M && wet[j]) j++;
    if ((j - i) * ds < 340) { const s = mx(0, i - 1), t2 = mn(M, j); for (let k = s; k <= t2; k++) { br[k] = 1; p[k] = mx(p[k], WATER + 4.5); } }
    i = j;
  }
  e.prof = p; e.br = br; e.ds = ds; e.len = len;
}
// ---------------- race loops: one closed polar sine curve per 3 km lattice cell (kept from v1) ----------------
const CELL = 3000;
export function trackOf(ci, cj) {
  const cx = (ci + 0.5) * CELL + (hash(ci, cj, 1) - 0.5) * 900, cz = (cj + 0.5) * CELL + (hash(ci, cj, 2) - 0.5) * 900;
  return { id: ci + ',' + cj, cx, cz, R: 280 + hash(ci, cj, 3) * 300, p1: hash(ci, cj, 4) * 6.28, p2: hash(ci, cj, 5) * 6.28, k: 2 + fl(hash(ci, cj, 6) * 3) };
}
export function trackR(t, th) { return t.R * (1 + 0.22 * S(t.k * th + t.p1) + 0.12 * S((t.k + 1) * th + t.p2)); }
function trackDR(t, th) { return t.R * (0.22 * t.k * C(t.k * th + t.p1) + 0.12 * (t.k + 1) * C((t.k + 1) * th + t.p2)); }
export function trackPoint(t, th) { const r = trackR(t, th); return [t.cx + r * C(th), t.cz + r * S(th)]; }
const tcache = new Map();
export function nearTrack(x, z) {
  const ci = fl(x / CELL), cj = fl(z / CELL), key = ci * 100000 + cj;
  let t = tcache.get(key);
  if (!t) { t = trackOf(ci, cj); t.path = { id: 'L' + t.id, loop: true, trk: t, type: LOOP, hw: 8, k: 0, amp: 0 }; buildProfile(t.path); tcache.set(key, t); }
  return t;
}
// candidate edges per road cell (cached)
const cellCache = new Map(), REACH = 90;
function cellEdges(ci, cj) {
  const key = (ci + 5000) * 10000 + (cj + 5000); let l = cellCache.get(key); if (l) return l;
  l = []; const x0 = ci * RG - REACH, x1 = (ci + 1) * RG + REACH, z0 = cj * RG - REACH, z1 = (cj + 1) * RG + REACH;
  for (let i = ci - 2; i <= ci + 1; i++) for (let j = cj - 2; j <= cj + 1; j++) for (let d = 0; d < 2; d++) {
    const e = edgeAt(i, j, d); if (!e) continue;
    const pad = A(e.amp) + 10;
    if (mx(e.a.x, e.b.x) + pad < x0 || mn(e.a.x, e.b.x) - pad > x1 || mx(e.a.z, e.b.z) + pad < z0 || mn(e.a.z, e.b.z) - pad > z1) continue;
    l.push(e);
  }
  cellCache.set(key, l); return l;
}
// distance from (x,z) to path e -> fills PD {d (unsigned), s (signed lateral, + = normal side), t}
const PD = { d: 1e9, s: 0, t: 0 };
function pathDist(e, x, z) {
  if (e.loop) {
    const T = e.trk, dx = x - T.cx, dz = z - T.cz, th = Math.atan2(dz, dx), r = trackR(T, th), rr = Math.hypot(dx, dz);
    PD.s = rr - r; PD.d = A(PD.s); PD.t = (th < 0 ? th + 6.283185307 : th) / 6.283185307; return true;
  }
  const rx = x - e.ax, rz = z - e.az, proj = rx * e.dx + rz * e.dz, perp = rx * e.nx + rz * e.nz;
  if (proj < -REACH || proj > e.L + REACH || A(perp) > A(e.amp) + REACH) return false;
  const w = Math.PI * e.k; let t = clamp(proj / e.L, 0, 1);
  let o = e.amp * S(w * t); const o1 = e.amp * w * C(w * t) / e.L;
  t = clamp(t + (perp - o) * o1 / (1 + o1 * o1) / e.L, 0, 1); // one Newton step along the tangent
  o = e.amp * S(w * t); const ax = proj - t * e.L, ap = perp - o;
  PD.d = Math.hypot(ax, ap); PD.s = ap; PD.t = t; return true;
}
// ---------------- full sample: natural terrain + road beds/banking + bridge decks ----------------
export const OUT = { h: 0, hn: 0, deck: -1e9, road: 0, rtype: 0, dom: 0, riv: 1e9, rd: 1e9 };
const CORE = 1.5;
export function sample(x, z, o = OUT) {
  const hn = natural(x, z); let h = hn, deck = -1e9, rw = 0, rtype = 0, rdmin = 1e9, bestW = 0, bestH = hn;
  const list = cellEdges(fl(x / RG), fl(z / RG));
  const tk = nearTrack(x, z);
  for (let n = -1; n < list.length; n++) {
    const e = n < 0 ? tk.path : list[n];
    if (!pathDist(e, x, z)) continue;
    const d = PD.d; if (d > e.hw + CORE + 62) continue;
    pathPoint(e, PD.t);
    const bank = e.loop ? 0 : clamp(-PP.curv * 45, -0.07, 0.07);
    const hb = PP.y + clamp(PD.s, -e.hw, e.hw) * bank;
    const core = e.hw + CORE, blend = mn(60, 8 + 1.3 * A(hn - hb));
    if (d > core + blend) continue;
    let w = d < core ? 1 : sst(core + blend, core, d);
    if (d < e.hw + 0.8 && d - e.hw < rdmin) { rdmin = d - e.hw; rtype = e.type; }
    if (d < e.hw + 0.5) rw = 1; else rw = mx(rw, sst(e.hw + 2.5, e.hw + 0.5, d));
    if (PP.bridge) { if (d < e.hw + 1.2) deck = mx(deck, hb); w = 0; }
    if (w > bestW) { bestW = w; bestH = hb; }
  }
  if (bestW > 0) h = hn + (bestH - hn) * bestW;
  const edge = mx(A(x), A(z)) - WORLD; if (edge > 0) h += edge * 0.6; // world rim
  o.h = h; o.hn = hn; o.deck = deck; o.road = rw; o.rtype = rtype; o.dom = NAT.dom; o.riv = NAT.riv; o.rd = rdmin;
  return o;
}
export function height(x, z) { return sample(x, z).h; }
export function ground(x, z) { sample(x, z); return OUT.deck > OUT.h ? OUT.deck : OUT.h; } // physics: includes bridge decks
export function trackW(x, z) { // 1 on race loop, smooth falloff (kept for scenery/compat)
  const t = nearTrack(x, z); pathDist(t.path, x, z); return PD.d < 9 ? 1 : PD.d > 22 ? 0 : sst(22, 9, PD.d);
}
export function normal(x, z, out, fn = height) {
  const e = 1.0, hx = fn(x + e, z) - fn(x - e, z), hz = fn(x, z + e) - fn(x, z - e);
  const l = Math.hypot(hx, 2 * e, hz); out[0] = -hx / l; out[1] = 2 * e / l; out[2] = -hz / l; return out;
}
// surface type from a sample (+ slope)
export function snowLine(x, z) { return 135 + 25 * S(x * 0.002) * C(z * 0.0023); }
export function patch(x, z) { return 0.5 + 0.5 * S(x * 0.013 + 1.7 * C(z * 0.011)) * C(z * 0.017 + 0.8 * S(x * 0.007)); }
export function surfaceOf(x, z, o, ny) {
  if (o.road > 0.5) return o.rtype === HWY ? SURF.ASPHALT : SURF.DIRT;
  const h = o.h;
  if (o.riv < 7 && h < 2.5) return SURF.MUD;
  if (h < WATER + 0.3) return SURF.MUD;
  switch (o.dom) {
    case REG.DUNES: return ny < 0.55 ? SURF.ROCK : SURF.SAND;
    case REG.CANYON: return ny > 0.9 ? SURF.DIRT : SURF.ROCK;
    case REG.ALPINE: return h > snowLine(x, z) && ny > 0.55 ? SURF.SNOW : ny < 0.78 ? SURF.ROCK : SURF.GRASS;
    default:
      if (h < 1.6) return SURF.SAND;
      if (ny < 0.72) return SURF.ROCK;
      return patch(x, z) > 0.82 ? SURF.DIRT : SURF.GRASS;
  }
}
export function surfaceAt(x, z, ny) { sample(x, z); return surfaceOf(x, z, OUT, ny); }
// grass density 0..1 (drives instanced grass)
export function grassDensity(x, z, o, ny, surf) {
  if (surf !== SURF.GRASS) return surf === SURF.DIRT && o.road < 0.5 ? 0.25 : 0;
  return (0.35 + 0.65 * sst(0.25, 0.7, patch(x * 1.7 + 300, z * 1.7))) * sst(0.74, 0.86, ny) * (1 - o.road) * (o.dom === REG.ALPINE ? 0.7 : 1);
}
// biome colour
export function colourOf(x, z, o, ny, surf, out) {
  const v = 0.5 + 0.5 * S(x * 0.004 + C(z * 0.003) * 2) * C(z * 0.0045), p = patch(x, z);
  let r, g, b;
  switch (surf) {
    case SURF.ASPHALT: r = .28; g = .28; b = .3; break;
    case SURF.DIRT: if (o.dom === REG.CANYON) { r = .78; g = .5; b = .33; } else { r = .66; g = .5; b = .34; } break;
    case SURF.GRASS:
      if (o.dom === REG.PLAINS) { r = .48 + .2 * v; g = .72 + .06 * v; b = .26; }
      else if (o.dom === REG.ALPINE) { r = .3 + .1 * v; g = .58 + .08 * v; b = .3; }
      else { r = .33 + .22 * v; g = .66 + .1 * v; b = .22 + .05 * p; } break;
    case SURF.SAND: if (o.dom === REG.DUNES) { r = .95; g = .78 + .05 * v; b = .5; } else { r = .93; g = .85; b = .6; } break;
    case SURF.ROCK:
      if (o.dom === REG.CANYON || o.dom === REG.DUNES) { const s = 0.5 + 0.5 * S(o.h * 0.9 + S(x * 0.01) * 1.5); r = .7 + .15 * s; g = .38 + .1 * s; b = .26 + .05 * s; }
      else { r = .55 + .06 * v; g = .53 + .05 * v; b = .58; } break;
    case SURF.SNOW: r = .95; g = .97; b = 1; break;
    default: r = .42; g = .33; b = .24; // mud
  }
  out[0] = r; out[1] = g; out[2] = b; return out;
}
export function colour(x, z, y, ny, out) { sample(x, z); return colourOf(x, z, OUT, ny, surfaceOf(x, z, OUT, ny), out); }
// paths (road edges + race loops) within radius r of (x,z) — used by road meshes / minimap
export function pathsNear(x, z, r) {
  const res = new Set(), c0 = fl((x - r) / RG), c1 = fl((x + r) / RG), d0 = fl((z - r) / RG), d1 = fl((z + r) / RG);
  for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) for (const e of cellEdges(i, j)) res.add(e);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) res.add(nearTrack(x + i * CELL, z + j * CELL).path);
  return [...res];
}
export { pathPoint, PP, HWY, TRAIL, LOOP };
