// Headless smoke test: load a module into the real runtime (same srcdoc, same
// CSP) in Chromium with software WebGL, run the lift-off and 120 frames, and
// inspect the scene. Produces a screenshot for the pipeline view.
import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';
import { buildSrcdoc } from '@lp/runtime/host';
import type { ModuleCtx, TestReport } from '@lp/runtime/host';
import type { Quad } from '@lp/runtime/host';

let browserP: Promise<Browser> | null = null;
function browser() {
  browserP ??= chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
  });
  return browserP;
}

export async function closeBrowser() {
  if (browserP) (await browserP).close();
  browserP = null;
}

export interface SmokeResult {
  ok: boolean;
  errors: string[];
  report: TestReport | null;
  screenshot: Buffer | null;
  /** controls/drags driven in the exercise phase */
  exercised?: number;
  ms: number;
}

export async function smokeTest(
  code: string,
  ctx: ModuleCtx,
  o: { photo?: Buffer | null; corners?: Quad; frames?: number; timeoutMs?: number; viewport?: { width: number; height: number }; exercise?: boolean } = {}
): Promise<SmokeResult> {
  const t0 = performance.now();
  const b = await browser();
  const page = await b.newPage({ viewport: o.viewport ?? { width: 390, height: 760 }, deviceScaleFactor: 1 });
  const consoleErrors: string[] = [];
  let exercised = 0;
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`console: ${m.text().slice(0, 500)}`);
  });
  try {
    let photoUrl: string | null = null;
    if (o.photo) {
      const jpg = await sharp(o.photo).rotate().resize({ width: 1024, height: 1024, fit: 'inside' }).jpeg({ quality: 82 }).toBuffer();
      photoUrl = `data:image/jpeg;base64,${jpg.toString('base64')}`;
    }
    await page.setContent(buildSrcdoc(code, { test: true }), { waitUntil: 'load' });
    const res = await page.evaluate(
      async ({ ctx, photoUrl, corners, frames, timeoutMs }) => {
        const wait = <T>(pred: (d: any) => T | undefined, ms: number) =>
          new Promise<T>((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('timeout')), ms);
            addEventListener('message', function h(ev) {
              const r = pred(ev.data);
              if (r !== undefined) {
                clearTimeout(t);
                removeEventListener('message', h);
                resolve(r);
              }
            });
          });
        const errs: string[] = [];
        addEventListener('message', (ev) => {
          if (ev.data?.type === 'error') errs.push(`${ev.data.phase}: ${ev.data.message}`);
        });
        let photo: ImageBitmap | null = null;
        if (photoUrl) {
          const img = new Image();
          img.src = photoUrl;
          await img.decode();
          photo = await createImageBitmap(img);
        }
        const loaded = wait((d) => (d?.type === 'loaded' ? 'loaded' : d?.type === 'error' && d.phase === 'create' ? 'error' : undefined), timeoutMs);
        postMessage({ type: 'load', photo, corners, ctx, instant: true }, '*', photo ? [photo] : []);
        let state: string;
        try {
          state = await loaded;
        } catch {
          return { report: null, errs: [...errs, 'load: timed out waiting for the module'] };
        }
        if (state === 'error') return { report: null, errs };
        const rep = wait((d) => (d?.type === 'test-report' ? d.report : undefined), timeoutMs);
        postMessage({ type: 'test', frames, screenshot: false }, '*');
        try {
          return { report: await rep, errs };
        } catch {
          return { report: null, errs: [...errs, `test: no report within ${timeoutMs} ms (frame loop hung?)`] };
        }
      },
      { ctx, photoUrl, corners: o.corners ?? [[0, 0], [1, 0], [1, 1], [0, 1]], frames: o.frames ?? 120, timeoutMs: o.timeoutMs ?? 15000 }
    );
    const report = res.report as TestReport | null;
    const errors = [...new Set([...res.errs, ...(report?.errors ?? []), ...consoleErrors.filter((e) => !/GPU stall|GL_|WebGL.*performance/i.test(e))])];
    if (report) {
      if (report.meshes === 0) errors.push('scene has no meshes');
      if (report.nanObjects.length) errors.push(`NaN transforms or vertices in: ${report.nanObjects.join(', ')}`);
      if (report.controls === 0) errors.push('no controls declared (call lp.controls([...]))');
    }
    const screenshot = report ? await page.screenshot({ type: 'png' }) : null;
    // exercise phase: controls, drags, fold/unfold, 10 s more (after the screenshot)
    if (report && errors.length === 0 && o.exercise !== false) {
      const ex = await page.evaluate(
        (ms) =>
          new Promise<any>((resolve) => {
            const t = setTimeout(() => resolve({ errors: [`exercise: no report within ${ms} ms (frame loop hung?)`], nanObjects: [], steps: 0 }), ms);
            addEventListener('message', function h(ev) {
              if (ev.data?.type === 'exercise-report') {
                clearTimeout(t);
                removeEventListener('message', h);
                resolve(ev.data);
              }
            });
            postMessage({ type: 'exercise', frames: 240 }, '*');
          }),
        o.timeoutMs ?? 20000
      );
      for (const e of ex.errors) errors.push(`while exercising controls/drags: ${e}`);
      if (ex.nanObjects.length) errors.push(`NaN after exercising controls/drags in: ${ex.nanObjects.join(', ')}`);
      if (ex.escaped?.length)
        errors.push(`objects flew off the figure (simulated at 24 fps): ${ex.escaped.join('; ')}. Keep every moving object bounded: integrate dynamics with lp.ode (RK4) rather than hand-rolled Euler steps, and clamp or reset positions so they stay within the figure for every combination of slider values.`);
      exercised = ex.steps;
    }
    return { ok: !!report && errors.length === 0, errors: [...new Set(errors)], report, screenshot, exercised, ms: performance.now() - t0 };
  } finally {
    await page.close();
  }
}
