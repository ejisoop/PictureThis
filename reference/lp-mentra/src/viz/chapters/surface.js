// Chapter III — Surfaces & partial derivatives. The printed contour map's
// level curves rise to their heights while the surface grows out of the page.
// f(x, y) = A sin(kx) cos(ky) on [−π, π]², displaced on the GPU.
import * as THREE from 'three';
import gsap from 'gsap';
import { PALETTE, FONTS, sketchPath, sketchArrow, handText, serif, wrapParagraph } from '../paper.js';
import { caption, noteScribble, pageToPx, PX_PER_UNIT } from '../pages.js';
import { sketchMaterial, addHullOutline, addEdges, inkTube, makeArrow, setArrow, makeLineMaterial, disposeTree, INK } from '../sketch.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { makeNote } from '../ui.js';

const C = { x: 1.05, z: -0.47 };
const HALF = 0.72; // world half-size of the domain
const S = HALF / Math.PI; // world units per math unit
const HS = 0.2; // world height per unit of f
const BASE_H = 0.4; // risen height of the z = 0 plane
const LEVELS = [-0.8, -0.55, -0.3, -0.08, 0.08, 0.3, 0.55, 0.8];

const f = (x, y, A, k) => A * Math.sin(k * x) * Math.cos(k * y);
const fx = (x, y, A, k) => A * k * Math.cos(k * x) * Math.cos(k * y);
const fy = (x, y, A, k) => -A * k * Math.sin(k * x) * Math.sin(k * y);

// marching squares → flat list of segments [x0,y0,x1,y1,...] in math coords
function contours(A, k, level, n = 90) {
  const out = [];
  const L = -Math.PI, step = (2 * Math.PI) / n;
  const val = (i, j) => f(L + i * step, L + j * step, A, k) - level;
  const lerp = (a, b) => a / (a - b);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v0 = val(i, j), v1 = val(i + 1, j), v2 = val(i + 1, j + 1), v3 = val(i, j + 1);
      const x0 = L + i * step, y0 = L + j * step;
      const e = [];
      if (v0 > 0 !== v1 > 0) e.push([x0 + lerp(v0, v1) * step, y0]);
      if (v1 > 0 !== v2 > 0) e.push([x0 + step, y0 + lerp(v1, v2) * step]);
      if (v2 > 0 !== v3 > 0) e.push([x0 + step - lerp(v2, v3) * step, y0 + step]);
      if (v3 > 0 !== v0 > 0) e.push([x0, y0 + step - lerp(v3, v0) * step]);
      if (e.length >= 2) out.push(e[0][0], e[0][1], e[1][0], e[1][1]);
      if (e.length === 4) out.push(e[2][0], e[2][1], e[3][0], e[3][1]);
    }
  }
  return out;
}

const ramp = (t) => {
  // t in [-1,1]: lavender → blue → sage → peach
  const stops = [[-1, '#b9a8d8'], [-0.35, '#a7c0d8'], [0.25, '#b5cca8'], [1, '#f2b49a']];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (t <= b) return new THREE.Color(ca).lerp(new THREE.Color(cb), (t - a) / (b - a));
  }
  return new THREE.Color(stops[3][1]);
};

