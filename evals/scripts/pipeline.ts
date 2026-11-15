// End-to-end eval: every page in evals/pages goes through POST /v1/frames
// (forced "look now", like a button press), then each discovery's generation
// is followed over SSE. Scores against evals/expected.json when present.
//
//   bun evals/scripts/pipeline.ts [--server http://localhost:8787] [--only substr] [--concurrency 3] [--regenerate]
//
// Writes evals/results/pipeline-<ts>/{results.json, report.md, <page>.png}.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const server = arg('server', 'http://localhost:8787')!;
const only = arg('only');
const conc = Number(arg('concurrency', '3'));
const regenerate = process.argv.includes('--regenerate');
const root = join(import.meta.dir, '..');
const out = join(root, 'results', `pipeline-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(out, { recursive: true });
const expected: Record<string, { visualizable: boolean; concept?: string }> = existsSync(join(root, 'expected.json')) ? JSON.parse(readFileSync(join(root, 'expected.json'), 'utf8')) : {};
const files = readdirSync(join(root, 'pages')).filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && (!only || f.includes(only))).sort();

interface Row {
  file: string;
  status: string;
  timeToDecision: number;
  understand?: number;
  discoveries: { id: string; title: string; concept: string; visualizable: number; gen?: { ok: boolean; source: string; ms: number; attempts: number; errors: string[]; firstEventMs: number; screenshot: string | null } }[];
  best?: unknown;
  error?: string;
}
const rows: Row[] = [];

async function follow(key: string, t0: number) {
  const res = await fetch(`${server}/v1/visualizations/events?key=${encodeURIComponent(key)}`);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '', first = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk.split('\n').find((l) => l.startsWith('data:'))?.slice(5).trim();
      if (!data) continue;
      const e = JSON.parse(data);
      first ||= performance.now() - t0;
      if (e.type === 'done' || e.type === 'failed') {
        reader.cancel();
        return { e, first };
      }
    }
  }
  return { e: { type: 'failed', errors: ['stream ended'] }, first };
}

async function one(file: string) {
  const sessionId = `eval-${basename(file)}-${Date.now()}`;
  const buf = readFileSync(join(root, 'pages', file));
  const type = extname(file) === '.png' ? 'image/png' : 'image/jpeg';
  const up = await (await fetch(`${server}/v1/uploads`, { method: 'POST', headers: { 'content-type': type }, body: buf })).json();
  const t0 = performance.now();
  const fr = await fetch(`${server}/v1/frames`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ photoUrl: up.photoUrl, sessionId, ts: Date.now(), reason: 'button' }) });
  const j = await fr.json();
  const row: Row = { file, status: j.status, timeToDecision: Math.round(performance.now() - t0), understand: Math.round(j.timings?.understand ?? 0), discoveries: [], best: j.best, error: j.error };
  rows.push(row);
  for (const d of j.discoveries ?? []) {
    const g0 = performance.now();
    const v = await (await fetch(`${server}/v1/visualizations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ discoveryId: d.id, force: regenerate, noTemplate: true }) })).json();
    let rec: any = v.viz, errors: string[] = [], ok = !!v.viz, first = 0;
    if (!rec) {
      const r = await follow(v.key, g0);
      first = r.first;
      rec = r.e.viz;
      ok = r.e.type === 'done';
      errors = r.e.errors ?? rec?.validation?.errors ?? [];
    }
    let shot: string | null = null;
    if (rec?.screenshot) {
      const png = await fetch(server + rec.screenshot);
      if (png.ok) {
        shot = join(out, `${basename(file, extname(file))}-${d.figureId}.png`);
        writeFileSync(shot, Buffer.from(await png.arrayBuffer()));
      }
    }
    if (rec?.code) writeFileSync(join(out, `${basename(file, extname(file))}-${d.figureId}.js`), rec.code);
    row.discoveries.push({ id: d.id, title: d.title, concept: d.concept, visualizable: d.visualizable, gen: { ok, source: rec?.source ?? '-', ms: Math.round(performance.now() - g0), attempts: rec?.attempts ?? 0, errors, firstEventMs: Math.round(first), screenshot: shot } });
  }
  console.log(`${file}: ${row.status} in ${row.timeToDecision} ms${row.discoveries.map((d) => ` · ${d.concept} ${(d.visualizable * 100) | 0}% → ${d.gen?.ok ? 'ok' : 'FAILED'} ${((d.gen?.ms ?? 0) / 1000).toFixed(1)} s, ${d.gen?.attempts} attempt(s)`).join('')}`);
}

