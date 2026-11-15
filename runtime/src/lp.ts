// The `lp` object handed to generated visualization modules. Everything a
// module can do to look like the demo goes through here: palette, sketch
// materials, ink, handwritten notes, page anchoring, choreography presets,
// maths helpers, controls and touch dragging.
import * as THREE from 'three';
import gsap from 'gsap';
// @ts-ignore — v1 JS
import { PALETTE, FONTS, rng, sketchPath, sketchLine, sketchCircle, sketchArrow, watercolor, handText, drawMath } from './paper.js';
// @ts-ignore
import { sketchMaterial, addHullOutline, addEdges, inkTube, makeArrow, setArrow, setTreeOpacity, disposeTree, INK } from './sketch.js';
// @ts-ignore
import { makeNote } from './ui.js';
import { popUp, riseFromPage, unfold, drawOn } from './choreo';
import { makeBoard, type BoardOpts } from './board';
import { ode, surface, vectorField, trace } from './math';
import type { Stage, Interactive } from './stage';
import type { ControlSpec, ModuleCtx } from './protocol';

export const palette = {
  ivory: '#f7f0e1',
  paper: '#f7f0e1',
  ink: '#2f2b26',
  graphite: '#5a5650',
  sepia: '#8a6a4a',
  sage: '#9fb79a',
  sageDeep: '#6f8f6c',
  blue: '#9db7cf',
  dustyBlue: '#9db7cf',
  blueDeep: '#6b8fb3',
  peach: '#f2b8a0',
  coral: '#e8907e',
  coralDeep: '#c96a5a',
  lavender: '#c4b5dc',
  lavenderDeep: '#8f7db5',
  yellow: '#f1d68c',
};
type PaletteKey = keyof typeof palette;
const NOTE_COLORS = ['coral', 'blue', 'sepia', 'sage', 'lavender'];

/** palette key or any CSS colour → hex; unknown strings fall back to graphite */
export function color(c: string | number | THREE.Color | undefined, fallback: string = palette.graphite): string {
  if (c === undefined || c === null) return fallback;
  if (typeof c === 'number' || (c as THREE.Color).isColor) return '#' + new THREE.Color(c as any).getHexString();
  const s = String(c);
  if (s in palette) return palette[s as PaletteKey];
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return s;
  return fallback;
}

type ControlInput =
  | { type: 'slider'; key: string; label: string; min: number; max: number; step?: number; value: number; unit?: string; format?: (v: number) => string; ticks?: { v: number; label: string }[]; snap?: number; onChange?: (v: number) => void }
  | { type: 'toggle'; key: string; label: string; icon?: string; value?: boolean; onChange?: (v: boolean) => void }
  | { type: 'button'; key?: string; label: string; icon?: string; onClick?: () => void };

export interface Bridge {
  controls(c: ControlSpec[]): void;
  display(key: string, display: string, value?: number | boolean): void;
  label(key: string, label: string, icon?: string): void;
  error(phase: 'control' | 'runtime', e: unknown): void;
}

export interface LpInternals {
  root: THREE.Group;
  interactives: Interactive[];
  controlHandlers: Map<string, (v: number | boolean | null) => void>;
  controlSpecs: ControlSpec[];
  notes: any[];
  marginNotes: any[];
  syncMargin(): void;
  controlCount(): number;
}

