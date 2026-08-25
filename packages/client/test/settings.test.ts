/**
 * Settings, and the two things about them that are easy to get wrong.
 *
 * A binding table that cannot survive a new action being added means everybody
 * loses their rebinds on update, and a rebind that silently takes a key
 * already in use means an action quietly stops working. Both are the sort of
 * bug that is reported as "the game forgot my keys" months later.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  ACTIONS, actionFor, conflictFor, defaultSettings, keyLabel, loadSettings,
  saveSettings,
} from '../src/settings.ts';

/** A localStorage that exists only for this file. */
function fakeStorage(): void {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
}

beforeEach(fakeStorage);

describe('bindings', () => {
  it('gives every action a key, and no two actions the same key', () => {
    const s = defaultSettings();
    const seen = new Map<string, string>();
    for (const a of ACTIONS) {
      const key = s.keys[a.id];
      expect(key, a.id).toBeTruthy();
      expect(seen.has(key), `${a.id} and ${seen.get(key)} both use ${key}`).toBe(false);
      seen.set(key, a.id);
    }
  });

  it('resolves a press to the action that owns it', () => {
    const s = defaultSettings();
    expect(actionFor(s, 'q')).toBe('rotateLeft');
    expect(actionFor(s, 'Q')).toBe('rotateLeft');
    expect(actionFor(s, ' ')).toBe('pause');
    expect(actionFor(s, 'z')).toBeNull();
  });

  it('treats a shifted punctuation key as the same key', () => {
    const s = defaultSettings();
    // Somebody who bound zoom to = means the key, not the character, so the
    // shifted form has to reach the same action.
    expect(actionFor(s, '=')).toBe('zoomIn');
    expect(actionFor(s, '+')).toBe('zoomIn');
    expect(actionFor(s, '-')).toBe('zoomOut');
    expect(actionFor(s, '_')).toBe('zoomOut');
  });

  it('reports which action a key clashes with, rather than only that it does', () => {
    const s = defaultSettings();
    expect(conflictFor(s, 'q', 'zoomIn')).toBe('rotateLeft');
    expect(conflictFor(s, 'q', 'rotateLeft')).toBeNull();
    expect(conflictFor(s, 'z', 'zoomIn')).toBeNull();
  });

  it('follows a rebind', () => {
    const s = defaultSettings();
    s.keys.rotateLeft = 'z';
    expect(actionFor(s, 'z')).toBe('rotateLeft');
    expect(actionFor(s, 'q')).toBeNull();
  });
});

describe('storage', () => {
  it('round-trips', () => {
    const s = defaultSettings();
    s.keys.pause = 'k';
    s.largeText = true;
    saveSettings(s);
    const back = loadSettings();
    expect(back.keys.pause).toBe('k');
    expect(back.largeText).toBe(true);
  });

  it('keeps rebinds when a new action appears', () => {
    /*
     * A settings file written by an older build knows nothing about actions
     * added since. Throwing it away would lose somebody's rebinds on every
     * update; merging over the defaults means the new action arrives on its
     * fallback and everything else is left alone.
     */
    globalThis.localStorage.setItem(
      'interchange.settings',
      JSON.stringify({ keys: { rotateLeft: 'z' }, largeText: true }),
    );
    const s = loadSettings();
    expect(s.keys.rotateLeft).toBe('z');
    expect(s.keys.photo).toBe('p');
    expect(s.largeText).toBe(true);
    expect(s.dayNight).toBe(true);
  });

  it('survives a corrupt file rather than throwing', () => {
    globalThis.localStorage.setItem('interchange.settings', '{not json');
    expect(loadSettings().keys.rotateLeft).toBe('q');
  });
});

describe('labels', () => {
  it('names the space bar rather than printing nothing', () => {
    expect(keyLabel(' ')).toBe('Space');
    expect(keyLabel('q')).toBe('Q');
    expect(keyLabel('Escape')).toBe('Escape');
  });
});
