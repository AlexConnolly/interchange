/**
 * The settings panel. features.md §20.
 *
 * Rebinding is the part worth building carefully, because it is the part that
 * is usually built badly. Two rules:
 *
 * A clash is reported, not refused. Telling somebody "that key is taken" and
 * making them go and find what took it is a puzzle they did not ask for; this
 * says *which* action holds it and swaps the two, which is what they meant.
 *
 * And the capture listens for one key and then stops. A rebind mode you have
 * to escape from is a rebind mode that eats the next thing you type.
 */

import { useEffect, useState } from 'react';
import {
  ACTIONS, conflictFor, defaultSettings, keyLabel, loadSettings, saveSettings,
  type ActionId, type Settings as SettingsState,
} from './settings.ts';

/** Tell the rest of the application that bindings have moved. */
function announce(): void {
  window.dispatchEvent(new CustomEvent('interchange:settings'));
}

export function SettingsPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const [settings, setSettings] = useState<SettingsState>(() => loadSettings());
  const [capturing, setCapturing] = useState<ActionId | null>(null);
  const [note, setNote] = useState('');

  const commit = (next: SettingsState): void => {
    setSettings(next);
    saveSettings(next);
    announce();
  };

  useEffect(() => {
    if (capturing === null) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing(null);
        setNote('');
        return;
      }
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const clash = conflictFor(settings, key, capturing);
      const keys = { ...settings.keys, [capturing]: key };
      if (clash) {
        /*
         * Swap rather than refuse. Somebody moving "pause" onto the key that
         * currently zooms almost always wants those two exchanged, and making
         * them hunt for the other one first is a puzzle nobody asked for.
         */
        keys[clash] = settings.keys[capturing];
        setNote(`Swapped with ${ACTIONS.find((a) => a.id === clash)?.name.toLowerCase()}.`);
      } else {
        setNote('');
      }
      commit({ ...settings, keys });
      setCapturing(null);
    };
    // Capture phase, so this sees the press before the world view does and the
    // key being bound does not also turn the camera on its way past.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capturing, settings]);

  useEffect(() => {
    document.documentElement.classList.toggle('large-text', settings.largeText);
    document.documentElement.classList.toggle('reduce-motion', settings.reduceMotion);
  }, [settings.largeText, settings.reduceMotion]);

  const groups = [...new Set(ACTIONS.map((a) => a.group))];

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" style={{ width: 'min(560px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: 0, padding: '10px 14px', borderBottom: '1px solid var(--rule)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1 }}>Settings</span>
          <button className="btn tiny" onClick={onClose}>Close</button>
        </h2>
        <div className="body">
          <div className="ledger"><div className="head">The world</div></div>
          <dl className="kv">
            <dt>Day and night</dt>
            <dd>
              <button className="btn tiny" onClick={() => commit({ ...settings, dayNight: !settings.dayNight })}>
                {settings.dayNight ? 'On' : 'Off'}
              </button>
            </dd>
            <dt>Weather in the picture</dt>
            <dd>
              <button className="btn tiny" onClick={() => commit({ ...settings, weatherEffects: !settings.weatherEffects })}>
                {settings.weatherEffects ? 'On' : 'Off'}
              </button>
            </dd>
            <dt>Larger text</dt>
            <dd>
              <button className="btn tiny" onClick={() => commit({ ...settings, largeText: !settings.largeText })}>
                {settings.largeText ? 'On' : 'Off'}
              </button>
            </dd>
            <dt>Reduce motion</dt>
            <dd>
              <button className="btn tiny" onClick={() => commit({ ...settings, reduceMotion: !settings.reduceMotion })}>
                {settings.reduceMotion ? 'On' : 'Off'}
              </button>
            </dd>
          </dl>
          <div style={{ padding: '0 10px 10px', fontSize: 11.5, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
            None of these reach the simulation. Weather still happens with the
            effects off; you simply stop seeing it. Two people in a shared world
            can hold different settings and still agree about the world.
          </div>

          {groups.map((g) => (
            <div key={g}>
              <div className="ledger"><div className="head">{g}</div></div>
              <dl className="kv">
                {ACTIONS.filter((a) => a.group === g).map((a) => (
                  <div key={a.id} style={{ display: 'contents' }}>
                    <dt>{a.name}</dt>
                    <dd>
                      <button
                        className={`btn tiny ${capturing === a.id ? 'danger' : ''}`}
                        onClick={() => { setNote(''); setCapturing(a.id); }}
                      >
                        {capturing === a.id ? 'Press a key…' : keyLabel(settings.keys[a.id])}
                      </button>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}

          {note && (
            <div style={{ padding: '0 10px 8px', fontSize: 11.5, color: 'var(--warn)' }}>{note}</div>
          )}
          <div className="row">
            <button className="btn tiny" onClick={() => { commit(defaultSettings()); setNote('Back to the defaults.'); }}>
              Reset everything
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
