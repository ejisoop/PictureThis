// Opens the same discovery repeatedly in one phone session (as a student would
// browse their discoveries) and reports explore outcomes + WebGL warnings.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1500, height: 960 } });
const logs: string[] = [];
p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning' || /context/i.test(m.text())) && logs.push(m.text().slice(0, 200)));
await p.goto('http://localhost:5173/');
await p.waitForTimeout(2500);
await p.selectOption('.sources select', { label: process.env.PAGE ?? 'Screenshot-2026-11-14_17:12:12.png' });
const btn = p.locator('.gbtn');
await btn.dispatchEvent('pointerdown'); await p.waitForTimeout(60); await btn.dispatchEvent('pointerup');
await p.waitForTimeout(4000);
await p.locator('.pane-label .btn').click(); // close app
await p.waitForTimeout(500);
await p.locator('.pane-label .btn').click(); // open app (no auto-open on revisit)
await p.waitForTimeout(2500);
const phone = () => p.frames().find((fr) => fr.url().endsWith('/phone'))!;
await phone().evaluate(() => { (window as any).__ev = []; addEventListener('lp-explore', (e: any) => (window as any).__ev.push(e.detail)); });
for (let i = 1; i <= Number(process.env.N ?? 14); i++) {
  await phone().locator('.disc-card').first().click();
  const t0 = Date.now();
  let last: any = null;
  while (Date.now() - t0 < 30000) {
    await p.waitForTimeout(500);
    const ev = await phone().evaluate(() => (window as any).__ev);
    last = ev[ev.length - 1];
    if (last && (last.state === 'interactive' || last.state === 'failed')) break;
  }
  await p.waitForTimeout(1500);
  const ev = await phone().evaluate(() => (window as any).__ev);
  last = ev[ev.length - 1];
  const iframes = await phone().evaluate(() => document.querySelectorAll('iframe').length);
  console.log(`#${i} ${last?.state} ${last?.failure ?? ''} ${(last?.errors ?? []).join(' | ').slice(0, 200)} (iframes ${iframes})`);
  await phone().locator('.explore-head .back:not(.tools)').click();
  await p.waitForTimeout(3500);
}
console.log([...new Set(logs)].slice(0, 12).join('\n'));
await b.close();
