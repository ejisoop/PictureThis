// Re-runs the (now stricter) smoke test on every cached visualization against
// its own page photo. bun scripts/retest-cache.ts
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { smokeTest, closeBrowser } from '../src/validate/smoke';
import { env } from '../src/env';

const db = new Database(join(env.dataDir, 'living-pages.sqlite'));
const vizs = (db.query("SELECT key, record FROM viz WHERE key NOT LIKE 'failed|%'").all() as any[]).map((r) => JSON.parse(r.record));
for (const v of vizs) {
  const d = db.query('SELECT record, photo FROM discovery WHERE page_key = ? ORDER BY created DESC').all(v.pageKey).map((r: any) => ({ ...JSON.parse(r.record), photoBuf: Buffer.from(r.photo) })).find((x: any) => x.figureId === v.figureId);
  if (!d) { console.log(v.figureId, 'no discovery'); continue; }
  const r = await smokeTest(v.code, d.ctx, { photo: d.photoBuf, corners: d.pageCorners, exercise: !process.env.QUICK });
  console.log(`${v.source.padEnd(9)} ${v.figureId.padEnd(18)} ${r.ok ? 'ok  ' : 'FAIL'} below-paper ${Math.round((r.report?.belowPaper ?? 0) * 100)}% steps ${r.exercised ?? 0} ${Math.round(r.ms)}ms ${r.errors.join(' | ').slice(0, 500)}`);
}
await closeBrowser();
