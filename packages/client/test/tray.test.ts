/**
 * Everything you can build is on a page of the Build tray, and every page is short.
 *
 * Two complaints landed on this row in a day. "I can't find the distribution
 * centre" — it was nine items past the fold of a strip that scrolled sideways with
 * its scrollbar hidden. And then, once wrapping had made all sixteen visible:
 * "rather than that big menu we have categories and a grouped menu? Would be a lot
 * cleaner."
 *
 * Both have the same shape. A tray is a strip along the bottom of a district and it
 * can hold about six things comfortably; anything that has to hold sixteen is going
 * to hide some or stack them. So the answer is not a bigger row, it is fewer things
 * per row — and this file is what keeps that true as content is added.
 */

import { describe, expect, it } from 'vitest';
import { loadContent } from '@interchange/data';
import {
  TRAY_CATEGORIES, BUILDING_PAGES, trayPageFor, type TrayPage,
} from '../src/tray.ts';

const C = loadContent();

/** What lands on each page, by industry id. */
function contents(): Map<TrayPage, string[]> {
  const out = new Map<TrayPage, string[]>();
  for (const ind of C.industries) {
    const page = trayPageFor(ind.kind, ind.deposit);
    out.set(page, [...(out.get(page) ?? []), ind.id]);
  }
  return out;
}

describe('filing what you can build', () => {
  it('puts every industry on exactly one page', () => {
    for (const ind of C.industries) {
      const page = trayPageFor(ind.kind, ind.deposit);
      const on = BUILDING_PAGES.filter((p) => p === page);
      expect(on.length, `${ind.id} (${ind.kind}) is on ${on.length} pages`).toBe(1);
    }
  });

  it('keeps the distribution centre somewhere findable', () => {
    /*
     * Named, because it is the one that was reported missing and because it is last
     * in the content — the position a truncating list loses first.
     */
    const depot = C.industries.find((i) => i.id === 'distribution-centre');
    expect(depot).toBeDefined();
    if (!depot) return;
    expect(trayPageFor(depot.kind, depot.deposit)).toBe('trade');
  });

  it('separates the farms from the quarry and the plantation', () => {
    /*
     * The one place the content's own `kind` needs help: `extraction` holds three
     * farms *and* a quarry and a forestry plantation. Calling a quarry a farm to
     * keep the category count at four would have been a tidier menu with a lie in
     * it, so the deposit splits them — farmland one way, stone and timber the other.
     */
    const by = contents();
    expect((by.get('farms') ?? []).sort())
      .toEqual(['arable-farm', 'dairy-farm', 'livestock-farm']);
    expect((by.get('ground') ?? []).sort()).toEqual(['forestry', 'quarry']);
  });

  it('files the greens and parks with the parish', () => {
    expect((contents().get('parish') ?? []).sort())
      .toEqual(['park', 'playing-field', 'village-green']);
  });

  it('files a kind nobody has thought of yet somewhere rather than nowhere', () => {
    /*
     * The hole this closes, and it is the hole the distribution centre fell through.
     * A building on the wrong page is a small wrongness a player can act on; a
     * building on no page does not exist and nothing errors.
     */
    for (const kind of ['utility', 'tourism', 'something-new', '']) {
      expect(BUILDING_PAGES).toContain(trayPageFor(kind, 0));
    }
  });
});

describe('the size of each page', () => {
  it('fits one row, which is the whole reason for grouping', () => {
    /*
     * Six is what the tray holds at 620px with 62px buttons. Measured before the
     * grouping: sixteen businesses wanted 1052px and had 480, and nine of them were
     * off the end with nothing to say so.
     */
    const by = contents();
    for (const page of BUILDING_PAGES) {
      const n = (by.get(page) ?? []).length;
      expect(n, `${page} has ${n} on it`).toBeLessThanOrEqual(6);
      expect(n, `${page} is empty`).toBeGreaterThan(0);
    }
  });

  it('has a category page that fits one row too', () => {
    // Adding a seventh category would push the category page into the same trap.
    expect(TRAY_CATEGORIES.length).toBeLessThanOrEqual(6);
  });
});

describe('the category page', () => {
  it('offers a page for every page that has buildings on it', () => {
    /*
     * The other half of "total": a page can be reachable and empty, or full and
     * unreachable, and the second is the bug. Every building page must have a
     * category button that opens it.
     */
    const offered = TRAY_CATEGORIES.map((c) => c.page);
    for (const page of BUILDING_PAGES) {
      expect(offered, `nothing opens ${page}`).toContain(page);
    }
  });

  it('shows a building on every category that has buildings', () => {
    /*
     * The sample render is what makes a category legible at a glance. Roads is the
     * one page with nothing to show, and it is the one page allowed a glyph.
     */
    for (const cat of TRAY_CATEGORIES) {
      if (cat.page === 'roads') {
        expect(cat.sample).toBeNull();
        continue;
      }
      expect(cat.sample, `${cat.page} has no sample`).not.toBeNull();
      const ids = C.industries.map((i) => i.id);
      expect(ids, `${cat.page}'s sample is not in the content`).toContain(cat.sample);
    }
  });

  it('draws its sample from the page it opens', () => {
    /*
     * A category showing a creamery and opening the farms page would be worse than
     * a glyph — it would be a wrong answer confidently given.
     */
    for (const cat of TRAY_CATEGORIES) {
      if (cat.sample === null) continue;
      const ind = C.industries.find((i) => i.id === cat.sample);
      expect(ind).toBeDefined();
      if (!ind) continue;
      expect(trayPageFor(ind.kind, ind.deposit), `${cat.page}'s sample`).toBe(cat.page);
    }
  });

  it('gives every category a label short enough for the button', () => {
    /*
     * Two lines of about ten characters at 62px, which is what `.tool-btn span`
     * clamps to. "Distribution centre" already lives on that limit as an item; a
     * category label longer than it would be clipped rather than wrapped.
     */
    for (const cat of TRAY_CATEGORIES) {
      expect(cat.label.length, `${cat.label} is long`).toBeLessThanOrEqual(14);
      expect(cat.hint.length, `${cat.page} has no hint`).toBeGreaterThan(10);
    }
  });
});
