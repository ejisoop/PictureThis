// Surfaces & partial derivatives — ported from the concept demo
// (chapters/surface.js) to the runtime contract. The printed contour map's
// level curves rise to their heights while the surface f(x, y) = A sin(kx) cos(ky)
// grows out of the page; a draggable point carries its tangent plane and ∇f,
// and can climb the gradient to a peak.
export default function create(lp, ctx) {
  const { THREE, palette: P } = lp;
  const DEG = lp.util.DEG;
  const PI = Math.PI;

  // design space: the printed figure is 1.82 wide × 1.66 tall, origin at its
  // centre, x right, y up off the page, z down the page. The [−π, π]² contour
  // square sits just about in the middle of it.
  const fig = lp.figure.frame(1.82, 1.66);
  const CENTRE = [-0.01, -0.03];
  const HALF = 0.72; // half-size of the domain in design units
  const S = HALF / PI; // design units per maths unit
  const HS = 0.2; // height per unit of f
  const BASE_H = 0.4; // risen height of the z = 0 plane
  const LEVELS = [-0.8, -0.55, -0.3, -0.08, 0.08, 0.3, 0.55, 0.8];
  const A0 = lp.param('A', 1, [0.3, 1.6]);
  const K0 = lp.param('k', 1, [0.5, 1.5]);
  const PT0 = [0.9, 0.7];

  const f = (x, y, A, k) => A * Math.sin(k * x) * Math.cos(k * y);
  const fx = (x, y, A, k) => A * k * Math.cos(k * x) * Math.cos(k * y);
  const fy = (x, y, A, k) => -A * k * Math.sin(k * x) * Math.sin(k * y);
  const clampD = (v) => lp.util.clamp(v, -PI, PI);

  const s = {
    A: A0, k: K0, At: A0, kt: K0,
    pt: new THREE.Vector2(PT0[0], PT0[1]),
    showPlane: true, showGrad: true, climbing: false,
    spin: 0, spinTarget: 0,
    surf: 0, extras: 0, planeVis: 1, gradVis: 1,
  };

  // asm: lies on the page (spins about the vertical); `lifted` rises off it
  const asm = new THREE.Group();
  asm.position.set(CENTRE[0], 0.004, CENTRE[1]);
  fig.add(asm);
  const lifted = new THREE.Group();

  // ---- the surface -------------------------------------------------------------
  const geo = lp.surface(() => 0, { x: [-PI, PI], y: [-PI, PI], res: 100, scale: [S, S, HS] });
  const surfMat = lp.sketch('#ffffff', { hatch: 0.8, emissive: 0, opacity: 0.94, doubleSide: true });
  const su = { uK: { value: s.k }, uFade: { value: 0 } };
  {
    const prev = surfMat.onBeforeCompile;
    surfMat.onBeforeCompile = (shader) => {
      prev(shader);
      Object.assign(shader.uniforms, su);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vM;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n vM = vec2(position.x, -position.z) / ${S.toFixed(6)};`);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uK, uFade; varying vec2 vM;
          vec3 lpRamp(float t){
            vec3 a = vec3(0.62,0.55,0.79), b = vec3(0.55,0.68,0.81), c = vec3(0.62,0.74,0.56), d = vec3(0.93,0.62,0.50);
            if (t < -0.35) return mix(a, b, (t+1.0)/0.65);
            if (t < 0.25) return mix(b, c, (t+0.35)/0.6);
            return mix(c, d, (t-0.25)/0.75);
          }`
        )
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb = lpRamp(clamp(sin(uK*vM.x)*cos(uK*vM.y), -1.0, 1.0));')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance = diffuseColor.rgb * 0.16;')
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          {
            vec2 g = vM / (3.14159265/6.0);
            vec2 w = fwidth(g);
            vec2 d = abs(fract(g - 0.5) - 0.5) / max(w, 1e-4);
            float line = 1.0 - min(min(d.x, d.y), 1.0);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.32,0.29,0.26), line * 0.45);
            gl_FragColor.a *= uFade;
          }`
        );
    };
    surfMat.customProgramCacheKey = () => 'lp-surface';
  }
  const surface = new THREE.Mesh(geo, surfMat);
  surface.castShadow = true;
  surface.frustumCulled = false;
  surface.raycast = () => {};
  surface.visible = false;
  lifted.add(surface);
  let surfKey = '';

  // ---- level curves (marching squares, chained into ink polylines) ----------------
  function contours(A, k, level, n = 72) {
    const out = [];
    const L = -PI, step = (2 * PI) / n;
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
  // flat segment list → polylines (segments sharing endpoints are joined)
  function chain(seg) {
    const n = seg.length / 4;
    const key = (x, y) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;
    const at = new Map();
    const push = (k, i) => (at.has(k) ? at.get(k).push(i) : at.set(k, [i]));
    for (let i = 0; i < n; i++) {
      push(key(seg[i * 4], seg[i * 4 + 1]), i);
      push(key(seg[i * 4 + 2], seg[i * 4 + 3]), i);
    }
    const used = new Uint8Array(n);
    const lines = [];
    const grow = (line, x, y) => {
      for (;;) {
        const next = (at.get(key(x, y)) || []).find((j) => !used[j]);
        if (next === undefined) return;
        used[next] = 1;
        const a = [seg[next * 4], seg[next * 4 + 1]], b = [seg[next * 4 + 2], seg[next * 4 + 3]];
        const far = key(a[0], a[1]) === key(x, y) ? b : a;
        line.push(far);
        [x, y] = far;
      }
    };
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = 1;
      const fwd = [[seg[i * 4], seg[i * 4 + 1]], [seg[i * 4 + 2], seg[i * 4 + 3]]];
      grow(fwd, fwd[1][0], fwd[1][1]);
      const back = [];
      grow(back, fwd[0][0], fwd[0][1]);
      lines.push([...back.reverse(), ...fwd]);
    }
    return lines;
  }

  const levelGroups = LEVELS.map((lv) => {
    const g = new THREE.Group();
    g.userData.level = lv;
    lifted.add(g);
    return g;
  });
  let contourKey = '', contourT = 0;
  function buildContours() {
    contourKey = `${s.A.toFixed(3)}|${s.k.toFixed(3)}`;
    for (const g of levelGroups) {
      for (const c of [...g.children]) {
        g.remove(c);
        lp.dispose(c);
      }
      const lv = g.userData.level;
      for (const line of chain(contours(s.A, s.k, lv * s.A))) {
        if (line.length < 2) continue;
        const pts = line.map(([mx, my]) => [mx * S, 0.002, -my * S]);
        g.add(lp.ink(pts, { radius: 0.0038, color: lv > 0 ? 'coralDeep' : 'lavenderDeep', opacity: 0.95, progress: rise ? rise.state.draw : 0 }));
      }
    }
  }

  // ---- axes: a lifting frame + vertical f axis ---------------------------------------
  const axes = new THREE.Group();
  const xAxis = lp.ink([[-HALF - 0.04, 0, 0], [HALF + 0.1, 0, 0]], { radius: 0.0055 });
  const yAxis = lp.ink([[0, 0, HALF + 0.04], [0, 0, -HALF - 0.1]], { radius: 0.0055 });
  const zAxis = lp.ink([[0, 0, 0], [0, 0.48, 0]], { radius: 0.0055, progress: 0 });
  zAxis.userData.drawOn = false; // grows with the surface, not with the ink
  axes.add(xAxis, yAxis, zAxis);
  for (const [p, d] of [[[HALF + 0.1, 0, 0], [1, 0, 0]], [[0, 0, -HALF - 0.1], [0, 0, -1]]]) {
    const a = lp.arrow('#3a352f', { head: 0.06, headR: 0.022 });
    const dir = new THREE.Vector3(...d);
    lp.setArrow(a, new THREE.Vector3(...p).addScaledVector(dir, -0.06), dir, 0.06);
    axes.add(a);
  }
  const zHead = lp.arrow('#3a352f', { head: 0.06, headR: 0.022 });
  lp.setArrow(zHead, new THREE.Vector3(0, 0.42, 0), new THREE.Vector3(0, 1, 0), 0.06);
  axes.add(zHead);
  const corners = [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF], [-HALF, -HALF]];
  const framePts = [];
  for (let i = 0; i < 4; i++)
    for (let t = 0; t <= 10; t++) {
      const u = t / 10;
      framePts.push([corners[i][0] + (corners[i + 1][0] - corners[i][0]) * u, 0, corners[i][1] + (corners[i + 1][1] - corners[i][1]) * u]);
    }
  axes.add(lp.ink(framePts, { radius: 0.003, dashed: true, dashCount: 60, color: 'graphite', opacity: 0.55 }));
  lifted.add(axes);

  // ---- point, tangent plane, gradient ------------------------------------------------
  const point = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 2), lp.sketch('yellow', { hatch: 0.6 }));
  lp.outline(point, 0.006);
  point.castShadow = true;
  lifted.add(point);

  const plane = new THREE.Group();
  const planeMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.46, 0.46).rotateX(-PI / 2),
    new THREE.MeshLambertMaterial({ color: P.peach, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false, emissive: '#5a3a2a' })
  );
  planeMesh.raycast = () => {};
  lp.edges(planeMesh, { color: 'coralDeep', width: 1.6 });
  const planeGrid = new THREE.GridHelper(0.46, 4, P.coralDeep, P.coralDeep);
  planeGrid.material.transparent = true;
  planeGrid.material.opacity = 0.35;
  planeGrid.raycast = () => {};
  plane.add(planeMesh, planeGrid);
  lifted.add(plane);

  const gradArrow = lp.arrow('coralDeep', { radius: 0.007, head: 0.06, headR: 0.022 });
  lifted.add(gradArrow);
  // both are transparent: draw them after the (transparent) surface so it can't wash them out
  plane.traverse((o) => (o.renderOrder = 2));
  gradArrow.traverse((o) => (o.renderOrder = 3));

  // notes that ride on the surface
  const notes = {
    max: lp.note('local max', { color: 'coral' }),
    min: lp.note('local min', { color: 'lavender' }),
    saddle: lp.note('saddle', { color: 'sage' }),
    grad: lp.note('∇f', { color: 'coral' }),
    xl: lp.note('<i>x</i>'),
    yl: lp.note('<i>y</i>'),
    zl: lp.note('<i>z = f(x, y)</i>', { anchor: 'left' }),
    hint: lp.note('drag the yellow point across the surface', { anchor: 'left' }),
    tan: lp.note('', { kind: 'equation' }),
    fx: lp.note('', { kind: 'equation' }),
  };
  for (const k of ['max', 'min', 'saddle', 'grad', 'xl', 'yl', 'zl']) lifted.add(notes[k]);
  notes.xl.position.set(HALF + 0.16, 0, 0);
  notes.yl.position.set(0, 0, -HALF - 0.16);
  notes.zl.position.set(0.04, 0.5, 0);

  // the whole lifted assembly rises off the printed map
  const rise = lp.choreo.riseFromPage(lifted, { at: [0, 0], height: BASE_H });
  asm.add(rise.group); // re-home it inside the spinning assembly
  buildContours();

  // ---- things that stay printed on the page ------------------------------------------
  const drop = lp.ink([[0, 0, 0], [0, -1, 0]], { radius: 0.0025, dashed: true, dashCount: 14, color: 'graphite', opacity: 0.6 });
  const gradShadow = lp.arrow('sepia', { radius: 0.005, head: 0.05, headR: 0.018 });
  asm.add(drop, gradShadow);
  asm.add(notes.hint);
  notes.hint.position.set(-HALF, 0.02, HALF + 0.12);

  const NF = 11;
  const field = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.014, 0.05, 6).rotateZ(-PI / 2).translate(0.01, 0, 0),
    new THREE.MeshBasicMaterial({ color: P.sepia, transparent: true, opacity: 0 }),
    NF * NF
  );
  const fieldShafts = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 0.004, 0.006).translate(-0.5, 0, 0),
    new THREE.MeshBasicMaterial({ color: P.sepia, transparent: true, opacity: 0 }),
    NF * NF
  );
  field.raycast = fieldShafts.raycast = () => {};
  field.frustumCulled = fieldShafts.frustumCulled = false;
  asm.add(field, fieldShafts);
  const dummy = new THREE.Object3D();

  // ---- interaction -------------------------------------------------------------------
  // the touch is projected onto a horizontal plane through the point (in the
  // lifted assembly's coordinates) — close to the reference's surface ray-march
  lp.draggable(point, {
    plane: 'page',
    space: lifted,
    hitRadius: 0.085,
    onStart: () => {
      s.climbing = false;
      ui.label('climb', 'climb ∇f', '⛰');
    },
    onDrag: (p) => s.pt.set(clampD(p.x / S), clampD(-p.z / S)),
  });

  const ui = lp.controls([
    { type: 'slider', key: 'A', label: 'amplitude <i>A</i>', min: 0.3, max: 1.6, step: 0.01, value: A0, format: (v) => v.toFixed(2), onChange: (v) => (s.At = v) },
    { type: 'slider', key: 'k', label: 'frequency <i>k</i>', min: 0.5, max: 1.5, step: 0.01, value: K0, format: (v) => v.toFixed(2), onChange: (v) => (s.kt = v) },
    { type: 'slider', key: 'spin', label: 'turn surface', min: -180, max: 180, step: 1, value: 0, format: (v) => `${Math.round(v)}°`, onChange: (v) => (s.spinTarget = v * DEG) },
    { type: 'toggle', key: 'plane', icon: '▱', label: 'tangent plane', value: true, onChange: (v) => (s.showPlane = v) },
    { type: 'toggle', key: 'grad', icon: '↗', label: 'gradient ∇f', value: true, onChange: (v) => (s.showGrad = v) },
    { type: 'button', key: 'climb', icon: '⛰', label: 'climb ∇f', onClick: () => setClimb(!s.climbing) },
    { type: 'button', key: 'reset', icon: '↺', label: 'reset', onClick: () => reset() },
  ]);

  function setClimb(on) {
    s.climbing = on;
    ui.label('climb', on ? 'stop' : 'climb ∇f', on ? '■' : '⛰');
  }
  function reset() {
    s.At = A0;
    s.kt = K0;
    s.spinTarget = 0;
    ui.set('A', A0);
    ui.set('k', K0);
    ui.set('spin', 0);
    setClimb(false);
    lp.gsap.to(s.pt, { x: PT0[0], y: PT0[1], duration: 0.8, ease: 'power3.inOut' });
  }

  // ---- pose ------------------------------------------------------------------------------
  function applyState() {
    const { A, k, surf, extras: e } = s;
    const key = `${A.toFixed(4)}|${k.toFixed(4)}|${surf.toFixed(4)}`;
    if (key !== surfKey) {
      surfKey = key;
      geo.userData.update((x, y) => f(x, y, A, k) * surf);
    }
    su.uK.value = k;
    su.uFade.value = Math.min(1, surf * 1.6);
    surface.visible = surf > 0.01;
    for (const g of levelGroups) g.position.y = g.userData.level * A * HS * surf;
    zAxis.material.uniforms.uProgress.value = Math.max(0, Math.min(1, surf));
    zHead.visible = surf > 0.9;
    point.visible = drop.visible = e > 0.01;
    point.scale.setScalar(Math.max(0.001, e));
    plane.visible = e * s.planeVis > 0.01;
    plane.scale.setScalar(Math.max(0.001, e * s.planeVis));
    gradArrow.visible = gradShadow.visible = e * s.gradVis > 0.02;
    field.visible = fieldShafts.visible = e * s.gradVis > 0.01;
    field.material.opacity = fieldShafts.material.opacity = 0.7 * e * s.gradVis;
  }

  const setNote = (n, html) => {
    if (n.userData.lastSet !== html) {
      n.userData.lastSet = html;
      n.set(html);
    }
  };
  const vis = (n, on) => (n.element.style.visibility = on ? 'visible' : 'hidden');

  function pose() {
    const A = s.A, kk = s.k, T = s.surf;
    const a = s.pt.x, b = s.pt.y;
    const fv = f(a, b, A, kk), fxv = fx(a, b, A, kk), fyv = fy(a, b, A, kk);
    const Pt = new THREE.Vector3(a * S, fv * HS * T, -b * S);
    point.position.copy(Pt);
    // the dashed drop runs from the point (in the risen assembly) down to the page
    const yAsm = Pt.y * rise.inner.scale.y + rise.group.position.y;
    drop.position.set(Pt.x, yAsm, Pt.z);
    drop.scale.y = Math.max(0.001, yAsm);
    // slopes in design units (z runs toward −y in maths coords)
    const hX = (fxv * HS * T) / S, hZ = (-fyv * HS * T) / S;
    const n = new THREE.Vector3(-hX, 1, -hZ).normalize();
    plane.position.copy(Pt);
    plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const gm = Math.hypot(hX, hZ);
    const dir = new THREE.Vector3(hX, hX * hX + hZ * hZ, hZ);
    const glen = Math.min(0.42, 0.05 + Math.hypot(fxv, fyv) * 0.16);
    if (gm > 1e-4) {
      lp.setArrow(gradArrow, Pt.clone().addScaledVector(n, 0.015), dir, glen);
      lp.setArrow(gradShadow, new THREE.Vector3(Pt.x, 0.002, Pt.z), new THREE.Vector3(hX, 0, hZ), glen * 0.9);
      notes.grad.position.copy(Pt).add(dir.clone().normalize().multiplyScalar(glen + 0.06));
    }
    vis(notes.grad, s.gradVis > 0.5 && gm > 1e-3);

    // critical-point labels follow the surface
    const H = (mx, my) => f(mx, my, A, kk) * HS * T;
    const c = PI / (2 * kk);
    const put = (note, mx, my, dy) => {
      vis(note, Math.abs(mx) <= PI && Math.abs(my) <= PI);
      note.position.set(mx * S, H(mx, my) + dy, -my * S);
    };
    put(notes.max, c, 0, 0.08);
    put(notes.min, -c, 0, -0.06);
    put(notes.saddle, 0, c, 0.07);

    const g2 = Math.hypot(fxv, fyv);
    setNote(notes.fx, `f(${a.toFixed(2)}, ${b.toFixed(2)}) = ${fv.toFixed(2)}<br>∂f/∂x = ${fxv.toFixed(2)} &nbsp; ∂f/∂y = ${fyv.toFixed(2)}<br>|∇f| = ${g2.toFixed(2)}${g2 < 0.05 ? ' — critical point!' : ''}`);
    const sg = (v) => (v < 0 ? '−' : '+');
    setNote(notes.tan, `tangent plane: z = ${fv.toFixed(2)} ${sg(fxv)} ${Math.abs(fxv).toFixed(2)}(x ${sg(-a)} ${Math.abs(a).toFixed(2)}) ${sg(fyv)} ${Math.abs(fyv).toFixed(2)}(y ${sg(-b)} ${Math.abs(b).toFixed(2)})`);

    // gradient field printed on the page beneath the surface
    if (field.visible) {
      let i = 0;
      for (let ix = 0; ix < NF; ix++)
        for (let iy = 0; iy < NF; iy++) {
          const mx = -PI + ((ix + 0.5) / NF) * 2 * PI, my = -PI + ((iy + 0.5) / NF) * 2 * PI;
          const gx = fx(mx, my, A, kk), gy = fy(mx, my, A, kk);
          const m = Math.hypot(gx, gy);
          const len = Math.min(0.11, m * 0.06);
          dummy.position.set(mx * S, 0.002, -my * S);
          dummy.rotation.set(0, Math.atan2(gy, gx), 0);
          dummy.scale.setScalar(m > 0.03 ? 1 : 0.001);
          dummy.updateMatrix();
          field.setMatrixAt(i, dummy.matrix);
          dummy.scale.set(Math.max(0.001, len), 1, 1);
          dummy.updateMatrix();
          fieldShafts.setMatrixAt(i, dummy.matrix);
          i++;
        }
      field.instanceMatrix.needsUpdate = fieldShafts.instanceMatrix.needsUpdate = true;
    }
  }
  applyState();
  pose();

  const allNotes = Object.values(notes);
  return {
    root: fig,
    view: { lift: 0.3, polar: 0.86, azimuth: -0.12, zoom: 0.8 },
    enter(tl) {
      tl.add(() => {
        s.surf = 0;
        s.extras = 0;
        s.spin = s.spinTarget = 0;
        applyState();
      }, 0);
      rise.enter(tl, 0); // ink draws on 0 → 0.9, assembly rises 0.75 → 2.05
      tl.to(s, { surf: 1, duration: 1.6, ease: 'elastic.out(1, 0.75)', onUpdate: applyState }, 1.3);
      tl.to(s, { extras: 1, duration: 0.7, ease: 'back.out(2)', onUpdate: applyState }, 2.3);
      tl.add(() => {
        [notes.xl, notes.yl, notes.zl].forEach((x, i) => x.reveal(i * 0.1, 0.4));
        [notes.max, notes.min, notes.saddle].forEach((x, i) => x.reveal(0.3 + i * 0.15, 0.5));
        notes.grad.reveal(0.6);
        notes.tan.reveal(0.8, 1.0);
        notes.fx.reveal(1.1, 0.9);
        notes.hint.reveal(1.6);
      }, 2.3);
    },
    exit(tl) {
      tl.add(() => {
        allNotes.forEach((n) => n.hide());
        setClimb(false);
        ui.set('spin', 0);
      }, 0);
      tl.to(s, { spinTarget: 0, spin: 0, duration: 0.6 }, 0);
      tl.to(s, { extras: 0, duration: 0.4, ease: 'back.in(2)', onUpdate: applyState }, 0);
      tl.to(s, { surf: 0, duration: 0.9, ease: 'power2.in', onUpdate: applyState }, 0.3);
      rise.exit(tl, 0.8); // sinks back 0.9 → 1.7, ink undraws 1.6 → 2.1
    },
    update(dt) {
      s.A = lp.util.damp(s.A, s.At, 7, dt);
      s.k = lp.util.damp(s.k, s.kt, 7, dt);
      s.spin = lp.util.damp(s.spin, s.spinTarget, 8, dt);
      asm.rotation.y = s.spin;
      s.planeVis = lp.util.damp(s.planeVis, s.showPlane ? 1 : 0, 8, dt);
      s.gradVis = lp.util.damp(s.gradVis, s.showGrad ? 1 : 0, 8, dt);
      const key = `${s.A.toFixed(3)}|${s.k.toFixed(3)}`;
      if (key !== contourKey) {
        contourT += dt;
        if (contourT > 0.05) {
          contourT = 0;
          buildContours();
        }
      }
      applyState();
      if (s.climbing) {
        const gx = fx(s.pt.x, s.pt.y, s.A, s.k), gy = fy(s.pt.x, s.pt.y, s.A, s.k);
        const gm = Math.hypot(gx, gy);
        if (gm < 0.02) setClimb(false);
        const step = Math.min(dt * 1.6, 0.05) / Math.max(gm, 0.3);
        s.pt.set(clampD(s.pt.x + gx * step), clampD(s.pt.y + gy * step));
      }
      pose();
    },
    dispose() {},
  };
}
