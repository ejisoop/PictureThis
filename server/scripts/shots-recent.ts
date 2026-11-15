// Screenshots of the most recent discoveries' visualizations at phone size, with
// the phone UI's header and bottom sheet drawn on top, so framing problems show.
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import sharp from 'sharp';
import { smokeTest, closeBrowser } from '../src/validate/smoke';
import { env } from '../src/env';
const OUT = process.env.OUT!;
const db = new Database(join(env.dataDir, 'living-pages.sqlite'));
const ds = (db.query('SELECT record, photo FROM discovery ORDER BY created DESC LIMIT 40').all() as any[]).map((r) => ({ ...JSON.parse(r.record), photoBuf: Buffer.from(r.photo) }));
const seen = new Set<string>();
const tiles: any[] = [];
for (const d of ds) {
  const k = `${d.pageKey}|${d.figureId}`;
  if (seen.has(k) || seen.size >= 6) continue;
  const row = db.query("SELECT record FROM viz WHERE page_key = ? AND figure_id = ? AND key NOT LIKE 'failed|%'").get(d.pageKey, d.figureId) as any;
  if (!row) continue;
  seen.add(k);
  const v = JSON.parse(row.record);
  const r = await smokeTest(v.code, d.ctx, { photo: d.photoBuf, corners: d.pageCorners, exercise: false, viewport: { width: 390, height: 844 } });
  if (!r.screenshot) continue;
  // the phone UI: header (top 92 px) and the open controls sheet (bottom ~330 px)
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect x="0" y="0" width="390" height="92" fill="#f7f0e1" opacity="0.85"/><rect x="8" y="498" width="374" height="330" rx="18" fill="#fbf6ea" opacity="0.85"/><text x="14" y="884" font-size="14">${d.title.replace(/[<&]/g, '')}</text></svg>`);
  const img = await sharp(r.screenshot).composite([{ input: overlay }]).png().toBuffer();
  tiles.push({ input: img, left: (tiles.length % 3) * 390, top: Math.floor(tiles.length / 3) * 844 });
  console.log(tiles.length, d.title, d.figureId, `figure box y ${d.figureBox.y0.toFixed(2)}–${d.figureBox.y1.toFixed(2)}`, `corners ${JSON.stringify(d.pageCorners.map((p: number[]) => p.map((x) => +x.toFixed(2))))}`);
}
await sharp({ create: { width: 1170, height: 844 * Math.ceil(tiles.length / 3), channels: 3, background: '#fff' } }).composite(tiles).png().toFile(`${OUT}/recent.png`);
await closeBrowser();
