import { chromium } from 'playwright';
const OUT = process.env.OUT!;
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1500, height: 960 } });
await p.goto('http://localhost:5173/');
await p.waitForTimeout(3000);
const phone = () => p.frames().find((fr) => fr.url().endsWith('/phone'))!;
const btn = p.locator('.gbtn');
// hold = pause
await btn.dispatchEvent('pointerdown'); await p.waitForTimeout(900); await btn.dispatchEvent('pointerup');
await p.waitForTimeout(1500);
console.log('after hold:', (await phone().locator('.scan-text b').innerText()));
await p.selectOption('.sources select', { label: 'Screenshot-2026-11-14_17:12:12.png' });
await p.waitForTimeout(500);
// tap = look now, while paused
await btn.dispatchEvent('pointerdown'); await p.waitForTimeout(80); await btn.dispatchEvent('pointerup');
await p.waitForTimeout(800);
console.log('right after tap:', await p.locator('.speaker').innerText().catch(() => '(no speaker caption)'));
await p.waitForTimeout(8000);
const rows = await p.locator('.trace').allInnerTexts();
console.log('frames while paused:', rows.length, rows.slice(0, 2).map((r) => r.replace(/\s+/g, ' ')).join(' || '));
await phone().locator('.app-head, .miniapp-header, header').first().screenshot({ path: `${OUT}/header.png` }).catch(async () => p.screenshot({ path: `${OUT}/header.png`, clip: { x: 520, y: 100, width: 400, height: 160 } }));
await p.screenshot({ path: `${OUT}/header.png`, clip: { x: 520, y: 95, width: 400, height: 170 } });
await b.close();
