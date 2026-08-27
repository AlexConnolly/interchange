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
const SHOTS: {
  name: string; query: string; wait?: number; hover?: string; click?: string[];
}[] = [
  { name: 'afternoon', query: 'across=30' },
  { name: 'wide', query: 'across=64' },
  { name: 'dawn-mist', query: 'across=30&time=0.02' },
  { name: 'night', query: 'across=30&time=0.62' },
  { name: 'close', query: 'across=16' },
  { name: 'cloud-in', query: 'across=52' },
  { name: 'cloud-full', query: 'across=70' },
  { name: 'cloud-none', query: 'across=30' },
  /*
   * A hover state, because half the interface only exists in one.
   *
   * The furniture is deliberately near-invisible until you reach for it, so a
   * screenshot of the resting state says nothing about whether the reaching-for
   * state works — and that is the half with the contrast in it.
   */
  { name: 'ui-hover', query: 'across=30', hover: '.dock' },
  { name: 'rich', query: 'across=30&happyHour=1500000' },
  /*
   * Twenty-two seconds, not nine. A plume takes its particles' whole lifetime to
   * fill in — fourteen seconds here — and a headless browser on software GL runs
   * this scene at about three frames a second, so the default settle photographs
   * a plume that is a third built. The emission rate is frame-rate independent;
   * how far through its life the field is when the shutter opens is not.
   */
  { name: 'smoke', query: 'across=18&time=0.09&day=241', wait: 22000 },
  { name: 'fog-day', query: 'across=34&time=0.02&day=261', wait: 14000 },
  /* A river crossing, close enough to see the deck and the water together. */
  { name: 'bridge', query: 'across=12&at=37,54' },
  /*
   * A panel, which needs a click to exist.
   *
   * Half this interface only appears when something is open, and until now the
   * screenshot tool could photograph none of it — so every change to a panel was
   * checked by reading the CSS and hoping. Clicking a map marker is the cheapest
   * way in: it is the same gesture a player makes.
   */
  { name: 'panel', query: 'across=26', click: ['.mark'] },
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
    /*
     * `intro=0`, always, and it is not optional.
     *
     * The game opens with ten seconds of coming down through cloud, which is
     * lovely and would make every screenshot in this file a photograph of weather:
     * the settle is nine seconds and the descent is not over until ten. Anything
     * automated wants the game, not the arrival.
     */
    const url = `${BASE}?vfx=high&intro=0&${shot.query}&shot=${Date.now()}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(shot.wait ?? SETTLE);
    for (const sel of shot.click ?? []) {
      /*
       * The first one *on screen*, which is not the first one in the document.
       *
       * Map markers are positioned for the whole district and only some of them
       * are in view, so `page.click('.mark')` picks whichever is first in DOM
       * order and fails with "outside of the viewport" as often as not. And
       * `force`, because the markers sit in a layer the canvas overlaps: they
       * take pointer events and the canvas does not, but proving that to
       * Playwright's hit-test is more trouble than dispatching the click.
       */
      const all = await page.locator(sel).all();
      let clicked = false;
      for (const el of all) {
        const box = await el.boundingBox();
        if (!box) continue;
        if (box.x < 40 || box.y < 40 || box.x > 1500 || box.y > 900) continue;
        await el.click({ force: true, timeout: 4000 });
        clicked = true;
        break;
      }
      if (!clicked) console.log(`  (nothing on screen matched ${sel})`);
      await page.waitForTimeout(600);
    }
    if (shot.hover) {
      await page.hover(shot.hover);
      // Long enough for the 120ms transition in, and no longer.
      await page.waitForTimeout(400);
    }
    const file = `${OUT}/${shot.name}.png`;
    await page.screenshot({ path: file });
    console.log(`${file}  <-  ${shot.query}`);
  }

  await browser.close();
}

await main();
