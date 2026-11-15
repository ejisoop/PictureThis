// Photo intake. The glasses upload to Mentra and hand us a signed URL; the
// dev harness uploads here instead and gets an equivalent short-lived URL.
// Frames are kept in memory only, and only until they expire.
import { env } from './env';

const TTL = 30 * 60 * 1000;
const MAX_BYTES = 20 * 1024 * 1024;
const uploads = new Map<string, { buf: Buffer; mime: string; exp: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of uploads) if (v.exp < now) uploads.delete(k);
}, 60_000).unref?.();

export function putUpload(buf: Buffer, mime: string) {
  const id = crypto.randomUUID();
  uploads.set(id, { buf, mime, exp: Date.now() + TTL });
  return id;
}

export function getUpload(id: string) {
  const u = uploads.get(id);
  return u && u.exp > Date.now() ? u : null;
}

/** Downloads a frame. Only http(s); local uploads short-circuit. */
export async function fetchPhoto(url: string): Promise<Buffer> {
  const m = /\/v1\/uploads\/([0-9a-f-]{36})(?:$|\?)/.exec(url);
  if (m) {
    const u = getUpload(m[1]);
    if (!u) throw new Error('upload expired');
    return u.buf;
  }
  const u = new URL(url);
  if (u.protocol !== 'https:' && !(env.allowHttpPhotos && u.protocol === 'http:')) throw new Error('photoUrl must be https');
  const res = await fetch(u, { signal: AbortSignal.timeout(12_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`photo download failed: HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error('photo too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('photo too large');
  return buf;
}
