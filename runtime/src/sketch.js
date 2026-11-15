// "Illustrated" 3D materials: watercolor-washed Lambert with screen-space pencil
// hatching, inverted-hull ink outlines, and drawable ink tubes for lines.
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

export const INK = new THREE.Color('#3a352f');
export const lineMaterials = new Set(); // need resolution updates

const HATCH_GLSL = /* glsl */ `
float lp_hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float lp_noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = lp_hash(i), b = lp_hash(i+vec2(1,0)), c = lp_hash(i+vec2(0,1)), d = lp_hash(i+vec2(1,1));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float lp_hatch(vec2 p, float ang, float spacing){
  vec2 dir = vec2(cos(ang), sin(ang));
  float wob = lp_noise(p*0.05)*2.0;
  float d = abs(fract((dot(p, dir)+wob)/spacing) - 0.5) * spacing;
  return 1.0 - smoothstep(0.35, 1.15, d);
}
`;

// Lambert + watercolor wash + hatching in shadowed areas.
export function sketchMaterial({ color = '#f2b8a0', hatch = 1, opacity = 1, emissive = 0.22, side = THREE.FrontSide } = {}) {
  const c = new THREE.Color(color);
  const m = new THREE.MeshLambertMaterial({
    color: c,
    emissive: c.clone().multiplyScalar(emissive),
    transparent: opacity < 1,
    opacity,
    side,
  });
  m.userData.uniforms = {
    uHatch: { value: hatch },
    uInk: { value: INK.clone() },
    uHighlight: { value: 0 },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, m.userData.uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uHatch; uniform vec3 uInk; uniform float uHighlight;\n${HATCH_GLSL}`)
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        {
          vec2 sp = gl_FragCoord.xy;
          float baseL = max(dot(diffuseColor.rgb, vec3(0.299,0.587,0.114)), 0.02);
          float lit = dot(outgoingLight, vec3(0.299,0.587,0.114)) / baseL;
          float wash = (lp_noise(sp*0.012) - 0.5) * 0.08 + (lp_noise(sp*0.05)-0.5)*0.04;
          gl_FragColor.rgb *= 1.0 + wash;
          float h1 = lp_hatch(sp, 0.785, 6.0) * (1.0 - smoothstep(0.55, 0.85, lit));
          float h2 = lp_hatch(sp, -0.785, 6.0) * (1.0 - smoothstep(0.35, 0.6, lit));
          float h = max(h1, h2*0.85) * uHatch;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uInk*0.9 + gl_FragColor.rgb*0.2, h*0.32);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0,0.93,0.78), uHighlight*0.25);
        }`
      );
  };
  m.customProgramCacheKey = () => 'sketch';
  return m;
}

// Inverted hull outline for smooth shapes.
export function addHullOutline(mesh, thickness = 0.012, color = INK) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: thickness }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      uniform float uT;
      void main(){
        vec3 p = position + normalize(normal) * uT;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity;
      void main(){ gl_FragColor = vec4(uColor, uOpacity); }`,
    side: THREE.BackSide,
    transparent: true,
  });
  const hull = new THREE.Mesh(mesh.geometry, mat);
  hull.userData.isOutline = true;
  hull.raycast = () => {};
  mesh.add(hull);
  return hull;
}

// Fat ink edges for hard-surface shapes.
export function addEdges(mesh, { color = INK, width = 1.6, threshold = 30, opacity = 0.9 } = {}) {
  const eg = new THREE.EdgesGeometry(mesh.geometry, threshold);
  const g = new LineSegmentsGeometry().fromEdgesGeometry(eg);
  eg.dispose();
  const mat = new LineMaterial({ color: new THREE.Color(color), linewidth: width, transparent: true, opacity });
  lineMaterials.add(mat);
  const ls = new LineSegments2(g, mat);
  ls.raycast = () => {};
  ls.userData.isOutline = true;
  mesh.add(ls);
  return ls;
}

export function makeLineMaterial(opts) {
  const mat = new LineMaterial({ transparent: true, ...opts });
  lineMaterials.add(mat);
  return mat;
}

// Drawable ink line built as a thin tube. uv.x runs 0..1 along the path, so a
// uProgress uniform "draws" the stroke; uDash turns it into a dashed line.
export function inkTubeMaterial({ color = INK, color2 = null, opacity = 1, dash = 0, dashCount = 30, progress = 1, flow = 0 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uColor2: { value: new THREE.Color(color2 || color) },
      uOpacity: { value: opacity },
      uProgress: { value: progress },
      uDash: { value: dash },
      uDashCount: { value: dashCount },
      uTime: { value: 0 },
      uFlow: { value: flow },
      uTailFade: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uColor2; uniform float uTailFade; uniform float uOpacity, uProgress, uDash, uDashCount, uTime, uFlow;
      varying vec2 vUv;
      float h(float x){ return fract(sin(x*91.17)*43758.5); }
      void main(){
        if (vUv.x > uProgress) discard;
        float tip = smoothstep(uProgress, uProgress - 0.02, vUv.x);
        if (uDash > 0.5) {
          float d = fract(vUv.x * uDashCount - uTime * uFlow);
          if (d > 0.55) discard;
        }
        float grain = 0.85 + 0.15 * h(floor(vUv.x * 400.0));
        vec3 col = mix(uColor, uColor2, smoothstep(0.15, 0.85, vUv.x));
        gl_FragColor = vec4(col * grain, uOpacity * (0.6 + 0.4 * tip) * mix(1.0, smoothstep(1.0, 0.86, vUv.x) * smoothstep(0.0, 0.05, vUv.x), uTailFade));
      }`,
    transparent: true,
    depthWrite: true,
  });
}

