// Frame gating, done here because the miniapp background can't decode images:
// reject blurry frames, and only spend a Gemini call when the page has changed
// and then held still for N consecutive frames.
import sharp from 'sharp';
import { env } from './env';

export interface FrameStats {
  sharpness: number;
  hash: bigint;
  width: number;
  height: number;
}

export async function frameStats(buf: Buffer): Promise<FrameStats> {
  const img = sharp(buf, { failOn: 'none' }).rotate();
  const meta = await img.metadata();
  const g = await img.clone().greyscale().resize(512, 512, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const { data, info } = g;
  const w = info.width, h = info.height;
  // variance of the 4-neighbour Laplacian
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = data[i - 1] + data[i + 1] + data[i - w] + data[i + w] - 4 * data[i];
      sum += l;
      sum2 += l * l;
      n++;
    }
  }
  const mean = sum / n;
  const sharpness = sum2 / n - mean * mean;
  // 64-bit difference hash (9×8)
  const d = await img.clone().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let hash = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash = (hash << 1n) | (d[y * 9 + x] < d[y * 9 + x + 1] ? 1n : 0n);
  const rot = (meta.orientation ?? 1) >= 5;
  return { sharpness, hash, width: (rot ? meta.height : meta.width) ?? 0, height: (rot ? meta.width : meta.height) ?? 0 };
}

export function hamming(a: bigint, b: bigint) {
  let x = a ^ b, c = 0;
  while (x) {
    c += Number(x & 1n);
    x >>= 1n;
  }
  return c;
}

interface SessionGate {
  prevHash: bigint | null;
  stable: number;
  analysedHash: bigint | null;
  analysedPageKey: string | null;
  lastSeen: number;
}
const sessions = new Map<string, SessionGate>();
setInterval(() => {
  const old = Date.now() - 6 * 3600_000;
  for (const [k, s] of sessions) if (s.lastSeen < old) sessions.delete(k);
}, 600_000).unref?.();

export type GateDecision =
  | { action: 'skip'; reason: 'blurry'; stats: FrameStats }
  | { action: 'skip'; reason: 'unchanged'; stats: FrameStats; pageKey: string | null }
  | { action: 'wait'; reason: 'settling'; stats: FrameStats; stable: number }
  | { action: 'analyse'; stats: FrameStats };

/** `force` (button press / "look now") skips the stability wait and the unchanged check. */
export function gate(sessionId: string, stats: FrameStats, force: boolean): GateDecision {
  const s = sessions.get(sessionId) ?? { prevHash: null, stable: 0, analysedHash: null, analysedPageKey: null, lastSeen: 0 };
  sessions.set(sessionId, s);
  const gapMs = s.lastSeen ? Date.now() - s.lastSeen : Infinity;
  s.lastSeen = Date.now();
  if (stats.sharpness < env.blurThreshold && !force) return { action: 'skip', reason: 'blurry', stats };
  const same = (a: bigint | null) => a !== null && hamming(a, stats.hash) <= env.sameFrameBits;
  s.stable = same(s.prevHash) ? s.stable + 1 : 1;
  s.prevHash = stats.hash;
  if (force) return { action: 'analyse', stats };
  if (same(s.analysedHash)) return { action: 'skip', reason: 'unchanged', stats, pageKey: s.analysedPageKey };
  // "Settling" waits for N similar frames in a row so we don't analyse a page mid-turn.
  // When frames arrive slowly (BLE / slow uploads: ~10 s apart), waiting for a second
  // one doubles the time to chime, and a sharp frame is already a steady one.
  const slowLink = gapMs > env.settleMaxGapMs;
  if (s.stable < env.stableFrames && !slowLink) return { action: 'wait', reason: 'settling', stats, stable: s.stable };
  return { action: 'analyse', stats };
}

export function markAnalysed(sessionId: string, hash: bigint, pageKey: string | null) {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.analysedHash = hash;
  s.analysedPageKey = pageKey;
}

export function resetSession(sessionId: string) {
  sessions.delete(sessionId);
}
