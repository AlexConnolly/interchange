/**
 * Everything you can build is on a page of the Build tray.
 *
 * "I can't find the distribution centre on the build map." It was there, and nine
 * of the sixteen businesses were off the end of a strip that scrolled sideways with
 * its scrollbar hidden — measured, the row wanted 1052px and had 480. That half is
 * a layout fix and it is in the CSS.
 *
 * This is the other half: the filing. The two pages were built from two passes over
 * the industry list with opposite conditions, which works and has a hole in it — a
 * third kind, or a rename, and an industry falls off *both* pages and is not in the
 * game any more, with nothing anywhere to say so.
 */

import { describe, expect, it } from 'vitest';
import { loadContent } from '@interchange/data';
import { trayPageFor, type TrayPage } from '../src/tray.ts';

const C = loadContent();

describe('filing what you can build', () => {
  it('puts every industry in the content on exactly one page', () => {
    const pages: TrayPage[] = ['works', 'parish'];
    for (const ind of C.industries) {
      const on = pages.filter((p) => trayPageFor(ind.kind) === p);
      expect(on.length, `${ind.id} (${ind.kind}) is on ${on.length} pages`).toBe(1);
    }
  });

  it('files the greens and parks with the parish, not the businesses', () => {
    const parish = C.industries.filter((i) => trayPageFor(i.kind) === 'parish');
    expect(parish.map((i) => i.id).sort())
      .toEqual(['park', 'playing-field', 'village-green']);
  });

  it('keeps the distribution centre on the business page', () => {
    /*
     * Named, because it is the one that was reported missing and because it is the
     * last item in the content — which is exactly the position a truncating list
     * loses first.
     */
    const depot = C.industries.find((i) => i.id === 'distribution-centre');
    expect(depot).toBeDefined();
    if (!depot) return;
    expect(trayPageFor(depot.kind)).toBe('works');
  });

  it('files a kind nobody has thought of yet somewhere rather than nowhere', () => {
    /*
     * The hole this closes. A building that turns up on the wrong page is a small
     * wrongness a player can still act on; a building that turns up on no page does
     * not exist, and nothing errors.
     */
    for (const kind of ['utility', 'tourism', 'something-new', '']) {
      expect(['works', 'parish']).toContain(trayPageFor(kind));
    }
  });

  it('leaves the business page with everything that trades', () => {
    const works = C.industries.filter((i) => trayPageFor(i.kind) === 'works');
    expect(works.length).toBe(C.industries.length - 3);
    // Nothing on the business page is an amenity, which is the whole distinction.
    expect(works.every((i) => i.kind !== 'amenity')).toBe(true);
  });
});
