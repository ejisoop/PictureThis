// PictureThis API server (Bun + Hono).
//   POST /v1/frames            photo URL from the glasses → gate → understand → discoveries
//   POST /v1/visualizations    start/join generation for a discovery (cache first)
//   GET  /v1/visualizations/events?key=…   SSE progress
//   GET  /v1/discoveries/:id(/photo.jpg)    stored discovery + its page photo
//   POST /v1/uploads           (dev harness) stand-in for Mentra's photo upload
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { RUNTIME_VERSION } from '@lp/runtime/bundle';
import { pageBoxToPhotoBox, type Quad } from '@lp/runtime/host';
import { env } from './env';
import { fetchPhoto, putUpload, getUpload } from './photos';
import { frameStats, gate, markAnalysed, resetSession } from './gate';
import { understand, understandFast, understandDetails, prepareImage } from './understand';
import { startGeneration, subscribe, jobFor, type JobEvent } from './generate';
import { vizKey, getViz, vizPng, putDiscovery, getDiscovery, discoveryPhoto, discoveriesForSession, logStage, stageSummary, listViz } from './cache';
import type { Discovery, Figure, ModuleCtxJson, PageUnderstanding } from './types';

const app = new Hono();
app.use('*', cors({ origin: env.corsOrigins === '*' ? '*' : env.corsOrigins.split(',') }));

/** public origin of this server: PUBLIC_URL, else what a reverse proxy says, else the request */
const base = (c: { req: { url: string; header: (k: string) => string | undefined } }) => {
  if (env.publicUrl) return env.publicUrl.replace(/\/$/, '');
  const host = c.req.header('x-forwarded-host')?.split(',')[0].trim() ?? c.req.header('host');
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0].trim() ?? new URL(c.req.url).protocol.replace(':', '');
  return host ? `${proto}://${host}` : new URL(c.req.url).origin;
};

interface StoredDiscovery extends Discovery {
  internal: { page: PageUnderstanding; figure: Figure; corners: Quad };
}
const publicDiscovery = (d: StoredDiscovery | Discovery, origin: string): Discovery => {
  const { internal: _i, ...pub } = d as StoredDiscovery;
  return { ...pub, photoUrl: pub.photoUrl.startsWith('/') ? origin + pub.photoUrl : pub.photoUrl };
};

/** per session: page key → discovery ids already delivered */
const delivered = new Map<string, Map<string, string[]>>();
function deliveredFor(session: string) {
  let m = delivered.get(session);
  if (!m) {
    m = new Map();
    for (const d of discoveriesForSession(session)) m.set(d.pageKey, [...(m.get(d.pageKey) ?? []), d.id]);
    delivered.set(session, m);
  }
  return m;
}

// ---- frames -------------------------------------------------------------------
const FrameReq = z.object({
  photoUrl: z.string().url().max(4096),
  sessionId: z.string().min(1).max(128),
  ts: z.number().optional(),
  reason: z.enum(['scan', 'button', 'voice']).default('scan'),
  debug: z.boolean().optional(),
});