export function inkTube(points, { radius = 0.006, segments, closed = false, jitter = 0, seed = 1, ...matOpts } = {}) {
  let pts = points;
  if (jitter > 0) {
    let s = seed;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
    const ph = [r() * 6, r() * 6, r() * 6];
    pts = points.map((p, i) => {
      const t = i * 0.35;
      return p.clone().add(new THREE.Vector3(Math.sin(t + ph[0]), Math.sin(t * 1.3 + ph[1]), Math.sin(t * 0.7 + ph[2])).multiplyScalar(jitter));
    });
  }
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
  const geo = new THREE.TubeGeometry(curve, segments ?? Math.max(8, pts.length * 2), radius, 5, closed);
  const mesh = new THREE.Mesh(geo, inkTubeMaterial(matOpts));
  mesh.raycast = () => {};
  return mesh;
}

// Sketchy arrow: shaft + cone head. setArrow() positions it.
export function makeArrow(color = INK, { radius = 0.008, head = 0.07, headR = 0.028 } = {}) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 6).translate(0, 0.5, 0), mat);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(headR, head, 10).translate(0, head / 2, 0), mat);
  g.add(shaft, tip);
  g.userData = { shaft, tip, head, mat };
  g.traverse((o) => (o.raycast = () => {}));
  return g;
}

const _up = new THREE.Vector3(0, 1, 0);
export function setArrow(arrow, origin, dir, length) {
  const { shaft, tip, head } = arrow.userData;
  arrow.position.copy(origin);
  const L = Math.max(length, 0.0001);
  const d = dir.clone().normalize();
  if (d.lengthSq() < 1e-6) d.set(0, 1, 0);
  arrow.quaternion.setFromUnitVectors(_up, d);
  const sh = Math.max(L - head, 0.001);
  shaft.scale.set(1, sh, 1);
  tip.position.y = sh;
  const s = Math.min(1, L / (head * 1.5));
  tip.scale.setScalar(s);
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      lineMaterials.delete(m);
      for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
      m.dispose();
    }
  });
}

// Fades every material in a tree (used for reveal / collapse).
export function setTreeOpacity(obj, a) {
  obj.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m.uniforms && m.uniforms.uOpacity) {
        m.uniforms.uOpacity.value = (m.userData.baseOpacity ??= m.uniforms.uOpacity.value) * a;
      } else {
        m.userData.wasTransparent ??= m.transparent;
        m.userData.baseOpacity ??= m.opacity;
        const want = a < 0.999 || m.userData.wasTransparent;
        if (m.transparent !== want) {
          m.transparent = want;
          m.needsUpdate = true;
        }
        m.opacity = m.userData.baseOpacity * a;
      }
    }
  });
}
