// Regenerates a discovery and expects the phone to survive a server restart mid-generation.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1500, height: 960 } });
await p.goto('http://localhost:5173/');
await p.waitForTimeout(2500);
const phone = () => p.frames().find((fr) => fr.url().endsWith('/phone'))!;
await phone().evaluate(() => { (window as any).__ev = []; addEventListener('lp-explore', (e: any) => (window as any).__ev.push(e.detail)); });
await p.selectOption('.sources select', { label: 'Screenshot-2026-11-14_17:13:53.png' });
const btn = p.locator('.gbtn');
await btn.dispatchEvent('pointerdown'); await p.waitForTimeout(60); await btn.dispatchEvent('pointerup');
// discovery → auto-open → (cache hit) interactive
for (let i = 0; i < 60; i++) {
  await p.waitForTimeout(1000);
  const ev = await phone().evaluate(() => (window as any).__ev);
  if (ev.some((e: any) => e.state === 'interactive' || e.state === 'failed')) break;
}
await phone().locator('.explore-head .tools').click();
await phone().locator('details.dev summary').click();
await phone().getByText('regenerate').click();
console.log('regenerating', new Date().toLocaleTimeString());
const t0 = Date.now();
let seen = new Set<string>();
while (Date.now() - t0 < 150000) {
  await p.waitForTimeout(1000);
  const ev = await phone().evaluate(() => (window as any).__ev);
  const last = ev[ev.length - 1];
  const tag = `${last.state} ${last.failure ?? ''}`;
  if (!seen.has(tag)) { seen.add(tag); console.log(Math.round((Date.now() - t0) / 1000) + 's', tag, (last.errors ?? []).join(' | ').slice(0, 200)); }
  if (last.state === 'interactive' || last.state === 'failed') break;
}
await b.close();
