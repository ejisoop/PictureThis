import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1500, height: 960 } });
await p.goto(process.env.HARNESS ?? 'http://localhost:5173/');
await p.waitForTimeout(2500);
const phone = () => p.frames().find((fr) => fr.url().endsWith('/phone'))!;
await p.selectOption('.sources select', { label: 'Screenshot-2026-11-14_17:12:12.png' });
const btn = p.locator('.gbtn');
await btn.dispatchEvent('pointerdown'); await p.waitForTimeout(60); await btn.dispatchEvent('pointerup');
await phone().locator('.disc-card').first().waitFor({ timeout: 30000 });
await p.waitForTimeout(4000);
if (await phone().locator('.lp-app.exploring').count()) { await phone().locator('.explore-head .back:not(.tools)').click(); await p.waitForTimeout(3000); }
await p.waitForTimeout(Number(process.env.WAIT ?? 0));
await phone().getByText('⚙ Settings').click();
await phone().locator('details.dev summary').click();
await p.waitForTimeout(1500);
console.log('target:', await phone().locator('.dev-target').innerText());
for (const name of ['generated code', 'Gemini prompt']) {
  await phone().getByRole('button', { name }).click();
  await p.waitForTimeout(1200);
  const pre = await phone().locator('.settings-card pre.code-view').first().innerText();
  console.log(`${name}: ${pre.length} chars · ${pre.slice(0, 70).replace(/\n/g, ' ')}`);
}
console.log('errors button enabled:', await phone().getByRole('button', { name: /errors/ }).isEnabled(), '· regenerate enabled:', await phone().getByRole('button', { name: 'regenerate' }).isEnabled());
await b.close();
