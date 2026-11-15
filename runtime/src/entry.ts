// Runs inside the sandboxed iframe. The host injects the generated module as
// `window.__LP_CREATE` (an inline script, before this bundle) and talks to us
// only via postMessage.
import * as THREE from 'three';
import gsap from 'gsap';
import { Stage, type StageViz } from './stage';
import { createLp, type LpInternals } from './lp';
import { FULL_QUAD } from './geom';
import { RUNTIME_VERSION, type HostToSandbox, type SandboxToHost, type ModuleCtx, type TestReport, type NormBox } from './protocol';

declare global {
  interface Window {
    __LP_CREATE?: (lp: unknown, ctx: ModuleCtx) => StageViz;
    __LP_LOAD_ERROR?: string;
  }
}

// Captured before generated code can shadow them.
const post = (() => {
  const p = window.parent;
  const send = p.postMessage.bind(p);
  return (m: SandboxToHost, transfer?: Transferable[]) => send(m, '*', transfer ?? []);
})();

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : (() => { try { return JSON.stringify(e); } catch { return String(e); } })()).slice(0, 2000);
const errStack = (e: unknown) => (e instanceof Error && e.stack ? e.stack.slice(0, 4000) : undefined);
const errors: string[] = [];
const report = (phase: Extract<SandboxToHost, { type: 'error' }>['phase'], e: unknown) => {
  const message = errText(e);
  errors.push(`${phase}: ${message}`);
  post({ type: 'error', phase, message, stack: errStack(e) });
};

window.addEventListener('error', (ev) => report('runtime', ev.error ?? ev.message));
window.addEventListener('unhandledrejection', (ev) => report('runtime', ev.reason));

const host = document.getElementById('stage')!;
const test = new URLSearchParams(location.hash.slice(1)).has('test') || (window as any).__LP_TEST === true;
const stage = new Stage(
  host,
  {
    onError: (phase, e) => report(phase, e),
    onState: (state) => post({ type: 'state', state }),
    onTouch: (kind) => post({ type: 'touch', kind }),
  },
  { preserveDrawingBuffer: test }
);
let internals: LpInternals | null = null;

function teardownModule() {
  if (internals) {
    for (const n of internals.notes) n.element?.remove?.();
    internals.root.parent?.remove(internals.root);
  }
  stage.clearViz();
  internals = null;
  stage.marginEl.innerHTML = '';
  stage.marginEl.dataset.html = '';
}

function clampBox(b: NormBox): NormBox {
  const c = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  let { x0, y0, x1, y1 } = { x0: c(b.x0), y0: c(b.y0), x1: c(b.x1), y1: c(b.y1) };
  if (x1 - x0 < 0.05) [x0, x1] = [Math.max(0, x0 - 0.1), Math.min(1, x1 + 0.1)];
  if (y1 - y0 < 0.05) [y0, y1] = [Math.max(0, y0 - 0.1), Math.min(1, y1 + 0.1)];
  return { x0, y0, x1, y1 };
}

async function load(photo: ImageBitmap | null, corners = FULL_QUAD, ctx: ModuleCtx, instant = false) {
  teardownModule();
  stage.load(photo, corners, clampBox(ctx.figure.rect));
  if (window.__LP_LOAD_ERROR) {
    report('create', window.__LP_LOAD_ERROR);
    return;
  }
  if (typeof window.__LP_CREATE !== 'function') {
    report('create', 'module did not define a create() function');
    return;
  }
  const made = createLp(stage, ctx, {
    controls: (controls) => post({ type: 'controls', controls }),
    display: (key, display, value) => post({ type: 'display', key, display, value }),
    label: (key, label, icon) => post({ type: 'label', key, label, icon }),
    error: (phase, e) => report(phase, e),
  });
  internals = made.internals;
  let viz: StageViz;
  try {
    viz = window.__LP_CREATE(made.lp, ctx);
    if (!viz || typeof viz !== 'object') throw new Error('create() must return { root, enter, exit, update, dispose }');
    for (const k of ['enter', 'exit', 'update', 'dispose'] as const) {
      if (typeof (viz as any)[k] !== 'function') throw new Error(`create() result is missing ${k}()`);
    }
  } catch (e) {
    report('create', e);
    return;
  }
  if (viz.root && viz.root !== made.internals.root && !viz.root.parent) made.internals.root.add(viz.root);
  stage.setViz({ ...viz, root: made.internals.root }, made.internals.interactives);
  // the bundle and fonts must be ready before the first handwritten note measures itself
  await document.fonts?.ready;
  post({ type: 'loaded' });
  await stage.showPhoto(instant);
}

window.addEventListener('message', (ev: MessageEvent<HostToSandbox>) => {
  if (ev.source !== window.parent) return;
  const m = ev.data;
  if (!m || typeof m !== 'object') return;
  switch (m.type) {
    case 'load':
      void load(m.photo, m.corners, m.ctx, m.instant).catch((e) => report('runtime', e));
      break;
    case 'play':
      void stage.activate(() => {});
      break;
    case 'fold':
      void stage.deactivate();
      break;
    case 'reset-view':
      stage.resetView();
      break;
    case 'control': {
      const h = internals?.controlHandlers.get(m.key);
      try {
        h?.(m.value);
      } catch (e) {
        report('control', e);
      }
      break;
    }
    case 'layout':
      // top = header bottom, bottom = height covered by the controls sheet (px)
      stage.marginEl.style.top = `${Math.max(0, m.top)}px`;
      stage.setInsets(m.top, m.bottom);
      break;
    case 'test':
      void runTest(m.frames, !!m.screenshot);
      break;
    case 'exercise':
      runExercise(m.frames);
      break;
    case 'dispose':
      try {
        teardownModule();
        stage.dispose();
        stage.renderer.forceContextLoss();
      } catch {
        /* the iframe is about to go away anyway */
      }
      break;
  }
});

