// Bar magnet — ported from the concept demo (chapters/magnet.js) to the
// runtime contract. The printed field-line drawing lifts off the page and fans
// out around the magnet's axis into true 3D field lines. The field is a Gilbert
// (two-pole) model; a draggable compass responds to the local field plus
// Earth's field, and the magnet itself can be twisted.
export default function create(lp, ctx) {
  const { THREE, palette: P } = lp;
  const DEG = lp.util.DEG;

  // design space: the figure is 1.84 wide × 1.62 tall, origin at its centre,
  // x right, y up off the page, z down the page.
  const fig = lp.figure.frame(1.84, 1.62);
  const C = { x: 0, z: -0.06 }; // magnet centre
  const HALF = 0.31, WIDTH = 0.16, THICK = 0.12;
  const D = 0.27; // pole (charge) offset
  const BOUND_X = 0.86, BOUND_R = 0.7;
  const PHIS = [0, 36, 72, 108, 144, 180].map((d) => d * DEG);
  const AXIS_H = 0.17;
  const COMPASS0 = { x: 0.57, z: 0.46 };
  const EARTH = 0.012;
  const FIG_HW = 0.92, FIG_HH = 0.81;
  const S0 = lp.param('strength', 1, [0.2, 2.5]);

  // ---- field maths -------------------------------------------------------------
  // B in the meridian plane (X along the axis, R radial) from +q at (+D,0), −q at (−D,0)
  function field2(X, R, q = 1) {
    const dx1 = X - D, dx2 = X + D;
    const r1 = Math.pow(dx1 * dx1 + R * R, 1.5), r2 = Math.pow(dx2 * dx2 + R * R, 1.5);
    return [q * (dx1 / r1 - dx2 / r2), q * (R / r1 - R / r2)];
  }

  // field lines leaving the N pole, fanned over the upper half-plane, ending on S
  function traceLines(n) {
    const lines = [];
    for (let i = 1; i <= n; i++) {
      const a = (0.2 + (0.74 * (i - 1)) / Math.max(1, n - 1)) * Math.PI;
      let X = D + 0.035 * Math.cos(a), R = 0.035 * Math.sin(a);
      const pts = [[X, R]];
      for (let k = 0; k < 900; k++) {
        const [bx, br] = field2(X, R);
        const m = Math.hypot(bx, br) || 1;
        X += (bx / m) * 0.008;
        R += (br / m) * 0.008;
        if (R < 0) R = 0;
        pts.push([X, R]);
        if (Math.hypot(X + D, R) < 0.035) {
          pts.push([-D, 0]);
          break;
        }
        if (Math.abs(X) > BOUND_X || R > BOUND_R) break;
      }
      // cumulative length for arrow placement
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
      lines.push({ pts, cum, len: cum[cum.length - 1] });
    }
    return lines;
  }

  // 3D field of the two poles (local magnet coords, x along the axis)
  function fieldAt(p, q) {
    const B = new THREE.Vector3();
    for (const [sx, qq] of [[D, q], [-D, -q]]) {
      const r = p.clone().sub(new THREE.Vector3(sx, 0, 0));
      const l3 = Math.pow(Math.max(r.lengthSq(), 0.004), 1.5);
      B.add(r.multiplyScalar(qq / l3));
    }
    return B;
  }

  const s = {
    strength: S0, showLines: true, earth: true, rot: 0, rotTarget: 0, time: 0,
    fan: 0, compass: 0, arrows: 0, lineProg: 1, rebuildIn: -1,
    compassPos: new THREE.Vector2(COMPASS0.x, COMPASS0.z), heading: 0, headingVel: 0,
  };

  // ---- magnet body ---------------------------------------------------------------
  // authored resting on the page; riseFromPage squashes it flat, then lifts it to the axis height
  const body = new THREE.Group();
  const halves = [];
  for (const [sgn, col, letter] of [[1, P.coral, 'N'], [-1, P.blue, 'S']]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(HALF, THICK, WIDTH), lp.sketch(col));
    m.position.set((sgn * HALF) / 2, THICK / 2, 0);
    m.castShadow = true;
    lp.edges(m, { width: 1.6 });
    body.add(m);
    halves.push(m);
    // the pole letter painted on the upper face (a flat, never-opened board used as a decal)
    const decal = lp.board({ at: [0, 0], size: [HALF * 0.995, WIDTH * 0.995], grid: false, px: 512 });
    const g = decal.ctx;
    g.fillStyle = col;
    g.fillRect(0, 0, decal.width, decal.height);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.fillRect(0, 0, decal.width, decal.height * 0.23);
    g.font = `600 ${Math.round(decal.height * 0.72)}px ${lp.fonts.serif}`;
    g.fillStyle = 'rgba(47,43,38,0.85)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, decal.width / 2, decal.height * 0.55);
    decal.refresh();
    decal.state.draw = 1;
    decal.apply();
    decal.group.position.set((sgn * HALF) / 2, THICK + 0.0015, (WIDTH * 0.995) / 2);
    body.add(decal.group);
  }

  const rise = lp.choreo.riseFromPage(body, { at: [C.x, C.z], height: AXIS_H - THICK / 2 });
  fig.add(rise.group);

  // ---- field lines (in planes through the axis, fanned about it) ---------------
  const linesGroup = new THREE.Group();
  rise.group.add(linesGroup); // lifted with the magnet, but not squashed
  const lineMat = (() => {
    const tmp = lp.ink([[0, 0, 0], [1, 0, 0]], { color: '#d98a78', opacity: 0.85, progress: 0, radius: 0.0055 });
    tmp.geometry.dispose();
    const m = tmp.material;
    m.uniforms.uColor2.value.set('#7f9fc2');
    m.uniforms.uTailFade.value = 1;
    return m;
  })();
  const planes = PHIS.map((phi) => {
    const g = new THREE.Group();
    g.userData.target = phi;
    g.userData.start = phi <= Math.PI / 2 ? 0 : Math.PI;
    linesGroup.add(g);
    return g;
  });
  const arrowMesh = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.02, 0.06, 8).rotateZ(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#5b4a3a', transparent: true, opacity: 0 }),
    PHIS.length * 14 * 2
  );
  arrowMesh.frustumCulled = false;
  arrowMesh.count = 0;
  arrowMesh.raycast = () => {};
  linesGroup.add(arrowMesh);

  let lines = [], lineGeos = [], nLines = 0;
  function buildLines() {
    const n = Math.round(3 + 3.2 * s.strength);
    if (n === nLines) return false;
    nLines = n;
    for (const g of planes) for (const c of [...g.children]) g.remove(c);
    lineGeos.forEach((g) => g.dispose());
    lines = traceLines(n);
    lineGeos = lines.map((ln) => {
      const pts = ln.pts.filter((_, k) => k % 2 === 0 || k === ln.pts.length - 1).map(([X, R]) => new THREE.Vector3(X, 0, R));
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(16, pts.length), 0.0055, 5, false);
    });
    for (const g of planes) {
      for (const geo of lineGeos) {
        const m = new THREE.Mesh(geo, lineMat);
        m.raycast = () => {};
        g.add(m);
      }
    }
    return true;
  }
  buildLines();

  // ---- compass -----------------------------------------------------------------
  const compass = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.105, 0.025, 40), lp.sketch('#f6e9c4', { hatch: 0.5 }));
  disc.position.y = 0.0125;
  disc.castShadow = true;
  lp.edges(disc, { width: 1.3, threshold: 50 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.007, 6, 48).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#3a352f' }));
  ring.position.y = 0.026;
  const needle = new THREE.Group();
  needle.position.y = 0.034;
  const tipN = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.085, 4).rotateZ(-Math.PI / 2).translate(0.0425, 0, 0), lp.sketch('coralDeep', { hatch: 0 }));
  const tipS = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.085, 4).rotateZ(Math.PI / 2).translate(-0.0425, 0, 0), lp.sketch('blueDeep', { hatch: 0 }));
  for (const t of [tipN, tipS]) {
    t.scale.y = 0.35;
    t.castShadow = true;
    needle.add(t);
  }
  needle.add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 10), new THREE.MeshBasicMaterial({ color: '#3a352f' })));
  compass.add(disc, ring, needle);
  fig.add(compass);
  {
    const [bx, br] = field2(COMPASS0.x - C.x, COMPASS0.z - C.z);
    s.heading = Math.atan2(-br, bx);
    needle.rotation.y = s.heading;
  }

  function placeCompass(extra = 0, animate = false) {
    const y = 0.002 + extra;
    if (animate) lp.gsap.to(compass.position, { y, duration: 0.4, ease: 'bounce.out' });
    else compass.position.y = y;
    compass.position.x = s.compassPos.x;
    compass.position.z = s.compassPos.y;
  }
  placeCompass();

  // keep the compass out of the magnet's footprint
  function avoidMagnet() {
    const Y = new THREE.Vector3(0, 1, 0);
    const local = new THREE.Vector3(s.compassPos.x - C.x, 0, s.compassPos.y - C.z).applyAxisAngle(Y, -s.rot);
    const ex = HALF + 0.12, ez = WIDTH / 2 + 0.12;
    if (Math.abs(local.x) < ex && Math.abs(local.z) < ez) {
      const px = ex - Math.abs(local.x), pz = ez - Math.abs(local.z);
      if (px < pz) local.x = Math.sign(local.x || 1) * ex;
      else local.z = Math.sign(local.z || 1) * ez;
      local.applyAxisAngle(Y, s.rot);
      s.compassPos.set(local.x + C.x, local.z + C.z);
    }
  }

  // ---- notes ---------------------------------------------------------------------
  const notes = {
    N: lp.note('north pole', { color: 'coral' }),
    S: lp.note('south pole', { color: 'blue' }),
    gauss: lp.note('∇·B = 0 — lines never cross,<br>they close back into the magnet', { kind: 'equation' }),
    falloff: lp.note('far away: |B| ∝ 1/r³', { kind: 'equation', color: 'sepia' }),
    compass: lp.note('', { kind: 'readout', anchor: 'left' }),
    hint: lp.note('drag the compass · twist the magnet', { anchor: 'left' }),
  };
  notes.N.position.set(HALF * 1.05, THICK + 0.2, 0.05);
  notes.S.position.set(-HALF * 1.05, THICK + 0.2, 0.05);
  body.add(notes.N, notes.S);
  notes.compass.position.set(0.13, 0.05, 0.03);
  compass.add(notes.compass);
  notes.hint.position.set(-0.85, 0.05, 0.77);
  fig.add(notes.hint);

  // ---- interaction -----------------------------------------------------------------
  const angleAt = (p) => -Math.atan2(p.z - C.z, p.x - C.x);
  let rotStart = 0, rotBase = 0;
  lp.draggable(body, {
    plane: 'page',
    space: fig,
    onStart: (p) => {
      rotStart = angleAt(p);
      rotBase = s.rotTarget;
    },
    onDrag: (p) => {
      s.rotTarget = rotBase + (angleAt(p) - rotStart);
    },
    onEnd: () => {
      const d = Math.atan2(Math.sin(s.rotTarget), Math.cos(s.rotTarget)) / DEG;
      ui.set('rot', Math.round(d));
    },
  });

  lp.draggable(disc, {
    plane: 'page',
    space: fig,
    onStart: () => lp.gsap.to(compass.position, { y: compass.position.y + 0.06, duration: 0.25 }),
    onDrag: (p) => {
      s.compassPos.set(lp.util.clamp(p.x, -FIG_HW + 0.12, FIG_HW - 0.12), lp.util.clamp(p.z, -FIG_HH + 0.12, FIG_HH - 0.12));
      avoidMagnet();
      placeCompass(0.06);
    },
    onEnd: () => placeCompass(0, true),
  });

  const ui = lp.controls([
    { type: 'slider', key: 'strength', label: 'magnet strength', min: 0.2, max: 2.5, step: 0.01, value: S0, format: (v) => `×${v.toFixed(2)}`, onChange: (v) => setStrength(v) },
    { type: 'slider', key: 'rot', label: 'magnet angle', min: -180, max: 180, step: 1, value: 0, format: (v) => `${Math.round(v)}°`, onChange: (v) => (s.rotTarget = v * DEG) },
    { type: 'toggle', key: 'lines', icon: '≋', label: 'field lines', value: true, onChange: (v) => toggleLines(v) },
    { type: 'toggle', key: 'earth', icon: '⊕', label: 'Earth’s field', value: true, onChange: (v) => (s.earth = v) },
    { type: 'button', key: 'reset', icon: '↺', label: 'reset', onClick: () => reset() },
  ]);

  function setStrength(v) {
    s.strength = v;
    s.rebuildIn = 0.06; // debounce the re-trace while the slider moves
  }
  function toggleLines(v) {
    s.showLines = v;
    lp.gsap.to(s, { lineProg: v ? 1 : 0, duration: v ? 1.0 : 0.6, ease: 'power2.inOut' });
    lp.gsap.to(s, { arrows: v ? 1 : 0, duration: 0.5 });
  }
  function reset() {
    s.rotTarget = 0;
    ui.set('rot', 0);
    ui.set('strength', S0);
    setStrength(S0);
    lp.gsap.to(s.compassPos, { x: COMPASS0.x, y: COMPASS0.z, duration: 0.8, ease: 'power3.inOut', onUpdate: () => placeCompass() });
  }

  // ---- pose ------------------------------------------------------------------------
  function applyState() {
    linesGroup.position.y = (THICK / 2) * rise.inner.scale.y;
    for (const g of planes) {
      const { start, target } = g.userData;
      g.rotation.x = -(start + (target - start) * s.fan);
    }
    lineMat.uniforms.uProgress.value = rise.state.draw * s.lineProg;
    compass.scale.setScalar(Math.max(0.0001, s.compass));
    compass.visible = s.compass > 0.01;
    arrowMesh.material.opacity = s.arrows * 0.85;
  }
  applyState();

  const dummy = new THREE.Object3D();
  const XAX = new THREE.Vector3(1, 0, 0), YAX = new THREE.Vector3(0, 1, 0);

  return {
    root: fig,
    view: { lift: 0.18, polar: 0.8, azimuth: 0.14, zoom: 1 },
    enter(tl) {
      tl.add(() => {
        s.fan = 0;
        s.compass = 0;
        s.arrows = 0;
        applyState();
      }, 0);
      rise.enter(tl, 0);
      tl.to(s, { fan: 1, duration: 1.6, ease: 'power3.inOut' }, 1.25);
      tl.to(s, { compass: 1, duration: 0.8, ease: 'back.out(2)' }, 1.6);
      tl.to(s, { arrows: s.showLines ? 1 : 0, duration: 0.6 }, 2.4);
      tl.add(() => {
        notes.N.reveal(0);
        notes.S.reveal(0.15);
        notes.gauss.reveal(0.4, 1.1);
        notes.falloff.reveal(1.0, 0.8);
        notes.compass.reveal(0.6);
        notes.hint.reveal(1.4);
      }, 2.4);
      tl.set({}, {}, 2.6);
    },
    exit(tl) {
      tl.add(() => Object.values(notes).forEach((n) => n.hide()), 0);
      tl.to(s, { rotTarget: 0, rot: 0, duration: 0.6, ease: 'power2.inOut' }, 0);
      tl.add(() => ui.set('rot', 0), 0.6);
      tl.to(s, { arrows: 0, duration: 0.3 }, 0);
      tl.to(s, { compass: 0, duration: 0.5, ease: 'back.in(2)' }, 0.1);
      tl.to(s, { fan: 0, duration: 1.0, ease: 'power3.inOut' }, 0.3);
      rise.exit(tl, 0.9);
    },
    update(dt) {
      s.time += dt;
      if (s.rebuildIn >= 0) {
        s.rebuildIn -= dt;
        if (s.rebuildIn < 0 && buildLines() && s.showLines) {
          s.lineProg = 0.3;
          lp.gsap.to(s, { lineProg: 1, duration: 0.6, ease: 'power2.out' });
        }
      }
      s.rot += (s.rotTarget - s.rot) * Math.min(1, dt * 10);
      rise.group.rotation.y = s.rot;
      lineMat.uniforms.uTime.value = s.time;
      applyState();

      // flowing arrows along field lines (N → S), speed ∝ strength
      let idx = 0;
      if (rise.group.visible && s.arrows > 0.01 && s.showLines) {
        for (const g of planes) {
          const ang = g.rotation.x;
          for (const ln of lines) {
            for (let k = 0; k < 2; k++) {
              const u = (k / 2 + s.time * 0.05 * (0.4 + s.strength) * (0.6 / Math.max(ln.len, 0.3))) % 1;
              const d = u * ln.len;
              let j = 1;
              while (j < ln.cum.length - 1 && ln.cum[j] < d) j++;
              const [x0, r0] = ln.pts[j - 1], [x1, r1] = ln.pts[j];
              const f = (d - ln.cum[j - 1]) / Math.max(1e-6, ln.cum[j] - ln.cum[j - 1]);
              const p = new THREE.Vector3(x0 + (x1 - x0) * f, 0, r0 + (r1 - r0) * f).applyAxisAngle(XAX, ang);
              const dir = new THREE.Vector3(x1 - x0, 0, r1 - r0).normalize().applyAxisAngle(XAX, ang);
              dummy.position.copy(p);
              dummy.quaternion.setFromUnitVectors(XAX, dir);
              dummy.scale.setScalar(Math.max(0.001, Math.min(1, u * 8, (1 - u) * 8)));
              dummy.updateMatrix();
              arrowMesh.setMatrixAt(idx++, dummy.matrix);
            }
          }
        }
      }
      arrowMesh.count = idx;
      arrowMesh.instanceMatrix.needsUpdate = true;

      // compass: torque toward local B (magnet + Earth)
      if (compass.visible) {
        const axisY = rise.group.position.y + linesGroup.position.y;
        const local = new THREE.Vector3(compass.position.x - C.x, compass.position.y - axisY, compass.position.z - C.z).applyAxisAngle(YAX, -s.rot);
        const B = fieldAt(local, 0.02 * s.strength).applyAxisAngle(YAX, s.rot);
        if (s.earth) B.z -= EARTH; // Earth's north = up the page (−z)
        const target = Math.atan2(-B.z, B.x);
        let diff = target - s.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const Bh = Math.hypot(B.x, B.z);
        const k = 60 * Math.min(4, Math.sqrt(Bh / EARTH));
        const h = Math.min(dt, 1 / 30);
        s.headingVel += (k * Math.sin(diff) - 5.5 * s.headingVel) * h;
        s.heading += s.headingVel * h;
        needle.rotation.y = s.heading;
        const ratio = Bh / EARTH;
        notes.compass.set(`|B| ≈ ${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)} × Earth’s`);
      }
    },
    dispose() {
      lineGeos.forEach((g) => g.dispose());
      lineMat.dispose();
    },
  };
}
