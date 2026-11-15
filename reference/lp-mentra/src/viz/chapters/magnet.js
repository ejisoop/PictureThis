// Chapter II — Magnetic fields. The printed field-line drawing lifts off the
// page and fans out around the magnet's axis into true 3D field lines.
// The field is a Gilbert (two-pole) model; a draggable compass responds to the
// local field plus Earth's field.
import * as THREE from 'three';
import gsap from 'gsap';
import { PALETTE, FONTS, sketchPath, sketchCircle, watercolor, handText, serif, wrapParagraph } from '../paper.js';
import { caption, noteScribble, pageToPx, PX_PER_UNIT } from '../pages.js';
import { PAGE_W } from '../book.js';
import { sketchMaterial, addHullOutline, addEdges, inkTubeMaterial, disposeTree } from '../sketch.js';
import { makeNote } from '../ui.js';

const C = { x: 1.05, z: -0.5 }; // magnet centre on the page
const HALF = 0.31, WIDTH = 0.16, THICK = 0.12;
const D = 0.27; // pole (charge) offset
const BOUND_X = 0.86, BOUND_R = 0.7;
const PHIS = [0, 36, 72, 108, 144, 180].map((d) => (d * Math.PI) / 180);
const AXIS_H = 0.17;
const COMPASS0 = { x: 1.62, z: 0.02 };
const EARTH = 0.012;

function field2(X, R, q = 1) {
  // B in the meridian plane from +q at (+D,0) and −q at (−D,0)
  const dx1 = X - D, dx2 = X + D;
  const r1 = Math.pow(dx1 * dx1 + R * R, 1.5), r2 = Math.pow(dx2 * dx2 + R * R, 1.5);
  return [q * (dx1 / r1 - dx2 / r2), q * (R / r1 - R / r2)];
}