const q = [...files];
await Promise.all(Array.from({ length: conc }, async () => {
  while (q.length) {
    const f = q.shift()!;
    await one(f).catch((e) => rows.push({ file: f, status: 'error', timeToDecision: 0, discoveries: [], error: String(e?.message ?? e) }));
  }
}));
rows.sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(join(out, 'results.json'), JSON.stringify(rows, null, 2));

// ---- summary ------------------------------------------------------------------
const pct = (a: number[], p: number) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN);
const decided = rows.filter((r) => r.status !== 'error');
const dec = decided.map((r) => r.timeToDecision);
const gens = rows.flatMap((r) => r.discoveries.map((d) => d.gen!)).filter(Boolean);
const okGens = gens.filter((g) => g.ok);
let tp = 0, fp = 0, fn = 0, tn = 0, scored = 0;
for (const r of decided) {
  const e = expected[r.file];
  if (!e) continue;
  scored++;
  const found = r.status === 'discovery';
  if (found && e.visualizable) tp++;
  else if (found) fp++;
  else if (e.visualizable) fn++;
  else tn++;
}
const lines = [
  `# Pipeline eval — ${new Date().toISOString()}`,
  '',
  `Pages: ${rows.length} (${rows.filter((r) => r.status === 'error').length} errors) · discoveries: ${gens.length}`,
  `Time to decision (photo → chime/no chime): p50 ${pct(dec, 0.5)} ms, p90 ${pct(dec, 0.9)} ms`,
  `Generation: ${okGens.length}/${gens.length} validated (${gens.length ? ((okGens.length / gens.length) * 100).toFixed(0) : 0}%), first-try pass ${gens.filter((g) => g.ok && g.attempts === 1).length}/${gens.length}; time p50 ${(pct(okGens.map((g) => g.ms), 0.5) / 1000).toFixed(1)} s, p90 ${(pct(okGens.map((g) => g.ms), 0.9) / 1000).toFixed(1)} s`,
  scored ? `Detection vs expected.json (${scored} pages): precision ${(tp / Math.max(1, tp + fp)).toFixed(2)}, recall ${(tp / Math.max(1, tp + fn)).toFixed(2)} (tp ${tp}, fp ${fp}, fn ${fn}, tn ${tn})` : 'Detection: no evals/expected.json labels yet',
  '',
  '| page | status | decision ms | figure | vis | gen | s | attempts | errors |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.flatMap((r) =>
    r.discoveries.length
      ? r.discoveries.map((d) => `| ${r.file} | ${r.status} | ${r.timeToDecision} | ${d.concept} | ${(d.visualizable * 100) | 0}% | ${d.gen?.ok ? 'ok' : 'FAIL'} (${d.gen?.source}) | ${((d.gen?.ms ?? 0) / 1000).toFixed(1)} | ${d.gen?.attempts} | ${(d.gen?.errors ?? []).join('; ').slice(0, 120)} |`)
      : [`| ${r.file} | ${r.status} | ${r.timeToDecision} | ${(r.best as any)?.title ?? ''} | ${(r.best as any) ? (((r.best as any).visualizable * 100) | 0) + '%' : ''} | | | | ${r.error ?? ''} |`]
  ),
];
writeFileSync(join(out, 'report.md'), lines.join('\n') + '\n');
console.log('\n' + lines.slice(0, 6).join('\n'));
console.log('out:', out);
