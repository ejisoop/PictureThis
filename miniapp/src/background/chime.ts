// A soft two-note bell, synthesised once and played as a data: URL, so the
// glasses need no audio asset or network for the cue. (Background-safe: only
// typed arrays and btoa.)
let cached: string | null = null;

export function chimeDataUrl(): string {
  if (cached) return cached;
  const rate = 22050, secs = 1.1, n = Math.floor(rate * secs);
  const pcm = new Int16Array(n);
  // E6 then B6, bell-like partials with exponential decay
  const notes = [{ f: 1318.5, t0: 0 }, { f: 1975.5, t0: 0.12 }];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = 0;
    for (const { f, t0 } of notes) {
      const u = t - t0;
      if (u < 0) continue;
      const env = Math.min(1, u / 0.004) * Math.exp(-u * 4.2);
      v += env * (Math.sin(2 * Math.PI * f * u) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * u) * Math.exp(-u * 6));
    }
    pcm[i] = Math.max(-1, Math.min(1, v * 0.28)) * 32767;
  }
  const bytes = new Uint8Array(44 + n * 2);
  const dv = new DataView(bytes.buffer);
  const str = (o: number, s: string) => [...s].forEach((c, k) => dv.setUint8(o + k, c.charCodeAt(0)));
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, n * 2, true);
  new Int16Array(bytes.buffer, 44).set(pcm);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  cached = `data:audio/wav;base64,${btoa(bin)}`;
  return cached;
}