app.post('/v1/frames', async (c) => {
  const parsed = FrameReq.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'bad request', issues: parsed.error.issues }, 400);
  const { photoUrl, sessionId, ts, reason, debug } = parsed.data;
  const timings: Record<string, number> = {};
  const T = performance.now();
  if (ts) timings.upload = Math.max(0, Date.now() - ts);
  let buf: Buffer;
  try {
    buf = await fetchPhoto(photoUrl);
  } catch (e) {
    return c.json({ status: 'error', error: (e as Error).message }, 422);
  }
  timings.download = performance.now() - T;
  const tg = performance.now();
  const stats = await frameStats(buf);
  const force = reason !== 'scan';
  const g = gate(sessionId, stats, force);
  timings.gate = performance.now() - tg;
  logStage(sessionId, 'gate', timings.gate, `${g.action}${'reason' in g ? ' ' + g.reason : ''} sharp=${stats.sharpness.toFixed(0)}`);
  const gateInfo = { sharpness: Math.round(stats.sharpness), hash: stats.hash.toString(16).padStart(16, '0'), decision: g.action, reason: 'reason' in g ? g.reason : null, size: [stats.width, stats.height] };
  if (g.action !== 'analyse') {
    const known = g.action === 'skip' && g.reason === 'unchanged' && g.pageKey ? deliveredFor(sessionId).get(g.pageKey) : undefined;
    return c.json({ status: g.action === 'wait' ? 'waiting' : g.reason, gate: gateInfo, timings, pageKey: 'pageKey' in g ? g.pageKey : null, knownDiscoveries: known ?? [] });
  }

  let u;
  try {
    u = await understandFast(buf);
  } catch (e) {
    logStage(sessionId, 'understand', performance.now() - T, `ERROR ${(e as Error).message}`);
    return c.json({ status: 'error', error: `page understanding failed: ${(e as Error).message}`, gate: gateInfo, timings }, 502);
  }
  timings.understand = u.ms;
  logStage(sessionId, 'understand', u.ms, `${u.meta.model} page=${u.page.fingerprint.pageNumber ?? '?'} figs=${u.page.figures.length} finish=${u.meta.finish} out=${u.meta.outTokens ?? '?'}tok${u.meta.fallback ? ` (fallback: ${u.meta.fallback})` : ''}`);
  markAnalysed(sessionId, stats.hash, u.page.isPage ? u.pageKey : null);
  const dbg = debug ? { page: u.page, raw: u.raw } : {};
  if (!u.page.isPage) return c.json({ status: 'no-page', gate: gateInfo, timings, ...dbg });

  const figs = u.page.figures.filter((f) => f.visualizable >= env.visualizableThreshold).sort((a, b) => b.visualizable - a.visualizable);
  const seen = deliveredFor(sessionId).get(u.pageKey);
  logScores(sessionId, u.page, figs, !!seen?.length);
  if (seen?.length) return c.json({ status: 'already', pageKey: u.pageKey, knownDiscoveries: seen, gate: gateInfo, timings, ...dbg });
  if (!figs.length) return c.json({ status: 'nothing', pageKey: u.pageKey, best: u.page.figures[0] ? { title: u.page.figures[0].title, visualizable: u.page.figures[0].visualizable, why: u.page.figures[0].why } : null, gate: gateInfo, timings, ...dbg });

  // store the page (cropped to its corners) — the only photo data we keep
  const td = performance.now();
  const { photo, corners } = await cropToPage(buf, u.page.pageCorners as Quad);
  const discoveries: StoredDiscovery[] = [];
  for (const fig of figs.slice(0, 3)) {
    const id = 'd_' + createHash('sha1').update(`${sessionId}|${u.pageKey}|${fig.id}`).digest('hex').slice(0, 14);
    const ctx = ctxOf(u.page, fig);
    const d: StoredDiscovery = {
      id, sessionId, pageKey: u.pageKey, figureId: fig.id, title: fig.title, concept: fig.concept, subject: fig.subject,
      summary: fig.why, figureLabel: fig.label || 'Figure', visualizable: fig.visualizable,
      pageNumber: u.page.fingerprint.pageNumber, heading: u.page.fingerprint.heading,
      photoUrl: `/v1/discoveries/${id}/photo.jpg`, pageCorners: corners, figureBox: fig.box,
      thumb: await thumbOf(photo, corners, fig), ctx, ts: Date.now(),
      internal: { page: u.page, figure: fig, corners },
    };
    putDiscovery(d, photo);
    discoveries.push(d);
  }
  deliveredFor(sessionId).set(u.pageKey, discoveries.map((d) => d.id));
  // stage 2 (after the chime): details for figures that aren't cached yet, then generate
  const need = discoveries.filter((d) => !getViz(vizKey(d.pageKey, d.figureId, RUNTIME_VERSION)));
  if (need.length) {
    const jpg = u.jpg;
    const job = (async () => {
      try {
        const det = await understandDetails(jpg, u.page, need.map((d) => d.internal.figure));
        logStage(sessionId, 'details', det.ms, `${det.model} out=${det.outTokens ?? '?'}tok regions=${det.page.regions.length}${det.fallback ? ` (fallback: ${det.fallback})` : ''}`);
        for (const d of need) {
          const fig = det.page.figures.find((f) => f.id === d.figureId) ?? d.internal.figure;
          d.internal = { ...d.internal, page: det.page, figure: fig };
          d.ctx = ctxOf(det.page, fig);
          putDiscovery(d, photo);
        }
      } catch (e) {
        logStage(sessionId, 'details', 0, `ERROR ${(e as Error).message.slice(0, 200)} (generating from the fast pass only)`);
      }
      // start generating right away: by the time the student opens it, it may be ready
      for (const d of need) startGeneration({ sessionId, pageKey: d.pageKey, page: d.internal.page, figure: d.internal.figure, photo, corners, ctx: d.ctx });
    })();
    for (const d of need) pendingDetails.set(d.id, job);
    void job.finally(() => need.forEach((d) => pendingDetails.get(d.id) === job && pendingDetails.delete(d.id)));
  }
  timings.decide = performance.now() - td;
  timings.total = performance.now() - T;
  logStage(sessionId, 'discovery', timings.total, discoveries.map((d) => `${d.figureId} ${(d.visualizable * 100) | 0}%`).join(', '));
  return c.json({ status: 'discovery', pageKey: u.pageKey, discoveries: discoveries.map((d) => publicDiscovery(d, base(c))), gate: gateInfo, timings, ...dbg });
});

