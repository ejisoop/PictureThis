// Server configuration. The Gemini key lives only here (server/.env).
import { join } from 'node:path';

const num = (v: string | undefined, d: number) => (v && Number.isFinite(+v) ? +v : d);
const bool = (v: string | undefined, d: boolean) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));
type Level = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
const level = (v: string | undefined, d: Level): Level => (['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'].includes((v ?? '').toUpperCase()) ? ((v as string).toUpperCase() as Level) : d);

export const env = {
  port: num(process.env.PORT, 8787),
  /** public base URL the phone/harness uses to reach this server (for photo/screenshot links) */
  publicUrl: process.env.PUBLIC_URL ?? '',
  geminiKey: process.env.GEMINI_API_KEY ?? '',
  visionModel: process.env.GEMINI_VISION_MODEL || 'gemini-3.5-flash-lite',
  codeModel: process.env.GEMINI_CODE_MODEL || 'gemini-3.8-flash',
  /** retry page understanding on this model if the vision model fails or runs away */
  visionFallbackModel: process.env.GEMINI_VISION_FALLBACK_MODEL ?? 'gemini-3.8-flash',
  visionTimeoutMs: num(process.env.GEMINI_VISION_TIMEOUT_MS, 15000),
  visionMaxSide: num(process.env.GEMINI_VISION_MAX_SIDE, 1600),
  visionThinking: level(process.env.GEMINI_VISION_THINKING, 'LOW'),
  codeThinking: level(process.env.GEMINI_CODE_THINKING, 'LOW'),
  dataDir: process.env.DATA_DIR ?? join(import.meta.dir, '..', 'data'),
  /** Laplacian-variance threshold below which a frame counts as blurry (on a 512 px greyscale) */
  blurThreshold: num(process.env.BLUR_THRESHOLD, 60),
  /** dHash hamming distance under which two frames show the same page */
  sameFrameBits: num(process.env.SAME_FRAME_BITS, 10),
  stableFrames: num(process.env.STABLE_FRAMES, 2),
  /** if frames are further apart than this, one sharp frame counts as settled (ms) */
  settleMaxGapMs: num(process.env.SETTLE_MAX_GAP_MS, 4500),
  /** longest image side for the fast first pass (before the chime) */
  visionFastMaxSide: num(process.env.GEMINI_VISION_FAST_MAX_SIDE, 1024),
  /** model for repair attempts after a failed validation (default: the code model) */
  repairModel: process.env.GEMINI_REPAIR_MODEL || '',
  repairThinking: level(process.env.GEMINI_REPAIR_THINKING, 'MEDIUM'),
  visualizableThreshold: num(process.env.VISUALIZABLE_THRESHOLD, 0.6),
  maxRepairs: num(process.env.MAX_REPAIRS, 2),
  /** serve a matching example module for well-known concepts instead of generating */
  templateMatch: bool(process.env.TEMPLATE_MATCH, true),
  /** allow plain-http photo URLs (dev only) */
  allowHttpPhotos: bool(process.env.ALLOW_HTTP_PHOTOS, true),
  /** comma-separated CORS origins; '*' in dev */
  corsOrigins: process.env.CORS_ORIGINS ?? '*',
};
