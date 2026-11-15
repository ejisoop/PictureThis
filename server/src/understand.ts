// Page understanding: Gemini vision calls with structured JSON output.
// understand() = one full call (evals, /v1/understand); the live path uses
// understandFast() before the chime + understandDetails() after a discovery.
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { env } from './env';
import { generateJson } from './gemini';
import { PageUnderstanding, type Box } from './types';
import { squareToQuad, isValidQuad, type Quad, type Mat3 } from '@lp/runtime/host';
import { KNOWN_CONCEPTS } from './examples';

const box2d = { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4, description: '[ymin, xmin, ymax, xmax] in the photo, each 0–1000' };

export const UNDERSTAND_SCHEMA = {
  type: 'object',
  properties: {
    isPage: { type: 'boolean', description: 'true if the photo shows a printed or on-screen textbook/notes page that can be read' },
    pageCorners: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
      description: 'corners of the page being read as [y, x] points in the photo (0–1000), in order top-left, top-right, bottom-right, bottom-left of the page itself (not of the photo). If the page fills the photo, use the photo corners.',
    },
    pageNumber: { type: ['integer', 'null'], description: 'printed page number, or null if none is visible' },
    heading: { type: 'string', description: 'the main section heading visible on the page, verbatim' },
    excerpt: { type: 'string', description: 'the first 8 words of body text on the page' },
    regions: {
      type: 'array',
      maxItems: 12,
      description: 'main layout regions in reading order (at most 12): headings, equations, figures, captions, and paragraphs that sit next to figures',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['text', 'heading', 'equation', 'figure', 'caption', 'table'] },
          box_2d: box2d,
          text: { type: 'string', description: 'at most 12 words: a heading or caption as printed, or a short gist of a paragraph (never transcribe whole paragraphs)' },
          latex: { type: 'string', description: 'LaTeX for equations, else empty' },
        },
        required: ['kind', 'box_2d'],
      },
    },
    figures: {
      type: 'array',
      maxItems: 6,
      description: 'every figure, diagram, graph or plot on the page (at most 6)',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'printed label such as "Figure 5.29", or empty' },
          box_2d: { ...box2d, description: 'tight box around the drawing itself (exclude the caption), [ymin, xmin, ymax, xmax] 0–1000' },
          caption: { type: 'string' },
          description: { type: 'string', description: 'what the drawing shows, precisely: objects, axes, arrows, labels, values' },
          title: { type: 'string', description: 'short student-facing title, e.g. "Projectile motion"' },
          concept: { type: 'string', description: 'specific kebab-case concept slug, e.g. "inclined-plane-forces", "projectile-motion", "law-of-reflection"' },
          template: {
            type: 'string',
            enum: [...KNOWN_CONCEPTS, 'none'],
            description: 'a ready-made model, only if the drawing depicts exactly that system (same objects and setup, e.g. a pendulum hanging from a pivot for simple-pendulum). Otherwise "none".',
          },
          subject: { type: 'string', enum: ['physics', 'calculus', 'mathematics', 'chemistry', 'biology', 'engineering', 'other'] },
          visualizable: {
            type: 'number',
            description:
              '0–1: how feasible a live interactive 3d model from THIS figure (a physical system, field, motion, geometry, data structure or function surface that moves or can be manipulated scores high; photos, tables, flowcharts, decorative art and plain text score low)',
          },
          why: { type: 'string', description: 'one sentence justifying the score' },
          parameters: {
            type: 'array',
            // no maxItems here: Gemini rejects maxItems on arrays nested inside array items (INVALID_ARGUMENT); trimmed in normalise()
            description: 'numeric quantities given in the figure, caption or nearby text, at most 8 (e.g. L = 1.6 m, θ0 = 30°)',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'identifier-like name, e.g. L, theta0, v0, g, m, k, A' },
                symbol: { type: 'string', description: 'as printed, e.g. θ₀' },
                value: { type: 'number' },
                unit: { type: 'string', description: 'unit as printed, e.g. m, deg, m/s, m/s^2' },
              },
              required: ['name', 'value'],
            },
          },
          equations: { type: 'array', items: { type: 'string' }, description: 'at most 6: LaTeX of the equations that govern this figure (from the page)' },
        },
        required: ['box_2d', 'description', 'title', 'concept', 'subject', 'visualizable', 'why'],
      },
    },
  },
  required: ['isPage', 'pageCorners', 'pageNumber', 'heading', 'excerpt', 'regions', 'figures'],
};

