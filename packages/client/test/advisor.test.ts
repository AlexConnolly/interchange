/**
 * The advisor: letters that arrive once, at the right moment.
 *
 * What matters is the *plumbing*, not the prose. A letter that arrives twice is a
 * pestering; one that never arrives is a tutorial nobody got; one that arrives at
 * the start when it is about a thing you cannot do yet is worse than either. So
 * those three are pinned, along with the trimming, which is the only arithmetic in
 * the file and the thing a toast depends on entirely.
 */

import { describe, expect, it } from 'vitest';
import { Advisor, POST, trim, type AdvisorWorld } from '../src/advisor.ts';

/** A district where nothing has happened yet. */
function fresh(over: Partial<AdvisorWorld> = {}): AdvisorWorld {
  return {
    tick: 0,
    fleet: 1,
    places: 0,
    fields: 0,
    delivered: 0,
    cash: 2_500_00,
    boardOpen: false,
    stranded: false,
    holdingStock: false,
    ...over,
  };
}

describe('the opening letter', () => {
  it('arrives immediately, and is from the man who left you the yard', () => {
    const a = new Advisor();
    const fireds = a.check(fresh());
    expect(fireds.length).toBe(1);
    expect(fireds[0].id).toBe('ashbury-handover');
    expect(fireds[0].from).toBe('Tom Ashbury');
    expect(fireds[0].role).toContain('yard');
    // The line that has to be in it.
    expect(fireds[0].body.join(' ')).toContain('keep you well');
  });

  it('counts as unread until it is opened', () => {
    const a = new Advisor();
    a.check(fresh());
    expect(a.unread).toBe(1);
    a.markRead('ashbury-handover');
    expect(a.unread).toBe(0);
    expect(a.wasRead('ashbury-handover')).toBe(true);
  });
});

describe('every letter', () => {
  it('arrives once and never again', () => {
    /*
     * The whole of the state in this file. Run a world where *everything* is true
     * twice over and check that the second pass delivers nothing: a predicate that
     * stays true — owning land, say — would otherwise post a letter every quarter
     * of a second for the rest of the game.
     */
    const all = fresh({
      fleet: 9, places: 4, fields: 3, delivered: 900, cash: 900_000_00,
      boardOpen: true, stranded: true, holdingStock: true,
    });
    const a = new Advisor();
    const first = a.check(all);
    /*
     * Not all of them, and the exception is the interesting part: the letter
     * suggesting you buy a business is conditioned on `places === 0`, so in a
     * world where you already own four it correctly never arrives. Advice you have
     * already taken is not advice. Named here rather than asserted as a count, so
     * that adding a letter does not break this test for no reason.
     */
    const missing = POST.filter((t) => !first.some((l) => l.id === t.id));
    expect(missing.map((t) => t.id)).toEqual(['creamery-buy-a-place']);

    // And the invariant that actually matters: nothing ever comes twice.
    expect(a.check(all)).toEqual([]);
    expect(a.check(all)).toEqual([]);
    expect(new Set(a.letters.map((l) => l.id)).size).toBe(a.letters.length);
  });

  it('has an id nothing else has', () => {
    // Ids are how "already had it" is remembered, so a duplicate would silently
    // swallow one of the two letters for ever.
    const ids = new Set(POST.map((t) => t.id));
    expect(ids.size).toBe(POST.length);
  });

  it('has a body somebody will actually finish', () => {
    for (const tip of POST) {
      expect(tip.body.length, tip.id).toBeGreaterThan(0);
      expect(tip.body.length, tip.id).toBeLessThanOrEqual(4);
      expect(tip.subject.length, tip.id).toBeGreaterThan(4);
      expect(tip.from.length, tip.id).toBeGreaterThan(2);
      for (const para of tip.body) {
        expect(para.length, `${tip.id} paragraph`).toBeLessThan(320);
      }
    }
  });
});

