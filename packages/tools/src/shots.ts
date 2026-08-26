/**
 * Screenshots of the running game, to files.
 *
 *   pnpm build && pnpm preview &
 *   node --experimental-strip-types packages/tools/src/shots.ts
 *
 * This exists because "how does it look" has been the hardest question to answer
 * all through this project, and the way it was being answered — driving a real
 * Chrome tab through an extension — turned out to be unreliable in a way that
 * wasted a lot of time: when the tab is not in the foreground the browser stops
 * calling `requestAnimationFrame`, the game's whole frame loop stops with it, and
 * every screenshot after that point is the same frozen frame. It looks exactly
 * like a rendering change that did nothing.
 *
 * A headless browser has no foreground, so the loop runs regardless. Chrome's own
 * `--screenshot` flag was nearly enough on its own and fails on one detail: it
 * fires at the load event, which is before the models have been fetched and
 * before influence has resolved, so it photographs an empty district. Hence a
 * driver, which can simply wait.
 *
 * `playwright-core` rather than `playwright`: it drives the Chrome that is
 * already installed instead of downloading a second copy of Chromium.
 */

import { mkdirSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';

/** Where the installed Chrome lives. Windows first, then the usual Unix spots. */
const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/**
 * A shot to take: the query the game is opened with, and what to call it.
 *
 * Times are the day fraction the client's `?time=` takes, where 0 is six in the
 * morning — see `HOUR` in `evening.ts`. They are chosen to show the things that
 * only exist at one hour: the mist is a dawn thing and nothing else in the game
 * says so, and the lit windows and street lamps only mean anything after dusk.
 */
const SHOTS: { name: string; query: string; wait?: number }[] = [
  { name: 'afternoon', query: 'across=30' },
  { name: 'wide', query: 'across=64' },
  { name: 'dawn-mist', query: 'across=30&time=0.02' },
  { name: 'night', query: 'across=30&time=0.62' },
  { name: 'close', query: 'across=16' },
  { name: 'cloud-in', query: 'across=52' },
  { name: 'cloud-full', query: 'across=70' },
  { name: 'cloud-none', query: 'across=30' },
];

const BASE = process.env.BASE ?? 'http://localhost:4173/';
const OUT = process.env.OUT ?? 'shots';
/** Long enough for the models to arrive and the district to settle. */
const SETTLE = Number(process.env.SETTLE ?? 9000);

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  let browser: Browser | null = null;
  for (const path of CHROMES) {
    try {
      browser = await chromium.launch({
        executablePath: path,
        args: [
          /*
           * Software WebGL, because a headless Chrome has no GPU to hand and
           * would otherwise fall back to a context that fails to create — which
           * this app survives by drawing nothing at all, so the failure arrives
           * as a blank picture rather than as an error.
           */
          '--use-angle=swiftshader',
          '--enable-unsafe-swiftshader',
          '--hide-scrollbars',
        ],
      });
      break;
    } catch {
      browser = null;
    }
  }
  if (!browser) {
    console.error(`no Chrome found; looked in:\n  ${CHROMES.join('\n  ')}`);
    process.exit(1);
  }

  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`  [page] ${m.text()}`);
  });

  /* One name, or a comma-separated few, when you only want to look at one
   * thing. Eight shots at nine seconds of settling each is two minutes, which
   * is too long to wait to check a single change. */
  const only = (process.env.ONLY ?? '').split(',').filter((x) => x !== '');
  for (const shot of SHOTS) {
    if (only.length > 0 && !only.includes(shot.name)) continue;
    const url = `${BASE}?vfx=high&${shot.query}&shot=${Date.now()}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(shot.wait ?? SETTLE);
    const file = `${OUT}/${shot.name}.png`;
    await page.screenshot({ path: file });
    console.log(`${file}  <-  ${shot.query}`);
  }

  await browser.close();
}

await main();
