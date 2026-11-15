// Visualization generation jobs, keyed by page key + figure id + runtime
// version: cache → (template) → Gemini → static check → headless smoke test →
// repair (≤ MAX_REPAIRS) → store. Progress is streamed to the UI over SSE.
import sharp from 'sharp';
import { RUNTIME_VERSION } from '@lp/runtime/bundle';
import { pageBoxToPhotoBox, type Quad } from '@lp/runtime/host';
import { env } from './env';
import { generateJson } from './gemini';
import { getViz, putViz, vizKey, logStage } from './cache';
import { systemPrompt, userPrompt, repairPrompt, CODEGEN_SCHEMA } from './prompts/codegen';
import { staticCheck } from './validate/static';
import { smokeTest } from './validate/smoke';
import { exampleForConcept, exampleCode } from './examples';
import type { Figure, ModuleCtxJson, PageUnderstanding, VizRecord } from './types';

export type JobEvent =
  | { type: 'progress'; stage: 'cache' | 'prompt' | 'writing' | 'static' | 'smoke' | 'repair' | 'store'; message: string; attempt?: number; t: number }
  | { type: 'done'; viz: VizRecord; t: number }
  | { type: 'failed'; errors: string[]; viz: VizRecord | null; t: number };

interface Job {
  key: string;
  events: JobEvent[];
  listeners: Set<(e: JobEvent) => void>;
  done: boolean;
  promise: Promise<VizRecord | null>;
}

const jobs = new Map<string, Job>();

export interface GenInput {
  sessionId: string;
  pageKey: string;
  page: PageUnderstanding;
  figure: Figure;
  /** stored page photo and its page corners */
  photo: Buffer;
  corners: Quad;
  ctx: ModuleCtxJson;
  force?: boolean;
  /** never serve a template (developer "regenerate") */
  noTemplate?: boolean;
}

export function jobFor(key: string) {
  return jobs.get(key) ?? null;
}

export function subscribe(key: string, fn: (e: JobEvent) => void) {
  const j = jobs.get(key);
  if (!j) return () => {};
  for (const e of j.events) fn(e);
  if (!j.done) j.listeners.add(fn);
  return () => j.listeners.delete(fn);
}

/** starts (or joins) the job for this figure */
export function startGeneration(input: GenInput): { key: string; cached: VizRecord | null } {
  const key = vizKey(input.pageKey, input.figure.id, RUNTIME_VERSION);
  if (!input.force) {
    const hit = getViz(key);
    if (hit) return { key, cached: { ...hit, source: hit.source === 'generated' ? 'cache' : hit.source } };
    const running = jobs.get(key);
    if (running && !running.done) return { key, cached: null };
  }
  const job: Job = { key, events: [], listeners: new Set(), done: false, promise: Promise.resolve(null) };
  jobs.set(key, job);
  const emit = (e: JobEvent) => {
    job.events.push(e);
    for (const l of job.listeners) l(e);
    if (e.type === 'done' || e.type === 'failed') {
      job.done = true;
      job.listeners.clear();
      setTimeout(() => jobs.get(key) === job && jobs.delete(key), 10 * 60_000);
    }
  };
  job.promise = run(key, input, emit).catch((err) => {
    emit({ type: 'failed', errors: [String(err?.message ?? err)], viz: null, t: Date.now() });
    return null;
  });
  return { key, cached: null };
}

async function figureCrop(photo: Buffer, corners: Quad, fig: Figure) {
  const meta = await sharp(photo).metadata();
  const W = meta.width ?? 1, H = meta.height ?? 1;
  const b = pageBoxToPhotoBox(corners, fig.box);
  const pad = 0.03;
  const x0 = Math.max(0, Math.floor((b.x0 - pad) * W)), y0 = Math.max(0, Math.floor((b.y0 - pad) * H));
  const x1 = Math.min(W, Math.ceil((b.x1 + pad) * W)), y1 = Math.min(H, Math.ceil((b.y1 + pad) * H));
  return sharp(photo).extract({ left: x0, top: y0, width: Math.max(8, x1 - x0), height: Math.max(8, y1 - y0) }).resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
}

