// Spike / eval: page understanding on every photo in evals/pages.
// bun evals/scripts/understand.ts [server=http://localhost:8787]
// Writes evals/results/understand-<ts>.json and an overlay PNG per page.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import sharp from 'sharp';

const server = process.argv[2] ?? 'http://localhost:8787';
const dir = join(import.meta.dir, '..', 'pages');
const out = join(import.meta.dir, '..', 'results', `understand-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(out, { recursive: true });
const files = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
const rows: any[] = [];

async function one(f: string) {
  const buf = readFileSync(join(dir, f));
  const type = extname(f) === '.png' ? 'image/png' : 'image/jpeg';
  const up = await (await fetch(`${server}/v1/uploads`, { method: 'POST', headers: { 'content-type': type }, body: buf })).json();
  const t0 = performance.now();
  const res = await fetch(`${server}/v1/understand`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ photoUrl: up.photoUrl }) });
  const wall = performance.now() - t0;
  const j = await res.json();
  if (!res.ok) {
    rows.push({ file: f, error: j.error ?? res.status, wall });
    return;
  }
  const p = j.page;
  rows.push({
    file: f, wall: Math.round(wall), gemini: Math.round(j.ms), pageKey: j.pageKey, isPage: p.isPage,
    pageNumber: p.fingerprint.pageNumber, heading: p.fingerprint.heading, regions: p.regions.length,
    figures: p.figures.map((x: any) => ({ id: x.id, title: x.title, concept: x.concept, visualizable: x.visualizable, why: x.why, params: x.parameters, box: x.box })),
  });
  // overlay: page quad (blue), regions (grey), figures (coral)
  const meta = await sharp(buf).metadata();
  const W = meta.width!, H = meta.height!;
  const q = p.pageCorners.map(([x, y]: number[]) => `${x * W},${y * H}`).join(' ');
  const rect = (b: any, col: string, w: number) => `<rect x="${b.x0 * W}" y="${b.y0 * H}" width="${(b.x1 - b.x0) * W}" height="${(b.y1 - b.y0) * H}" fill="none" stroke="${col}" stroke-width="${w}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><polygon points="${q}" fill="none" stroke="#6b8fb3" stroke-width="6"/>
    ${p.regions.map((r: any) => rect(r.box, r.kind === 'equation' ? '#8f7db5' : '#999', 2)).join('')}
    ${p.figures.map((x: any) => rect(x.photoBox, x.visualizable >= 0.75 ? '#c96a5a' : '#f1d68c', 6) + `<text x="${x.photoBox.x0 * W + 8}" y="${x.photoBox.y0 * H + 40}" font-size="34" fill="#c96a5a" font-family="sans-serif">${(x.visualizable * 100) | 0}% ${x.concept}</text>`).join('')}</svg>`;
  const ov = await sharp(Buffer.from(svg)).resize(W, H, { fit: 'fill' }).png().toBuffer();
  const merged = await sharp(buf).composite([{ input: ov }]).png().toBuffer();
  await sharp(merged).resize({ width: 900 }).png().toFile(join(out, basename(f, extname(f)) + '.overlay.png'));
}

const queue = [...files];
await Promise.all([0, 1, 2].map(async () => { while (queue.length) { const f = queue.shift()!; await one(f).catch((e) => rows.push({ file: f, error: String(e?.message ?? e) })); } }));
rows.sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(join(out, 'results.json'), JSON.stringify(rows, null, 2));
const ok = rows.filter((r) => !r.error);
const lat = ok.map((r) => r.gemini).sort((a, b) => a - b);
console.log(`${ok.length}/${rows.length} ok · gemini latency p50 ${lat[Math.floor(lat.length / 2)]} ms, max ${lat[lat.length - 1]} ms`);
for (const r of rows) console.log(r.error ? `${r.file}: ERROR ${r.error}` : `${r.file}: ${r.gemini}ms p${r.pageNumber ?? '?'} "${r.heading.slice(0, 40)}" → ${r.figures.map((f: any) => `${f.concept}@${(f.visualizable * 100) | 0}%`).join(', ') || 'no figures'}`);
console.log('out:', out);
