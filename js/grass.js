// GPU-instanced grass. Each instance = a clump of 3 tapered blades. Instances live on a toroidal tile around the
// player; height, density and tint are read in the vertex shader from the terrain ring-buffer texture (texelFetch),
// interpolated with exactly the same triangle split as the terrain mesh, so blades sit on the ground.
import * as THREE from 'three';

export function createGrass(scene, grid, { count = 12000, tile = 72 } = {}) {
  // blade clump geometry (local units: 1 = blade height)
  const pos = [], uvs = [];
  for (let b = 0; b < 3; b++) {
    const a = b * 2.1 + 0.3, ox = Math.cos(a * 1.7) * 0.18, oz = Math.sin(a * 1.3) * 0.18, dx = Math.cos(a) * 0.09, dz = Math.sin(a) * 0.09, lean = 0.12 * (b - 1);
    pos.push(ox - dx, 0, oz - dz, ox + dx, 0, oz + dz, ox + lean, 1 - 0.15 * b, oz + lean * 0.5);
    uvs.push(0, 0, 1, 0, 0.5, 1);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const off = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) { off[i * 4] = Math.random() * tile; off[i * 4 + 1] = Math.random() * tile; off[i * 4 + 2] = Math.random(); off[i * 4 + 3] = Math.random() * 6.283; }
  geo.setAttribute('off', new THREE.InstancedBufferAttribute(off, 4));
  geo.instanceCount = count;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTex: { value: grid.tex }, uN: { value: grid.n }, uStep: { value: grid.step }, uTile: { value: tile }, uCenter: { value: new THREE.Vector2() },
      uTime: { value: 0 }, uFogColor: { value: new THREE.Color() }, uFogNear: { value: 100 }, uFogFar: { value: 500 }, uSun: { value: new THREE.Vector3(0.5, 1, 0.3).normalize() },
    },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      precision highp float; precision highp sampler2D;
      attribute vec4 off; uniform sampler2D uTex; uniform float uN, uStep, uTile, uTime; uniform vec2 uCenter;
      varying vec3 vCol; varying float vFog, vY;
      vec4 tx(float gi, float gj) { return texelFetch(uTex, ivec2(int(mod(gi, uN)), int(mod(gj, uN))), 0); }
      void main() {
        vec2 w = off.xy + uTile * floor((uCenter - off.xy) / uTile + 0.5);   // toroidal wrap around centre
        float dist = length(w - uCenter);
        vec2 g = w / uStep, gi = floor(g), f = g - gi;
        vec4 a = tx(gi.x, gi.y), b = tx(gi.x, gi.y + 1.0), c = tx(gi.x + 1.0, gi.y + 1.0), d = tx(gi.x + 1.0, gi.y);
        vec4 s = (f.x + f.y < 1.0) ? a + (d - a) * f.x + (b - a) * f.y : c + (b - c) * (1.0 - f.x) + (d - c) * (1.0 - f.y);
        float dens = s.y;
        float fade = smoothstep(uTile * 0.5, uTile * 0.32, dist);
        float keep = step(off.z, dens) * fade;
        float hgt = (0.45 + 0.55 * off.z) * (0.55 + 0.6 * dens) * keep;
        float cs = cos(off.w), sn = sin(off.w);
        vec3 p = position; p.xz = mat2(cs, -sn, sn, cs) * p.xz * (0.9 + 0.6 * off.z);
        float sway = sin(uTime * 1.9 + w.x * 0.21 + w.y * 0.17) * 0.18 + sin(uTime * 3.3 + w.x * 0.6) * 0.06;
        p.x += sway * p.y * p.y; p.z += sway * 0.5 * p.y * p.y;
        p *= hgt; p.y *= 1.0;
        vec3 wp = vec3(w.x + p.x, s.x + p.y - 0.05, w.y + p.z);
        vec2 gn = floor(g + 0.5); vec4 cn = tx(gn.x, gn.y); float pc = cn.z; vec3 base = vec3(floor(pc / 256.0), mod(pc, 256.0), cn.w) / 255.0; // packed colour: nearest texel (no interpolation)
        vY = position.y;
        vCol = base * (0.62 + 0.55 * position.y) * (0.92 + 0.16 * off.z);
        vec4 mv = modelViewMatrix * vec4(wp, 1.0);
        vFog = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      precision mediump float; uniform vec3 uFogColor; uniform float uFogNear, uFogFar; varying vec3 vCol; varying float vFog, vY;
      void main() {
        vec3 c = vCol;
        float fg = smoothstep(uFogNear, uFogFar, vFog);
        gl_FragColor = vec4(mix(c, uFogColor, fg), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; scene.add(mesh);
  return {
    mesh,
    update(t, cx, cz, fog) { const u = mat.uniforms; u.uTime.value = t; u.uCenter.value.set(cx, cz); u.uTex.value = grid.tex; if (fog) { u.uFogColor.value.copy(fog.color); u.uFogNear.value = fog.near; u.uFogFar.value = fog.far; } },
  };
}
