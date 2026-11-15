// Projectile motion — the printed trajectory figure pops up off the page and
// becomes a live, RK4-integrated launch: a coral ball flies along the parabola
// leaving a dashed ink trail, with its velocity v and components vx, vy drawn
// as in the textbook, ghost markers at equal time steps, and a graph-paper card
// behind plotting vx(t) and vy(t). Drag the launch arrow tip to aim.
export default function create(lp, ctx) {
  const { THREE, palette: P } = lp;
  const DEG = lp.util.DEG;
  const { clamp, damp } = lp.util;

  // design space: the figure is 2.0 wide × 1.3 tall, origin at its centre,
  // x right, z down the page. The pop-up stands on the figure's bottom edge.
  const fig = lp.figure.frame(2.0, 1.3);
  const HINGE = [0, 0.58];
  const X0 = -0.8, Y0 = 0.2; // launch point (origin of the axes) in the standing pop-up's x/y,
  // raised off the paper so the downward arrows at landing stay visible
  const X_AVAIL = 1.5, Y_AVAIL = 0.8; // room for the flight inside the axes
  const AX_X = 1.66, AX_Y = 0.96; // axis lengths
  const BALL_R = 0.05;
  const VK = 0.024; // world units per m/s for velocity arrows
  const DRAG_K = 0.35; // linear drag b/m in 1/s
  const V_MIN = 3, V_MAX = 25, TH_MIN = 5, TH_MAX = 85;

  const TH0 = lp.param('theta0', 45, [TH_MIN, TH_MAX]);
  const V0 = lp.param('v0', 12, [V_MIN, V_MAX]);
  const G0 = lp.param('g', 9.8, [1, 30]);

  const s = {
    th: TH0, v0: V0, g: G0, gt: G0, drag: false,
    mode: 'aim', auto: true, autoAt: Infinity, dragging: false,
    t: 0, st: [0, 0, 0, 0], K: 0.1, Kt: 0.1,
    trail: [], hist: [], ghosts: 0, landX: 0,
    pred: null, predDirty: true,
  };

  // ---- the pop-up figure ----------------------------------------------------
  const stand = new THREE.Group();
  const P3 = (x, y, z = 0) => new THREE.Vector3(X0 + x * s.K, Y0 + y * s.K, z);

  // sketchy axes in ink, with cone heads
  const inkMat = () => new THREE.MeshBasicMaterial({ color: P.ink, transparent: true });
  const xAxis = lp.ink([[X0 - 0.05, Y0, -0.003], [X0 + 0.4, Y0 + 0.002, -0.003], [X0 + AX_X, Y0, -0.003]], { radius: 0.0055, jitter: 0.002 });
  const yAxis = lp.ink([[X0, Y0 - 0.17, -0.003], [X0 - 0.002, Y0 + 0.5, -0.003], [X0, Y0 + AX_Y, -0.003]], { radius: 0.0055, jitter: 0.002 });
  const xHead = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 10).rotateZ(-Math.PI / 2), inkMat());
  xHead.position.set(X0 + AX_X + 0.02, Y0, -0.003);
  const yHead = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.06, 10), inkMat());
  yHead.position.set(X0, Y0 + AX_Y + 0.02, -0.003);
  stand.add(xAxis, yAxis, xHead, yHead);

  // metre ticks (repositioned as the scale changes)
  const tickGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.045, 5);
  const xTicks = [], yTicks = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(tickGeo, inkMat());
    m.visible = false;
    xTicks.push(m);
    stand.add(m);
  }
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(tickGeo, inkMat());
    m.rotation.z = Math.PI / 2;
    m.visible = false;
    yTicks.push(m);
    stand.add(m);
  }

  // landing marker for the predicted range
  const rMark = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 5), new THREE.MeshBasicMaterial({ color: P.sepia, transparent: true }));
  stand.add(rMark);

  // ball
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R, 2), lp.sketch('coral', { hatch: 1.2 }));
  ball.castShadow = true;
  lp.outline(ball, 0.007);
  stand.add(ball);

  // dashed arrow: lp.arrow with its solid shaft swapped for dashes (setArrow still scales it)
  function dashedArrow(c, o = {}, n = 6) {
    const a = lp.arrow(c, o);
    const { shaft, mat } = a.userData;
    a.remove(shaft);
    shaft.geometry.dispose();
    const dashes = new THREE.Group();
    const r = o.radius ?? 0.008;
    const geo = new THREE.CylinderGeometry(r, r, 0.6 / n, 6);
    for (let i = 0; i < n; i++) {
      const d = new THREE.Mesh(geo, mat);
      d.position.y = (i + 0.3) / n;
      d.raycast = () => {};
      dashes.add(d);
    }
    a.add(dashes);
    a.userData.shaft = dashes;
    return a;
  }

  // live velocity arrows, coloured like the printed figure
  const vArrow = lp.arrow('lavenderDeep', { radius: 0.008 });
  const vxArrow = dashedArrow('blueDeep', { radius: 0.006, head: 0.055, headR: 0.022 });
  const vyArrow = dashedArrow('coral', { radius: 0.006, head: 0.055, headR: 0.022 });
  stand.add(vArrow, vxArrow, vyArrow);

  // launch arrow v₀ with a draggable tip
  const launchArrow = lp.arrow('lavender', { radius: 0.006, head: 0.06, headR: 0.024 });
  launchArrow.userData.mat.opacity = 0.75;
  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 10), lp.sketch('yellow', { hatch: 0.6 }));
  lp.outline(handle, 0.005);
  stand.add(launchArrow, handle);

  // ghost markers at equal time steps
  const GHOSTS = 14;
  const ghosts = [];
  for (let i = 0; i < GHOSTS; i++) {
    const g = new THREE.Group();
    const dot = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL_R * 0.62, 1), lp.sketch('lavender', { hatch: 0.6, opacity: 0.55 }));
    const gv = lp.arrow('lavenderDeep', { radius: 0.004, head: 0.04, headR: 0.015 });
    const gx = dashedArrow('blueDeep', { radius: 0.0035, head: 0.035, headR: 0.013 }, 5);
    const gy = dashedArrow('coral', { radius: 0.0035, head: 0.035, headR: 0.013 }, 5);
    for (const a of [gv, gx, gy]) a.userData.mat.opacity = 0.5;
    g.add(dot, gv, gx, gy);
    g.visible = false;
    g.userData = { gv, gx, gy, m: [0, 0, 0, 0] };
    ghosts.push(g);
    stand.add(g);
  }

  let predMesh = null, trailMesh = null, arcMesh = null;
  let drawnK = { pred: -1, trail: -1 }, arcTh = -1, trailLen = -1, trailClock = 0;

  const pop = lp.choreo.popUp(stand, { at: HINGE });
  fig.add(pop.group); // hinge in the figure frame's coordinates

  // ---- vx(t), vy(t) card standing behind ------------------------------------
  const board = lp.board({ at: [-0.45, -0.52], size: [0.95, 0.45], lean: 0.55 });
  fig.add(board.group);

  // ---- notes ----------------------------------------------------------------
  const notes = {
    v: lp.note('<i>v</i>', { color: 'lavender' }),
    vx: lp.note('<i>v</i><sub>x</sub>', { color: 'blue' }),
    vy: lp.note('<i>v</i><sub>y</sub>', { color: 'coral' }),
    v0: lp.note('<i>v</i><sub>0</sub> = 12.0 m/s', { color: 'lavender', anchor: 'left' }),
    th: lp.note('θ<sub>0</sub> = 45°'),
    x: lp.note('<i>x</i> (m)'),
    y: lp.note('<i>y</i> (m)'),
    R: lp.note('R = 14.7 m', { color: 'sepia' }),
    rt: lp.note('t = 0.00 s', { kind: 'readout', anchor: 'left' }),
    rx: lp.note('x = 0.00 m', { kind: 'readout', anchor: 'left' }),
    ry: lp.note('y = 0.00 m', { kind: 'readout', anchor: 'left' }),
    rv: lp.note('|v| = 0.0 m/s', { kind: 'readout', anchor: 'left', color: 'lavender' }),
    rg: lp.note('ghosts every 0.2 s', { kind: 'readout', anchor: 'left', color: 'sepia' }),
    eq1: lp.note('x = v₀cosθ₀·t', { kind: 'equation', color: 'blue' }),
    eq2: lp.note('y = v₀sinθ₀·t − ½gt²', { kind: 'equation', color: 'coral' }),
    eq3: lp.note('R = v₀² sin2θ₀ / g', { kind: 'equation' }),
  };
  const xLabels = xTicks.map(() => lp.note('0', { color: 'sepia' }));
  const yLabels = yTicks.map(() => lp.note('0', { color: 'sepia' }));
  const inStand = ['v', 'vx', 'vy', 'v0', 'th', 'x', 'y', 'R', 'rt', 'rx', 'ry', 'rv', 'rg'];
  for (const k of inStand) stand.add(notes[k]);
  for (const n of [...xLabels, ...yLabels]) stand.add(n);
  notes.x.position.set(X0 + AX_X + 0.03, Y0 - 0.075, 0);
  notes.y.position.set(X0 + 0.11, Y0 + AX_Y - 0.03, 0);
  ['rt', 'rx', 'ry', 'rv', 'rg'].forEach((k, i) => notes[k].position.set(0.5, Y0 + 0.8 - i * 0.05, 0));
  // readouts sit on a faint paper wash so they stay legible over printed text
  const chip = (h) => `<span style="background:rgba(251,246,234,0.8);border-radius:4px;padding:0 4px">${h}</span>`;
  const show = (n, on) => (n.element.style.visibility = on ? 'visible' : 'hidden');

  // ---- prediction (closed form; matches the integrator) ---------------------
  const kNow = () => (s.drag ? DRAG_K : 0);
  function stateAt(t, th, v0, g, k) {
    const vx0 = v0 * Math.cos(th), vy0 = v0 * Math.sin(th);
    if (k < 1e-6) return [vx0 * t, vy0 * t - 0.5 * g * t * t, vx0, vy0 - g * t];
    const e = Math.exp(-k * t), vt = g / k;
    return [(vx0 / k) * (1 - e), ((vy0 + vt) / k) * (1 - e) - vt * t, vx0 * e, (vy0 + vt) * e - vt];
  }
  function predict() {
    const th = s.th * DEG, k = kNow();
    const T0 = (2 * s.v0 * Math.sin(th)) / s.g;
    const h = T0 / 400;
    let t = h;
    while (stateAt(t, th, s.v0, s.g, k)[1] > 0 && t < T0 * 2) t += h;
    let a = t - h, b = t;
    for (let i = 0; i < 30; i++) {
      const m = (a + b) / 2;
      if (stateAt(m, th, s.v0, s.g, k)[1] > 0) a = m;
      else b = m;
    }
    const T = (a + b) / 2;
    const pts = [];
    let H = 0;
    for (let i = 0; i <= 90; i++) {
      const p = stateAt((T * i) / 90, th, s.v0, s.g, k);
      pts.push(p);
      H = Math.max(H, p[1]);
    }
    const R = pts[pts.length - 1][0];
    s.pred = { T, R, H, pts, th, k };
    s.Kt = Math.min(X_AVAIL / Math.max(R, 1e-3), Y_AVAIL / Math.max(H, 1e-3));
    // ghosts every Δt, a "nice" step giving ~7 per flight
    const raw = T / 7;
    const steps = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10];
    s.pred.dt = steps.reduce((best, x) => (Math.abs(Math.log(x / raw)) < Math.abs(Math.log(best / raw)) ? x : best));
    s.predDirty = false;
  }

  const niceStep = (x) => {
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    const f = x / p;
    return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
  };

  // ---- drawing helpers ------------------------------------------------------
  function swapMesh(old, pts, o) {
    if (old) {
      stand.remove(old);
      lp.dispose(old);
    }
    const m = lp.ink(pts, { ...o, progress: o.progress ?? pop.state.draw });
    m.userData.drawOn = false;
    stand.add(m);
    return m;
  }

  function drawPred() {
    const pts = s.pred.pts.map(([x, y]) => P3(x, y, -0.006));
    predMesh = swapMesh(predMesh, pts, { radius: 0.0032, color: 'graphite', opacity: 0.32 });
    drawnK.pred = s.K;
  }

  function drawTrail() {
    if (s.trail.length < 2) {
      if (trailMesh) trailMesh.visible = false;
      trailLen = s.trail.length;
      return;
    }
    const pts = s.trail.map(([x, y]) => P3(x, y, -0.002));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    trailMesh = swapMesh(trailMesh, pts, { radius: 0.0045, dashed: true, dashCount: Math.max(3, Math.round(len * 38)), color: 'ink', opacity: 0.85 });
    drawnK.trail = s.K;
    trailLen = s.trail.length;
  }

  function drawArc() {
    const th = s.th * DEG, r = 0.17;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const a = (th * i) / 24;
      pts.push([X0 + Math.cos(a) * r, Y0 + Math.sin(a) * r, -0.004]);
    }
    arcMesh = swapMesh(arcMesh, pts, { radius: 0.0035, color: 'graphite', opacity: 0.8 });
    arcTh = s.th;
    notes.th.position.set(X0 + Math.cos(th / 2) * (r + 0.1) + 0.04, Y0 + Math.sin(th / 2) * (r + 0.1), 0);
  }

  function placeTicks() {
    const xs = niceStep(X_AVAIL / s.K / 4);
    const ys = niceStep(Math.max(AX_Y - 0.12, 0.2) / s.K / 3);
    xTicks.forEach((m, i) => {
      const v = (i + 1) * xs, X = X0 + v * s.K;
      const on = X < X0 + AX_X - 0.06;
      m.visible = on;
      m.position.set(X, Y0, -0.003);
      show(xLabels[i], on && pop.state.lift > 0.9);
      xLabels[i].position.set(X, Y0 - 0.075, 0);
      xLabels[i].set(fmtNum(v));
    });
    yTicks.forEach((m, i) => {
      const v = (i + 1) * ys, Y = Y0 + v * s.K;
      const on = Y < Y0 + AX_Y - 0.1;
      m.visible = on;
      m.position.set(X0, Y, -0.003);
      show(yLabels[i], on && pop.state.lift > 0.9);
      yLabels[i].position.set(X0 - 0.08, Y, 0);
      yLabels[i].set(fmtNum(v));
    });
  }
  const fmtNum = (v) => (v >= 10 ? v.toFixed(0) : v >= 1 ? +v.toFixed(1) + '' : +v.toFixed(2) + '');

  function placeVel(arrows, origin, vx, vy, lab) {
    const [av, ax, ay] = arrows;
    const sp = Math.hypot(vx, vy);
    av.visible = sp * VK > 0.02;
    if (av.visible) lp.setArrow(av, origin, new THREE.Vector3(vx, vy, 0), sp * VK);
    ax.visible = Math.abs(vx) * VK > 0.02;
    if (ax.visible) lp.setArrow(ax, origin, new THREE.Vector3(Math.sign(vx), 0, 0), Math.abs(vx) * VK);
    ay.visible = Math.abs(vy) * VK > 0.02;
    if (ay.visible) lp.setArrow(ay, origin, new THREE.Vector3(0, Math.sign(vy), 0), Math.abs(vy) * VK);
    if (lab) {
      const d = new THREE.Vector3(vx, vy, 0).normalize();
      notes.v.position.copy(origin).addScaledVector(d, sp * VK + 0.06);
      notes.vx.position.copy(origin).add(new THREE.Vector3(Math.abs(vx) * VK * 0.55, vy >= 0 ? -0.06 : 0.06, 0));
      notes.vy.position.copy(origin).add(new THREE.Vector3(-0.07, Math.sign(vy) * Math.abs(vy) * VK * 0.6, 0));
      show(notes.v, av.visible);
      show(notes.vx, ax.visible);
      show(notes.vy, ay.visible);
    }
  }

  // ---- θ₀ / v₀ from the launch arrow ---------------------------------------
  function placeLaunch() {
    const th = s.th * DEG;
    const d = new THREE.Vector3(Math.cos(th), Math.sin(th), 0);
    const o = new THREE.Vector3(X0, Y0, 0.004);
    lp.setArrow(launchArrow, o, d, s.v0 * VK);
    handle.position.copy(o).addScaledVector(d, s.v0 * VK + 0.01);
    notes.v0.position.copy(handle.position).add(new THREE.Vector3(0.05, 0.035, 0));
    notes.v0.set(`<i>v</i><sub>0</sub> = ${s.v0.toFixed(1)} m/s`);
    notes.th.set(`θ<sub>0</sub> = ${s.th.toFixed(0)}°`);
  }

  // ---- shot lifecycle -------------------------------------------------------
  function aim(delay = 0.9) {
    s.mode = 'aim';
    s.t = 0;
    s.st = stateAt(0, s.th * DEG, s.v0, s.g, 0);
    s.trail = [];
    s.hist = [];
    s.ghosts = 0;
    ghosts.forEach((g) => (g.visible = false));
    drawTrail();
    s.autoAt = s.auto && !s.dragging ? s.clock + delay : Infinity;
    setButton();
  }
  function launch() {
    if (s.mode !== 'aim') aim(0);
    s.mode = 'flying';
    s.auto = true;
    s.autoAt = Infinity;
    s.st = stateAt(0, s.th * DEG, s.v0, s.g, 0);
    s.trail = [[0, 0]];
    s.hist = [[0, s.st[2], s.st[3]]];
    setButton();
  }
  function togglePlay() {
    if (s.mode === 'flying') {
      s.mode = 'paused';
      s.auto = false;
      s.autoAt = Infinity;
    } else if (s.mode === 'paused') {
      s.mode = 'flying';
      s.auto = true;
    } else launch();
    setButton();
  }
  function setButton() {
    if (!ui) return;
    if (s.mode === 'flying') ui.label('play', 'pause', '❚❚');
    else if (s.mode === 'paused') ui.label('play', 'resume', '▶');
    else ui.label('play', 'launch', '➚');
  }
  function reset() {
    s.th = TH0;
    s.v0 = V0;
    s.gt = G0;
    s.drag = false;
    ui.set('theta', TH0);
    ui.set('v0', V0);
    ui.set('g', G0);
    ui.set('drag', false);
    s.auto = true;
    s.predDirty = true;
    aim(1.0);
  }

  s.clock = 0;
  let ui = null;
  ui = lp.controls([
    { type: 'slider', key: 'theta', label: 'launch angle <i>θ</i><sub>0</sub>', min: TH_MIN, max: TH_MAX, step: 1, value: TH0, format: (v) => `${v.toFixed(0)}°`, onChange: (v) => { s.th = v; s.predDirty = true; aim(); } },
    { type: 'slider', key: 'v0', label: 'launch speed <i>v</i><sub>0</sub>', min: V_MIN, max: V_MAX, step: 0.1, value: V0, format: (v) => `${v.toFixed(1)} m/s`, onChange: (v) => { s.v0 = v; s.predDirty = true; aim(); } },
    {
      type: 'slider', key: 'g', label: 'gravity <i>g</i>', min: 1.6, max: 24.8, step: 0.01, value: G0, snap: 0.5,
      ticks: [{ v: 1.62, label: 'Moon' }, { v: 3.71, label: 'Mars' }, { v: 9.81, label: 'Earth' }, { v: 24.79, label: 'Jupiter' }],
      format: (v) => `${v.toFixed(2)} m/s²`, onChange: (v) => (s.gt = v),
    },
    { type: 'toggle', key: 'drag', label: 'air drag', icon: '≋', value: false, onChange: (v) => { s.drag = v; s.predDirty = true; } },
    { type: 'button', key: 'play', icon: '➚', label: 'launch', onClick: () => togglePlay() },
    { type: 'button', key: 'reset', icon: '↺', label: 'reset', onClick: () => reset() },
  ]);

  lp.draggable(handle, {
    plane: 'vertical',
    space: stand,
    hitRadius: 0.07,
    onStart: () => {
      s.dragging = true;
      aim();
    },
    onDrag: (p) => {
      const dx = p.x - X0, dy = p.y - Y0;
      s.th = Math.round(clamp(Math.atan2(dy, dx) / DEG, TH_MIN, TH_MAX));
      s.v0 = Math.round(clamp(Math.hypot(dx, dy) / VK, V_MIN, V_MAX) * 10) / 10;
      ui.set('theta', s.th);
      ui.set('v0', s.v0);
      s.predDirty = true;
      s.st = stateAt(0, s.th * DEG, s.v0, s.g, 0);
    },
    onEnd: () => {
      s.dragging = false;
      launch();
    },
  });

  // ---- vx(t), vy(t) card ----------------------------------------------------
  function drawCard() {
    const pr = s.pred;
    board.clear();
    const Tm = pr.T * 1.08, vm = Math.max(s.v0, Math.abs(pr.pts[pr.pts.length - 1][3])) * 1.1;
    const ax = board.axes({ x: [0, Tm], y: [-vm, vm], xLabel: 't', yLabel: 'v' });
    const px = [], py = [];
    for (let i = 0; i <= 80; i++) {
      const t = (pr.T * i) / 80;
      const st = stateAt(t, pr.th, s.v0, s.g, pr.k);
      px.push([t, st[2]]);
      py.push([t, st[3]]);
    }
    board.plot(ax, px, { color: P.blueDeep, width: 2.6, dash: [10, 8] });
    board.plot(ax, py, { color: P.coralDeep, width: 2.6, dash: [10, 8] });
    board.plot(ax, s.hist.map(([t, vx]) => [t, vx]), { color: P.blueDeep, width: 4.2 });
    board.plot(ax, s.hist.map(([t, , vy]) => [t, vy]), { color: P.coralDeep, width: 4.2 });
    if (s.hist.length) {
      const [t, vx, vy] = s.hist[s.hist.length - 1];
      board.dot(ax, t, vx, { color: P.blueDeep });
      board.dot(ax, t, vy);
    }
    board.text('vx — constant', 560, 52, { color: P.blueDeep });
    board.text(s.drag ? 'vy — drag bends it' : 'vy — slope −g', 560, 94, { color: P.coralDeep });
    board.refresh();
  }

  // ---- pose -----------------------------------------------------------------
  function applyPose() {
    if (s.predDirty) predict();
    if (Math.abs(arcTh - s.th) > 0.4) drawArc();
    if (Math.abs(drawnK.pred - s.K) > s.K * 0.003 || predMesh?.userData.p !== s.pred) {
      drawPred();
      predMesh.userData.p = s.pred;
    }
    if (Math.abs(drawnK.trail - s.K) > s.K * 0.003) drawTrail();
    placeTicks();
    placeLaunch();

    const [x, y, vx, vy] = s.st;
    const bp = P3(x, y, 0);
    ball.position.copy(bp);
    placeVel([vArrow, vxArrow, vyArrow], bp, vx, vy, true);
    for (let i = 0; i < GHOSTS; i++) {
      const g = ghosts[i];
      if (!g.visible) continue;
      const [gx, gy, gvx, gvy] = g.userData.m;
      const o = P3(gx, gy, -0.001);
      g.children[0].position.copy(o);
      placeVel([g.userData.gv, g.userData.gx, g.userData.gy], o, gvx, gvy, false);
    }

    const pr = s.pred;
    notes.R.position.copy(P3(pr.R, 0)).add(new THREE.Vector3(0.02, -0.14, 0));
    rMark.position.copy(P3(pr.R, 0)).add(new THREE.Vector3(0, 0.035, -0.003));
    notes.R.set(`↑ R = ${pr.R.toFixed(1)} m`);
    notes.rt.set(chip(`t = ${s.t.toFixed(2)} s`));
    notes.rg.set(chip(`ghosts every Δt = ${pr.dt} s`));
    notes.rx.set(chip(`x = ${x.toFixed(2)} m`));
    notes.ry.set(chip(`y = ${Math.max(0, y).toFixed(2)} m`));
    notes.rv.set(chip(`|v| = ${Math.hypot(vx, vy).toFixed(1)} m/s`));

    const th = s.th * DEG;
    const c = s.v0 * Math.cos(th), si = s.v0 * Math.sin(th);
    notes.eq1.set(`x = v₀cosθ₀·t = ${c.toFixed(2)} t`);
    notes.eq2.set(`y = v₀sinθ₀·t − ½gt² = ${si.toFixed(2)} t − ${(s.g / 2).toFixed(2)} t²`);
    const Rf = (s.v0 * s.v0 * Math.sin(2 * th)) / s.g;
    notes.eq3.set(`R = v₀² sin2θ₀ / g = ${Rf.toFixed(1)} m${s.drag ? ` <span style="opacity:.75">(with drag ${pr.R.toFixed(1)} m)</span>` : ''}`);
  }

  // ---- physics --------------------------------------------------------------
  const sim = lp.ode((t, [x, y, vx, vy]) => {
    const k = kNow();
    return [vx, vy, -k * vx, -s.g - k * vy];
  }, s.st.slice());

  function stepFlight(dt) {
    const prev = s.st.slice();
    sim.set(s.st);
    const next = sim.step(dt, 4).slice();
    let t1 = s.t + dt;
    let landed = false;
    if (next[1] <= 0 && next[3] < 0 && s.t > 0) {
      const f = prev[1] / Math.max(prev[1] - next[1], 1e-9);
      for (let i = 0; i < 4; i++) next[i] = prev[i] + (next[i] - prev[i]) * f;
      next[1] = 0;
      t1 = s.t + dt * f;
      landed = true;
    }
    // ghosts at multiples of Δt
    const gdt = s.pred.dt;
    while (s.ghosts < GHOSTS && (s.ghosts + 1) * gdt <= t1 + 1e-9) {
      const tg = (s.ghosts + 1) * gdt;
      const f = (tg - s.t) / Math.max(t1 - s.t, 1e-9);
      const g = ghosts[s.ghosts++];
      g.userData.m = prev.map((v, i) => v + (next[i] - v) * f);
      g.visible = true;
    }
    s.st = next;
    s.t = t1;
    s.trail.push([next[0], next[1]]);
    s.hist.push([s.t, next[2], next[3]]);
    if (landed) {
      s.mode = 'landed';
      s.landX = next[0];
      s.autoAt = s.auto ? s.clock + 3.2 : Infinity;
      setButton();
      drawTrail();
    }
  }

  predict();
  s.K = s.Kt;
  aim(0);
  applyPose();
  drawCard();
  let cardTick = 0;

  return {
    root: fig,
    view: { lift: 0.4, polar: 1.04, azimuth: 0.04, zoom: 0.98 },
    enter(tl) {
      tl.add(() => {
        s.auto = true;
        s.predDirty = true;
        aim(0);
        s.autoAt = Infinity;
        applyPose();
      }, 0);
      const end = pop.enter(tl, 0);
      board.enter(tl, 0.35);
      tl.add(() => {
        [notes.x, notes.y, notes.th, notes.v0, notes.R, notes.v, notes.vx, notes.vy].forEach((n, i) => n.reveal(i * 0.08, 0.5));
        [notes.rt, notes.rx, notes.ry, notes.rv, notes.rg].forEach((n, i) => n.reveal(0.3 + i * 0.1, 0.5));
        [...xLabels, ...yLabels].forEach((n) => n.reveal(0.2, 0.4));
        notes.eq1.reveal(0.3, 0.9);
        notes.eq2.reveal(0.7, 0.9);
        notes.eq3.reveal(1.1, 0.9);
        launch();
      }, end - 0.2);
    },
    exit(tl) {
      tl.add(() => {
        Object.values(notes).forEach((n) => n.hide());
        [...xLabels, ...yLabels].forEach((n) => n.hide());
        s.mode = 'paused';
        s.autoAt = Infinity;
      }, 0);
      board.exit(tl, 0.2);
      pop.exit(tl, 0.4);
    },
    update(dt) {
      s.clock += dt;
      const g1 = damp(s.g, s.gt, 8, dt);
      if (Math.abs(g1 - s.g) > 1e-5) {
        s.g = g1;
        s.predDirty = true;
      }
      if (s.predDirty) predict();
      s.K = damp(s.K, s.Kt, 5, dt);

      const h = Math.min(dt, 1 / 30);
      if (s.mode === 'flying') {
        stepFlight(h);
        trailClock += h;
        if (trailClock > 1 / 20 || s.mode === 'landed') {
          trailClock = 0;
          drawTrail();
        }
      } else if (s.mode === 'aim') {
        s.st = stateAt(0, s.th * DEG, s.v0, s.g, 0);
      }
      if (s.clock >= s.autoAt) {
        s.autoAt = Infinity;
        launch();
      }
      applyPose();

      cardTick += dt;
      if (cardTick > 1 / 30 && board.state.open > 0.5) {
        cardTick = 0;
        drawCard();
      }
    },
    dispose() {
      for (const m of [predMesh, trailMesh, arcMesh]) if (m) lp.dispose(m);
    },
  };
}