describe('when the tips fire', () => {
  it('holds back everything that is about a thing you have not done', () => {
    /*
     * The point of the whole design. On a brand new district only the handover
     * should arrive — a letter about the planning board, or about the ground you
     * own, is a letter about a screen the player cannot use yet, and delivering it
     * at minute one is exactly what a bad tutorial does.
     */
    const a = new Advisor();
    const fired = a.check(fresh());
    expect(fired.map((l) => l.id)).toEqual(['ashbury-handover']);
  });

  it('brings the board letter when the board opens, and not before', () => {
    const a = new Advisor();
    a.check(fresh());
    expect(a.check(fresh({ fleet: 3 })).map((l) => l.id)).not.toContain('clerk-board');
    expect(a.check(fresh({ boardOpen: true })).map((l) => l.id)).toContain('clerk-board');
  });

  it('brings the land letter only once you own ground', () => {
    const a = new Advisor();
    a.check(fresh());
    expect(a.check(fresh()).map((l) => l.id)).not.toContain('clerk-land');
    expect(a.check(fresh({ fields: 1 })).map((l) => l.id)).toContain('clerk-land');
  });

  it('brings the stranded letter the moment something of yours is cut off', () => {
    const a = new Advisor();
    a.check(fresh());
    expect(a.check(fresh({ stranded: true })).map((l) => l.id))
      .toContain('ashbury-stranded');
  });

  it('stops nagging about buying a business once you own one', () => {
    // The predicate is `places === 0`, so a player who buys a farm before the
    // letter's other condition is met never gets advice they have already taken.
    const a = new Advisor();
    a.check(fresh());
    const late = a.check(fresh({ delivered: 200, places: 2 }));
    expect(late.map((l) => l.id)).not.toContain('creamery-buy-a-place');
  });

  it('stamps a letter with the tick it arrived on', () => {
    const a = new Advisor();
    const [l] = a.check(fresh({ tick: 12_345 }));
    expect(l.at).toBe(12_345);
  });
});

describe('sending one by hand', () => {
  it('puts it in, and refuses the same id twice', () => {
    /*
     * The hook the rest of the game writes through. Refusing a repeat id matters
     * because the caller is usually an event handler, and an event handler firing
     * twice for one event is the normal state of affairs rather than a bug.
     */
    const a = new Advisor();
    const one = {
      id: 'one-off',
      from: 'Somebody',
      role: 'a neighbour',
      tint: '#888888',
      subject: 'Hello',
      body: ['A short note.'],
      at: 5,
    };
    expect(a.post(one)).toBe(true);
    expect(a.post(one)).toBe(false);
    expect(a.letters.filter((l) => l.id === 'one-off').length).toBe(1);
    expect(a.unread).toBe(1);
  });
});

describe('trimming for the toast', () => {
  it('leaves a short letter alone', () => {
    const l = {
      id: 'x', from: 'A', role: 'b', tint: '#000', subject: 's',
      body: ['Short enough.'], at: 0,
    };
    expect(trim(l)).toBe('Short enough.');
  });

  it('cuts at a word, never mid-word', () => {
    /*
     * A preview ending "the creamery is always sho" reads as broken; one ending
     * "the creamery is always…" reads as a preview. This is the reason the cut is
     * here rather than in CSS — `text-overflow` on three paragraphs of markup
     * clips the first and hides the rest.
     */
    const l = {
      id: 'x', from: 'A', role: 'b', tint: '#000', subject: 's',
      body: ['The creamery is always short of milk and always will be'],
      at: 0,
    };
    const out = trim(l, 30);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(31);
    // The last thing before the ellipsis is a whole word.
    const words = 'The creamery is always short of milk and always will be'.split(' ');
    const kept = out.slice(0, -1).trim();
    expect(words.join(' ').startsWith(kept)).toBe(true);
    expect(kept.endsWith(' ')).toBe(false);
  });

  it('flattens the paragraphs into one line', () => {
    const l = {
      id: 'x', from: 'A', role: 'b', tint: '#000', subject: 's',
      body: ['One.', 'Two.', 'Three.'], at: 0,
    };
    expect(trim(l)).toBe('One. Two. Three.');
  });

  it('never leaves a ragged fragment when a single word is longer than the room', () => {
    // The pathological case: no space to cut at. It has to still return something
    // that is at most the length asked for, rather than falling back to the whole
    // word and pushing the toast wider than the screen.
    const l = {
      id: 'x', from: 'A', role: 'b', tint: '#000', subject: 's',
      body: ['Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch'], at: 0,
    };
    const out = trim(l, 20);
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out.endsWith('…')).toBe(true);
  });
});
