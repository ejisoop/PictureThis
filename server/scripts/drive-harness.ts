import { chromium } from 'playwright';
const OUT = process.env.OUT!;
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1500, height: 960 } });
const logs: string[] = [];
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
p.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
p.on('frameattached', (f) => f.page().on('pageerror', () => {}));
await p.goto('http://localhost:5173/');
await p.waitForTimeout(3000);
await p.screenshot({ path: `${OUT}/h0.png` });
await p.selectOption('.sources select', { label: process.env.PAGE ?? 'Screenshot-2026-11-14_17:12:12.png' });
await p.waitForTimeout(800);
const btn = p.locator('.gbtn');
await btn.dispatchEvent('pointerdown');
await p.waitForTimeout(80);
await btn.dispatchEvent('pointerup');
for (const [i, t] of [[1, 5000], [2, 5000], [3, 6000], [4, 8000]] as const) {
  await p.waitForTimeout(t);
  await p.screenshot({ path: `${OUT}/h${i}.png` });
}
console.log(logs.slice(0, 30).join('\n'));
await b.close();
