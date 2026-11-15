// Compare models on a real repair: a stored failed generation (code + errors) is
// sent as a repair to each candidate; every result goes through full validation.
//   bun scripts/compare-repair.ts gemini-3.8-flash:LOW gemini-4-argon:MEDIUM ...
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { env } from '../src/env';
import { generateJson } from '../src/gemini';
import { systemPrompt, repairPrompt, CODEGEN_SCHEMA } from '../src/prompts/codegen';
import { staticCheck } from '../src/validate/static';
import { smokeTest, closeBrowser } from '../src/validate/smoke';

const db = new Database(join(env.dataDir, 'living-pages.sqlite'), { readonly: true });
const failed = (db.query("SELECT record FROM viz WHERE key LIKE 'failed|%' ORDER BY created DESC").all() as any[]).map((r) => JSON.parse(r.record));
const configs = process.argv.slice(2).map((a) => { const [model, thinking = 'MEDIUM'] = a.split(':'); return { model, thinking: thinking as any }; });
const runs = Number(process.env.RUNS ?? 1);

for (const f of failed) {
  const d = (db.query('SELECT record, photo FROM discovery WHERE page_key = ? ORDER BY created DESC').all(f.pageKey) as any[]).map((r) => ({ ...JSON.parse(r.record), photoBuf: Buffer.from(r.photo) })).find((x: any) => x.figureId === f.figureId);
  if (!d || !f.prompt) continue;
  console.log(`\n== ${f.title} (${f.figureId}) — errors: ${f.validation.errors.join(' | ').slice(0, 120)}`);
  const jobs = configs.flatMap((c) => Array.from({ length: runs }, () => c)).map(async (c) => {
    const t0 = performance.now();
    try {
      const { data } = await generateJson<any>({ model: c.model, system: systemPrompt(), parts: [{ text: f.prompt.user }, { text: repairPrompt(f.code, f.validation.errors) }], schema: CODEGEN_SCHEMA, thinking: c.thinking, temperature: 0.3, timeoutMs: 180000 }, 0);
      const gen = performance.now() - t0;
      const st = staticCheck(String(data.code ?? ''));
      if (!st.ok) return `${c.model}:${c.thinking}  FAIL static (${(gen / 1000).toFixed(1)} s): ${st.errors[0]}`;
      const sm = await smokeTest(data.code, d.ctx, { photo: d.photoBuf, corners: d.pageCorners });
      return `${c.model}:${c.thinking}  ${sm.ok ? 'PASS' : 'FAIL'}  gemini ${(gen / 1000).toFixed(1)} s  ${sm.ok ? '' : sm.errors.join(' | ').slice(0, 140)}`;
    } catch (e) {
      return `${c.model}:${c.thinking}  ERROR ${(performance.now() - t0) / 1000 | 0} s: ${String((e as Error).message).slice(0, 120)}`;
    }
  });
  for (const r of await Promise.all(jobs)) console.log('  ' + r);
}
await closeBrowser();