function traceLines(n) {
  const lines = [];
  for (let i = 1; i <= n; i++) {
    const a = (0.2 + (0.74 * (i - 1)) / Math.max(1, n - 1)) * Math.PI;
    let X = D + 0.035 * Math.cos(a), R = 0.035 * Math.sin(a);
    const pts = [[X, R]];
    for (let s = 0; s < 900; s++) {
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

const PRINT_LINES = traceLines(7);

export const magnetChapter = {
  id: 'magnet',
  seed: 52,
  tabTitle: 'Magnetic fields',
  panelTitle: 'Fig. 7.2 — live',
  diag: { x0: 0.13, z0: -1.25, w: 1.84, h: 1.62 },

  drawLeft(ctx, pw) {
    pw.header('Chapter 7 · Magnetism', '212', 'left');
    pw.title('7.1', 'Magnetic Fields of Permanent Magnets', 'Fields in space');
    pw.para('Every magnet is surrounded by a magnetic field B, a vector quantity defined at every point in space. Field lines trace its direction: they emerge from the north pole, curve through the surrounding space and re-enter the magnet at its south pole.', { dropCap: true });
    pw.para('Far from a bar magnet, its field approaches that of a magnetic dipole with moment m:');
    pw.eq(['B', { up: '(' }, 'r', { up: ') = ' }, { frac: [['μ', { sub: ['0'] }], [{ up: '4' }, 'π']] }, { up: ' ' }, { frac: [[{ up: '3(' }, 'm', { up: ' · ' }, 'n', { up: ')' }, 'n', { up: ' − ' }, 'm'], ['r', { sup: ['3'] }]] }], '7.3');
    pw.para('The field weakens rapidly with distance, and field lines never cross, since the field has a single direction at each point. Magnetic field lines form closed loops — there are no magnetic charges — a statement captured by Gauss’s law for magnetism:');
    pw.eq([{ up: '∇ · ' }, 'B', { up: ' = 0' }], '7.4');
    const y4 = pw.lastEqY;
    pw.para('A compass needle is itself a small magnet. The torque τ = μ × B rotates it until it lines up with the local field, which is how a compass maps the invisible field around a magnet.');
    handText(ctx, 'lines leave N, enter S', 220, y4 + 4, 38, PALETTE.graphite, { rotate: -0.05 });
    noteScribble(ctx, 214, y4 + 16, 290, 5);
    handText(ctx, 'n = unit vector along r', 980, y4 - 230, 30, PALETTE.sepia, { rotate: 0.03, alpha: 0.85 });
    handText(ctx, 'Earth’s field ≈ 50 μT — fridge magnet ≈ 5 mT', 210, pw.y + 50, 34, PALETTE.sepia, { rotate: -0.02, alpha: 0.85 });
  },

  drawRight(ctx, pw) {
    pw.header('Magnetic fields', '213', 'right');
    const [x, y] = pageToPx(0.2, 0.52);
    caption(ctx, 'Fig. 7.2', 'Field lines around a bar magnet, traced in the plane of the page. A compass placed in the field points along B.', x, y, 1.66 * PX_PER_UNIT);
    serif(ctx, 37, { color: PALETTE.ink });
    const [x2, y2] = pageToPx(0.2, 0.88);
    wrapParagraph(ctx, 'Iron filings sprinkled on paper above a magnet trace out these same curves. Notice how the lines crowd together near the poles, where the field is strongest: the density of field lines is a measure of |B|.', x2, y2, 1.66 * PX_PER_UNIT, 53, { indent: 44 });
    // key idea box
    const [bx, by] = pageToPx(0.2, 1.17);
    ctx.save();
    ctx.fillStyle = 'rgba(157,183,207,0.18)';
    ctx.fillRect(bx, by - 46, 1.66 * PX_PER_UNIT, 82);
    ctx.fillStyle = PALETTE.blueDeep;
    ctx.fillRect(bx, by - 46, 6, 82);
    ctx.font = `600 30px ${FONTS.serif}`;
    ctx.fillText('KEY IDEA', bx + 30, by + 6);
    ctx.font = `italic 400 32px ${FONTS.serif}`;
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText('Field lines are tangent to B; their spacing shows its strength.', bx + 190, by + 6);
    ctx.restore();
  },

  drawDiagram(ctx, mode, P, ppu) {
    const ghost = mode === 'ghost', color = mode === 'color';
    const toP = (X, R, sgn = 1) => P(C.x + X, C.z + sgn * R);
    const ink = ghost ? 'rgba(90,86,80,0.2)' : PALETTE.ink;
    // field lines
    PRINT_LINES.forEach((ln, i) => {
      for (const sgn of [1, -1]) {
        const pts = ln.pts.filter((_, k) => k % 3 === 0 || k === ln.pts.length - 1).map(([X, R]) => toP(X, R, sgn));
        sketchPath(ctx, pts, {
          color: ghost ? 'rgba(90,86,80,0.13)' : color ? (i % 2 ? PALETTE.coralDeep : PALETTE.blueDeep) : PALETTE.graphite,
          width: ghost ? 1.6 : 2.4, seed: i * 7 + sgn + 20, alpha: color ? 0.85 : 0.95, dash: ghost ? [6, 10] : null, passes: ghost ? 1 : 2,
        });
        if (!ghost) {
          // a direction arrow halfway along each line
          const k = Math.floor(ln.pts.length * 0.5);
          const [a, b] = toP(...ln.pts[k], sgn), [c2, d2] = toP(...ln.pts[k + 2], sgn);
          const ang = Math.atan2(d2 - b, c2 - a);
          ctx.save();
          ctx.fillStyle = color ? PALETTE.sepia : PALETTE.ink;
          ctx.translate(a, b);
          ctx.rotate(ang);
          ctx.beginPath();
          ctx.moveTo(10, 0);
          ctx.lineTo(-8, -7);
          ctx.lineTo(-8, 7);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    });
    // magnet
    const [m0x, m0y] = P(C.x - HALF, C.z - WIDTH / 2);
    const [m1x, m1y] = P(C.x + HALF, C.z + WIDTH / 2);
    const midx = (m0x + m1x) / 2;
    if (!ghost) {
      ctx.save();
      ctx.fillStyle = color ? PALETTE.blue : '#e9e1cf';
      ctx.fillRect(m0x, m0y, midx - m0x, m1y - m0y);
      ctx.fillStyle = color ? PALETTE.coral : '#ddd2bb';
      ctx.fillRect(midx, m0y, m1x - midx, m1y - m0y);
      if (!color) {
        ctx.beginPath();
        ctx.rect(midx, m0y, m1x - midx, m1y - m0y);
        ctx.clip();
        ctx.strokeStyle = 'rgba(47,43,38,0.4)';
        ctx.lineWidth = 1.5;
        for (let i = -100; i < 400; i += 9) {
          ctx.beginPath();
          ctx.moveTo(midx + i, m1y);
          ctx.lineTo(midx + i + 100, m0y);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    sketchPath(ctx, [[m0x, m0y], [m1x, m0y], [m1x, m1y], [m0x, m1y], [m0x, m0y]], { color: ink, width: ghost ? 2 : 3.2, seed: 3, dash: ghost ? [8, 9] : null });
    sketchPath(ctx, [[midx, m0y], [midx, m1y]], { color: ink, width: 2, seed: 4 });
    ctx.save();
    ctx.font = `600 52px ${FONTS.serif}`;
    ctx.fillStyle = ghost ? 'rgba(90,86,80,0.2)' : PALETTE.ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('S', (m0x + midx) / 2, (m0y + m1y) / 2 + 3);
    ctx.fillText('N', (midx + m1x) / 2, (m0y + m1y) / 2 + 3);
    ctx.restore();
    // printed compass
    const [cx, cy] = P(COMPASS0.x, COMPASS0.z);
    const r = 0.1 * ppu;
    if (color) watercolor(ctx, (c) => c.arc(cx, cy, r, 0, Math.PI * 2), PALETTE.yellow, { alpha: 0.6 });
    sketchCircle(ctx, cx, cy, r, { color: ink, width: ghost ? 1.6 : 2.6, seed: 9, dash: ghost ? [6, 8] : null });
    if (!ghost) {
      const [bx, br] = field2(COMPASS0.x - C.x, COMPASS0.z - C.z);
      const ang = Math.atan2(br, bx);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.fillStyle = color ? PALETTE.coralDeep : PALETTE.ink;
      ctx.beginPath();
      ctx.moveTo(r * 0.85, 0); ctx.lineTo(0, -9); ctx.lineTo(0, 9); ctx.closePath(); ctx.fill();
      ctx.fillStyle = color ? PALETTE.blueDeep : '#9a948a';
      ctx.beginPath();
      ctx.moveTo(-r * 0.85, 0); ctx.lineTo(0, -9); ctx.lineTo(0, 9); ctx.closePath(); ctx.fill();
      ctx.restore();
      handText(ctx, 'compass', cx + r + 12, cy + 10, 36, PALETTE.graphite);
    } else {
      handText(ctx, '↑ lifted from the page', ...P(C.x - 0.5, C.z + 0.66), 34, 'rgba(138,106,74,0.55)');
    }
  },

  createViz(env) {
    return new MagnetViz(env);
  },
};

class MagnetViz {
  constructor(env) {
    this.env = env;
    this.group = new THREE.Group();
    this.group.visible = false;
    env.anchor.group.add(this.group);
    this.strength = 1;
    this.showLines = true;
    this.earth = true;
    this.rot = 0;
    this.rotTarget = 0;
    this.time = 0;

    const asm = (this.asm = new THREE.Group());
    asm.position.copy(this.env.anchor.point(C.x, C.z, 0.003));
    this.group.add(asm);

    // magnet body
    const body = (this.body = new THREE.Group());
    asm.add(body);
    const letterMat = (letter, col) => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = col;
      g.fillRect(0, 0, 256, 128);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(0, 0, 256, 30);
      g.font = `600 92px ${FONTS.serif}`;
      g.fillStyle = 'rgba(47,43,38,0.85)';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(letter, 128, 70);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshLambertMaterial({ map: t, emissive: '#3a3020', transparent: true });
    };
    this.halves = [];
    for (const [sgn, col, letter] of [[1, PALETTE.coral, 'N'], [-1, PALETTE.blue, 'S']]) {
      const side = sketchMaterial({ color: col });
      const mats = [side, side, letterMat(letter, col), side, side, side];
      const m = new THREE.Mesh(new THREE.BoxGeometry(HALF, THICK, WIDTH), mats);
      m.position.x = (sgn * HALF) / 2;
      m.castShadow = true;
      addEdges(m, { width: 1.6 });
      body.add(m);
      this.halves.push(m);
    }

    // field lines
    this.linesGroup = new THREE.Group();
    asm.add(this.linesGroup);
    this.lineMat = inkTubeMaterial({ color: '#d98a78', color2: '#7f9fc2', opacity: 0.85, progress: 0 });
    this.lineMat.uniforms.uTailFade.value = 1;
    this.planes = PHIS.map((phi) => {
      const g = new THREE.Group();
      g.userData.target = phi;
      g.userData.start = phi <= Math.PI / 2 ? 0 : Math.PI;
      this.linesGroup.add(g);
      return g;
    });
    this.arrowMesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.02, 0.06, 8).rotateZ(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#5b4a3a', transparent: true, opacity: 0 }), PHIS.length * 14 * 2);
    this.arrowMesh.frustumCulled = false;
    this.linesGroup.add(this.arrowMesh);
    this._buildLines();

    // compass
    const cmp = (this.compass = new THREE.Group());
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.105, 0.025, 40), sketchMaterial({ color: '#f6e9c4', hatch: 0.5 }));
    disc.position.y = 0.0125;
    disc.castShadow = true;
    addEdges(disc, { width: 1.3, threshold: 50 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.007, 6, 48).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#3a352f' }));
    ring.position.y = 0.026;
    const needle = (this.needle = new THREE.Group());
    needle.position.y = 0.034;
    const tipN = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.085, 4).rotateZ(-Math.PI / 2).translate(0.0425, 0, 0), sketchMaterial({ color: PALETTE.coralDeep, hatch: 0 }));
    const tipS = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.085, 4).rotateZ(Math.PI / 2).translate(-0.0425, 0, 0), sketchMaterial({ color: PALETTE.blueDeep, hatch: 0 }));
    for (const t of [tipN, tipS]) { t.scale.y = 0.35; t.castShadow = true; needle.add(t); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 10), new THREE.MeshBasicMaterial({ color: '#3a352f' }));
    needle.add(hub);
    cmp.add(disc, ring, needle);
    this.compassDisc = disc;
    this.compassPos = new THREE.Vector2(COMPASS0.x, COMPASS0.z);
    this.heading = 0;
    this.headingVel = 0;
    this.group.add(cmp);
    this._placeCompass();
    {
      const [bx, br] = field2(COMPASS0.x - C.x, COMPASS0.z - C.z);
      this.heading = Math.atan2(-br, bx);
    }

    this.notes = {
      N: makeNote('north pole', { cls: 'sm coral' }),
      S: makeNote('south pole', { cls: 'sm blue' }),
      gauss: makeNote('∇·B = 0 — lines never cross,<br>they close back into the magnet', { cls: 'eq', anchor: 'left' }),
      falloff: makeNote('far away: |B| ∝ 1/r³', { cls: 'eq sepia', anchor: 'left' }),
      compass: makeNote('', { cls: 'sm', anchor: 'left' }),
      hint: makeNote('drag the compass · twist the magnet', { cls: 'xs', anchor: 'left' }),
    };
    this.notes.N.position.set(HALF * 1.05, THICK / 2 + 0.2, 0.05);
    this.notes.S.position.set(-HALF * 1.05, THICK / 2 + 0.2, 0.05);
    body.add(this.notes.N, this.notes.S);
    this.notes.gauss.position.copy(this.env.anchor.point(0.15, -1.32, 0.35));
    this.notes.falloff.position.copy(this.env.anchor.point(0.15, -1.2, 0.22));
    this.notes.hint.position.copy(this.env.anchor.point(0.2, 0.33, 0.05));
    this.group.add(this.notes.gauss, this.notes.falloff, this.notes.hint);
    cmp.add(this.notes.compass);
    this.notes.compass.position.set(0.13, 0.05, 0.03);

    // interactions
    const hl = (on) => this.halves.forEach((h) => gsap.to(h.material[0].userData.uniforms.uHighlight, { value: on ? 0.7 : 0, duration: 0.25 }));
    this.interactives = [
      {
        object: disc,
        kind: 'grab',
        onDown: () => gsap.to(cmp.position, { y: cmp.position.y + 0.06, duration: 0.25 }),
        onDrag: (ray) => {
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(this.env.anchor.point(1, 0).y + 0.06));
          const hit = ray.intersectPlane(plane, new THREE.Vector3());
          if (!hit) return;
          const local = this.env.anchor.group.worldToLocal(hit);
          const bd = this.env.anchor.bounds;
          this.compassPos.set(Math.max(bd.x0 + 0.12, Math.min(bd.x1 - 0.12, local.x)), Math.max(bd.z0 + 0.12, Math.min(bd.z1 - 0.12, local.z)));
          this._avoidMagnet();
          this._placeCompass(0.06);
        },
        onUp: () => this._placeCompass(0, true),
        onHover: (on) => gsap.to(disc.material.userData.uniforms.uHighlight, { value: on ? 0.8 : 0, duration: 0.25 }),
      },
      ...this.halves.map((h) => ({
        object: h,
        kind: 'rotate',
        onDown: (hit) => {
          this._rotStart = this._angleAt(hit.point);
          this._rotBase = this.rotTarget;
          hl(true);
        },
        onDrag: (ray) => {
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(this.asm.getWorldPosition(new THREE.Vector3()).y + AXIS_H));
          const p = ray.intersectPlane(plane, new THREE.Vector3());
          if (p) this.rotTarget = this._rotBase + (this._angleAt(p) - this._rotStart);
        },
        onUp: () => hl(false),
        onHover: hl,
      })),
    ];

    this.controls = [
      { type: 'slider', key: 'strength', label: 'magnet strength', min: 0.2, max: 2.5, step: 0.01, value: 1, format: (v) => `×${v.toFixed(2)}`, onChange: (v) => this.setStrength(v) },
      { type: 'slider', key: 'rot', label: 'magnet angle', min: -180, max: 180, step: 1, value: 0, format: (v) => `${Math.round(v)}°`, onChange: (v) => (this.rotTarget = (v * Math.PI) / 180) },
      {
        type: 'buttons',
        items: [
          { key: 'lines', icon: '≋', label: 'field lines', toggle: true, value: true, onChange: (v) => this.toggleLines(v) },
          { key: 'earth', icon: '⊕', label: 'Earth’s field', toggle: true, value: true, onChange: (v) => (this.earth = v) },
          { icon: '↺', label: 'reset', onClick: () => this.reset() },
        ],
      },
      { type: 'hint', text: 'Weaken the magnet and the compass turns toward Earth’s north (top of the page).' },
    ];

    this.focus = { target: this.env.anchor.point(1.45, -0.15, 0.2), distance: 5.6, azimuth: 0.14, polar: 0.8 };
    this.state = { draw: 0, lift: 0, fan: 0, compass: 0, arrows: 0 };
    this._applyState();
  }

  _angleAt(worldP) {
    const c = this.asm.getWorldPosition(new THREE.Vector3());
    return -Math.atan2(worldP.z - c.z, worldP.x - c.x);
  }

  _avoidMagnet() {
    // keep the compass out of the magnet's footprint
    const local = new THREE.Vector3(this.compassPos.x - C.x, 0, this.compassPos.y - C.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.rot);
    const ex = HALF + 0.12, ez = WIDTH / 2 + 0.12;
    if (Math.abs(local.x) < ex && Math.abs(local.z) < ez) {
      const px = ex - Math.abs(local.x), pz = ez - Math.abs(local.z);
      if (px < pz) local.x = Math.sign(local.x || 1) * ex;
      else local.z = Math.sign(local.z || 1) * ez;
      local.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.rot);
      this.compassPos.set(local.x + C.x, local.z + C.z);
    }
  }

  _placeCompass(extra = 0, animate = false) {
    const x = this.compassPos.x, z = this.compassPos.y;
    const onRight = x >= 0;
    const u = Math.abs(x) / PAGE_W;
    const p = this.env.anchor.point(Math.abs(x), z);
    const y = p.y + 0.002 + extra;
    if (animate) gsap.to(this.compass.position, { y, duration: 0.4, ease: 'bounce.out' });
    else this.compass.position.y = y;
    this.compass.position.x = onRight ? x : -Math.abs(x);
    this.compass.position.z = z;
    void u;
  }

  _buildLines() {
    const n = Math.round(3 + 3.2 * this.strength);
    if (n === this.nLines) return;
    this.nLines = n;
    for (const g of this.planes) {
      for (const c of [...g.children]) g.remove(c);
    }
    this.lineGeos?.forEach((g) => g.dispose());
    this.lines = traceLines(n);
    this.lineGeos = this.lines.map((ln) => {
      const pts = ln.pts.filter((_, k) => k % 2 === 0 || k === ln.pts.length - 1).map(([X, R]) => new THREE.Vector3(X, 0, R));
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(16, pts.length), 0.0055, 5, false);
    });
    for (const g of this.planes) {
      for (const geo of this.lineGeos) {
        const m = new THREE.Mesh(geo, this.lineMat);
        m.raycast = () => {};
        g.add(m);
      }
    }
  }

  setStrength(v) {
    this.strength = v;
    clearTimeout(this._rebuildT);
    this._rebuildT = setTimeout(() => {
      const before = this.nLines;
      this._buildLines();
      if (before !== this.nLines && this.showLines) {
        this.lineMat.uniforms.uProgress.value = 0.3;
        gsap.to(this.lineMat.uniforms.uProgress, { value: 1, duration: 0.6, ease: 'power2.out' });
      }
    }, 60);
  }

  toggleLines(v) {
    this.showLines = v;
    gsap.to(this.lineMat.uniforms.uProgress, { value: v ? 1 : 0, duration: v ? 1.0 : 0.6, ease: 'power2.inOut' });
    gsap.to(this.state, { arrows: v ? 1 : 0, duration: 0.5 });
  }

  reset() {
    this.rotTarget = 0;
    this.panel?.api.rot.set(0);
    this.panel?.api.strength.set(1);
    this.setStrength(1);
    gsap.to(this.compassPos, { x: COMPASS0.x, y: COMPASS0.z, duration: 0.8, ease: 'power3.inOut', onUpdate: () => this._placeCompass() });
  }

  _applyState() {
    const s = this.state;
    const h = AXIS_H * s.lift;
    this.body.position.y = h;
    this.body.scale.y = 0.04 + 0.96 * s.lift;
    this.body.position.y = Math.max(h, (THICK / 2) * this.body.scale.y);
    this.linesGroup.position.y = this.body.position.y;
    for (const g of this.planes) {
      const { start, target } = g.userData;
      g.rotation.x = -(start + (target - start) * s.fan);
    }
    this.lineMat.uniforms.uProgress.value = this.showLines ? s.draw : 0;
    this.halves.forEach((m) => m.material.forEach((mm) => {
      if (mm.uniforms) return;
      mm.transparent = true;
      mm.opacity = Math.min(1, s.draw * 1.5);
    }));
    this.halves.forEach((m) => m.children.forEach((c) => c.material && (c.material.opacity = 0.9 * Math.min(1, s.draw * 1.5))));
    this.compass.scale.setScalar(Math.max(0.0001, s.compass));
    this.compass.visible = s.compass > 0.01;
    this.arrowMesh.material.opacity = s.arrows * 0.85;
  }

  enter(tl, t0) {
    const s = this.state;
    tl.add(() => (this.group.visible = true), t0);
    tl.to(s, { draw: 1, duration: 1.1, ease: 'power1.inOut', onUpdate: () => this._applyState() }, t0);
    tl.to(s, { lift: 1, duration: 0.8, ease: 'power2.out', onUpdate: () => this._applyState() }, t0 + 0.9);
    tl.to(s, { fan: 1, duration: 1.6, ease: 'power3.inOut', onUpdate: () => this._applyState() }, t0 + 1.25);
    tl.to(s, { compass: 1, duration: 0.8, ease: 'back.out(2)', onUpdate: () => this._applyState() }, t0 + 1.6);
    tl.to(s, { arrows: 1, duration: 0.6, onUpdate: () => this._applyState() }, t0 + 2.4);
    tl.add(() => {
      const n = this.notes;
      n.N.reveal(0);
      n.S.reveal(0.15);
      n.gauss.reveal(0.4, 1.1);
      n.falloff.reveal(1.0, 0.8);
      n.compass.reveal(0.6);
      n.hint.reveal(1.4);
    }, t0 + 2.4);
    return t0 + 2.6;
  }

  exit(tl, t0) {
    const s = this.state;
    tl.add(() => Object.values(this.notes).forEach((n) => n.hide()), t0);
    tl.to(this, { rotTarget: 0, rot: 0, duration: 0.6, ease: 'power2.inOut' }, t0);
    tl.to(s, { arrows: 0, duration: 0.3, onUpdate: () => this._applyState() }, t0);
    tl.to(s, { compass: 0, duration: 0.5, ease: 'back.in(2)', onUpdate: () => this._applyState() }, t0 + 0.1);
    tl.to(s, { fan: 0, duration: 1.0, ease: 'power3.inOut', onUpdate: () => this._applyState() }, t0 + 0.3);
    tl.to(s, { lift: 0, duration: 0.6, ease: 'power2.in', onUpdate: () => this._applyState() }, t0 + 1.0);
    tl.to(s, { draw: 0, duration: 0.5, onUpdate: () => this._applyState() }, t0 + 1.5);
    tl.add(() => (this.group.visible = false), t0 + 2.05);
    return t0 + 1.5;
  }

  update(dt) {
    if (!this.group.visible) return;
    this.time += dt;
    this.rot += (this.rotTarget - this.rot) * Math.min(1, dt * 10);
    this.asm.rotation.y = this.rot;
    this.lineMat.uniforms.uTime.value = this.time;

    // flowing arrows along field lines (N → S), speed ∝ strength
    const dummy = this._dummy || (this._dummy = new THREE.Object3D());
    const X = new THREE.Vector3(1, 0, 0);
    let idx = 0;
    if (this.state.arrows > 0.01 && this.showLines) {
      for (const g of this.planes) {
        const phi = -g.rotation.x;
        for (const ln of this.lines) {
          for (let k = 0; k < 2; k++) {
            const u = (k / 2 + this.time * 0.05 * (0.4 + this.strength) * (0.6 / Math.max(ln.len, 0.3))) % 1;
            const d = u * ln.len;
            let j = 1;
            while (j < ln.cum.length - 1 && ln.cum[j] < d) j++;
            const [x0, r0] = ln.pts[j - 1], [x1, r1] = ln.pts[j];
            const f = (d - ln.cum[j - 1]) / Math.max(1e-6, ln.cum[j] - ln.cum[j - 1]);
            const p = new THREE.Vector3(x0 + (x1 - x0) * f, 0, r0 + (r1 - r0) * f).applyAxisAngle(X, phi);
            const dir = new THREE.Vector3(x1 - x0, 0, r1 - r0).normalize().applyAxisAngle(X, phi);
            dummy.position.copy(p);
            dummy.quaternion.setFromUnitVectors(X, dir);
            const fade = Math.min(1, u * 8, (1 - u) * 8);
            dummy.scale.setScalar(Math.max(0.001, fade));
            dummy.updateMatrix();
            this.arrowMesh.setMatrixAt(idx++, dummy.matrix);
          }
        }
      }
    }
    this.arrowMesh.count = idx;
    this.arrowMesh.instanceMatrix.needsUpdate = true;

    // compass: torque toward local B (magnet + Earth)
    if (this.compass.visible) {
      const wp = this.compass.getWorldPosition(new THREE.Vector3());
      const lp = this.linesGroup.worldToLocal(wp.clone());
      const q = 0.02 * this.strength;
      const B = new THREE.Vector3();
      for (const [sx, qq] of [[D, q], [-D, -q]]) {
        const r = lp.clone().sub(new THREE.Vector3(sx, 0, 0));
        const l3 = Math.pow(Math.max(r.lengthSq(), 0.004), 1.5);
        B.add(r.multiplyScalar(qq / l3));
      }
      B.transformDirection(this.linesGroup.matrixWorld).multiplyScalar(B.length() || 0);
      // transformDirection normalises; restore magnitude
      const Bm = this._fieldMag(lp, q);
      B.normalize().multiplyScalar(Bm);
      if (this.earth) B.add(new THREE.Vector3(0, 0, -EARTH));
      const target = Math.atan2(-B.z, B.x);
      let diff = target - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const Bh = Math.hypot(B.x, B.z);
      const k = 60 * Math.min(4, Math.sqrt(Bh / EARTH));
      this.headingVel += (k * Math.sin(diff) - 5.5 * this.headingVel) * Math.min(dt, 1 / 30);
      this.heading += this.headingVel * Math.min(dt, 1 / 30);
      this.needle.rotation.y = this.heading;
      const ratio = Bh / EARTH;
      this.notes.compass.set(`|B| ≈ ${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)} × Earth’s`);
    }
  }

  _fieldMag(lp, q) {
    const B = new THREE.Vector3();
    for (const [sx, qq] of [[D, q], [-D, -q]]) {
      const r = lp.clone().sub(new THREE.Vector3(sx, 0, 0));
      const l3 = Math.pow(Math.max(r.lengthSq(), 0.004), 1.5);
      B.add(r.multiplyScalar(qq / l3));
    }
    return B.length();
  }

  dispose() {
    this.group.parent?.remove(this.group);
    Object.values(this.notes).forEach((n) => n.element.remove());
    this.lineGeos?.forEach((g) => g.dispose());
    disposeTree(this.group);
    this.lineMat.dispose();
  }
}
