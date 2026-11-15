// bun scripts/smoke.ts <module.js> [photo] [x0,y0,x1,y1]  → prints the report, writes <module>.png in the scratch dir
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { smokeTest, closeBrowser } from '../src/validate/smoke';

const [file, photo, box] = process.argv.slice(2);
const [x0, y0, x1, y1] = (box ?? '0.12,0.2,0.88,0.62').split(',').map(Number);
const r = await smokeTest(readFileSync(file, 'utf8'), {
  figure: { rect: { x0, y0, x1, y1 }, description: 'smoke test' },
  params: {},
  equations: [],
  page: { number: null, heading: '' },
}, { photo: photo ? readFileSync(photo) : null });
const out = `${process.env.OUT_DIR ?? '.'}/${basename(file, '.js')}.png`;
if (r.screenshot) writeFileSync(out, r.screenshot);
console.log(JSON.stringify({ ok: r.ok, ms: Math.round(r.ms), errors: r.errors, report: r.report && { ...r.report, png: undefined } }, null, 2));
console.log('screenshot:', r.screenshot ? out : 'none');
await closeBrowser();
