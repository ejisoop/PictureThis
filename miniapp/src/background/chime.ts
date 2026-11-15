// Bell cues, synthesised once and played as data: URLs, so the glasses need no
// audio asset or network for them. (Background-safe: only typed arrays and btoa.)
const cache = new Map<string, string>();

/** discovery: a soft two-note bell, E6 then B6 */
export function chimeDataUrl(): string {
  return bell('chime', 1.1, 4.2, 0.28, [{ f: 1318.5, t0: 0 }, { f: 1975.5, t0: 0.12 }]);
}

/** button press acknowledged: one short, bright ding (A6), distinct from the discovery chime */
export function dingDataUrl(): string {
  return bell('ding', 0.45, 9, 0.3, [{ f: 1760, t0: 0 }]);
}

function bell(key: string, secs: number, decay: number, gain: number, notes: { f: number; t0: number }[]): string {
  const hit = cache.get(key);
  if (hit) return hit;
  const rate = 22050, n = Math.floor(rate * secs);
  const pcm = new Int16Array(n);
  // bell-like partials with exponential decay
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = 0;
    for (const { f, t0 } of notes) {
      const u = t - t0;
      if (u < 0) continue;
      const env = Math.min(1, u / 0.004) * Math.exp(-u * decay);
      v += env * (Math.sin(2 * Math.PI * f * u) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * u) * Math.exp(-u * 6));
    }
    pcm[i] = Math.max(-1, Math.min(1, v * gain)) * 32767;
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
  const url = `data:audio/wav;base64,${btoa(bin)}`;
  cache.set(key, url);
  return url;
}
