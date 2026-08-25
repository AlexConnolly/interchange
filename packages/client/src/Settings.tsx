/**
 * The pause menu, which is also the only settings screen.
 *
 * Two things were being asked for and they turn out to be one thing. The sound
 * had grown a mute button in the corner of the clock, the visual effects needed
 * a way to be turned down on a slower machine, and neither belongs in the
 * playing frame: a control you touch twice a session should not occupy space
 * you look at every second. A pause menu is where those live in every game ever
 * made, and putting them there gets the clock's corner back at the same time.
 *
 * It pauses the simulation, and that is not a detail. A settings screen over a
 * running world means the lorries keep driving while you are reading a label,
 * and a player who opens it to turn the music down has silently lost a delivery.
 * The world stops, the frame keeps drawing — so the district is still there
 * behind the panel, which is the whole reason to blur it rather than cover it.
 */

import { type JSX } from 'react';

/** How much of the look to draw. Mirrors the renderer's own three levels. */
export type Vfx = 'high' | 'low' | 'off';

export interface Options {
  sound: boolean;
  music: number;
  effects: number;
  vfx: Vfx;
}

export const DEFAULTS: Options = {
  sound: true,
  music: 0.42,
  effects: 0.55,
  vfx: 'high',
};

const KEY = 'interchange.options';

/**
 * Read the saved options.
 *
 * Field by field with a fallback each, rather than trusting the shape: this is
 * data from a previous version of the game that is still on the player's disk,
 * and a released build that throws on a stale key is a released build that will
 * not start.
 */
export function loadOptions(): Options {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const got = JSON.parse(raw) as Partial<Options>;
    const vfx: Vfx = got.vfx === 'low' || got.vfx === 'off' ? got.vfx : 'high';
    return {
      sound: typeof got.sound === 'boolean' ? got.sound : DEFAULTS.sound,
      music: typeof got.music === 'number' ? clamp(got.music) : DEFAULTS.music,
      effects: typeof got.effects === 'number' ? clamp(got.effects) : DEFAULTS.effects,
      vfx,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveOptions(o: Options): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    // A private window with storage blocked. The settings still work for this
    // session, which is the part that matters.
  }
}

const clamp = (n: number): number => Math.max(0, Math.min(1, n));

function Row({
  label, hint, children,
}: {
  label: string;
  hint?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="opt-row">
      <div className="opt-label">
        <span>{label}</span>
        {hint !== undefined && <small>{hint}</small>}
      </div>
      {children}
    </div>
  );
}

/**
 * A three-way choice, drawn as three buttons rather than a dropdown.
 *
 * Three options is below the size where a menu earns its extra click, and a
 * segmented control shows what the alternatives *are* without being opened —
 * which for a quality setting is most of the information.
 */
function Choice<T extends string>({
  value, options, onPick,
}: {
  value: T;
  options: { v: T; label: string }[];
  onPick: (v: T) => void;
}): JSX.Element {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.v}
          className={o.v === value ? 'on' : ''}
          onClick={() => onPick(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  value, onChange, disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <input
      className="opt-slider"
      type="range"
      min={0}
      max={100}
      value={Math.round(value * 100)}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.currentTarget.value) / 100)}
    />
  );
}

export function Settings({
  options, onChange, onResume,
}: {
  options: Options;
  onChange: (o: Options) => void;
  onResume: () => void;
}): JSX.Element {
  const set = (patch: Partial<Options>): void => onChange({ ...options, ...patch });

  return (
    <div className="pause-veil" onClick={onResume}>
      {/* Stop a click inside the card from reaching the veil and closing it,
          which is the oldest bug in modal dialogs. */}
      <div className="pause" onClick={(e) => e.stopPropagation()}>
        <div className="pause-head">
          <h2>Paused</h2>
          <span>The district is waiting</span>
        </div>

        <div className="opt-group">
          <h3>Sound</h3>
          <Row label="Sound" hint={options.sound ? 'On' : 'Off'}>
            <Choice
              value={options.sound ? 'on' : 'off'}
              options={[{ v: 'on', label: 'On' }, { v: 'off', label: 'Off' }]}
              onPick={(v) => set({ sound: v === 'on' })}
            />
          </Row>
          <Row label="Music">
            <Slider
              value={options.music}
              disabled={!options.sound}
              onChange={(music) => set({ music })}
            />
          </Row>
          <Row label="Engines and weather">
            <Slider
              value={options.effects}
              disabled={!options.sound}
              onChange={(effects) => set({ effects })}
            />
          </Row>
        </div>

        <div className="opt-group">
          <h3>Picture</h3>
          <Row
            label="Visual effects"
            hint={
              options.vfx === 'high' ? 'Bloom, haze, sun shafts, depth of field'
                : options.vfx === 'low' ? 'Colour and haze only — kinder to older machines'
                  : 'Off — plain, and the fastest'
            }
          >
            <Choice
              value={options.vfx}
              options={[
                { v: 'high', label: 'Full' },
                { v: 'low', label: 'Reduced' },
                { v: 'off', label: 'Off' },
              ]}
              onPick={(vfx) => set({ vfx })}
            />
          </Row>
        </div>

        <button className="pause-resume primary" onClick={onResume}>Resume</button>
        <p className="pause-foot">Esc to close</p>
      </div>
    </div>
  );
}