/** NaN transforms or vertices anywhere under the module root */
function findNaN() {
  const nan: string[] = [];
  const root = internals?.root;
  root?.updateMatrixWorld(true);
  root?.traverse((o: any) => {
    const e = o.matrixWorld.elements as number[];
    if (!e.every(Number.isFinite)) nan.push(`${o.type}${o.name ? ' ' + o.name : ''}`);
    const pos = (o.geometry as THREE.BufferGeometry | undefined)?.attributes?.position;
    if (pos && !Array.prototype.every.call(pos.array, Number.isFinite)) nan.push(`${o.type} geometry`);
  });
  return [...new Set(nan)].slice(0, 20);
}

/**
 * Exercise phase of the smoke test: what a student does in the first minute.
 * Every slider to both ends and back, toggles both ways, every button, and a
 * synthetic drag on every draggable, with frames in between; then a long run.
 */
function runExercise(frames: number) {
  const dt = 1 / 60;
  const before = errors.length;
  let t = gsap.ticker.time || 0;
  let steps = 0;
  const run = (n: number) => {
    for (let i = 0; i < n; i++) {
      t += dt;
      gsap.updateRoot(t);
      stage.frame(dt);
    }
  };
  const call = (key: string, v: number | boolean | null) => {
    steps++;
    try {
      internals?.controlHandlers.get(key)?.(v);
    } catch (e) {
      report('control', e);
    }
    run(12);
  };
  for (const c of internals?.controlSpecs ?? []) {
    if (c.type === 'slider') {
      for (const v of [c.min, c.max, (c.min + c.max) / 2, c.value]) call(c.key, v);
    } else if (c.type === 'toggle') {
      call(c.key, !c.value);
      call(c.key, c.value);
    } else {
      call(c.key, null);
      run(60);
    }
  }
  // synthetic drags: from the object's screen position, a short arc
  const ray = new THREE.Raycaster();
  for (const it of stage.interactives) {
    const wp = it.object.getWorldPosition(new THREE.Vector3()).project(stage.camera);
    const at = (dx: number, dy: number) => {
      ray.setFromCamera(new THREE.Vector2(wp.x + dx, wp.y + dy), stage.camera);
      return ray.ray.clone();
    };
    const hit = { object: it.object, point: it.object.getWorldPosition(new THREE.Vector3()), distance: 1 } as unknown as THREE.Intersection;
    steps++;
    try {
      it.onDown?.(hit, at(0, 0));
      for (let k = 1; k <= 12; k++) {
        it.onDrag?.(at(Math.sin(k / 2) * 0.15, k * 0.012), new PointerEvent('pointermove'));
        run(2);
      }
      it.onUp?.();
    } catch (e) {
      report('runtime', e);
    }
    run(30);
  }
  // back to the page and up again
  void stage.deactivate();
  run(160);
  void stage.activate(() => {});
  run(200);
  run(frames);
  post({ type: 'exercise-report', errors: errors.slice(before, before + 20), nanObjects: findNaN(), steps });
}

// heartbeat for the host's watchdog
setInterval(() => post({ type: 'stats', stats: stage.takeStats() }), 1000);

/** Deterministic smoke test: run the full lift and N frames at 60 fps, then inspect the scene. */
async function runTest(frames: number, screenshot: boolean) {
  stage.frozen = true;
  gsap.ticker.sleep();
  const dt = 1 / 60;
  const viz = stage.viz;
  if (viz) {
    void stage.activate(() => {});
    // drive GSAP and the module in lockstep
    const t0 = gsap.ticker.time || 0;
    for (let i = 0; i < frames; i++) {
      gsap.updateRoot(t0 + dt * (i + 1));
      stage.frame(dt);
    }
    // let the choreography, note write-ons and camera move settle (3 s more)
    for (let i = 0; i < 180; i++) {
      gsap.updateRoot(t0 + dt * (frames + i + 1));
      stage.frame(dt);
    }
  }
  const nan: string[] = [];
  let meshes = 0, inkLines = 0;
  const root = internals?.root;
  root?.updateMatrixWorld(true);
  root?.traverse((o: any) => {
    if (o.isMesh && !o.userData.isOutline && o.material?.visible !== false) {
      meshes++;
      if (o.material?.uniforms?.uProgress) inkLines++;
    }
    const e = o.matrixWorld.elements as number[];
    if (!e.every(Number.isFinite)) nan.push(`${o.type}${o.name ? ' ' + o.name : ''}`);
    const g = o.geometry as THREE.BufferGeometry | undefined;
    const pos = g?.attributes?.position;
    if (pos && !Array.prototype.every.call(pos.array, Number.isFinite)) nan.push(`${o.type} geometry`);
  });
  const rep: TestReport = {
    frames,
    meshes,
    inkLines,
    notes: internals?.notes.length ?? 0,
    controls: internals?.controlCount() ?? 0,
    nanObjects: [...new Set(nan)].slice(0, 20),
    errors: errors.slice(0, 20),
    hasEnterExit: !!viz,
    belowPaper: Math.round(stage.lift.below * 100) / 100,
  };
  if (screenshot) {
    stage.frame(dt);
    rep.png = stage.renderer.domElement.toDataURL('image/png');
  }
  post({ type: 'test-report', report: rep });
}

post({ type: 'ready', version: RUNTIME_VERSION });
if (test) (window as any).__lpStage = stage;
stage.start();
