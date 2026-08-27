/**
 * The main menu, and the save list that both it and the pause menu use.
 *
 * The game used to begin the instant the page loaded, which is a lovely thing for
 * a demo and impossible once saves exist: there has to be a moment before the
 * world is made where you can choose not to make a new one. So the page opens
 * here.
 *
 * Four items, and one of them does nothing. **Exit** is on the list because a main
 * menu without it reads as a menu that is missing something — and because a
 * browser tab cannot be closed by script unless the script opened it, which is a
 * fact about the platform rather than a decision. It says so when pressed rather
 * than being greyed out, because a disabled button with no explanation is worse
 * than a button that tells you the truth.
 *
 * ## The save list is one component used twice
 *
 * Loading and saving are the same list of the same slots, differing only in what
 * pressing one does — and in that saving offers a "new save" row where loading
 * does not. Writing it twice would have been two places to get the naming wrong.
 */

import { useState, type JSX } from 'react';
import {
  listSaves, deleteSave, ago, type SaveSlot,
} from './saves.ts';

/** The layers of the menu. `null` means the game is running. */
export type MenuPage = 'main' | 'load' | 'settings' | null;

function Item({
  label, sub, on, onClick, disabled,
}: {
  label: string; sub?: string; on?: boolean; onClick: () => void; disabled?: boolean;
}): JSX.Element {
  return (
    <button
      className={`menu-item${on ? ' on' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="menu-label">{label}</span>
      {sub !== undefined && <span className="menu-sub">{sub}</span>}
    </button>
  );
}

/**
 * The slots, with a delete on each.
 *
 * `onPick` does the loading or the overwriting; `newRow` is the "+ New save" line,
 * absent when loading because there is nothing to load into a slot that does not
 * exist yet.
 */
export function SaveList({
  slots, onPick, onDelete, newRow,
}: {
  slots: SaveSlot[];
  onPick: (slot: SaveSlot) => void;
  onDelete: (slot: SaveSlot) => void;
  newRow?: () => void;
}): JSX.Element {
  return (
    <div className="slots">
      {newRow && (
        <button className="slot fresh" onClick={newRow}>
          <span className="slot-name">+ New save</span>
        </button>
      )}
      {slots.length === 0 && !newRow && (
        <div className="nowt">
          <span className="nowt-head">No saved games</span>
          <span className="nowt-sub">
            Start a new one, and save it from the cog when you have somewhere worth
            coming back to.
          </span>
        </div>
      )}
      {slots.map((s) => (
        <div className={`slot-row${s.auto ? ' auto' : ''}`} key={s.id}>
          <button className="slot" onClick={() => onPick(s)}>
            <span className="slot-name">
              {s.name}
              {/* The autosave says so on its face. A player must never mistake it
                  for one of their own and be surprised when it moves. */}
              {s.auto && <em>autosave</em>}
            </span>
            <span className="slot-where">{s.where}</span>
            <span className="slot-when">{ago(s.when)}</span>
          </button>
          <button
            className="slot-bin"
            onClick={() => onDelete(s)}
            aria-label={`Delete ${s.name}`}
            title="Delete this save"
          >&times;</button>
        </div>
      ))}
    </div>
  );
}

export function Menu({
  page, onPage, onNew, onLoad, settings,
}: {
  page: 'main' | 'load' | 'settings';
  onPage: (p: 'main' | 'load' | 'settings') => void;
  onNew: () => void;
  onLoad: (slot: SaveSlot) => void;
  /** The existing options panel, so there is one of it rather than two. */
  settings: JSX.Element;
}): JSX.Element {
  const [slots, setSlots] = useState<SaveSlot[]>(() => listSaves());
  const [said, setSaid] = useState('');

  return (
    <div className="menu">
      {/*
        * The title, and it is the only place in the game the name appears.
        * Deliberately: a heads-up display with a wordmark on it is a wordmark you
        * stop seeing after ten seconds, and this is the one screen with room.
        */}
      <div className="menu-head">
        <h1>Interchange</h1>
        <p>Haulage in an English parish, 1985</p>
      </div>

      {page === 'main' && (
        <div className="menu-list">
          <Item label="New game" sub="A district you have never seen" onClick={onNew} />
          <Item
            label="Load game"
            sub={slots.length === 0 ? 'Nothing saved yet'
              : slots.length === 1 ? '1 saved game' : `${slots.length} saved games`}
            onClick={() => { setSlots(listSaves()); onPage('load'); }}
            disabled={slots.length === 0}
          />
          <Item label="Settings" sub="Sound and detail" onClick={() => onPage('settings')} />
          {/*
            * Exit, which cannot work and says so.
            *
            * `window.close()` is refused for any tab a script did not open — a
            * platform rule, not an oversight — so the honest thing is to be here,
            * be pressable, and explain. Greying it out would leave the player
            * wondering what they had to do first.
            */}
          <Item
            label="Exit"
            sub={said || 'Close the game'}
            onClick={() => setSaid('A browser tab cannot close itself. Use the tab’s ×.')}
          />
        </div>
      )}

      {page === 'load' && (
        <div className="menu-panel">
          <div className="menu-bar">
            <button className="menu-back" onClick={() => onPage('main')}>&lsaquo; Back</button>
            <span className="grow">Load game</span>
          </div>
          <SaveList
            slots={slots}
            onPick={onLoad}
            onDelete={(s) => { deleteSave(s.id); setSlots(listSaves()); }}
          />
        </div>
      )}

      {page === 'settings' && (
        <div className="menu-panel">
          <div className="menu-bar">
            <button className="menu-back" onClick={() => onPage('main')}>&lsaquo; Back</button>
            <span className="grow">Settings</span>
          </div>
          {settings}
        </div>
      )}
    </div>
  );
}
