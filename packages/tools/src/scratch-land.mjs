import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', m => { if (m.type() === 'error') console.log('  [err]', m.text()); });
page.on('pageerror', e => console.log('  [pageerror]', e.message));
const money = process.argv[2] ? `&happyHour=${process.argv[2]}` : '';
await page.goto(`http://localhost:4173/?vfx=high&across=30${money}&shot=${Date.now()}`, { waitUntil: 'load' });
await page.waitForTimeout(10000);

await page.locator('.dock-btn', { hasText: 'Land' }).click({ force: true });
await page.waitForTimeout(900);
const chips = await page.locator('.plot').all();
console.log('price chips:', chips.length, 'cash:', await page.locator('.purse-sum').textContent());
if (chips.length === 0) { await browser.close(); process.exit(0); }
await chips[0].click({ force: true });
await page.waitForTimeout(700);
console.log('panel:', (await page.locator('.plot-buy').textContent().catch(() => 'ABSENT')));
const buy = page.locator('.plot-buy .btn.go');
console.log('buy disabled?', await buy.isDisabled());
await page.screenshot({ path: 'shots/land-before.png' });
await buy.click({ force: true });
await page.waitForTimeout(1200);
console.log('after: chips', (await page.locator('.plot').all()).length,
            'panel', (await page.locator('.plot-buy').count()),
            'cash', await page.locator('.purse-sum').textContent());
await page.screenshot({ path: 'shots/land-after.png' });
await browser.close();
