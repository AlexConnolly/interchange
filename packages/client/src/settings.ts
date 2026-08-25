/**
 * Settings and key bindings. features.md §20, Phase 1.
 *
 * Two things worth stating, because both are decisions rather than defaults.
 *
 * Bindings are *actions to keys*, not keys to actions. The action is the
 * stable thing — "turn the camera left" outlives whatever key does it — so a
 * saved binding is a list of actions and a rebind is one entry changing. The
 * other way round, a saved file is a list of keys and adding an action means
 * migrating everybody's settings.
 *
 * And none of it reaches the simulation. architecture.md's determinism rule 6
 * says no renderer feedback into the sim, and settings are a bigger version of
 * the same hazard: a preference that changed how fast the world ran, or what a
 * rival could see, would be a desync waiting for two players to disagree about
 * their own options. Everything here is presentation and input.
 */

export const ACTIONS = [
  { id: 'rotateLeft', name: 'Turn the camera left', group: 'Camera', fallback: 'q' },
  { id: 'rotateRight', name: 'Turn the camera right', group: 'Camera', fallback: 'e' },
  { id: 'zoomIn', name: 'Zoom in', group: 'Camera', fallback: '=' },
  { id: 'zoomOut', name: 'Zoom out', group: 'Camera', fallback: '-' },
  { id: 'pause', name: 'Pause and resume', group: 'Time', fallback: ' ' },
  { id: 'speed1', name: 'Normal speed', group: 'Time', fallback: '1' },
  { id: 'speed2', name: 'Double speed', group: 'Time', fallback: '2' },
  { id: 'speed3', name: 'Five times', group: 'Time', fallback: '3' },
  { id: 'speed4', name: 'Twenty times', group: 'Time', fallback: '4' },
  { id: 'congestion', name: 'Congestion overlay', group: 'Overlays', fallback: 'c' },
  { id: 'ownership', name: 'Ownership overlay', group: 'Overlays', fallback: 'o' },
  { id: 'cargo', name: 'Cargo flow overlay', group: 'Overlays', fallback: 'f' },
  { id: 'amenity', name: 'Amenity overlay', group: 'Overlays', fallback: 'a' },
  { id: 'photo', name: 'Photo mode', group: 'View', fallback: 'p' },
] as const;

export type ActionId = (typeof ACTIONS)[number]['id'];

export interface Settings {
  /** Action id -> the key that triggers it, lower case. */
  keys: Record<string, string>;
  /** Draw the world at night as well as by day. Some players find the night
   *  cycle handsome and some find it a readability tax; art-direction.md is
   *  clear that it must never be the second, so it can be turned off. */
  dayNight: boolean;
  /** Weather in the render. The simulation still has weather either way —
   *  turning this off changes the picture, never the world. */
  weatherEffects: boolean;
  /** Larger interface text, which is the accessibility request that comes up
   *  more than any other and costs one CSS variable. */
  largeText: boolean;
  /** Stop the camera drifting on middle-drag, for anybody who finds motion
   *  uncomfortable. */
  reduceMotion: boolean;
  /** How much of the region a scroll step covers. */
  zoomStep: number;
}

const KEY = 'interchange.settings';

export function defaultSettings(): Settings {
  const keys: Record<string, string> = {};
  for (const a of ACTIONS) keys[a.id] = a.fallback;
  return {
    keys,
    dayNight: true,
    weatherEffects: true,
    largeText: false,
    reduceMotion: false,
    zoomStep: 1,
  };
}

/**
 * Read what is stored, filling in anything the stored copy does not know
 * about.
 *
 * A settings file written by an older build is missing whatever has been added
 * since, and the wrong response to that is to throw it away — somebody's
 * rebinds should survive an update. Merging over the defaults means a new
 * action arrives on its fallback key and everything else is left alone.
 */
export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return base;
    const stored = JSON.parse(raw) as Partial<Settings>;
    return {
      ...base,
      ...stored,
      keys: { ...base.keys, ...(stored.keys ?? {}) },
    };
  } catch {
    return base;
  }
}

export function saveSettings(s: Settings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s));
  } catch {
    // A player with storage disabled gets settings that last the session,
    // which is better than an error they cannot do anything about.
  }
}

/**
 * Which action, if any, a key press means.
 *
 * Case is folded because a binding is about the key and not about whether
 * shift happened to be down, and the shifted forms of the punctuation keys
 * are treated as the same key for the same reason — somebody who bound zoom
 * to `=` means the key, not the character.
 */
export function actionFor(settings: Settings, key: string): ActionId | null {
  const k = key.length === 1 ? key.toLowerCase() : key;
  const alias = k === '+' ? '=' : k === '_' ? '-' : k;
  for (const a of ACTIONS) {
    const bound = settings.keys[a.id];
    if (bound === alias || bound === k) return a.id;
  }
  return null;
}

/** How a key reads in the interface. */
export function keyLabel(key: string): string {
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

/** Is this key already doing something else? Returns the action it clashes
 *  with, so the interface can say which rather than merely refusing. */
export function conflictFor(settings: Settings, key: string, except: ActionId): ActionId | null {
  for (const a of ACTIONS) {
    if (a.id === except) continue;
    if (settings.keys[a.id] === key) return a.id;
  }
  return null;
}
