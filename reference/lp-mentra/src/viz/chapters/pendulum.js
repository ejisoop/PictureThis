// Chapter I — The simple pendulum. Printed side-view figure pops up off the
// page like a pop-up book and becomes a live RK4-integrated pendulum.
import * as THREE from 'three';
import gsap from 'gsap';
import { PALETTE, FONTS, sketchPath, sketchLine, sketchCircle, sketchArrow, watercolor, handText, serif, drawMath } from '../paper.js';
import { caption, noteScribble } from '../pages.js';
import { sketchMaterial, addHullOutline, addEdges, inkTube, makeArrow, setArrow, setTreeOpacity, disposeTree } from '../sketch.js';
import { makeNote } from '../ui.js';

const DEG = Math.PI / 180;
// hinge (bottom-centre of the figure) in page coordinates
const HA = { x: 1.05, z: 0.1 };
const PIVOT = new THREE.Vector2(0.08, 1.22);
const POLE_X = -0.66;
const ARM_Y = 1.27;
const BOB_R = 0.075;
const VIS_PER_M = 0.5; // world units per metre of string
const L0 = 1.6, TH0 = 30 * DEG, G0 = 9.81;
// graph card (page coords)
const GR = { x0: 0.33, x1: 1.77, z0: 0.46, z1: 1.02 };
const HB = { x: (GR.x0 + GR.x1) / 2, z: GR.z1 };

const toPage = (X, Y) => [HA.x + X, HA.z - Y];