export const surfaceChapter = {
  id: 'surface',
  seed: 77,
  tabTitle: 'Surfaces & calculus',
  panelTitle: 'Fig. 12.4 — live',
  diag: { x0: 0.15, z0: -1.27, w: 1.82, h: 1.66 },

  drawLeft(ctx, pw) {
    pw.header('Chapter 12 · Multivariable Calculus', '448', 'left');
    pw.title('12.3', 'Surfaces and Partial Derivatives', 'Functions of two variables');
    pw.para('A function of two variables, z = f(x, y), assigns a height to every point of the plane. Its graph is a surface in space; a contour map records the same surface as level curves f(x, y) = c drawn on the flat page.', { dropCap: true });
    pw.eq(['f', { up: '(' }, 'x', { up: ', ' }, 'y', { up: ') = ' }, 'A', { up: ' sin(' }, 'kx', { up: ') cos(' }, 'ky', { up: ')' }], '12.6');
    pw.para('Holding y fixed and differentiating with respect to x gives the partial derivative ∂f/∂x, the slope of the surface in the x-direction. Together the partial derivatives form the gradient:');
    pw.eq([{ up: '∇' }, 'f', { up: ' = ( ' }, { frac: [[{ up: '∂' }, 'f'], [{ up: '∂' }, 'x']] }, { up: ' , ' }, { frac: [[{ up: '∂' }, 'f'], [{ up: '∂' }, 'y']] }, { up: ' )' }], '12.7');
    const y7 = pw.lastEqY;
    pw.para('The gradient points in the direction of steepest ascent and is always perpendicular to the level curves. Near a point (a, b) the surface is closely approximated by its tangent plane:');
    pw.eq(['z', { up: ' = ' }, 'f', { up: ' + ' }, 'f', { sub: ['x'] }, { up: '(' }, 'x', { up: ' − ' }, 'a', { up: ') + ' }, 'f', { sub: ['y'] }, { up: '(' }, 'y', { up: ' − ' }, 'b', { up: ')' }], '12.8', 44);
    pw.para('Where ∇f = 0 the tangent plane is horizontal. These critical points are local maxima, local minima, or saddle points.');
    handText(ctx, '∇f ⟂ level curves!', 1010, y7 + 8, 40, PALETTE.graphite, { rotate: -0.05 });
    noteScribble(ctx, 1004, y7 + 22, 260, 7);
    handText(ctx, 'hill climbing = follow ∇f', 210, pw.y + 46, 36, PALETTE.sepia, { rotate: -0.02, alpha: 0.85 });
  },

  drawRight(ctx, pw) {
    pw.header('Partial derivatives', '449', 'right');
    const [x, y] = pageToPx(0.2, 0.55);
    caption(ctx, 'Fig. 12.4', 'Contour map of f(x, y) = sin x cos y on [−π, π]². Shaded regions are where f > 0.', x, y, 1.66 * PX_PER_UNIT);
    serif(ctx, 37, { color: PALETTE.ink });
    const [x2, y2] = pageToPx(0.2, 0.86);
    wrapParagraph(ctx, 'Closely spaced level curves mean a steep surface. At the centre of each family of closed curves sits a peak or a valley; where two families meet in an X, the surface forms a saddle.', x2, y2, 1.66 * PX_PER_UNIT, 53, { indent: 44 });
    const [bx, by] = pageToPx(0.2, 1.2);
    ctx.save();
    ctx.font = `600 30px ${FONTS.serif}`;
    ctx.fillStyle = PALETTE.sepia;
    ctx.fillText('Exercise 12.3.2', bx, by);
    ctx.font = `italic 400 32px ${FONTS.serif}`;
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText('Find and classify every critical point of f in the square.', bx + 240, by);
    ctx.restore();
  },

  drawDiagram(ctx, mode, P, ppu) {
    const ghost = mode === 'ghost', color = mode === 'color';
    const M = (mx, my) => P(C.x + mx * S, C.z - my * S);
    // shading
    if (!ghost) {
      const n = 60, st = (2 * Math.PI) / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const v = f(-Math.PI + (i + 0.5) * st, -Math.PI + (j + 0.5) * st, 1, 1);
          const [a, b] = M(-Math.PI + i * st, -Math.PI + (j + 1) * st);
          const [c, d] = M(-Math.PI + (i + 1) * st, -Math.PI + j * st);
          if (color) {
            const col = ramp(v);
            ctx.fillStyle = `rgba(${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0},0.55)`;
            ctx.fillRect(a, b, c - a + 0.6, d - b + 0.6);
          } else if (v > 0) {
            ctx.fillStyle = `rgba(138,106,74,${0.05 + v * 0.07})`;
            ctx.fillRect(a, b, c - a + 0.6, d - b + 0.6);
          }
        }
    }
    // level curves
    LEVELS.forEach((lv, li) => {
      const seg = contours(1, 1, lv, 70);
      ctx.save();
      ctx.strokeStyle = ghost ? 'rgba(90,86,80,0.16)' : color ? (lv > 0 ? PALETTE.coralDeep : PALETTE.lavenderDeep) : PALETTE.graphite;
      ctx.lineWidth = ghost ? 1.5 : 2.4;
      ctx.lineCap = 'round';
      if (lv < 0 && !color) ctx.setLineDash([9, 7]);
      ctx.globalAlpha = ghost ? 1 : 0.9;
      ctx.beginPath();
      for (let i = 0; i < seg.length; i += 4) {
        ctx.moveTo(...M(seg[i], seg[i + 1]));
        ctx.lineTo(...M(seg[i + 2], seg[i + 3]));
      }
      ctx.stroke();
      ctx.restore();
      void li;
    });
    // axes + frame
    const ink = ghost ? 'rgba(90,86,80,0.22)' : PALETTE.ink;
    sketchPath(ctx, [M(-Math.PI, -Math.PI), M(Math.PI, -Math.PI), M(Math.PI, Math.PI), M(-Math.PI, Math.PI), M(-Math.PI, -Math.PI)], { color: ghost ? 'rgba(90,86,80,0.18)' : 'rgba(47,43,38,0.5)', width: 1.8, seed: 2, passes: 1 });
    sketchArrow(ctx, ...M(-Math.PI - 0.15, 0), ...M(Math.PI + 0.4, 0), { color: ink, width: 2.6, seed: 3 });
    sketchArrow(ctx, ...M(0, -Math.PI - 0.15), ...M(0, Math.PI + 0.4), { color: ink, width: 2.6, seed: 4 });
    ctx.save();
    ctx.font = `italic 400 42px ${FONTS.serif}`;
    ctx.fillStyle = ink;
    ctx.fillText('x', ...M(Math.PI + 0.45, -0.3));
    ctx.fillText('y', ...M(0.18, Math.PI + 0.32));
    ctx.font = `400 28px ${FONTS.serif}`;
    for (const [v, t] of [[-Math.PI, '−π'], [Math.PI, 'π']]) {
      const [a, b] = M(v, -0.38);
      ctx.fillText(t, a - 12, b);
      const [c, d] = M(-0.5, v);
      ctx.fillText(t, c - 22, d + 10);
    }
    ctx.restore();
    if (!ghost) {
      const lab = (mx, my, t, c2) => {
        const [a, b] = M(mx, my);
        ctx.fillStyle = c2;
        ctx.beginPath();
        ctx.arc(a, b, 6, 0, Math.PI * 2);
        ctx.fill();
        handText(ctx, t, a + 12, b - 12, 34, c2);
      };
      lab(Math.PI / 2, 0, 'max', color ? PALETTE.coralDeep : PALETTE.ink);
      lab(-Math.PI / 2, 0, 'min', color ? PALETTE.lavenderDeep : PALETTE.ink);
      lab(0, Math.PI / 2, 'saddle', color ? PALETTE.sageDeep : PALETTE.ink);
    } else {
      handText(ctx, '↑ lifted from the page', ...M(-Math.PI + 0.1, -Math.PI - 0.55), 34, 'rgba(138,106,74,0.55)');
    }
  },

  createViz(env) {
    return new SurfaceViz(env);
  },
};

