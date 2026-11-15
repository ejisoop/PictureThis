// Server-side data shapes, validated with zod. The Gemini response schema in
// understand.ts mirrors PageUnderstanding.
import { z } from 'zod';

const n01 = z.number().min(-0.25).max(1.25);
export const Box = z.object({ x0: n01, y0: n01, x1: n01, y1: n01 });
export type Box = z.infer<typeof Box>;
export const Pt = z.tuple([z.number(), z.number()]);
export const Quad = z.tuple([Pt, Pt, Pt, Pt]);

export const RegionKind = z.enum(['text', 'heading', 'equation', 'figure', 'caption', 'table']);
export const Region = z.object({
  kind: RegionKind,
  box: Box, // normalised page coordinates
  text: z.string().default(''),
  latex: z.string().default(''),
});

export const Param = z.object({ name: z.string(), symbol: z.string().default(''), value: z.number(), unit: z.string().default('') });

export const Figure = z.object({
  id: z.string(),
  label: z.string().default(''),
  box: Box, // normalised page coordinates
  photoBox: Box, // normalised photo coordinates
  caption: z.string().default(''),
  description: z.string(),
  title: z.string(),
  concept: z.string(),
  /** a reference example that depicts exactly this system, or 'none' */
  template: z.string().default('none'),
  subject: z.string(),
  visualizable: z.number().min(0).max(1),
  why: z.string().default(''),
  parameters: z.array(Param).default([]),
  equations: z.array(z.string()).default([]),
});
export type Figure = z.infer<typeof Figure>;

export const PageUnderstanding = z.object({
  isPage: z.boolean(),
  pageCorners: Quad, // normalised photo coordinates tl,tr,br,bl
  fingerprint: z.object({ pageNumber: z.number().int().nullable(), heading: z.string(), excerpt: z.string() }),
  regions: z.array(Region),
  figures: z.array(Figure),
});
export type PageUnderstanding = z.infer<typeof PageUnderstanding>;

/** What the background receives and forwards to the UI. */
export interface Discovery {
  id: string;
  sessionId: string;
  pageKey: string;
  figureId: string;
  title: string;
  concept: string;
  subject: string;
  summary: string;
  figureLabel: string;
  visualizable: number;
  pageNumber: number | null;
  heading: string;
  /** stored page photo (cropped to the page), served by this server */
  photoUrl: string;
  /** page corners within that stored photo */
  pageCorners: [number, number][];
  /** figure box in normalised page coordinates */
  figureBox: Box;
  /** small JPEG of the figure (data URL) for the discoveries list */
  thumb: string;
  ctx: ModuleCtxJson;
  ts: number;
}

export interface ModuleCtxJson {
  figure: { rect: Box; description: string; concept?: string; subject?: string };
  params: Record<string, { value: number; unit?: string }>;
  equations: string[];
  page: { number: number | null; heading: string };
}

export type VizSource = 'cache' | 'template' | 'generated';

export interface VizRecord {
  key: string;
  pageKey: string;
  figureId: string;
  runtimeVersion: string;
  source: VizSource;
  code: string;
  title: string;
  summary: string;
  controls: string[];
  model: string;
  attempts: number;
  validation: { ok: boolean; errors: string[]; report: unknown };
  screenshot: string | null; // URL path
  prompt: { system: string; user: string } | null;
  timings: Record<string, number>;
  createdAt: number;
  /** the ctx the module was generated and validated with (page parameters etc.) */
  ctx?: ModuleCtxJson;
}