function drawGraph(ctx, w, h, { mode = 'print', hist = null, pred = null, paper = false }) {
  if (paper) {
    ctx.fillStyle = '#f8f2e4';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(140,110,70,0.25)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
  }
  const s = w / 1024;
  const ox = 90 * s, oy = h / 2 + 6 * s, gw = w - 130 * s, gh = h / 2 - 50 * s;
  const ink = mode === 'ghost' ? 'rgba(90,86,80,0.18)' : PALETTE.graphite;
  // grid
  ctx.save();
  ctx.strokeStyle = mode === 'ghost' ? 'rgba(90,86,80,0.06)' : 'rgba(110,140,170,0.18)';
  ctx.lineWidth = 1.2 * s;
  for (let i = 1; i <= 10; i++) {
    ctx.beginPath();
    ctx.moveTo(ox + (gw * i) / 10, oy - gh);
    ctx.lineTo(ox + (gw * i) / 10, oy + gh);
    ctx.stroke();
  }
  for (const f of [-1, -0.5, 0.5, 1]) {
    ctx.beginPath();
    ctx.moveTo(ox, oy - gh * f);
    ctx.lineTo(ox + gw, oy - gh * f);
    ctx.stroke();
  }
  ctx.restore();
  sketchArrow(ctx, ox, oy, ox + gw + 24 * s, oy, { color: ink, width: 2.6 * s, head: 14 * s, seed: 3 });
  sketchArrow(ctx, ox, oy + gh + 8 * s, ox, oy - gh - 22 * s, { color: ink, width: 2.6 * s, head: 14 * s, seed: 5 });
  ctx.save();
  ctx.font = `italic 400 ${34 * s}px ${FONTS.serif}`;
  ctx.fillStyle = ink;
  ctx.fillText('θ', ox - 50 * s, oy - gh + 10 * s);
  ctx.fillText('t', ox + gw + 2 * s, oy + 36 * s);
  ctx.font = `400 ${22 * s}px ${FONTS.serif}`;
  ctx.fillText('+90°', ox - 70 * s, oy - gh + 44 * s);
  ctx.fillText('−90°', ox - 70 * s, oy + gh);
  ctx.restore();
  const yOf = (th) => oy - (th / (100 * DEG)) * gh * 1.1;
  if (mode === 'ghost') return;

  if (hist) {
    // live: true motion (solid) vs small-angle prediction (dashed)
    if (pred && pred.length > 1) {
      ctx.save();
      ctx.setLineDash([10 * s, 8 * s]);
      ctx.strokeStyle = PALETTE.blueDeep;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 2.6 * s;
      ctx.beginPath();
      pred.forEach(([u, th], i) => (i ? ctx.lineTo(ox + u * gw, yOf(th)) : ctx.moveTo(ox + u * gw, yOf(th))));
      ctx.stroke();
      ctx.restore();
    }
    if (hist.length > 1) {
      ctx.save();
      ctx.strokeStyle = PALETTE.coralDeep;
      ctx.lineWidth = 4.2 * s;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      hist.forEach(([u, th], i) => (i ? ctx.lineTo(ox + u * gw, yOf(th)) : ctx.moveTo(ox + u * gw, yOf(th))));
      ctx.stroke();
      const [lu, lth] = hist[hist.length - 1];
      ctx.fillStyle = PALETTE.coralDeep;
      ctx.beginPath();
      ctx.arc(ox + lu * gw, yOf(lth), 7 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.font = `600 ${40 * s}px ${FONTS.hand}`;
    ctx.fillStyle = PALETTE.coralDeep;
    ctx.fillText('— actual θ(t)', w - 420 * s, 46 * s);
    ctx.fillStyle = PALETTE.blueDeep;
    ctx.fillText('- - small-angle θ₀ cos ωt', w - 420 * s, 88 * s);
    ctx.restore();
    return;
  }
  // printed: one curve plus the longer-period large-amplitude curve
  const pts = [], pts2 = [];
  for (let i = 0; i <= 200; i++) {
    const u = i / 200;
    pts.push([ox + u * gw, yOf(TH0 * 2 * Math.cos(u * 4 * Math.PI * 2))]);
    pts2.push([ox + u * gw, yOf(TH0 * 2 * Math.cos(u * 3.55 * Math.PI * 2))]);
  }
  sketchPath(ctx, pts, { color: mode === 'color' ? PALETTE.blueDeep : PALETTE.ink, width: 2.6 * s, seed: 9, dash: [10 * s, 8 * s] });
  sketchPath(ctx, pts2, { color: mode === 'color' ? PALETTE.coralDeep : PALETTE.ink, width: 3.2 * s, seed: 4 });
}

export const pendulumChapter = {
  id: 'pendulum',
  seed: 21,
  tabTitle: 'Pendulum motion',
  panelTitle: 'Fig. 4.3 — live',
  diag: { x0: 0.12, z0: -1.25, w: 1.86, h: 2.36 },

  drawLeft(ctx, pw) {
    pw.header('Chapter 4 · Oscillations', '86', 'left');
    pw.title('4.2', 'The Simple Pendulum', 'Periodic motion');
    pw.para('A simple pendulum is an idealised system: a point mass m hangs from a fixed pivot on a light, inextensible string of length L. Displaced by an angle θ and released, the mass swings back and forth under the combined pull of gravity and the tension in the string.', { dropCap: true });
    pw.para('Only the component of gravity tangent to the arc, −mg sin θ, accelerates the bob. Newton’s second law along the arc gives the equation of motion:');
    pw.eq([{ frac: [['d', { sup: ['2'] }, 'θ'], ['dt', { sup: ['2'] }]] }, { up: ' + ' }, { frac: [['g'], ['L']] }, { up: ' sin ' }, 'θ', { up: ' = 0' }], '4.5');
    pw.para('For small angles sin θ ≈ θ, and the motion becomes simple harmonic. The period then depends only on the length of the string and the strength of gravity — not on the mass, and not on the amplitude:');
    pw.eq(['T', { up: ' = 2' }, 'π', { sqrt: [{ frac: [['L'], ['g']] }] }], '4.6');
    const eq6 = pw.lastEqY;
    pw.eq(['θ', { up: '(' }, 't', { up: ') = ' }, 'θ', { sub: ['0'] }, { up: ' cos ' }, 'ωt', { up: ',     ' }, 'ω', { up: ' = ' }, { sqrt: [{ frac: [['g'], ['L']] }] }], '4.7');
    pw.para('At large amplitudes the approximation fails: the true period grows longer and the motion drifts away from a perfect cosine. Fig. 4.4 compares the two.');
    // student pencil notes
    handText(ctx, 'mass cancels out!', 210, eq6 - 6, 40, PALETTE.graphite, { rotate: -0.06 });
    noteScribble(ctx, 206, eq6 + 8, 250, 2);
    sketchArrow(ctx, 470, eq6 - 18, 560, eq6 - 22, { color: PALETTE.graphite, width: 2, head: 12, alpha: 0.6, seed: 8 });
    handText(ctx, 'Galileo — swinging cathedral lamp, 1602', 210, pw.y + 40, 34, PALETTE.sepia, { rotate: -0.02, alpha: 0.8 });
  },

  drawRight(ctx, pw) {
    pw.header('The simple pendulum', '87', 'right');
    // figure captions live in drawDiagram so they survive in every variant
    pw.y = 1880;
  },

  drawDiagram(ctx, mode, P, ppu) {
    const ghost = mode === 'ghost';
    const color = mode === 'color';
    const ink = ghost ? 'rgba(90,86,80,0.22)' : PALETTE.ink;
    const L = (a, b) => P(...toPage(a, b));
    const lw = ghost ? 2 : 3.2;
    const dash = ghost ? [8, 9] : null;

    // stand
    const base = [[-0.82, 0], [-0.5, 0], [-0.5, 0.05], [-0.82, 0.05], [-0.82, 0]].map(([a, b]) => L(a, b));
    if (color) watercolor(ctx, (c) => { c.moveTo(...base[0]); base.forEach((p) => c.lineTo(...p)); }, PALETTE.sage, { alpha: 0.7 });
    sketchPath(ctx, base, { color: ink, width: lw, seed: 1, dash });
    const pole = [L(POLE_X - 0.018, 0.05), L(POLE_X - 0.018, ARM_Y + 0.03), L(POLE_X + 0.018, ARM_Y + 0.03), L(POLE_X + 0.018, 0.05)];
    if (color) watercolor(ctx, (c) => { c.moveTo(...pole[0]); pole.forEach((p) => c.lineTo(...p)); }, PALETTE.lavender, { alpha: 0.7, spread: 2 });
    sketchPath(ctx, pole, { color: ink, width: lw * 0.8, seed: 2, dash });
    sketchLine(ctx, ...L(POLE_X, ARM_Y), ...L(PIVOT.x + 0.05, ARM_Y), { color: ink, width: lw * 1.2, seed: 3, dash });
    // string + bob at initial angle
    const L0v = L0 * VIS_PER_M;
    const bx = PIVOT.x + Math.sin(TH0) * L0v, by = PIVOT.y - Math.cos(TH0) * L0v;
    sketchLine(ctx, ...L(PIVOT.x, PIVOT.y), ...L(bx, by), { color: ink, width: lw * 0.7, seed: 4, dash });
    const [cx, cy] = L(bx, by);
    const r = BOB_R * ppu;
    if (color) watercolor(ctx, (c) => c.arc(cx, cy, r, 0, Math.PI * 2), PALETTE.coral, { alpha: 0.85 });
    sketchCircle(ctx, cx, cy, r, { color: ink, width: lw, seed: 5, dash });
    if (!ghost) {
      // crosshatch shading on bob
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = 'rgba(47,43,38,0.35)';
      ctx.lineWidth = 1.4;
      for (let i = -r * 2; i < r * 2; i += 7) {
        ctx.beginPath();
        ctx.moveTo(cx + i, cy + r);
        ctx.lineTo(cx + i + r, cy);
        ctx.stroke();
      }
      ctx.restore();
    }
    const pv = L(PIVOT.x, PIVOT.y);
    sketchCircle(ctx, pv[0], pv[1], 7, { color: ink, width: lw, seed: 6 });
    if (ghost) {
      handText(ctx, '↑ lifted from the page', ...L(-0.1, 0.18), 34, 'rgba(138,106,74,0.55)');
    } else {
      const c2 = color ? PALETTE.sepia : PALETTE.graphite;
      // vertical reference + angle
      sketchLine(ctx, ...pv, ...L(PIVOT.x, PIVOT.y - L0v - 0.1), { color: c2, width: 2, dash: [10, 10], seed: 7 });
      const arc = [];
      for (let a = 0; a <= TH0; a += TH0 / 20) arc.push(L(PIVOT.x + Math.sin(a) * 0.3, PIVOT.y - Math.cos(a) * 0.3));
      sketchPath(ctx, arc, { color: c2, width: 2.2, seed: 8 });
      // swing path
      const sw = [];
      for (let a = -TH0; a <= TH0 + 1e-6; a += TH0 / 30) sw.push(L(PIVOT.x + Math.sin(a) * L0v, PIVOT.y - Math.cos(a) * L0v));
      sketchPath(ctx, sw, { color: color ? PALETTE.blueDeep : c2, width: 2, dash: [12, 10], seed: 9 });
      // forces
      sketchArrow(ctx, cx, cy, cx, cy + 0.3 * ppu, { color: color ? PALETTE.sepia : ink, width: 2.6, seed: 10 });
      const tdir = [-Math.sin(TH0), Math.cos(TH0)];
      const t0 = L(bx + tdir[0] * 0.09, by + tdir[1] * 0.09), t1 = L(bx + tdir[0] * 0.3, by + tdir[1] * 0.3);
      sketchArrow(ctx, ...t0, ...t1, { color: color ? PALETTE.sageDeep : ink, width: 2.6, seed: 11 });
      // labels
      ctx.save();
      ctx.font = `italic 400 40px ${FONTS.serif}`;
      ctx.fillStyle = ink;
      ctx.fillText('θ', ...L(PIVOT.x + 0.07, PIVOT.y - 0.4));
      ctx.fillText('L', ...L(PIVOT.x + Math.sin(TH0) * 0.45 + 0.04, PIVOT.y - Math.cos(TH0) * 0.45));
      ctx.fillText('m', cx + r + 10, cy - r * 0.4);
      ctx.fillText('mg', cx + 10, cy + 0.3 * ppu);
      ctx.fillText('T', t1[0] - 34, t1[1] + 6);
      ctx.restore();
    }

    // captions (identical in every variant)
    const [kx, ky] = P(0.32, 0.27);
    caption(ctx, 'Fig. 4.3', 'A pendulum of length L = 1.6 m displaced by θ = 30°. The restoring force is the tangential part of gravity, −mg sin θ.', kx, ky, 1.48 * ppu);

    // graph inset
    const [gx0, gy0] = P(GR.x0, GR.z0), [gx1, gy1] = P(GR.x1, GR.z1);
    ctx.save();
    ctx.translate(gx0, gy0);
    if (!ghost) {
      ctx.strokeStyle = 'rgba(140,110,70,0.3)';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, gx1 - gx0, gy1 - gy0);
    } else {
      ctx.setLineDash([8, 9]);
      ctx.strokeStyle = 'rgba(90,86,80,0.2)';
      ctx.strokeRect(0, 0, gx1 - gx0, gy1 - gy0);
    }
    drawGraph(ctx, gx1 - gx0, gy1 - gy0, { mode });
    ctx.restore();
    const [qx, qy] = P(0.32, GR.z1 + 0.09);
    caption(ctx, 'Fig. 4.4', 'Angular displacement θ(t): small-angle prediction (dashed) and the true large-swing motion.', qx, qy, 1.48 * ppu);
  },

  createViz(env) {
    return new PendulumViz(env);
  },
};

class PendulumViz {
  constructor(env) {
    this.env = env;
    this.group = new THREE.Group();
    this.group.visible = false;
    env.anchor.group.add(this.group);

    // physics state
    const prm = env.params || {};
    this.L0 = prm.L ?? L0;
    this.theta0 = prm.theta0 ?? TH0;
    this.L = this.L0;
    this.g = G0;
    this.theta = this.theta0;
    this.omega = 0;
    this.time = 0;
    this.paused = true;
    this.dragging = false;
    this.hist = [];
    this.release = { t: 0, th: TH0 };

    // --- pop-up figure, hinged at the bottom of the printed drawing ---
    const hinge = (this.hinge = new THREE.Group());
    hinge.position.copy(this.env.anchor.point(HA.x, HA.z, 0.004));
    this.group.add(hinge);
    const inner = (this.inner = new THREE.Group()); // scaled in z to "gain depth"
    hinge.add(inner);

    const baseM = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.3), sketchMaterial({ color: PALETTE.sage }));
    baseM.position.set(-0.66, 0.025, 0.12);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, ARM_Y + 0.03 - 0.05, 10), sketchMaterial({ color: '#c9bfdc' }));
    pole.position.set(POLE_X, 0.05 + (ARM_Y - 0.02) / 2, 0.12);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, PIVOT.x + 0.05 - POLE_X, 8).rotateZ(Math.PI / 2), sketchMaterial({ color: '#c9bfdc' }));
    arm.position.set((POLE_X + PIVOT.x + 0.05) / 2, ARM_Y, 0.12);
    const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.14), sketchMaterial({ color: PALETTE.yellow }));
    clamp.position.set(PIVOT.x, ARM_Y - 0.01, 0.06);
    for (const m of [baseM, pole, arm, clamp]) {
      m.castShadow = true;
      addEdges(m, { width: 1.4 });
      inner.add(m);
    }

    // swinging arm
    const swing = (this.swing = new THREE.Group());
    swing.position.set(PIVOT.x, PIVOT.y, 0);
    inner.add(swing);
    const string = (this.string = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 1, 6).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: '#3a352f', transparent: true })));
    string.castShadow = true;
    swing.add(string);
    const bob = (this.bob = new THREE.Mesh(new THREE.IcosahedronGeometry(BOB_R, 2), sketchMaterial({ color: PALETTE.coral, hatch: 1.2 })));
    bob.castShadow = true;
    addHullOutline(bob, 0.007);
    swing.add(bob);
    const grab = (this.grab = new THREE.Mesh(new THREE.SphereGeometry(BOB_R * 2.2, 8, 8), new THREE.MeshBasicMaterial({ visible: false })));
    bob.add(grab);
    const pivotDot = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 10), new THREE.MeshBasicMaterial({ color: '#3a352f' }));
    swing.add(pivotDot);

    // reference + trajectory
    this.vertical = inkTube([new THREE.Vector3(PIVOT.x, PIVOT.y, -0.002), new THREE.Vector3(PIVOT.x, PIVOT.y - 1.05, -0.002)], { radius: 0.0035, dash: 1, dashCount: 22, color: PALETTE.graphite, opacity: 0.6, progress: 0 });
    inner.add(this.vertical);
    this.arcMesh = null;
    this.arcProgress = { v: 0 };
    this.lastArc = { A: -1, L: -1 };

    // force arrows
    this.vArrow = makeArrow(PALETTE.blueDeep);
    this.gArrow = makeArrow(PALETTE.sepia);
    inner.add(this.vArrow, this.gArrow);

    // graph card (second hinge, folds up like a laptop lid)
    this.cardCanvas = document.createElement('canvas');
    this.cardCanvas.width = 1024;
    this.cardCanvas.height = Math.round(1024 * ((GR.z1 - GR.z0) / (GR.x1 - GR.x0)));
    this.cardTex = new THREE.CanvasTexture(this.cardCanvas);
    this.cardTex.colorSpace = THREE.SRGBColorSpace;
    this.cardTex.anisotropy = 8;
    const cw = GR.x1 - GR.x0, ch = GR.z1 - GR.z0;
    const card = (this.card = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch).translate(0, ch / 2, 0), new THREE.MeshLambertMaterial({ map: this.cardTex, side: THREE.DoubleSide, emissive: '#2a2418', transparent: true })));
    card.castShadow = true;
    addEdges(card, { width: 1.2, opacity: 0.5 });
    const cardHinge = (this.cardHinge = new THREE.Group());
    cardHinge.position.copy(this.env.anchor.point(HB.x, HB.z, 0.006));
    cardHinge.add(card);
    this.group.add(cardHinge);
    drawGraph(this.cardCanvas.getContext('2d'), this.cardCanvas.width, this.cardCanvas.height, { mode: 'print', paper: true });
    this.cardTex.needsUpdate = true;

    // handwritten annotations
    this.notes = {
      theta: makeNote('θ = 30.0°', { cls: 'sm' }),
      L: makeNote('L = 1.60 m', { cls: 'sm sepia' }),
      v: makeNote('<i>v</i>', { cls: 'sm blue' }),
      mg: makeNote('<i>mg</i>', { cls: 'sm sepia' }),
      eq1: makeNote('θ̈ = −(g/L) sin θ', { cls: 'eq', anchor: 'left' }),
      eq2: makeNote('T = 2π√(L/g) ≈ 2.54 s', { cls: 'eq coral', anchor: 'left' }),
      eq3: makeNote('drag the bob to set θ₀ — let go to release', { cls: 'xs', anchor: 'left' }),
    };
    this.notes.eq1.position.set(0.5, 1.26, 0);
    this.notes.eq2.position.set(0.5, 1.13, 0);
    this.notes.eq3.position.set(0.5, 1.02, 0);
    for (const n of [this.notes.eq1, this.notes.eq2, this.notes.eq3]) inner.add(n);
    for (const k of ['theta', 'L', 'v', 'mg']) inner.add(this.notes[k]);

    this.interactives = [
      {
        object: this.grab,
        kind: 'grab',
        label: 'pinch & drag the bob',
        onDown: () => {
          this.dragging = true;
          this.omega = 0;
          gsap.to(this.bob.material.userData.uniforms.uHighlight, { value: 1, duration: 0.2 });
        },
        onDrag: (ray) => this._dragTo(ray),
        onUp: () => {
          this.dragging = false;
          this.paused = false;
          this.release = { t: this.time, th: this.theta };
          gsap.to(this.bob.material.userData.uniforms.uHighlight, { value: 0, duration: 0.4 });
          this.env.setPlayLabel?.(false);
        },
        onHover: (on) => gsap.to(this.bob.material.userData.uniforms.uHighlight, { value: on ? 0.6 : 0, duration: 0.25 }),
      },
    ];

    this.controls = [
      { type: 'slider', key: 'L', label: 'string length <i>L</i>', min: 0.4, max: 2.0, step: 0.01, value: this.L0, format: (v) => `${v.toFixed(2)} m`, onChange: (v) => (this.Ltarget = v) },
      {
        type: 'slider', key: 'g', label: 'gravity <i>g</i>', min: 1.6, max: 24.8, step: 0.01, value: this.g, snap: 0.5,
        ticks: [{ v: 1.62, label: 'Moon' }, { v: 3.71, label: 'Mars' }, { v: 9.81, label: 'Earth' }, { v: 24.79, label: 'Jupiter' }],
        format: (v) => `${v.toFixed(2)} m/s²`, onChange: (v) => (this.gTarget = v),
      },
      {
        type: 'buttons',
        items: [
          { key: 'play', icon: '❚❚', label: 'pause', onClick: () => this.togglePause() },
          { icon: '↺', label: 'reset', onClick: () => this.reset() },
          { icon: '◠', label: 'big swing', onClick: () => this.setAngle(150 * DEG) },
        ],
      },
      { type: 'hint', text: 'Pinch the bob and drag it to a new angle.' },
    ];
    this.Ltarget = this.L;
    this.gTarget = this.g;

    this.focus = { target: this.env.anchor.point(1.45, -0.05, 0.45), distance: 6.0, azimuth: 0.1, polar: 0.9 };

    this._applyPose();
    this.state = { lift: 0, depth: 0, draw: 0, card: 0 };
    this._applyState();
  }

  togglePause() {
    this.paused = !this.paused;
    if (!this.paused) this.release = { t: this.time, th: this.theta };
    this.env.setPlayLabel?.(this.paused);
  }
  setAngle(a) {
    this.theta = a;
    this.omega = 0;
    this.paused = false;
    this.release = { t: this.time, th: a };
    this.env.setPlayLabel?.(false);
  }
  reset() {
    this.Ltarget = L0;
    this.gTarget = G0;
    this.panel?.api.L.set(L0);
    this.panel?.api.g.set(G0);
    gsap.to(this, { theta: TH0, duration: 0.8, ease: 'power3.inOut', onStart: () => { this.paused = true; this.omega = 0; }, onComplete: () => { this.paused = false; this.release = { t: this.time, th: TH0 }; this.hist = []; } });
  }

  _dragTo(ray) {
    const pivotW = this.swing.getWorldPosition(new THREE.Vector3());
    const n = new THREE.Vector3(0, 0, 1).transformDirection(this.inner.matrixWorld);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, pivotW);
    const hit = ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return;
    const local = this.inner.worldToLocal(hit.clone());
    const dx = local.x - PIVOT.x, dy = local.y - PIVOT.y;
    let a = Math.atan2(dx, -dy);
    a = Math.max(-165 * DEG, Math.min(165 * DEG, a));
    this.theta = a;
    this.omega = 0;
  }

  _applyState() {
    const s = this.state;
    this.hinge.rotation.x = -Math.PI / 2 + (Math.PI / 2 - 0.06) * s.lift;
    this.inner.scale.z = 0.02 + 0.98 * s.depth;
    this.hinge.position.y = this.env.anchor.point(HA.x, HA.z).y + 0.004 + 0.02 * s.depth;
    this.cardHinge.rotation.x = -Math.PI / 2 + (Math.PI / 2 - 0.42) * s.card;
    setTreeOpacity(this.inner, Math.min(1, s.draw * 1.4));
    this.card.material.opacity = Math.min(1, s.draw * 1.6);
    this.vertical.material.uniforms.uProgress.value = s.draw;
    if (this.arcMesh) this.arcMesh.material.uniforms.uProgress.value = s.draw;
  }

  _applyPose() {
    const Lv = this.L * VIS_PER_M;
    this.swing.rotation.z = this.theta;
    this.string.scale.y = Lv - BOB_R * 0.8;
    this.bob.position.y = -Lv;
    // arrows (in inner coords)
    const bobPos = new THREE.Vector3(PIVOT.x + Math.sin(this.theta) * Lv, PIVOT.y - Math.cos(this.theta) * Lv, 0.0);
    const tangent = new THREE.Vector3(Math.cos(this.theta), Math.sin(this.theta), 0);
    const v = this.omega * Lv;
    const vlen = Math.min(0.5, Math.abs(v) * 0.22);
    this.vArrow.visible = vlen > 0.03;
    setArrow(this.vArrow, bobPos.clone().add(tangent.clone().multiplyScalar(Math.sign(v) * BOB_R)), tangent.clone().multiplyScalar(Math.sign(v) || 1), vlen);
    const glen = 0.06 + this.g * 0.018;
    setArrow(this.gArrow, bobPos.clone().add(new THREE.Vector3(0, -BOB_R, 0)), new THREE.Vector3(0, -1, 0), glen);
    this.notes.mg.position.copy(bobPos).add(new THREE.Vector3(0.07, -BOB_R - glen * 0.7, 0));
    this.notes.v.position.copy(bobPos).add(tangent.clone().multiplyScalar(Math.sign(v) * (BOB_R + vlen + 0.05))).add(new THREE.Vector3(0, 0.04, 0));
    this.notes.v.element.style.visibility = this.vArrow.visible ? 'visible' : 'hidden';
    this.notes.theta.position.set(PIVOT.x - 0.26, PIVOT.y - 0.3, 0);
    const side = this.theta >= 0 ? 1 : -1;
    this.notes.L.position.set(PIVOT.x + Math.sin(this.theta) * Lv * 0.62 + side * Math.cos(this.theta) * 0.17, PIVOT.y - Math.cos(this.theta) * Lv * 0.62 + side * Math.sin(this.theta) * 0.17, 0);
    this.notes.theta.set(`θ = ${(this.theta / DEG).toFixed(1)}°`);
    this.notes.L.set(`L = ${this.L.toFixed(2)} m`);
    this._updateArc();
  }

  _updateArc() {
    const Lv = this.L * VIS_PER_M;
    // amplitude from energy: cos A = cos θ − ω²L / 2g
    const c = Math.cos(this.theta) - (this.omega * this.omega * this.L) / (2 * this.g);
    const A = c < -1 ? Math.PI : Math.acos(Math.min(1, c));
    if (Math.abs(A - this.lastArc.A) < 0.01 && Math.abs(Lv - this.lastArc.L) < 0.004) return;
    this.lastArc = { A, L: Lv };
    if (this.arcMesh) {
      this.inner.remove(this.arcMesh);
      disposeTree(this.arcMesh);
    }
    const pts = [];
    const AA = Math.max(A, 0.02);
    for (let i = 0; i <= 64; i++) {
      const a = -AA + (2 * AA * i) / 64;
      pts.push(new THREE.Vector3(PIVOT.x + Math.sin(a) * Lv, PIVOT.y - Math.cos(a) * Lv, -0.004));
    }
    this.arcMesh = inkTube(pts, { radius: 0.004, dash: 1, dashCount: Math.max(8, Math.round(AA * Lv * 40)), color: PALETTE.blueDeep, opacity: 0.75, progress: this.state ? this.state.draw : 0, segments: 96 });
    this.inner.add(this.arcMesh);
  }

  enter(tl, t0) {
    const s = this.state;
    tl.add(() => {
      this.group.visible = true;
      this.theta = this.theta0;
      this.omega = 0;
      this.paused = true;
      this._applyPose();
    }, t0);
    tl.to(s, { draw: 1, duration: 0.9, ease: 'power1.inOut', onUpdate: () => this._applyState() }, t0);
    tl.to(s, { depth: 1, duration: 0.6, ease: 'power2.out', onUpdate: () => this._applyState() }, t0 + 0.7);
    tl.to(s, { lift: 1, duration: 1.2, ease: 'back.out(1.6)', onUpdate: () => this._applyState() }, t0 + 1.0);
    tl.to(s, { card: 1, duration: 1.1, ease: 'back.out(1.4)', onUpdate: () => this._applyState() }, t0 + 1.35);
    tl.add(() => {
      this.paused = false;
      this.hist = [];
      this.release = { t: this.time, th: this.theta };
      this.env.setPlayLabel?.(false);
      const n = this.notes;
      [n.theta, n.L, n.mg, n.v].forEach((x, i) => x.reveal(i * 0.12, 0.5));
      n.eq1.reveal(0.3, 0.9);
      n.eq2.reveal(0.8, 0.9);
      n.eq3.reveal(1.3, 0.9);
    }, t0 + 2.0);
    return t0 + 2.3;
  }

  exit(tl, t0) {
    const s = this.state;
    tl.add(() => {
      Object.values(this.notes).forEach((n) => n.hide());
      this.paused = true;
    }, t0);
    // swing gently back to the printed pose before folding
    tl.to(this, { theta: TH0, omega: 0, duration: 0.6, ease: 'power2.inOut', onUpdate: () => this._applyPose() }, t0);
    tl.to(s, { card: 0, duration: 0.7, ease: 'power2.in', onUpdate: () => this._applyState() }, t0 + 0.2);
    tl.to(s, { lift: 0, duration: 0.8, ease: 'power2.in', onUpdate: () => this._applyState() }, t0 + 0.4);
    tl.to(s, { depth: 0, duration: 0.4, ease: 'power2.in', onUpdate: () => this._applyState() }, t0 + 1.1);
    tl.to(s, { draw: 0, duration: 0.5, onUpdate: () => this._applyState() }, t0 + 1.4);
    tl.add(() => (this.group.visible = false), t0 + 1.95);
    return t0 + 1.4;
  }

  _deriv(th, om, g, L) {
    return [om, -(g / L) * Math.sin(th)];
  }

  update(dt) {
    if (!this.group.visible) return;
    // smooth parameter changes (spring-ish)
    this.L += (this.Ltarget - this.L) * Math.min(1, dt * 8);
    this.g += (this.gTarget - this.g) * Math.min(1, dt * 8);
    if (!this.paused && !this.dragging) {
      const n = 4, h = Math.min(dt, 1 / 30) / n;
      for (let i = 0; i < n; i++) {
        const { g, L } = this;
        const k1 = this._deriv(this.theta, this.omega, g, L);
        const k2 = this._deriv(this.theta + (h / 2) * k1[0], this.omega + (h / 2) * k1[1], g, L);
        const k3 = this._deriv(this.theta + (h / 2) * k2[0], this.omega + (h / 2) * k2[1], g, L);
        const k4 = this._deriv(this.theta + h * k3[0], this.omega + h * k3[1], g, L);
        this.theta += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
        this.omega += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      }
      this.time += Math.min(dt, 1 / 30);
      this.hist.push([this.time, this.theta]);
    } else if (this.dragging) {
      this.time += dt;
      this.hist.push([this.time, this.theta]);
      this.release = { t: this.time, th: this.theta };
    }
    const W = 10;
    while (this.hist.length && this.hist[0][0] < this.time - W) this.hist.shift();
    this._applyPose();
    this.notes.eq2.set(`T = 2π√(L/g) ≈ ${(2 * Math.PI * Math.sqrt(this.L / this.g)).toFixed(2)} s`);

    this._cardTick = (this._cardTick || 0) + dt;
    if (this._cardTick > 1 / 30 && this.state.card > 0.5) {
      this._cardTick = 0;
      const t1 = this.time, t0 = t1 - W;
      const hist = this.hist.map(([t, th]) => [(t - t0) / W, th]);
      const pred = [];
      const w = Math.sqrt(this.g / this.L);
      for (let i = 0; i <= 160; i++) {
        const t = t0 + (W * i) / 160;
        if (t < this.release.t) continue;
        pred.push([(t - t0) / W, this.release.th * Math.cos(w * (t - this.release.t))]);
      }
      drawGraph(this.cardCanvas.getContext('2d'), this.cardCanvas.width, this.cardCanvas.height, { mode: 'live', hist, pred, paper: true });
      this.cardTex.needsUpdate = true;
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    Object.values(this.notes).forEach((n) => n.element.remove());
    disposeTree(this.group);
  }
}