function surfaceMaterial(uniforms) {
  const m = sketchMaterial({ color: '#ffffff', hatch: 0.8, emissive: 0, side: THREE.DoubleSide, opacity: 0.94 });
  const prev = m.onBeforeCompile;
  const GLSL = /* glsl */ `
    uniform float uA, uK, uT, uLift;
    vec3 surfAt(vec2 xz){
      float mx = xz.x / ${S.toFixed(6)};
      float my = -xz.y / ${S.toFixed(6)};
      float f = uA * sin(uK*mx) * cos(uK*my);
      float fx = uA * uK * cos(uK*mx) * cos(uK*my);
      float fy = -uA * uK * sin(uK*mx) * sin(uK*my);
      return vec3(f, fx, fy);
    }`;
  m.onBeforeCompile = (shader) => {
    prev(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL}\nvarying float vF; varying vec2 vM;`)
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 sf = surfAt(position.xz);
         float hs = ${HS.toFixed(4)} * uT;
         vec3 objectNormal = normalize(vec3(-sf.y * hs / ${S.toFixed(6)}, 1.0, sf.z * hs / ${S.toFixed(6)}));
         vF = sf.x / max(uA, 0.001); vM = vec2(position.x, -position.z) / ${S.toFixed(6)};`
      )
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position.x, sf.x * hs + uLift, position.z);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vF; varying vec2 vM;\nvec3 lpRamp(float t){
        vec3 a = vec3(0.62,0.55,0.79), b = vec3(0.55,0.68,0.81), c = vec3(0.62,0.74,0.56), d = vec3(0.93,0.62,0.50);
        if (t < -0.35) return mix(a, b, (t+1.0)/0.65);
        if (t < 0.25) return mix(b, c, (t+0.35)/0.6);
        return mix(c, d, (t-0.25)/0.75);
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb = lpRamp(clamp(vF,-1.0,1.0));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance = diffuseColor.rgb * 0.16;`)
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
         {
           vec2 g = vM / (3.14159265/6.0);
           vec2 w = fwidth(g);
           vec2 d = abs(fract(g - 0.5) - 0.5) / max(w, 1e-4);
           float line = 1.0 - min(min(d.x, d.y), 1.0);
           gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.32,0.29,0.26), line * 0.45);
         }`
      );
  };
  m.customProgramCacheKey = () => 'lp-surface';
  return m;
}