async function run(key: string, input: GenInput, emit: (e: JobEvent) => void): Promise<VizRecord | null> {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const now = () => Date.now();
  const prog = (stage: Extract<JobEvent, { type: 'progress' }>['stage'], message: string, attempt?: number) => emit({ type: 'progress', stage, message, attempt, t: now() });
  const { figure: fig } = input;

  // ---- template: a reference module for a well-known concept ----------------
  const ex = env.templateMatch && !input.noTemplate && fig.template !== 'none' ? exampleForConcept(fig.template) : null;
  const exCode = ex ? exampleCode(ex) : null;
  if (ex && exCode) {
    prog('cache', `using the ${ex.title.toLowerCase()} template`);
    const smoke = await smokeTest(exCode, input.ctx as any, { photo: input.photo, corners: input.corners });
    timings.smoke = smoke.ms;
    if (smoke.ok) {
      const rec: VizRecord = {
        key, pageKey: input.pageKey, figureId: fig.id, runtimeVersion: RUNTIME_VERSION, source: 'template', code: exCode,
        title: ex.title, summary: ex.summary, controls: [], model: 'template:' + ex.id, attempts: 0,
        validation: { ok: true, errors: [], report: smoke.report }, screenshot: `/v1/visualizations/${encodeURIComponent(key)}/screenshot.png`,
        prompt: null, timings: { ...timings, total: performance.now() - t0 }, createdAt: Date.now(), ctx: input.ctx,
      };
      putViz(rec, smoke.screenshot);
      logStage(input.sessionId, 'generate', performance.now() - t0, `template ${ex.id}`);
      emit({ type: 'done', viz: rec, t: now() });
      return rec;
    }
    prog('cache', `template failed on this page (${smoke.errors[0]}); generating instead`);
  }

  // ---- Gemini ------------------------------------------------------------------
  prog('prompt', 'reading the figure');
  const crop = await figureCrop(input.photo, input.corners, fig);
  const system = systemPrompt();
  const user = userPrompt(input.page, fig);
  const history: { role: 'user' | 'model'; text: string }[] = [];
  let lastErrors: string[] = [];
  let best: { out: { title: string; summary: string; controls: string[]; code: string }; errors: string[]; smoke: Awaited<ReturnType<typeof smokeTest>> | null } | null = null;

  for (let attempt = 1; attempt <= 1 + env.maxRepairs; attempt++) {
    prog(attempt === 1 ? 'writing' : 'repair', attempt === 1 ? 'sketching your visualization' : `fixing ${lastErrors.length} problem${lastErrors.length === 1 ? '' : 's'}`, attempt);
    const parts: any[] = [{ inlineData: { mimeType: 'image/jpeg', data: crop.toString('base64') } }, { text: user }];
    // repairs: include the previous attempt and its errors (single-turn for simplicity)
    if (attempt > 1 && best) parts.push({ text: repairPrompt(best.out.code, lastErrors) });
    const tg = performance.now();
    // repairs can use a stronger model (GEMINI_REPAIR_MODEL): fewer, harder calls
    const model = attempt > 1 && env.repairModel ? env.repairModel : env.codeModel;
    const { data, ms } = await generateJson<{ title: string; summary: string; controls: string[]; code: string }>({
      model,
      system,
      parts,
      schema: CODEGEN_SCHEMA,
      thinking: attempt > 1 && env.repairModel ? env.repairThinking : env.codeThinking,
      temperature: attempt === 1 ? 0.6 : 0.3,
      timeoutMs: 120_000,
    });
    timings[`gemini${attempt}`] = ms;
    logStage(input.sessionId, 'gemini', performance.now() - tg, `${model} attempt ${attempt}`);
    const out = { title: String(data.title ?? fig.title), summary: String(data.summary ?? ''), controls: Array.isArray(data.controls) ? data.controls.map(String) : [], code: stripFences(String(data.code ?? '')) };
    history.push({ role: 'model', text: out.code });

    prog('static', 'checking the code', attempt);
    const st = staticCheck(out.code);
    if (!st.ok) {
      lastErrors = st.errors;
      best = { out, errors: st.errors, smoke: null };
      continue;
    }
    prog('smoke', 'test-running it', attempt);
    const smoke = await smokeTest(out.code, input.ctx as any, { photo: input.photo, corners: input.corners });
    timings[`smoke${attempt}`] = smoke.ms;
    logStage(input.sessionId, 'smoke', smoke.ms, smoke.ok ? 'ok' : smoke.errors.join(' | ').slice(0, 200));
    best = { out, errors: smoke.errors, smoke };
    if (smoke.ok) break;
    lastErrors = smoke.errors;
  }

  const ok = !!best && best.errors.length === 0;
  const rec: VizRecord = {
    key, pageKey: input.pageKey, figureId: fig.id, runtimeVersion: RUNTIME_VERSION, source: 'generated',
    code: best?.out.code ?? '', title: best?.out.title ?? fig.title, summary: best?.out.summary ?? '', controls: best?.out.controls ?? [],
    model: env.repairModel && history.length > 1 ? `${env.codeModel} + ${env.repairModel} (repair)` : env.codeModel, attempts: history.length,
    validation: { ok, errors: best?.errors ?? ['no output'], report: best?.smoke?.report ? { ...best.smoke.report, png: undefined } : null },
    screenshot: best?.smoke?.screenshot ? `/v1/visualizations/${encodeURIComponent(key)}/screenshot.png` : null,
    prompt: { system, user }, timings: { ...timings, total: performance.now() - t0 }, createdAt: Date.now(), ctx: input.ctx,
  };
  logStage(input.sessionId, 'generate', performance.now() - t0, `${ok ? 'ok' : 'FAILED'} after ${history.length} attempt(s)`);
  if (ok) {
    prog('store', 'saving');
    putViz(rec, best!.smoke?.screenshot ?? null);
    emit({ type: 'done', viz: rec, t: now() });
    return rec;
  }
  // failures are kept for the developer view but never served from the cache
  putViz({ ...rec, key: `failed|${key}|${rec.createdAt}` }, best?.smoke?.screenshot ?? null);
  emit({ type: 'failed', errors: rec.validation.errors, viz: rec, t: now() });
  return null;
}

function stripFences(code: string) {
  const m = /^\s*```(?:js|javascript)?\s*\n([\s\S]*?)\n```\s*$/.exec(code);
  return (m ? m[1] : code).trim() + '\n';
}