/**
 * One line per figure Gemini found: its visualizable score against the
 * threshold, and what the gate did with it.
 *   [ab12cd34] score   95% ≥ 75%  → generate  fig-figure-5-29 "Projectile motion" (projectile-motion) — why
 */
function logScores(sessionId: string, page: PageUnderstanding, passing: Figure[], alreadyDelivered: boolean) {
  const tag = `[${sessionId.slice(0, 8)}] score     `;
  const thr = Math.round(env.visualizableThreshold * 100);
  if (!page.figures.length) {
    console.log(`${tag} no figures on this page`);
    return;
  }
  const chosen = new Set(passing.slice(0, 3).map((f) => f.id));
  for (const f of [...page.figures].sort((a, b) => b.visualizable - a.visualizable)) {
    const pct = Math.round(f.visualizable * 100);
    const pass = f.visualizable >= env.visualizableThreshold;
    const decision = !pass ? 'skip    ' : alreadyDelivered ? 'already ' : chosen.has(f.id) ? 'generate' : 'over max';
    const tpl = f.template && f.template !== 'none' ? ` template=${f.template}` : '';
    console.log(`${tag} ${String(pct).padStart(3)}% ${pass ? '≥' : '<'} ${thr}%  → ${decision}  ${f.id} "${f.title}" (${f.concept}${tpl}) — ${f.why}`.slice(0, 400));
  }
}

/** what the generated module receives as ctx */
function ctxOf(page: PageUnderstanding, fig: Figure): ModuleCtxJson {
  return {
    figure: { rect: fig.box, description: fig.description, concept: fig.concept, subject: fig.subject },
    params: Object.fromEntries(fig.parameters.map((p) => [p.name, { value: p.value, unit: p.unit }])),
    equations: fig.equations,
    page: { number: page.fingerprint.pageNumber, heading: page.fingerprint.heading },
  };
}

/** discovery id → its running stage-2 (details) job; generation waits for it */
const pendingDetails = new Map<string, Promise<void>>();

async function cropToPage(buf: Buffer, q: Quad) {
  const img = sharp(buf, { failOn: 'none' }).rotate();
  const meta = await img.metadata();
  const rot = (meta.orientation ?? 1) >= 5;
  const W = (rot ? meta.height : meta.width) ?? 1, H = (rot ? meta.width : meta.height) ?? 1;
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const m = 0.02;
  const x0 = Math.max(0, Math.min(...xs) - m), y0 = Math.max(0, Math.min(...ys) - m);
  const x1 = Math.min(1, Math.max(...xs) + m), y1 = Math.min(1, Math.max(...ys) + m);
  const left = Math.floor(x0 * W), top = Math.floor(y0 * H);
  const width = Math.max(16, Math.min(W - left, Math.ceil((x1 - x0) * W))), height = Math.max(16, Math.min(H - top, Math.ceil((y1 - y0) * H)));
  const photo = await sharp(await img.toBuffer()).extract({ left, top, width, height }).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
  const corners = q.map(([x, y]) => [((x * W - left) / width), ((y * H - top) / height)]) as Quad;
  return { photo, corners };
}

