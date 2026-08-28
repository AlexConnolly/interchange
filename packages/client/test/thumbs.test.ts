/**
 * Everything the interface shows a picture of has a picture.
 *
 * The Build tray, the Business list and a place's own panel all show the *rendered
 * model* now rather than a glyph of its category — "can we not just move towards
 * the renders with those too". Which means the interface depends on a set of PNGs
 * produced by a Blender script that nobody runs by accident.
 *
 * So the failure mode is specific and quiet: add an industry to the content, do not
 * run `art/build_thumbs.py`, and the tray shows a broken image where a building
 * should be. Nothing errors, nothing logs, and it looks like a missing feature
 * rather than a missing file. Exactly what happened with the three parish buildings
 * — their models existed for a commit before their thumbnails did.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadContent } from '@interchange/data';
import { placeThumb } from '../src/Markers.tsx';
import { thumb } from '../src/Markers.tsx';

const C = loadContent();

/** Where the client serves its static files from. */
const PUBLIC = join(import.meta.dirname, '..', 'public');

const at = (url: string): string => join(PUBLIC, url);

describe('the rendered buildings', () => {
  it('exist for every industry in the content', () => {
    const missing = C.industries
      .map((i) => ({ id: i.id, file: placeThumb(i.id) }))
      .filter((x) => !existsSync(at(x.file)));
    expect(missing.map((m) => m.file)).toEqual([]);
  });

  it('are not empty files', () => {
    /*
     * A zero-byte PNG is what a half-finished Blender run leaves behind, and an
     * `img` tag renders it as nothing at all rather than as an error.
     */
    for (const ind of C.industries) {
      const bytes = statSync(at(placeThumb(ind.id))).size;
      expect(bytes, `${ind.id} thumbnail`).toBeGreaterThan(500);
    }
  });

  it('include the yard, which is not an industry but is in the list', () => {
    /*
     * The Business list puts your yards above your businesses, in the same rows.
     * The yard does not come out of the content, so it is the one picture nothing
     * else would check.
     */
    expect(existsSync(at('thumbs/plc_yard.png'))).toBe(true);
  });
});

describe('the rendered vehicles', () => {
  it('exist for every vehicle in the content', () => {
    /*
     * Held to the same rule as the buildings. This has been right for a long time
     * and there was nothing keeping it right.
     */
    const missing = C.vehicles
      .map((v) => ({ id: v.id, file: thumb(v.id) }))
      .filter((x) => !existsSync(at(x.file)));
    expect(missing.map((m) => m.file)).toEqual([]);
  });
});

describe('the thumbnail path', () => {
  it('turns a content id into the name the pipeline writes', () => {
    /*
     * The one piece of arithmetic in this: ids are hyphenated and Blender object
     * names are not, so the two would silently disagree for exactly the
     * multi-word buildings — which is most of them.
     */
    expect(placeThumb('distribution-centre')).toBe('thumbs/plc_distribution_centre.png');
    expect(placeThumb('village-green')).toBe('thumbs/plc_village_green.png');
    expect(placeThumb('quarry')).toBe('thumbs/plc_quarry.png');
  });

  it('is relative, so it works wherever the game is served from', () => {
    /*
     * No leading slash. The build is served from a sub-path on the tunnel, and an
     * absolute URL would ask the tunnel's root for it.
     */
    for (const ind of C.industries) {
      expect(placeThumb(ind.id).startsWith('/')).toBe(false);
    }
  });
});