class SurfaceViz {
  constructor(env) {
    this.env = env;
    this.group = new THREE.Group();
    this.group.visible = false;
    env.anchor.group.add(this.group);
    const prm = env.params || {};
    this.A = prm.A ?? 1;
    this.k = prm.k ?? 1;
    this.At = this.A;
    this.kt = this.k;
    this.pt = new THREE.Vector2(0.9, 0.7); // (a, b) in math coords
    this.showPlane = true;
    this.showGrad = true;
    this.climbing = false;
    this.spin = 0;
    this.spinTarget = 0;

    const asm = (this.asm = new THREE.Group());
    asm.position.copy(this.env.anchor.point(C.x, C.z, 0.004));
    this.group.add(asm);

    // surface
    this.u = { uA: { value: this.A }, uK: { value: this.k }, uT: { value: 0 }, uLift: { value: 0 } };
    const geo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, 110, 110).rotateX(-Math.PI / 2);
    this.surfMat = surfaceMaterial(this.u);
    this.surface = new THREE.Mesh(geo, this.surfMat);
    this.surface.castShadow = true;
    this.surface.frustumCulled = false;
    this.surface.raycast = () => {};
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uA, uK, uT, uLift;`)
        .replace(
          '#include <begin_vertex>',
          `float mx = position.x / ${S.toFixed(6)}; float my = -position.z / ${S.toFixed(6)};
           vec3 transformed = vec3(position.x, uA*sin(uK*mx)*cos(uK*my) * ${HS.toFixed(4)} * uT + uLift, position.z);`
        );
    };
    this.surface.customDepthMaterial = depth;
    asm.add(this.surface);

    // level curves (rise to their heights)
    this.levelGroups = LEVELS.map((lv) => {
      const g = new THREE.Group();
      g.userData.level = lv;
      const mat = makeLineMaterial({ color: new THREE.Color(lv > 0 ? PALETTE.coralDeep : PALETTE.lavenderDeep), linewidth: 1.7, opacity: 0 });
      const ls = new LineSegments2(new LineSegmentsGeometry(), mat);
      ls.raycast = () => {};
      ls.frustumCulled = false;
      g.add(ls);
      g.userData.ls = ls;
      asm.add(g);
      return g;
    });
    this._buildContours();

    // axes: a lifting frame + vertical f axis
    this.axes = new THREE.Group();
    const ax = (a, b, opts) => inkTube([a, b], { radius: 0.0055, segments: 8, progress: 1, ...opts });
    this.xAxis = ax(new THREE.Vector3(-HALF - 0.04, 0, 0), new THREE.Vector3(HALF + 0.1, 0, 0));
    this.yAxis = ax(new THREE.Vector3(0, 0, HALF + 0.04), new THREE.Vector3(0, 0, -HALF - 0.1));
    this.zAxis = ax(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.48, 0), { progress: 0 });
    this.axes.add(this.xAxis, this.yAxis, this.zAxis);
    const heads = [[new THREE.Vector3(HALF + 0.1, 0, 0), new THREE.Vector3(1, 0, 0)], [new THREE.Vector3(0, 0, -HALF - 0.1), new THREE.Vector3(0, 0, -1)]];
    for (const [p, d] of heads) {
      const a = makeArrow(INK, { head: 0.06, headR: 0.022 });
      setArrow(a, p.clone().sub(d.clone().multiplyScalar(0.06)), d, 0.06);
      this.axes.add(a);
    }
    this.zHead = makeArrow(INK, { head: 0.06, headR: 0.022 });
    this.axes.add(this.zHead);
    // dashed frame of the domain
    const fr = [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF], [-HALF, -HALF]].map(([a, b]) => new THREE.Vector3(a, 0, b));
    const frame = [];
    for (let i = 0; i < 4; i++) for (let t = 0; t <= 10; t++) frame.push(fr[i].clone().lerp(fr[i + 1], t / 10));
    this.frame = inkTube(frame, { radius: 0.003, dash: 1, dashCount: 60, color: PALETTE.graphite, opacity: 0.55, segments: 160 });
    this.axes.add(this.frame);
    asm.add(this.axes);

    // point, tangent plane, gradient arrows
    this.point = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 2), sketchMaterial({ color: PALETTE.yellow, hatch: 0.6 }));
    addHullOutline(this.point, 0.006);
    this.point.castShadow = true;
    this.grabber = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.point.add(this.grabber);
    asm.add(this.point);
    this.drop = inkTube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -1, 0)], { radius: 0.0025, dash: 1, dashCount: 14, color: PALETTE.graphite, opacity: 0.6 });
    asm.add(this.drop);

    this.plane = new THREE.Group();
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.46).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: PALETTE.peach, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, emissive: '#5a3a2a' }));
    addEdges(pm, { color: PALETTE.coralDeep, width: 1.6 });
    const pg = new THREE.GridHelper(0.46, 4, PALETTE.coralDeep, PALETTE.coralDeep);
    pg.material.transparent = true;
    pg.material.opacity = 0.35;
    this.plane.add(pm, pg);
    this.planeMesh = pm;
    asm.add(this.plane);

    this.gradArrow = makeArrow(PALETTE.coralDeep, { radius: 0.007, head: 0.06, headR: 0.022 });
    this.gradShadow = makeArrow(PALETTE.sepia, { radius: 0.005, head: 0.05, headR: 0.018 });
    asm.add(this.gradArrow, this.gradShadow);

    // gradient field printed onto the page beneath (instanced arrows)
    const NF = 11;
    this.fieldN = NF;
    this.field = new THREE.InstancedMesh(new THREE.ConeGeometry(0.014, 0.05, 6).rotateZ(-Math.PI / 2).translate(0.01, 0, 0), new THREE.MeshBasicMaterial({ color: PALETTE.sepia, transparent: true, opacity: 0 }), NF * NF);
    this.fieldShafts = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.004, 0.006).translate(-0.5, 0, 0), new THREE.MeshBasicMaterial({ color: PALETTE.sepia, transparent: true, opacity: 0 }), NF * NF);
    this.field.raycast = this.fieldShafts.raycast = () => {};
    asm.add(this.field, this.fieldShafts);

    this.notes = {
      max: makeNote('local max', { cls: 'sm coral' }),
      min: makeNote('local min', { cls: 'sm lavender' }),
      saddle: makeNote('saddle', { cls: 'sm sage' }),
      fx: makeNote('', { cls: 'sm', anchor: 'left' }),
      tan: makeNote('', { cls: 'eq', anchor: 'left' }),
      grad: makeNote('∇f', { cls: 'sm coral' }),
      xl: makeNote('<i>x</i>', { cls: 'sm' }),
      yl: makeNote('<i>y</i>', { cls: 'sm' }),
      zl: makeNote('<i>z = f(x, y)</i>', { cls: 'sm', anchor: 'left' }),
      hint: makeNote('drag the yellow point across the surface', { cls: 'xs', anchor: 'left' }),
    };
    for (const n of Object.values(this.notes)) asm.add(n);
    this.notes.tan.position.set(-HALF - 0.05, 1.16, -HALF);
    this.notes.fx.position.set(-HALF - 0.05, 0.92, -HALF);
    this.notes.hint.position.set(-HALF, 0.02, HALF + 0.12);

    this.interactives = [
      {
        object: this.grabber,
        kind: 'grab',
        onDown: () => {
          this.climbing = false;
          this.env.setClimbLabel?.(false);
          gsap.to(this.point.material.userData.uniforms.uHighlight, { value: 1, duration: 0.2 });
        },
        onDrag: (ray) => {
          const m = this._raySurface(ray);
          if (m) this.pt.copy(m);
        },
        onUp: () => gsap.to(this.point.material.userData.uniforms.uHighlight, { value: 0, duration: 0.3 }),
        onHover: (on) => gsap.to(this.point.material.userData.uniforms.uHighlight, { value: on ? 0.6 : 0, duration: 0.2 }),
      },
    ];

    this.controls = [
      { type: 'slider', key: 'A', label: 'amplitude <i>A</i>', min: 0.3, max: 1.6, step: 0.01, value: 1, format: (v) => v.toFixed(2), onChange: (v) => (this.At = v) },
      { type: 'slider', key: 'k', label: 'frequency <i>k</i>', min: 0.5, max: 1.5, step: 0.01, value: 1, format: (v) => v.toFixed(2), onChange: (v) => (this.kt = v) },
      { type: 'slider', key: 'spin', label: 'turn surface', min: -180, max: 180, step: 1, value: 0, format: (v) => `${Math.round(v)}°`, onChange: (v) => (this.spinTarget = (v * Math.PI) / 180) },
      {
        type: 'buttons',
        items: [
          { key: 'plane', icon: '▱', label: 'tangent plane', toggle: true, value: true, onChange: (v) => (this.showPlane = v) },
          { key: 'grad', icon: '↗', label: 'gradient ∇f', toggle: true, value: true, onChange: (v) => (this.showGrad = v) },
          { key: 'climb', icon: '⛰', label: 'climb ∇f', onClick: () => { this.climbing = !this.climbing; this.env.setClimbLabel?.(this.climbing); } },
          { icon: '↺', label: 'reset', onClick: () => this.reset() },
        ],
      },
    ];

    this.focus = { target: this.env.anchor.point(1.45, -0.2, 0.35), distance: 5.6, azimuth: -0.12, polar: 0.86 };
    this.state = { draw: 0, rise: 0, surf: 0, extras: 0 };
    this.planeVis = 1;
    this.gradVis = 1;
    this._applyState();
  }

  reset() {
    this.At = 1; this.kt = 1; this.spinTarget = 0;
    this.panel?.api.A.set(1); this.panel?.api.k.set(1); this.panel?.api.spin.set(0);
    this.climbing = false;
    this.env.setClimbLabel?.(false);
    gsap.to(this.pt, { x: 0.9, y: 0.7, duration: 0.8, ease: 'power3.inOut' });
  }

  _buildContours() {
    this._cKey = `${this.A.toFixed(3)}|${this.k.toFixed(3)}`;
    for (const g of this.levelGroups) {
      const seg = contours(this.A, this.k, g.userData.level * this.A, 72);
      const arr = new Float32Array((seg.length / 2) * 3);
      for (let i = 0, j = 0; i < seg.length; i += 2, j += 3) {
        arr[j] = seg[i] * S;
        arr[j + 1] = 0.002;
        arr[j + 2] = -seg[i + 1] * S;
      }
      const ls = g.userData.ls;
      ls.geometry.dispose();
      ls.geometry = new LineSegmentsGeometry();
      if (arr.length) ls.geometry.setPositions(arr);
      ls.visible = arr.length > 0;
    }
  }

  _height(mx, my) {
    return f(mx, my, this.A, this.k) * HS * this.u.uT.value + this.u.uLift.value;
  }

  // ray-march the analytic surface (in asm-local coords) → math coords
  _raySurface(ray) {
    const inv = new THREE.Matrix4().copy(this.asm.matrixWorld).invert();
    const r = ray.clone().applyMatrix4(inv);
    let prev = null;
    for (let t = 0; t < 12; t += 0.01) {
      const p = r.at(t, new THREE.Vector3());
      if (Math.abs(p.x) > HALF * 1.6 || Math.abs(p.z) > HALF * 1.6) { prev = null; continue; }
      const mx = p.x / S, my = -p.z / S;
      const d = p.y - this._height(mx, my);
      if (prev && prev.d > 0 && d <= 0) {
        const a = prev.d / (prev.d - d);
        const q = prev.p.clone().lerp(p, a);
        return new THREE.Vector2(THREE.MathUtils.clamp(q.x / S, -Math.PI, Math.PI), THREE.MathUtils.clamp(-q.z / S, -Math.PI, Math.PI));
      }
      prev = { p, d };
    }
    // fall back to the base plane
    const hit = r.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.u.uLift.value), new THREE.Vector3());
    if (!hit) return null;
    return new THREE.Vector2(THREE.MathUtils.clamp(hit.x / S, -Math.PI, Math.PI), THREE.MathUtils.clamp(-hit.z / S, -Math.PI, Math.PI));
  }

  _applyState() {
    const s = this.state;
    this.u.uT.value = s.surf;
    this.u.uLift.value = BASE_H * s.rise;
    const sm = this.surfMat;
    sm.opacity = 0.94 * Math.min(1, s.surf * 1.6);
    this.surface.visible = s.surf > 0.01;
    for (const g of this.levelGroups) {
      g.position.y = g.userData.level * this.A * HS * s.surf + BASE_H * s.rise;
      g.userData.ls.material.opacity = Math.min(1, s.draw * 1.5) * 0.95;
    }
    this.axes.position.y = BASE_H * s.rise;
    this.xAxis.material.uniforms.uProgress.value = s.draw;
    this.yAxis.material.uniforms.uProgress.value = s.draw;
    this.frame.material.uniforms.uProgress.value = s.draw;
    this.zAxis.material.uniforms.uProgress.value = s.surf;
    this.zHead.visible = s.surf > 0.9;
    setArrow(this.zHead, new THREE.Vector3(0, 0.42, 0), new THREE.Vector3(0, 1, 0), 0.06);
    this.axes.children.forEach((c) => c.userData.mat && (c.userData.mat.opacity = s.draw));
    const e = s.extras;
    this.point.visible = this.drop.visible = e > 0.01;
    this.point.scale.setScalar(Math.max(0.001, e));
    this.plane.visible = e * this.planeVis > 0.01;
    this.plane.scale.setScalar(Math.max(0.001, e * this.planeVis));
    this.gradArrow.visible = this.gradShadow.visible = e * this.gradVis > 0.02;
    this.field.material.opacity = this.fieldShafts.material.opacity = 0.7 * e * this.gradVis;
    this.notes.xl.position.set(HALF + 0.16, this.axes.position.y, 0);
    this.notes.yl.position.set(0, this.axes.position.y, -HALF - 0.16);
    this.notes.zl.position.set(0.04, this.axes.position.y + 0.5, 0);
  }

  enter(tl, t0) {
    const s = this.state;
    tl.add(() => (this.group.visible = true), t0);
    tl.to(s, { draw: 1, duration: 0.9, ease: 'power1.inOut', onUpdate: () => this._applyState() }, t0);
    tl.to(s, { rise: 1, duration: 1.1, ease: 'power2.inOut', onUpdate: () => this._applyState() }, t0 + 0.8);
    tl.to(s, { surf: 1, duration: 1.6, ease: 'elastic.out(1, 0.75)', onUpdate: () => this._applyState() }, t0 + 1.3);
    tl.to(s, { extras: 1, duration: 0.7, ease: 'back.out(2)', onUpdate: () => this._applyState() }, t0 + 2.3);
    tl.add(() => {
      const n = this.notes;
      [n.xl, n.yl, n.zl].forEach((x, i) => x.reveal(i * 0.1, 0.4));
      [n.max, n.min, n.saddle].forEach((x, i) => x.reveal(0.3 + i * 0.15, 0.5));
      n.grad.reveal(0.6);
      n.tan.reveal(0.8, 1.0);
      n.fx.reveal(1.1, 0.9);
      n.hint.reveal(1.6);
    }, t0 + 2.3);
    return t0 + 2.6;
  }

  exit(tl, t0) {
    const s = this.state;
    tl.add(() => {
      Object.values(this.notes).forEach((n) => n.hide());
      this.climbing = false;
    }, t0);
    tl.to(this, { spinTarget: 0, spin: 0, duration: 0.6 }, t0);
    tl.to(s, { extras: 0, duration: 0.4, ease: 'back.in(2)', onUpdate: () => this._applyState() }, t0);
    tl.to(s, { surf: 0, duration: 0.9, ease: 'power2.in', onUpdate: () => this._applyState() }, t0 + 0.3);
    tl.to(s, { rise: 0, duration: 0.8, ease: 'power2.inOut', onUpdate: () => this._applyState() }, t0 + 0.9);
    tl.to(s, { draw: 0, duration: 0.5, onUpdate: () => this._applyState() }, t0 + 1.6);
    tl.add(() => (this.group.visible = false), t0 + 2.15);
    return t0 + 1.6;
  }

  update(dt) {
    if (!this.group.visible) return;
    const k = Math.min(1, dt * 7);
    this.A += (this.At - this.A) * k;
    this.k += (this.kt - this.k) * k;
    this.u.uA.value = this.A;
    this.u.uK.value = this.k;
    this.spin += (this.spinTarget - this.spin) * Math.min(1, dt * 8);
    this.asm.rotation.y = this.spin;
    this.planeVis += ((this.showPlane ? 1 : 0) - this.planeVis) * Math.min(1, dt * 8);
    this.gradVis += ((this.showGrad ? 1 : 0) - this.gradVis) * Math.min(1, dt * 8);
    const key = `${this.A.toFixed(3)}|${this.k.toFixed(3)}`;
    if (key !== this._cKey) {
      this._cT = (this._cT || 0) + dt;
      if (this._cT > 0.05) { this._cT = 0; this._buildContours(); }
    }
    this._applyState();

    const { A } = this, kk = this.k;
    if (this.climbing) {
      const gx = fx(this.pt.x, this.pt.y, A, kk), gy = fy(this.pt.x, this.pt.y, A, kk);
      const gm = Math.hypot(gx, gy);
      if (gm < 0.02) { this.climbing = false; this.env.setClimbLabel?.(false); }
      const step = Math.min(dt * 1.6, 0.05) / Math.max(gm, 0.3);
      this.pt.x = THREE.MathUtils.clamp(this.pt.x + gx * step, -Math.PI, Math.PI);
      this.pt.y = THREE.MathUtils.clamp(this.pt.y + gy * step, -Math.PI, Math.PI);
    }
    const a = this.pt.x, b = this.pt.y;
    const fv = f(a, b, A, kk), fxv = fx(a, b, A, kk), fyv = fy(a, b, A, kk);
    const T = this.u.uT.value, lift = this.u.uLift.value;
    const P = new THREE.Vector3(a * S, fv * HS * T + lift, -b * S);
    this.point.position.copy(P);
    this.drop.position.copy(P);
    this.drop.scale.y = Math.max(0.001, P.y);
    // slopes in world units (z axis points to −y in math coords)
    const hX = (fxv * HS * T) / S, hZ = (-fyv * HS * T) / S;
    const n = new THREE.Vector3(-hX, 1, -hZ).normalize();
    this.plane.position.copy(P);
    this.plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const gm = Math.hypot(hX, hZ);
    const dir = new THREE.Vector3(hX, hX * hX + hZ * hZ, hZ);
    const glen = Math.min(0.42, 0.05 + Math.hypot(fxv, fyv) * 0.16);
    if (gm > 1e-4) {
      setArrow(this.gradArrow, P.clone().add(n.clone().multiplyScalar(0.015)), dir, glen);
      setArrow(this.gradShadow, new THREE.Vector3(P.x, 0.006, P.z), new THREE.Vector3(hX, 0, hZ), glen * 0.9);
      this.notes.grad.position.copy(P).add(dir.clone().normalize().multiplyScalar(glen + 0.06));
    }
    this.notes.grad.element.style.visibility = this.gradVis > 0.5 && gm > 1e-3 ? 'visible' : 'hidden';

    // critical point labels follow the surface
    const H = (mx, my) => f(mx, my, A, kk) * HS * T + lift;
    const c = Math.PI / (2 * kk);
    const put = (note, mx, my, dy) => {
      const inside = Math.abs(mx) <= Math.PI && Math.abs(my) <= Math.PI;
      note.element.style.visibility = inside ? 'visible' : 'hidden';
      note.position.set(mx * S, H(mx, my) + dy, -my * S);
    };
    put(this.notes.max, c, 0, 0.08);
    put(this.notes.min, -c, 0, -0.06);
    put(this.notes.saddle, 0, c, 0.07);

    this.notes.fx.set(`f(${a.toFixed(2)}, ${b.toFixed(2)}) = ${fv.toFixed(2)}<br>∂f/∂x = ${fxv.toFixed(2)} &nbsp; ∂f/∂y = ${fyv.toFixed(2)}<br>|∇f| = ${Math.hypot(fxv, fyv).toFixed(2)}${Math.hypot(fxv, fyv) < 0.05 ? ' — critical point!' : ''}`);
    const sg = (v) => (v < 0 ? '−' : '+');
    this.notes.tan.set(`tangent plane: z = ${fv.toFixed(2)} ${sg(fxv)} ${Math.abs(fxv).toFixed(2)}(x ${sg(-a)} ${Math.abs(a).toFixed(2)}) ${sg(fyv)} ${Math.abs(fyv).toFixed(2)}(y ${sg(-b)} ${Math.abs(b).toFixed(2)})`);

    // gradient field drawn on the page under the surface
    if (this.gradVis > 0.02) {
      const d = this._d || (this._d = new THREE.Object3D());
      const NF = this.fieldN;
      let i = 0;
      for (let ix = 0; ix < NF; ix++)
        for (let iy = 0; iy < NF; iy++) {
          const mx = -Math.PI + ((ix + 0.5) / NF) * 2 * Math.PI, my = -Math.PI + ((iy + 0.5) / NF) * 2 * Math.PI;
          const gx = fx(mx, my, A, kk), gy = fy(mx, my, A, kk);
          const m = Math.hypot(gx, gy);
          const len = Math.min(0.11, m * 0.06);
          d.position.set(mx * S, 0.004, -my * S);
          d.rotation.set(0, Math.atan2(gy, gx), 0);
          d.scale.setScalar(m > 0.03 ? 1 : 0.001);
          d.updateMatrix();
          this.field.setMatrixAt(i, d.matrix);
          d.scale.set(Math.max(0.001, len), 1, 1);
          d.updateMatrix();
          this.fieldShafts.setMatrixAt(i, d.matrix);
          i++;
        }
      this.field.instanceMatrix.needsUpdate = this.fieldShafts.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    Object.values(this.notes).forEach((n) => n.element.remove());
    disposeTree(this.group);
  }
}
