// Simple pendulum — ported from the concept demo (chapters/pendulum.js) to the
// runtime contract. The printed side-view pops up off the page like a pop-up
// book and becomes a live RK4-integrated pendulum; a graph-paper card folds up
// behind it and plots θ(t) against the small-angle prediction.
export default function create(lp, ctx) {
  const { THREE, palette: P } = lp;
  const DEG = lp.util.DEG;

  // design space: the figure is 2.0 wide × 1.5 tall, origin at its centre,
  // x right, z down the page. The pop-up stands on the figure's bottom edge.
  const fig = lp.figure.frame(2.0, 1.5);
  const HINGE = [-0.05, 0.62];
  const PIVOT = new THREE.Vector2(0.08, 1.22); // in the standing pop-up's x/y
  const POLE_X = -0.66, ARM_Y = 1.27, BOB_R = 0.075;
  const VIS_PER_M = 0.5; // world units per metre of string
  const L0 = lp.param('L', 1.6, [0.4, 2.0]);
  const TH0 = lp.param('theta0', 30, [-160, 160]) * DEG;
  const G0 = lp.param('g', 9.81, [1, 30]);

  const s = { L: L0, g: G0, Lt: L0, gt: G0, theta: TH0, omega: 0, time: 0, paused: true, dragging: false, hist: [], release: { t: 0, th: TH0 } };

  // ---- the pop-up figure --------------------------------------------------
  const stand = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.3), lp.sketch('sage'));
  base.position.set(-0.66, 0.025, 0.12);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, ARM_Y - 0.02, 10), lp.sketch('#c9bfdc'));
  pole.position.set(POLE_X, 0.05 + (ARM_Y - 0.02) / 2, 0.12);
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, PIVOT.x + 0.05 - POLE_X, 8).rotateZ(Math.PI / 2), lp.sketch('#c9bfdc'));
  arm.position.set((POLE_X + PIVOT.x + 0.05) / 2, ARM_Y, 0.12);
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.14), lp.sketch('yellow'));
  clamp.position.set(PIVOT.x, ARM_Y - 0.01, 0.06);
  for (const m of [base, pole, arm, clamp]) {
    m.castShadow = true;
    lp.edges(m, { width: 1.4 });
    stand.add(m);
  }

  const swing = new THREE.Group();
  swing.position.set(PIVOT.x, PIVOT.y, 0);
  stand.add(swing);
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 1, 6).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: '#3a352f', transparent: true }));
  string.castShadow = true;
  swing.add(string);
  const bob = new THREE.Mesh(new THREE.IcosahedronGeometry(BOB_R, 2), lp.sketch('coral', { hatch: 1.2 }));
  bob.castShadow = true;
  lp.outline(bob, 0.007);
  swing.add(bob);
  swing.add(new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 10), new THREE.MeshBasicMaterial({ color: '#3a352f' })));

  const vertical = lp.ink([[PIVOT.x, PIVOT.y, -0.002], [PIVOT.x, PIVOT.y - 1.05, -0.002]], { radius: 0.0035, dashed: true, dashCount: 22, color: 'graphite', opacity: 0.6 });
  stand.add(vertical);
  let arcMesh = null;
  let lastArc = { A: -1, L: -1 };

  const vArrow = lp.arrow('blueDeep');
  const gArrow = lp.arrow('sepia');
  stand.add(vArrow, gArrow);

  const pop = lp.choreo.popUp(stand, { in: fig, at: HINGE });

  // ---- θ(t) card standing behind ---------------------------------------------
  const board = lp.board({ in: fig, at: [0.1, -0.55], size: [1.5, 0.56], lean: 0.42 });
  const W = 10; // seconds shown

  function drawCard() {
    board.clear();
    const ax = board.axes({ x: [0, W], y: [-100, 100], xLabel: 't', yLabel: 'θ' });
    const t1 = s.time, t0 = t1 - W;
    const w = Math.sqrt(s.g / s.L);
    const pred = [];
    for (let i = 0; i <= 160; i++) {
      const t = t0 + (W * i) / 160;
      if (t < s.release.t) continue;
      pred.push([t - t0, (s.release.th * Math.cos(w * (t - s.release.t))) / DEG]);
    }
    board.plot(ax, pred, { color: P.blueDeep, width: 2.6, dash: [10, 8] });
    const hist = s.hist.map(([t, th]) => [t - t0, th / DEG]);
    board.plot(ax, hist, { color: P.coralDeep, width: 4.2 });
    if (hist.length) board.dot(ax, ...hist[hist.length - 1]);
    board.text('— actual θ(t)', 600, 46, { color: P.coralDeep });
    board.text('- - small-angle θ₀ cos ωt', 600, 88, { color: P.blueDeep });
    board.refresh();
  }
  drawCard();

  // ---- notes -----------------------------------------------------------------
  const notes = {
    theta: lp.note('θ = 30.0°'),
    L: lp.note('L = 1.60 m', { color: 'sepia' }),
    v: lp.note('<i>v</i>', { color: 'blue' }),
    mg: lp.note('<i>mg</i>', { color: 'sepia' }),
    eq1: lp.note('θ̈ = −(g/L) sin θ', { kind: 'equation' }),
    eq2: lp.note('T = 2π√(L/g) ≈ 2.54 s', { kind: 'equation', color: 'coral' }),
  };
  for (const k of ['theta', 'L', 'v', 'mg']) stand.add(notes[k]);

  // ---- interaction -----------------------------------------------------------
  // drag the bob: the touch is projected onto the swing's plane, in the stand's coordinates
  lp.draggable(bob, {
    plane: 'vertical',
    space: stand,
    hitRadius: BOB_R * 2.2,
    onStart: () => {
      s.dragging = true;
      s.omega = 0;
    },
    onDrag: (p) => {
      const a = Math.atan2(p.x - PIVOT.x, -(p.y - PIVOT.y));
      s.theta = lp.util.clamp(a, -165 * DEG, 165 * DEG);
      s.omega = 0;
    },
    onEnd: () => {
      s.dragging = false;
      s.paused = false;
      s.release = { t: s.time, th: s.theta };
      ui.label('play', 'pause', '❚❚');
    },
  });

  const ui = lp.controls([
    { type: 'slider', key: 'L', label: 'string length <i>L</i>', min: 0.4, max: 2.0, step: 0.01, value: L0, format: (v) => `${v.toFixed(2)} m`, onChange: (v) => (s.Lt = v) },
    {
      type: 'slider', key: 'g', label: 'gravity <i>g</i>', min: 1.6, max: 24.8, step: 0.01, value: G0, snap: 0.5,
      ticks: [{ v: 1.62, label: 'Moon' }, { v: 3.71, label: 'Mars' }, { v: 9.81, label: 'Earth' }, { v: 24.79, label: 'Jupiter' }],
      format: (v) => `${v.toFixed(2)} m/s²`, onChange: (v) => (s.gt = v),
    },
    { type: 'button', key: 'play', icon: '▶', label: 'play', onClick: () => togglePause() },
    { type: 'button', key: 'reset', icon: '↺', label: 'reset', onClick: () => reset() },
    { type: 'button', key: 'big', icon: '◠', label: 'big swing', onClick: () => setAngle(150 * DEG) },
  ]);

  function togglePause() {
    s.paused = !s.paused;
    if (!s.paused) s.release = { t: s.time, th: s.theta };
    ui.label('play', s.paused ? 'play' : 'pause', s.paused ? '▶' : '❚❚');
  }
  function setAngle(a) {
    s.theta = a;
    s.omega = 0;
    s.paused = false;
    s.release = { t: s.time, th: a };
    ui.label('play', 'pause', '❚❚');
  }
  function reset() {
    s.Lt = L0;
    s.gt = G0;
    ui.set('L', L0);
    ui.set('g', G0);
    s.paused = true;
    s.omega = 0;
    lp.gsap.to(s, { theta: TH0, duration: 0.8, ease: 'power3.inOut', onComplete: () => { s.paused = false; s.release = { t: s.time, th: TH0 }; s.hist = []; } });
  }

  // ---- pose ------------------------------------------------------------------
  function updateArc() {
    const Lv = s.L * VIS_PER_M;
    // amplitude from energy: cos A = cos θ − ω²L / 2g
    const c = Math.cos(s.theta) - (s.omega * s.omega * s.L) / (2 * s.g);
    const A = c < -1 ? Math.PI : Math.acos(Math.min(1, c));
    if (Math.abs(A - lastArc.A) < 0.01 && Math.abs(Lv - lastArc.L) < 0.004) return;
    lastArc = { A, L: Lv };
    if (arcMesh) {
      stand.remove(arcMesh);
      lp.dispose(arcMesh);
    }
    const AA = Math.max(A, 0.02);
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const a = -AA + (2 * AA * i) / 64;
      pts.push([PIVOT.x + Math.sin(a) * Lv, PIVOT.y - Math.cos(a) * Lv, -0.004]);
    }
    arcMesh = lp.ink(pts, { radius: 0.004, dashed: true, dashCount: Math.max(8, Math.round(AA * Lv * 40)), color: 'blueDeep', opacity: 0.75, progress: pop.state.draw });
    arcMesh.userData.drawOn = false;
    stand.add(arcMesh);
  }

  function applyPose() {
    const Lv = s.L * VIS_PER_M;
    swing.rotation.z = s.theta;
    string.scale.y = Lv - BOB_R * 0.8;
    bob.position.y = -Lv;
    const bobPos = new THREE.Vector3(PIVOT.x + Math.sin(s.theta) * Lv, PIVOT.y - Math.cos(s.theta) * Lv, 0);
    const tangent = new THREE.Vector3(Math.cos(s.theta), Math.sin(s.theta), 0);
    const v = s.omega * Lv;
    const vlen = Math.min(0.5, Math.abs(v) * 0.22);
    vArrow.visible = vlen > 0.03;
    lp.setArrow(vArrow, bobPos.clone().addScaledVector(tangent, Math.sign(v) * BOB_R), tangent.clone().multiplyScalar(Math.sign(v) || 1), vlen);
    const glen = 0.06 + s.g * 0.018;
    lp.setArrow(gArrow, bobPos.clone().add(new THREE.Vector3(0, -BOB_R, 0)), new THREE.Vector3(0, -1, 0), glen);
    notes.mg.position.copy(bobPos).add(new THREE.Vector3(0.07, -BOB_R - glen * 0.7, 0));
    notes.v.position.copy(bobPos).addScaledVector(tangent, Math.sign(v) * (BOB_R + vlen + 0.05)).add(new THREE.Vector3(0, 0.04, 0));
    notes.v.element.style.visibility = vArrow.visible ? 'visible' : 'hidden';
    notes.theta.position.set(PIVOT.x - 0.26, PIVOT.y - 0.3, 0);
    const side = s.theta >= 0 ? 1 : -1;
    notes.L.position.set(PIVOT.x + Math.sin(s.theta) * Lv * 0.62 + side * Math.cos(s.theta) * 0.17, PIVOT.y - Math.cos(s.theta) * Lv * 0.62 + side * Math.sin(s.theta) * 0.17, 0);
    notes.theta.set(`θ = ${(s.theta / DEG).toFixed(1)}°`);
    notes.L.set(`L = ${s.L.toFixed(2)} m`);
    updateArc();
  }
  applyPose();

  // ---- physics ---------------------------------------------------------------
  const sim = lp.ode((t, [th, om]) => [om, -(s.g / s.L) * Math.sin(th)], [s.theta, s.omega]);
  let cardTick = 0;

  return {
    root: fig,
    view: { lift: 0.55, polar: 1.02, azimuth: 0.1, zoom: 0.95 },
    enter(tl) {
      tl.add(() => {
        s.theta = TH0;
        s.omega = 0;
        s.paused = true;
        applyPose();
      }, 0);
      const end = pop.enter(tl, 0);
      board.enter(tl, 0.35);
      tl.add(() => {
        s.paused = false;
        s.hist = [];
        s.release = { t: s.time, th: s.theta };
        ui.label('play', 'pause', '❚❚');
        [notes.theta, notes.L, notes.mg, notes.v].forEach((n, i) => n.reveal(i * 0.12, 0.5));
        notes.eq1.reveal(0.3, 0.9);
        notes.eq2.reveal(0.8, 0.9);
      }, end - 0.2);
    },
    exit(tl) {
      tl.add(() => {
        Object.values(notes).forEach((n) => n.hide());
        s.paused = true;
      }, 0);
      tl.to(s, { theta: TH0, omega: 0, duration: 0.6, ease: 'power2.inOut', onUpdate: applyPose }, 0);
      board.exit(tl, 0.2);
      pop.exit(tl, 0.4);
    },
    update(dt) {
      s.L = lp.util.damp(s.L, s.Lt, 8, dt);
      s.g = lp.util.damp(s.g, s.gt, 8, dt);
      if (!s.paused && !s.dragging) {
        sim.set([s.theta, s.omega]);
        [s.theta, s.omega] = sim.step(Math.min(dt, 1 / 30), 4);
        s.time += Math.min(dt, 1 / 30);
        s.hist.push([s.time, s.theta]);
      } else if (s.dragging) {
        s.time += dt;
        s.hist.push([s.time, s.theta]);
        s.release = { t: s.time, th: s.theta };
      }
      while (s.hist.length && s.hist[0][0] < s.time - W) s.hist.shift();
      applyPose();
      notes.eq2.set(`T = 2π√(L/g) ≈ ${(2 * Math.PI * Math.sqrt(s.L / s.g)).toFixed(2)} s`);
      cardTick += dt;
      if (cardTick > 1 / 30 && board.state.open > 0.5) {
        cardTick = 0;
        drawCard();
      }
    },
    dispose() {},
  };
}
