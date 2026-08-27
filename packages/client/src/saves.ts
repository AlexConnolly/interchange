/**
 * Saves, in the browser's own cupboard.
 *
 * `localStorage`, which is not glamorous and is exactly right for this: it is
 * synchronous, it survives a closed tab, and it needs no permission dialog. The
 * limit is about five megabytes for the whole origin and a save of a played
 * district is ninety kilobytes, so a player gets dozens before anything has to be
 * cleverer.
 *
 * ## Auto-named, and why the name is what it is
 *
 * No text box. A save's name is generated from where you were in the game —
 * "Marchford Haulage · Autumn 1985 · £41,200 · 4 lorries" — because that is the
 * information you are actually using when you look down a list of saves. A name
 * you typed three weeks ago tells you what you were thinking then; the season and
 * the money tell you which game this is.
 *
 * It also means saving is one press. "Click cog, save game, bosh."
 *
 * ## The autosave is a slot nothing else can touch
 *
 * One fixed key, overwritten every game-month, never listed among the manual
 * saves for overwriting. A browser tab is easy to close by accident and this game
 * is played in long sittings, so the autosave exists to make that survivable — and
 * a manual save must never be silently replaced by one.
 *
 * ## What goes in besides the world
 *
 * The advisor's memory of which letters have arrived and which have been read. It
 * is client state rather than simulation state, so nothing in `state.ts` knows
 * about it — and without it every load would deliver Tom Ashbury's handover letter
 * again, which is the sort of small wrongness that makes a save feel fake.
 */

import { type SavedState } from '@interchange/sim';

/** Everything in one slot. */
export interface SaveSlot {
  /** The key this lives under, without the prefix. */
  id: string;
  /** Generated, never typed. See the note above. */
  name: string;
  /** Where in the game it was, for the second line of the list. */
  where: string;
  /** Real-world time of saving, for the third. */
  when: number;
  /** The autosave slot is not offered for overwriting. */
  auto: boolean;
  state: SavedState;
  /** Which letters have arrived and which have been read. */
  post: { had: string[]; read: string[] };
}

/** What a save needs to know about the world to name itself. */
export interface SaveFacts {
  company: string;
  year: number;
  /** 0..3 from spring, for the word rather than the month number. */
  season: number;
  cash: number;
  fleet: number;
  places: number;
}

const PREFIX = 'interchange.save.';
export const AUTO_ID = 'auto';

const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];

/** Money, short. The list has no room for pence and nobody reads them. */
function money(pence: number): string {
  const p = Math.round(pence / 100);
  if (Math.abs(p) >= 1_000_000) return `£${(p / 1_000_000).toFixed(1)}m`;
  if (Math.abs(p) >= 10_000) return `£${Math.round(p / 1000)}k`;
  return `£${p.toLocaleString('en-GB')}`;
}

/**
 * The two lines a slot shows.
 *
 * The company on top because it is the one thing that identifies *which game*;
 * the season, the money and the fleet underneath because between them they say
 * how far in you are better than a play time would.
 */
export function describe(f: SaveFacts): { name: string; where: string } {
  const lorries = f.fleet === 1 ? '1 lorry' : `${f.fleet} lorries`;
  const bits = [`${SEASONS[f.season % 4]} ${f.year}`, money(f.cash), lorries];
  if (f.places > 0) bits.push(f.places === 1 ? '1 business' : `${f.places} businesses`);
  return { name: f.company, where: bits.join(' · ') };
}

/** When it was saved, in words. */
export function ago(when: number, now = Date.now()): string {
  const mins = Math.floor((now - when) / 60_000);
  const time = new Date(when).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit',
  });
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const sameDay = new Date(when).toDateString() === new Date(now).toDateString();
  if (sameDay) return `today, ${time}`;
  const yesterday = new Date(now - 86_400_000).toDateString();
  if (new Date(when).toDateString() === yesterday) return `yesterday, ${time}`;
  return new Date(when).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Every save, newest first, with the autosave at the top if it exists.
 *
 * A slot that will not parse is *skipped rather than thrown*, and that is
 * deliberate: one corrupt entry — a save from an older version, a write that was
 * cut off by a closing tab — must not make the whole list unopenable. The player's
 * other six saves are still perfectly good and they should still be able to reach
 * them.
 */
export function listSaves(): SaveSlot[] {
  const out: SaveSlot[] = [];
  let store: Storage;
  try {
    store = window.localStorage;
  } catch {
    // Private browsing with storage blocked. No saves, no crash.
    return out;
  }
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    try {
      const raw = store.getItem(key);
      if (!raw) continue;
      const slot = JSON.parse(raw) as SaveSlot;
      if (!slot || typeof slot !== 'object' || !slot.state) continue;
      out.push({ ...slot, id: key.slice(PREFIX.length) });
    } catch {
      // Unreadable. Leave it where it is rather than deleting somebody's data on
      // a guess about why it did not parse.
      continue;
    }
  }
  out.sort((a, b) => {
    if (a.auto !== b.auto) return a.auto ? -1 : 1;
    return b.when - a.when;
  });
  return out;
}

export interface WriteResult {
  ok: boolean;
  /** Said plainly, because the only likely failure is a full cupboard. */
  reason: string;
}

/**
 * Write a slot.
 *
 * `id` decides whether this is a new save or an overwrite, and the caller chooses
 * — a new one gets a fresh id from the clock, an overwrite reuses the one it is
 * replacing. There is no "are you sure": the list shows what each slot is, and
 * picking one is the confirmation.
 */
export function writeSave(
  id: string, state: SavedState, facts: SaveFacts,
  post: { had: string[]; read: string[] }, auto = false,
): WriteResult {
  const { name, where } = describe(facts);
  const slot: SaveSlot = { id, name, where, when: Date.now(), auto, state, post };
  try {
    window.localStorage.setItem(PREFIX + id, JSON.stringify(slot));
    return { ok: true, reason: '' };
  } catch (err) {
    /*
     * Almost always the quota. Worth saying which, because "could not save" sends
     * a player looking for a bug and "no room left" sends them to delete a save —
     * and the second is the truth nineteen times out of twenty.
     */
    const full = err instanceof DOMException
      && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    return {
      ok: false,
      reason: full
        ? 'No room left for saves. Delete one and try again.'
        : 'The browser would not store it.',
    };
  }
}

export function deleteSave(id: string): void {
  try {
    window.localStorage.removeItem(PREFIX + id);
  } catch { /* nothing to be done, and nothing worth saying */ }
}

/** A fresh id for a new slot. The clock, which is unique enough and sorts. */
export function newId(): string {
  return `s${Date.now().toString(36)}`;
}
