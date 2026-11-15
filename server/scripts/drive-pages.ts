// Drives the harness through every eval page: look now → wait for the phone
// to reach interactive or failed → report errors seen by the explore session.
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1500, height: 960 } });
const logs: string[] = [];
p.on('console', (m) => m.type() === 'error' && logs.push(m.text().slice(0, 300)));
await p.goto('http://localhost:5173/');
await p.waitForTimeout(2500);
const files: string[] = await (await fetch('http://localhost:5173/evals/pages')).json();
for (const f of files.filter((x) => !process.env.ONLY || x.includes(process.env.ONLY))) {
  await p.selectOption('.sources select', { label: f });
  const phone = p.frames().find((fr) => fr.url().endsWith('/phone'))!;
  await phone.evaluate(() => { (window as any).__ev = []; addEventListener('lp-explore', (e: any) => (window as any).__ev.push(e.detail)); });
  const btn = p.locator('.gbtn');
  await btn.dispatchEvent('pointerdown'); await p.waitForTimeout(60); await btn.dispatchEvent('pointerup');
  let last: any = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 80000) {
    await p.waitForTimeout(1000);
    const ev = await phone.evaluate(() => (window as any).__ev);
    last = ev[ev.length - 1];
    if (last && (last.state === 'interactive' || last.state === 'failed')) { await p.waitForTimeout(6000); const ev2 = await phone.evaluate(() => (window as any).__ev); last = ev2[ev2.length - 1]; break; }
  }
  console.log(f.slice(19, 27), last ? `${last.state} ${last.failure ?? ''} ${(last.errors ?? []).join(' || ').slice(0, 400)}` : 'no explore (no discovery?)');
  // back home
  await phone.evaluate(() => document.querySelector('.lp-app.exploring') && (document.querySelector('.explore-head .back') as HTMLElement)?.click());
  await p.waitForTimeout(3000);
}
console.log('console errors:', [...new Set(logs)].slice(0, 15).join('\n'));
await b.close();