const PROMPT = `You are the page-reading stage of "PictureThis", which turns textbook figures into interactive 3D models.
The photo was taken by camera glasses worn by a student reading, or is a screenshot of a page.
Read the page that the student is looking at and return the JSON described by the schema.
- Coordinates: every box is [ymin, xmin, ymax, xmax] and every point is [y, x], normalised to 0–1000 over the whole photo.
- pageCorners: the four corners of the physical page (or the page area of a screenshot). If an edge is cut off by the photo frame, use the frame edge.
- Figures: include every drawing, diagram, graph or plot. The box must be tight around the drawing, excluding its caption.
- Be strict with "visualizable": ≥ 0.60 only if a moving, manipulable 3D model would clearly teach the figure's idea better than the printed drawing.
- Extract numeric parameters with units exactly as printed. Do not invent values.
- Keep text fields short. Summarise body text in a few words; never transcribe paragraphs. Speed matters: the student is waiting.`;

export interface Understood {
  page: PageUnderstanding;
  pageKey: string;
  ms: number;
  raw: unknown;
  imageBytes: number;
}

/** inverse of a 3×3 (row-major) */
function inv3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
const apply = (m: Mat3, x: number, y: number): [number, number] => {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
function fromBox2d(b: number[]): Box {
  const [y0, x0, y1, x1] = b.map((v) => clamp01(v / 1000));
  return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
}
function photoToPageBox(toPage: Mat3, b: Box): Box {
  const pts = [apply(toPage, b.x0, b.y0), apply(toPage, b.x1, b.y0), apply(toPage, b.x1, b.y1), apply(toPage, b.x0, b.y1)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: clamp01(Math.min(...xs)), y0: clamp01(Math.min(...ys)), x1: clamp01(Math.max(...xs)), y1: clamp01(Math.max(...ys)) };
}

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-');

/** Stable key for a page across students and photos. */
export function pageKeyOf(fp: { pageNumber: number | null; heading: string; excerpt: string }) {
  const h = slug(fp.heading).slice(0, 80);
  const basis = fp.pageNumber !== null && h ? `p${fp.pageNumber}|${h}` : `${h}|${slug(fp.excerpt).split('-').slice(0, 10).join('-')}`;
  return 'pg_' + createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

export function figureIdOf(f: { label: string; concept: string }, i: number) {
  const l = slug(f.label);
  return l ? `fig-${l}` : `fig-${slug(f.concept) || 'figure'}-${i + 1}`;
}

export async function prepareImage(buf: Buffer, maxSide = 1600) {
  return sharp(buf, { failOn: 'none' }).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

export interface UnderstandMeta {
  finish: string;
  outTokens: number | null;
  model: string;
  fallback: string | null;
}

export async function understand(buf: Buffer, o: { thinking?: typeof env.visionThinking; maxSide?: number; model?: string } = {}): Promise<Understood & { usage: unknown; meta: UnderstandMeta }> {
  const jpg = await prepareImage(buf, o.maxSide ?? env.visionMaxSide);
  const call = (model: string, thinking: typeof env.visionThinking) =>
    generateJson<any>(
      {
        model,
        parts: [{ inlineData: { mimeType: 'image/jpeg', data: jpg.toString('base64') } }, { text: PROMPT }],
        schema: UNDERSTAND_SCHEMA,
        thinking,
        temperature: 0.2,
        // a normal page is ~600–1200 output tokens; a runaway (repeating regions) is cut off early
        maxOutputTokens: 2048,
        timeoutMs: env.visionTimeoutMs,
      },
      0
    );
  const model = o.model ?? env.visionModel;
  let res;
  const t0 = performance.now();
  try {
    res = await call(model, o.thinking ?? env.visionThinking);
  } catch (e) {
    // Flash-Lite occasionally loops on poor photos: one retry on the fallback model
    const fb = env.visionFallbackModel;
    if (!fb || fb === model) throw e;
    console.warn(`understand: ${model} failed (${(e as Error).message.slice(0, 120)}); retrying on ${fb}`);
    res = await call(fb, fb.includes('lite') ? env.visionThinking : 'LOW');
    (res as any).fallback = `${model} failed: ${(e as Error).message.slice(0, 80)}`;
  }
  const { data, usage } = res;
  const ms = performance.now() - t0; // includes a failed first attempt
  const u = usage as { candidatesTokenCount?: number } | undefined;
  (data as any).__meta = { finish: res.finish, outTokens: u?.candidatesTokenCount ?? null, model: (res as any).fallback ? env.visionFallbackModel : model, fallback: (res as any).fallback ?? null };
  const meta = (data as any).__meta;
  delete (data as any).__meta;
  return { ...normalise(data), ms, raw: data, imageBytes: jpg.length, usage, meta };
}

/** Raw Gemini JSON → PageUnderstanding in our coordinate conventions. */
export function normalise(d: any): { page: PageUnderstanding; pageKey: string } {
  let corners = (Array.isArray(d.pageCorners) ? d.pageCorners : []).map((p: number[]) => [clamp01((p?.[1] ?? 0) / 1000), clamp01((p?.[0] ?? 0) / 1000)]) as Quad;
  if (!isValidQuad(corners)) corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const toPage = inv3(squareToQuad(corners));
  const regions = (d.regions ?? []).slice(0, 40).flatMap((r: any) => {
    if (!Array.isArray(r?.box_2d) || r.box_2d.length !== 4) return [];
    return [{ kind: r.kind, box: photoToPageBox(toPage, fromBox2d(r.box_2d)), text: String(r.text ?? ''), latex: String(r.latex ?? '') }];
  });
  const figures = (d.figures ?? []).slice(0, 12).flatMap((f: any, i: number) => {
    if (!Array.isArray(f?.box_2d) || f.box_2d.length !== 4) return [];
    const photoBox = fromBox2d(f.box_2d);
    return [{
      id: figureIdOf({ label: String(f.label ?? ''), concept: String(f.concept ?? '') }, i),
      label: String(f.label ?? ''),
      box: photoToPageBox(toPage, photoBox),
      photoBox,
      caption: String(f.caption ?? ''),
      description: String(f.description || f.title || ''),
      title: String(f.title ?? 'Figure'),
      concept: slug(String(f.concept ?? 'figure')),
      template: KNOWN_CONCEPTS.includes(String(f.template)) ? String(f.template) : 'none',
      subject: String(f.subject ?? 'other'),
      visualizable: clamp01(Number(f.visualizable) || 0),
      why: String(f.why ?? ''),
      parameters: (f.parameters ?? []).slice(0, 8).filter((p: any) => p && typeof p.name === 'string' && Number.isFinite(p.value)).map((p: any) => ({ name: p.name, symbol: String(p.symbol ?? ''), value: p.value, unit: String(p.unit ?? '') })),
      equations: (f.equations ?? []).filter((e: unknown) => typeof e === 'string').slice(0, 8),
    }];
  });
  // de-duplicate ids
  const seen = new Map<string, number>();
  for (const f of figures) {
    const n = seen.get(f.id) ?? 0;
    seen.set(f.id, n + 1);
    if (n) f.id = `${f.id}-${n + 1}`;
  }
  const fingerprint = { pageNumber: Number.isInteger(d.pageNumber) ? d.pageNumber : null, heading: String(d.heading ?? ''), excerpt: String(d.excerpt ?? '') };
  const page = PageUnderstanding.parse({ isPage: !!d.isPage, pageCorners: corners, fingerprint, regions, figures });
  return { page, pageKey: pageKeyOf(fingerprint) };
}

// ---- two-stage understanding -------------------------------------------------
// Output tokens dominate latency (~100–400 tok/s depending on load). The chime
// only needs: is this a page, where is it, which figures are worth animating.
// Everything else (regions, descriptions, parameters, equations) is fetched
// afterwards, only for pages with a discovery, while the phone is opening.

const FIG = UNDERSTAND_SCHEMA.properties.figures.items.properties as Record<string, any>;
export const FAST_SCHEMA = {
  type: 'object',
  properties: {
    isPage: UNDERSTAND_SCHEMA.properties.isPage,
    pageCorners: UNDERSTAND_SCHEMA.properties.pageCorners,
    pageNumber: UNDERSTAND_SCHEMA.properties.pageNumber,
    heading: { type: 'string', description: 'the main section heading on the page, verbatim (at most 10 words)' },
    excerpt: { type: 'string', description: 'the first 6 words of body text' },
    figures: {
      type: 'array',
      maxItems: 6,
      description: 'every figure, diagram, graph or plot on the page (at most 6)',
      items: {
        type: 'object',
        properties: {
          label: FIG.label,
          box_2d: FIG.box_2d,
          title: { type: 'string', description: 'short student-facing title (at most 6 words)' },
          concept: FIG.concept,
          template: FIG.template,
          subject: FIG.subject,
          visualizable: FIG.visualizable,
          why: { type: 'string', description: 'at most 15 words justifying the score' },
        },
        required: ['box_2d', 'title', 'concept', 'subject', 'visualizable', 'why'],
      },
    },
  },
  required: ['isPage', 'pageCorners', 'pageNumber', 'heading', 'excerpt', 'figures'],
};

const FAST_PROMPT = `You are the first, fast pass of "PictureThis", which turns textbook figures into interactive 3D models. Speed matters: a student is waiting.
Find the page the student is reading and its figures, and score each figure. Return only the JSON in the schema, with short text fields.
- Coordinates: boxes are [ymin, xmin, ymax, xmax], points are [y, x], normalised 0–1000 over the whole photo.
- pageCorners: the corners of the page itself (use the photo edge where the page is cut off).
- Figure boxes: tight around the drawing, excluding the caption.
- "visualizable" ≥ 0.75 only if a moving, manipulable 3D model would clearly teach the figure's idea better than the printed drawing.`;

export const DETAILS_SCHEMA = {
  type: 'object',
  properties: {
    regions: UNDERSTAND_SCHEMA.properties.regions,
    figures: {
      type: 'array',
      maxItems: 6,
      description: 'one entry per listed figure, in the same order',
      items: {
        type: 'object',
        properties: {
          description: FIG.description,
          caption: FIG.caption,
          parameters: FIG.parameters,
          equations: FIG.equations,
        },
        required: ['description'],
      },
    },
  },
  required: ['regions', 'figures'],
};

async function visionCall(jpg: Buffer, prompt: string, schema: unknown, maxOutputTokens: number) {
  const call = (model: string) =>
    generateJson<any>(
      {
        model,
        parts: [{ inlineData: { mimeType: 'image/jpeg', data: jpg.toString('base64') } }, { text: prompt }],
        schema,
        thinking: env.visionThinking,
        temperature: 0.2,
        maxOutputTokens,
        timeoutMs: env.visionTimeoutMs,
      },
      0
    );
  const t0 = performance.now();
  const model = env.visionModel;
  try {
    const r = await call(model);
    return { ...r, ms: performance.now() - t0, model, fallback: null as string | null };
  } catch (e) {
    const fb = env.visionFallbackModel;
    if (!fb || fb === model) throw e;
    console.warn(`vision: ${model} failed (${(e as Error).message.slice(0, 120)}); retrying on ${fb}`);
    const r = await call(fb);
    return { ...r, ms: performance.now() - t0, model: fb, fallback: `${model}: ${(e as Error).message.slice(0, 80)}` };
  }
}

/** Stage 1, before the chime: page + scored figures only. */
export async function understandFast(buf: Buffer) {
  const jpg = await prepareImage(buf, env.visionMaxSide);
  const r = await visionCall(jpg, FAST_PROMPT, FAST_SCHEMA, 1024);
  const n = normalise({ ...r.data, regions: [] });
  const u = r.usage as { candidatesTokenCount?: number } | undefined;
  return { ...n, jpg, ms: r.ms, raw: r.data, meta: { finish: r.finish, outTokens: u?.candidatesTokenCount ?? null, model: r.model, fallback: r.fallback } as UnderstandMeta };
}

/** Stage 2, after a discovery: regions + details for the chosen figures, merged into the page. */
export async function understandDetails(jpg: Buffer, page: PageUnderstanding, figs: { id: string; label: string; photoBox: Box }[]) {
  const list = figs.map((f, i) => `${i + 1}. ${f.label || 'figure'} at [${[f.photoBox.y0, f.photoBox.x0, f.photoBox.y1, f.photoBox.x1].map((v) => Math.round(v * 1000)).join(', ')}]`).join('\n');
  const prompt = `${PROMPT}

This is a second pass: the page and figures are already found. Return the layout regions, and for each of these figures (boxes are [ymin, xmin, ymax, xmax] 0–1000), in this order:
${list}
give a precise description of the drawing, its caption, the numeric parameters with units, and the governing equations from the page.`;
  const r = await visionCall(jpg, prompt, DETAILS_SCHEMA, 3072);
  const d = r.data ?? {};
  const toPage = inv3(squareToQuad(page.pageCorners as Quad));
  const regions = (d.regions ?? []).slice(0, 40).flatMap((x: any) =>
    Array.isArray(x?.box_2d) && x.box_2d.length === 4 ? [{ kind: x.kind, box: photoToPageBox(toPage, fromBox2d(x.box_2d)), text: String(x.text ?? ''), latex: String(x.latex ?? '') }] : []
  );
  const merged = PageUnderstanding.parse({
    ...page,
    regions,
    figures: page.figures.map((f) => {
      const i = figs.findIndex((x) => x.id === f.id);
      const det = i >= 0 ? d.figures?.[i] : null;
      if (!det) return f;
      return {
        ...f,
        description: String(det.description ?? f.description),
        caption: String(det.caption ?? ''),
        parameters: (det.parameters ?? []).slice(0, 8).filter((p: any) => p && typeof p.name === 'string' && Number.isFinite(p.value)).map((p: any) => ({ name: p.name, symbol: String(p.symbol ?? ''), value: p.value, unit: String(p.unit ?? '') })),
        equations: (det.equations ?? []).filter((e: unknown) => typeof e === 'string').slice(0, 6),
      };
    }),
  });
  const u = r.usage as { candidatesTokenCount?: number } | undefined;
  return { page: merged, ms: r.ms, model: r.model, outTokens: u?.candidatesTokenCount ?? null, fallback: r.fallback };
}