async function thumbOf(photo: Buffer, corners: Quad, fig: Figure) {
  const meta = await sharp(photo).metadata();
  const W = meta.width ?? 1, H = meta.height ?? 1;
  const b = pageBoxToPhotoBox(corners, fig.box);
  const left = Math.floor(b.x0 * W), top = Math.floor(b.y0 * H);
  const width = Math.max(8, Math.min(W - left, Math.ceil((b.x1 - b.x0) * W))), height = Math.max(8, Math.min(H - top, Math.ceil((b.y1 - b.y0) * H)));
  const jpg = await sharp(photo).extract({ left, top, width, height }).resize(160, 160, { fit: 'cover' }).jpeg({ quality: 72 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

// ---- discoveries ------------------------------------------------------------------
app.get('/v1/discoveries/:id', (c) => {
  const d = getDiscovery(c.req.param('id'));
  return d ? c.json(publicDiscovery(d, base(c))) : c.json({ error: 'not found' }, 404);
});
/** read-only: the cached visualization for a discovery (never starts a generation) */
app.get('/v1/discoveries/:id/visualization', (c) => {
  const d = getDiscovery(c.req.param('id'));
  if (!d) return c.json({ error: 'not found' }, 404);
  const v = getViz(vizKey(d.pageKey, d.figureId, RUNTIME_VERSION));
  return v ? c.json(v) : c.json({ error: 'not generated yet' }, 404);
});
app.get('/v1/discoveries/:id/photo.jpg', (c) => {
  const p = discoveryPhoto(c.req.param('id'));
  return p ? c.body(new Uint8Array(p), 200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' }) : c.json({ error: 'not found' }, 404);
});
app.get('/v1/sessions/:id/discoveries', (c) => c.json(discoveriesForSession(c.req.param('id')).map((d) => publicDiscovery(d, base(c)))));
app.post('/v1/sessions/:id/reset', (c) => {
  resetSession(c.req.param('id'));
  delivered.delete(c.req.param('id'));
  return c.json({ ok: true });
});

// ---- visualizations -----------------------------------------------------------------
const VizReq = z.object({ discoveryId: z.string().max(64), force: z.boolean().optional(), noTemplate: z.boolean().optional() });
app.post('/v1/visualizations', async (c) => {
  const p = VizReq.safeParse(await c.req.json().catch(() => null));
  if (!p.success) return c.json({ error: 'bad request' }, 400);
  // details may still be arriving: wait, then use the updated discovery
  await pendingDetails.get(p.data.discoveryId);
  const d = getDiscovery(p.data.discoveryId) as StoredDiscovery | null;
  const photo = d && discoveryPhoto(d.id);
  if (!d || !photo) return c.json({ error: 'discovery not found' }, 404);
  const { key, cached } = startGeneration({
    sessionId: d.sessionId, pageKey: d.pageKey, page: d.internal.page, figure: d.internal.figure, photo, corners: d.internal.corners, ctx: d.ctx,
    force: p.data.force, noTemplate: p.data.noTemplate,
  });
  if (cached) logStage(d.sessionId, 'cache-hit', 0, `${cached.source} ${d.figureId}`);
  return c.json({ key, status: cached ? 'ready' : 'running', viz: cached ? { ...cached, ctx: cached.ctx ?? d.ctx } : null, events: `/v1/visualizations/events?key=${encodeURIComponent(key)}` });
});

app.get('/v1/visualizations/events', (c) => {
  const key = c.req.query('key') ?? '';
  return streamSSE(c, async (s) => {
    const lean = (v: any) => (v ? { ...v, prompt: v.prompt ? { system: `(${v.prompt.system.length} chars)`, user: v.prompt.user } : null } : v);
    const hit = getViz(key);
    if (hit && !jobFor(key)) {
      await s.writeSSE({ event: 'done', data: JSON.stringify({ type: 'done', viz: lean(hit), t: Date.now() }) });
      return;
    }
    if (!jobFor(key)) {
      await s.writeSSE({ event: 'failed', data: JSON.stringify({ type: 'failed', errors: ['no such job'], viz: null }) });
      return;
    }
    // replay + live events through a queue (subscribe() replays synchronously)
    const queue: JobEvent[] = [];
    let wake: (() => void) | null = null;
    let closed = false;
    const off = subscribe(key, (e) => {
      queue.push(e);
      wake?.();
    });
    s.onAbort(() => {
      closed = true;
      wake?.();
    });
    try {
      for (;;) {
        while (queue.length) {
          const e = queue.shift()!;
          const payload = 'viz' in e ? { ...e, viz: lean(e.viz) } : e;
          await s.writeSSE({ event: e.type, data: JSON.stringify(payload) });
          if (e.type !== 'progress') return;
        }
        if (closed) return;
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 15000); // keep-alive tick
        });
        wake = null;
        if (!queue.length && !closed) await s.writeSSE({ event: 'ping', data: '{}' });
      }
    } catch (err) {
      console.error('SSE error', err);
    } finally {
      off();
    }
  });
});

app.get('/v1/visualizations/:key/screenshot.png', (c) => {
  const png = vizPng(c.req.param('key'));
  return png ? c.body(new Uint8Array(png), 200, { 'content-type': 'image/png' }) : c.json({ error: 'not found' }, 404);
});
app.get('/v1/visualizations/prompt', (c) => {
  const v = getViz(c.req.query('key') ?? '');
  return v?.prompt ? c.json(v.prompt) : c.json({ error: 'no prompt for this visualization' }, 404);
});
app.get('/v1/visualizations', (c) => c.json(listViz(Number(c.req.query('limit') ?? 50)).map(({ prompt: _p, ...r }) => r)));

// ---- dev: uploads stand in for Mentra's signed photo URLs ------------------------------
app.post('/v1/uploads', async (c) => {
  const type = c.req.header('content-type') ?? '';
  if (!/^image\//.test(type)) return c.json({ error: 'send the image bytes with an image/* content-type' }, 415);
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (buf.length > 20 * 1024 * 1024) return c.json({ error: 'too large' }, 413);
  const id = putUpload(buf, type);
  return c.json({ photoUrl: `${base(c)}/v1/uploads/${id}`, mimeType: type, size: buf.length, requestId: id });
});
app.get('/v1/uploads/:id', (c) => {
  const u = getUpload(c.req.param('id'));
  return u ? c.body(new Uint8Array(u.buf), 200, { 'content-type': u.mime }) : c.json({ error: 'expired' }, 404);
});

/** dev/evals: page understanding without gating */
app.post('/v1/understand', async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b?.photoUrl) return c.json({ error: 'photoUrl required' }, 400);
  try {
    const buf = await fetchPhoto(b.photoUrl);
    const u = await understand(buf, { thinking: b.thinking, maxSide: b.maxSide, model: b.model });
    return c.json({ pageKey: u.pageKey, ms: u.ms, page: u.page, raw: u.raw, usage: u.usage });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/** free-form diagnostics from the miniapp background (e.g. camera errors on real glasses) */
const Log = z.object({ sessionId: z.string().max(128), stage: z.string().max(40), ms: z.number().optional(), detail: z.string().max(1000).optional() });
app.post('/v1/log', async (c) => {
  const t = Log.safeParse(await c.req.json().catch(() => null));
  if (!t.success) return c.json({ error: 'bad request' }, 400);
  logStage(t.data.sessionId, t.data.stage, t.data.ms ?? 0, t.data.detail ?? '');
  return c.json({ ok: true });
});

/** the phone reports how each explore went (render time, or why it failed) */
const Telemetry = z.object({ sessionId: z.string().max(128), discoveryId: z.string().max(64), event: z.enum(['rendered', 'failed']), ms: z.number().optional(), source: z.string().max(20).optional(), reason: z.string().max(500).optional(), errors: z.array(z.string().max(1000)).max(20).optional() });
app.post('/v1/telemetry', async (c) => {
  const t = Telemetry.safeParse(await c.req.json().catch(() => null));
  if (!t.success) return c.json({ error: 'bad request' }, 400);
  const d = t.data;
  logStage(d.sessionId, d.event === 'rendered' ? 'render' : 'render-FAIL', d.ms ?? 0, `${d.discoveryId} ${d.source ?? ''} ${d.reason ?? ''} ${(d.errors ?? []).join(' | ')}`.slice(0, 1500));
  return c.json({ ok: true });
});

app.get('/v1/health', (c) => c.json({ ok: true, runtime: RUNTIME_VERSION, visionModel: env.visionModel, codeModel: env.codeModel, gemini: !!env.geminiKey }));
app.get('/v1/stats', (c) => c.json(stageSummary()));

void prepareImage; // re-exported helper used by evals
console.log(`PictureThis server on :${env.port} · runtime ${RUNTIME_VERSION} · vision ${env.visionModel} · code ${env.codeModel}${env.geminiKey ? '' : ' · NO GEMINI KEY'}`);
export default { port: env.port, fetch: app.fetch, idleTimeout: 120 };