export function createLp(stage: Stage, ctx: ModuleCtx, bridge: Bridge) {
  const root = new THREE.Group();
  root.name = 'lp-root';
  stage.pageGroup.add(root);
  const interactives: Interactive[] = [];
  const controlHandlers = new Map<string, (v: number | boolean | null) => void>();
  const controlSpecs: ControlSpec[] = [];
  const notes: any[] = [];
  const marginNotes: any[] = [];
  let nControls = 0;

  const fw = stage.figureWorld();
  const figure = {
    ...fw,
    rect: { ...stage.figure },
    description: ctx.figure.description,
    /** figure-normalised (u right, v down, 0..1) → world point on the page */
    point: (u: number, v: number, lift = 0) => stage.point(fw.x0 + u * fw.w, fw.z0 + v * fw.h, lift),
    /**
     * A group centred on the figure, lying on the page (x right, y up off the
     * page, z down the page), scaled so `designW × designH` units fill the
     * figure. Lets a module be authored at a fixed size whatever the photo.
     */
    frame(designW = 1.8, designH?: number) {
      const g = new THREE.Group();
      const s = Math.min(fw.w / designW, designH ? fw.h / designH : Infinity);
      g.scale.setScalar(Number.isFinite(s) && s > 0 ? s : 1);
      g.position.copy(stage.point(fw.cx, fw.cz, 0.001));
      root.add(g);
      return g;
    },
  };

  const page = {
    W: stage.W,
    H: stage.H,
    group: stage.pageGroup,
    point: (x: number, z: number, lift = 0) => stage.point(x, z, lift),
    uv: (u: number, v: number, lift = 0) => stage.uv(u, v, lift),
  };

  const syncMargin = () => {
    const html = marginNotes
      .filter((n) => n.userData.shown)
      .map((n) => `<div class="mnote ${n.userData.color}">${n.userData.last ?? n.userData.ink.innerHTML}</div>`)
      .join('');
    if (stage.marginEl.dataset.html !== html) {
      stage.marginEl.innerHTML = html;
      stage.marginEl.dataset.html = html;
    }
  };

  /** handwritten note. kind: label (small, in 3D) | readout (live value) | equation (margin strip) */
  function note(html: string, o: { kind?: 'label' | 'equation' | 'readout'; color?: string; anchor?: 'center' | 'left'; at?: THREE.Vector3 } = {}) {
    const kind = o.kind ?? 'label';
    const col = o.color && NOTE_COLORS.includes(o.color) ? o.color : '';
    const cls = kind === 'equation' ? `eq ${col}` : `sm ${col}`;
    const n = makeNote(String(html), { cls, anchor: o.anchor ?? 'center' });
    n.userData.color = col;
    n.userData.kind = kind;
    if (o.at) n.position.copy(o.at);
    const set0 = n.set;
    n.set = (h: string) => {
      set0(String(h));
      if (kind === 'equation') syncMargin();
    };
    if (kind === 'equation') {
      n.visible = false;
      marginNotes.push(n);
      const rev0 = n.reveal, hide0 = n.hide;
      n.reveal = (...a: unknown[]) => { n.userData.shown = true; syncMargin(); return rev0(...a); };
      n.hide = (...a: unknown[]) => { n.userData.shown = false; syncMargin(); return hide0(...a); };
    }
    notes.push(n);
    return n;
  }

  const decimals = (step?: number) => (step && step < 1 ? Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)) : 0);

  function controls(list: ControlInput[]) {
    const specs: ControlSpec[] = [];
    const fmt = new Map<string, (v: number) => string>();
    let auto = 0;
    for (const c of list ?? []) {
      if (!c || typeof c !== 'object') continue;
      const key = String((c as any).key ?? `btn${auto++}`);
      if (c.type === 'slider') {
        const f = typeof c.format === 'function' ? c.format : (v: number) => `${v.toFixed(decimals(c.step))}${c.unit ? ' ' + c.unit : ''}`;
        fmt.set(key, f);
        let display = '';
        try { display = f(c.value); } catch { display = String(c.value); }
        specs.push({ type: 'slider', key, label: String(c.label), min: +c.min, max: +c.max, step: c.step, value: +c.value, display, ticks: c.ticks, snap: c.snap });
        controlHandlers.set(key, (v) => {
          const n = Number(v);
          if (!Number.isFinite(n)) return;
          c.onChange?.(n);
          let d = '';
          try { d = f(n); } catch { d = String(n); }
          bridge.display(key, d, n);
        });
      } else if (c.type === 'toggle') {
        specs.push({ type: 'toggle', key, label: String(c.label), icon: c.icon, value: !!c.value });
        controlHandlers.set(key, (v) => c.onChange?.(!!v));
      } else if (c.type === 'button') {
        specs.push({ type: 'button', key, label: String(c.label), icon: c.icon });
        controlHandlers.set(key, () => c.onClick?.());
      }
    }
    nControls = specs.length;
    controlSpecs.splice(0, controlSpecs.length, ...specs);
    bridge.controls(specs);
    const values = new Map<string, number | boolean>();
    for (const sp of specs) if (sp.type !== 'button') values.set(sp.key, sp.value);
    for (const [k, h] of [...controlHandlers]) controlHandlers.set(k, (v) => { if (v !== null) values.set(k, v); h(v); });
    return {
      /** current value of a slider/toggle */
      get(key: string) {
        return values.get(key);
      },
      /** move a control from code (e.g. after a reset) */
      set(key: string, value: number | boolean) {
        values.set(key, value);
        const f = fmt.get(key);
        let d = '';
        if (f) { try { d = f(Number(value)); } catch { d = String(value); } }
        bridge.display(key, d, value);
      },
      /** relabel a button/toggle (e.g. play ↔ pause) */
      label(key: string, label: string, icon?: string) {
        bridge.label(key, label, icon);
      },
    };
  }

  /**
   * Touch-dragging. The drag point is the ray hit on a plane through the
   * object: 'page' = parallel to the parent's x/z plane, 'vertical' = the
   * parent's x/y plane, 'screen' = facing the camera. onDrag receives the
   * point in the coordinates of `space` (default: the object's parent).
   */
  function draggable(
    object: THREE.Object3D,
    opts:
      | ((p: THREE.Vector3, ray: THREE.Ray) => void)
      | { plane?: 'page' | 'vertical' | 'screen'; space?: THREE.Object3D; onStart?: (p: THREE.Vector3, ray: THREE.Ray) => void; onDrag?: (p: THREE.Vector3, ray: THREE.Ray) => void; onEnd?: () => void; hitRadius?: number }
  ) {
    const o = typeof opts === 'function' ? { onDrag: opts } : opts ?? {};
    let target = object;
    if (o.hitRadius) {
      const grab = new THREE.Mesh(new THREE.SphereGeometry(o.hitRadius, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
      object.add(grab);
      target = grab;
    }
    const plane = new THREE.Plane();
    const tmp = new THREE.Vector3();
    const highlight = (v: number) =>
      object.traverse((x: any) => {
        const u = x.material?.userData?.uniforms?.uHighlight;
        if (u) gsap.to(u, { value: v, duration: 0.25 });
      });
    const localHit = (ray: THREE.Ray) => {
      const parent = o.space ?? object.parent;
      if (!parent) return null;
      const hit = ray.intersectPlane(plane, tmp);
      if (!hit) return null;
      return parent.worldToLocal(hit.clone());
    };
    const setPlane = () => {
      const parent = (o.space ?? object.parent)!;
      parent.updateMatrixWorld();
      const wp = object.getWorldPosition(new THREE.Vector3());
      let n: THREE.Vector3;
      if (o.plane === 'vertical') n = new THREE.Vector3(0, 0, 1).transformDirection(parent.matrixWorld);
      else if (o.plane === 'screen') n = stage.camera.getWorldDirection(new THREE.Vector3()).negate();
      else n = new THREE.Vector3(0, 1, 0).transformDirection(parent.matrixWorld);
      plane.setFromNormalAndCoplanarPoint(n, wp);
    };
    interactives.push({
      object: target,
      onDown: (_hit, ray) => {
        setPlane();
        highlight(1);
        const p = localHit(ray);
        if (p) o.onStart?.(p, ray);
      },
      onDrag: (ray) => {
        const p = localHit(ray);
        if (p) o.onDrag?.(p, ray);
      },
      onUp: () => {
        highlight(0);
        o.onEnd?.();
      },
      onHover: (on) => highlight(on ? 0.6 : 0),
    });
  }

  function ink(points: (THREE.Vector3 | number[])[], o: { dashed?: boolean; color?: string; color2?: string; tailFade?: number; progress?: number; radius?: number; opacity?: number; closed?: boolean; dashCount?: number; jitter?: number; flow?: number } = {}) {
    const pts = (points ?? [])
      .map((p) => (Array.isArray(p) ? new THREE.Vector3(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0) : p))
      .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
    if (pts.length < 2) pts.push(new THREE.Vector3(), new THREE.Vector3(0, 0.0001, 0));
    const mesh = inkTube(pts, {
      radius: o.radius ?? 0.005,
      dash: o.dashed ? 1 : 0,
      dashCount: o.dashCount ?? 30,
      color: color(o.color, '#3a352f'),
      opacity: o.opacity ?? 1,
      progress: o.progress ?? 1,
      closed: !!o.closed,
      jitter: o.jitter ?? 0,
      flow: o.flow ?? 0,
      color2: o.color2 ? color(o.color2) : null,
    });
    if (o.tailFade) mesh.material.uniforms.uTailFade.value = o.tailFade;
    return mesh;
  }

  /** an offscreen canvas as a texture (labels, decals, printed faces); call refresh() after drawing */
  function canvasTexture(w = 512, h = 512) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(8, Math.min(2048, Math.round(w)));
    canvas.height = Math.max(8, Math.min(2048, Math.round(h)));
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return { canvas, ctx: canvas.getContext('2d')!, texture, refresh: () => { texture.needsUpdate = true; } };
  }

  /** numeric parameter extracted from the page (ctx.params), case-insensitive, with a fallback */
  function param(name: string, fallback: number, range?: [number, number]) {
    const ps = ctx.params ?? {};
    const k = Object.keys(ps).find((x) => x === name) ?? Object.keys(ps).find((x) => x.toLowerCase() === name.toLowerCase());
    const raw = k === undefined ? undefined : (ps as any)[k];
    const v = typeof raw === 'number' ? raw : typeof raw?.value === 'number' ? raw.value : NaN;
    if (!Number.isFinite(v)) return fallback;
    return range ? Math.min(range[1], Math.max(range[0], v)) : v;
  }

  const lp = {
    THREE,
    param,
    gsap,
    palette,
    fonts: FONTS,
    color: (c: string) => color(c),
    sketch: (c: string, o: { hatch?: number; opacity?: number; emissive?: number; doubleSide?: boolean } = {}) =>
      sketchMaterial({ color: color(c, palette.peach), hatch: o.hatch ?? 1, opacity: o.opacity ?? 1, emissive: o.emissive ?? 0.22, side: o.doubleSide ? THREE.DoubleSide : THREE.FrontSide }),
    outline: (mesh: THREE.Mesh, thickness = 0.008) => addHullOutline(mesh, thickness),
    edges: (mesh: THREE.Mesh, o: { width?: number; opacity?: number; threshold?: number; color?: string } = {}) => addEdges(mesh, { ...o, color: color(o.color, '#3a352f') }),
    ink,
    canvasTexture,
    arrow: (c?: string, o: { radius?: number; head?: number; headR?: number; dashed?: boolean; dashCount?: number } = {}) => {
      const a = makeArrow(color(c, '#3a352f'), o);
      if (o.dashed) {
        // replace the solid shaft by dashes; setArrow scales the shaft group along y
        const { shaft, mat } = a.userData;
        const n = Math.max(2, Math.min(24, o.dashCount ?? 7));
        const dashes = new THREE.Group();
        const r = o.radius ?? 0.008;
        for (let i = 0; i < n; i++) {
          const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.55 / n, 6).translate(0, (i + 0.275) / n, 0), mat);
          d.raycast = () => {};
          dashes.add(d);
        }
        a.remove(shaft);
        shaft.geometry.dispose();
        a.add(dashes);
        a.userData.shaft = dashes;
      }
      return a;
    },
    setArrow: (arrow: THREE.Object3D, origin: THREE.Vector3, dir: THREE.Vector3, length: number) => setArrow(arrow, origin, dir, Number.isFinite(length) ? length : 0.0001),
    note,
    figure,
    page,
    root,
    board: (o: Partial<BoardOpts> & { in?: THREE.Object3D; at: [number, number]; size: [number, number] }) => makeBoard({ ...o, parent: o.in ?? o.parent ?? root } as BoardOpts),
    choreo: {
      popUp: (g: THREE.Object3D, o: { in?: THREE.Object3D; parent?: THREE.Object3D; at?: [number, number]; lean?: number } = {}) => popUp(g, { ...o, parent: o.in ?? o.parent ?? root }),
      riseFromPage: (g: THREE.Object3D, o: { in?: THREE.Object3D; parent?: THREE.Object3D; at?: [number, number]; height?: number } = {}) => riseFromPage(g, { ...o, parent: o.in ?? o.parent ?? root }),
      unfold: (g: THREE.Object3D, o: { in?: THREE.Object3D; parent?: THREE.Object3D; at?: [number, number]; lean?: number } = {}) => unfold(g, { ...o, parent: o.in ?? o.parent ?? root }),
      drawOn,
    },
    ode,
    surface,
    vectorField,
    trace,
    controls,
    draggable,
    opacity: (obj: THREE.Object3D, a: number) => setTreeOpacity(obj, a),
    dispose: (obj: THREE.Object3D) => disposeTree(obj),
    paper: { sketchPath, sketchLine, sketchCircle, sketchArrow, watercolor, handText, drawMath },
    util: {
      DEG: Math.PI / 180,
      rng,
      clamp: (v: number, a: number, b: number) => Math.min(b, Math.max(a, v)),
      lerp: (a: number, b: number, t: number) => a + (b - a) * t,
      /** frame-rate independent approach: x += (target − x)·(1 − e^(−rate·dt)) */
      damp: (x: number, target: number, rate: number, dt: number) => x + (target - x) * (1 - Math.exp(-rate * dt)),
    },
    INK,
  };

  const internals: LpInternals = { root, interactives, controlHandlers, controlSpecs, notes, marginNotes, syncMargin, controlCount: () => nControls };
  return { lp, internals };
}

export type Lp = ReturnType<typeof createLp>['lp'];
