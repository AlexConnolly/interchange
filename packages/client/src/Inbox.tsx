/**
 * The inbox: a button with a dot on it, a toast, and a page of letters.
 *
 * Three pieces, and each is doing a different job at a different moment.
 *
 * The **button** sits next to the money, because that corner is where the two
 * things you glance at without being asked already live. It carries a dot when
 * something is unread and nothing at all when it is not — a badge with a number on
 * it would be a count of homework.
 *
 * The **toast** slides out of the button when a letter arrives, and is the only
 * part that interrupts. It shows who wrote and one trimmed line, then goes. That
 * is deliberately not enough to act on: the job of a toast is to tell you a thing
 * exists, and a toast you have to read fast is a modal that has learned to hide.
 *
 * The **panel** is where the reading happens, and it is the same list-then-page
 * shape as everything else — the letters, then one letter, with a chevron back.
 *
 * ## Opening the inbox does not read everything
 *
 * A tempting shortcut, and wrong. The dot means "there is something here you have
 * not seen", and clearing it because somebody glanced at the list would make it a
 * lie about the one letter they actually wanted. A letter is read when it has been
 * opened, and only then.
 */

import { useState, type JSX } from 'react';
import { type Advisor, type Letter, trim } from './advisor.ts';

/**
 * A sender, drawn.
 *
 * Head and shoulders on a tinted disc, and the tint is the sender's. No portraits
 * — this game has four named characters and would need a new drawing for the
 * fifth, where a colour and an initial scale to as many as the post ever wants.
 * At twenty pixels a face would be three grey smudges anyway, and what the eye is
 * actually doing here is recognising *which of them* it is, which colour does
 * better than likeness.
 */
function Sender({ from, tint, size = 34 }: {
  from: string; tint: string; size?: number;
}): JSX.Element {
  return (
    <span
      className="who"
      style={{ background: tint, width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="currentColor">
        <circle cx="12" cy="8.4" r="4.1" />
        <path d="M3.6 21.4c0-4.3 3.8-7.2 8.4-7.2s8.4 2.9 8.4 7.2Z" />
      </svg>
      <i>{from.slice(0, 1)}</i>
    </span>
  );
}

/** When a letter came, in the game's own words. */
function when(at: number, now: number, ticksPerDay: number): string {
  const days = Math.floor((now - at) / ticksPerDay);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 24) return `${days} days ago`;
  const months = Math.floor(days / 24);
  return months === 1 ? 'a month ago' : `${months} months ago`;
}

export function InboxButton({
  unread, on, onClick,
}: { unread: number; on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      className={`inbox${on ? ' on' : ''}`}
      onClick={onClick}
      title={unread > 0 ? `${unread} unread` : 'Inbox'}
      aria-label={unread > 0 ? `Inbox, ${unread} unread` : 'Inbox'}
      data-quiet
    >
      {/* A tray with a letter in it. Reads at seventeen pixels, which a
          conventional envelope does not once it has a fold line in it. */}
      <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3.2 13.4h4.1a1 1 0 0 1 1 .8 3.8 3.8 0 0 0 7.4 0 1 1 0 0 1 1-.8h4.1v5.2a1.8 1.8 0 0 1-1.8 1.8H5a1.8 1.8 0 0 1-1.8-1.8Z" />
        <path d="M6.4 4.4h11.2a1.4 1.4 0 0 1 1.35 1l1.85 6.2h-3.6a2.4 2.4 0 0 0-2.3 1.7 2.1 2.1 0 0 1-4.1 0 2.4 2.4 0 0 0-2.3-1.7H5.25l1.8-6.2a1.4 1.4 0 0 1 1.35-1Z" opacity="0.55" />
      </svg>
      {/* A dot, not a number. Whether there is post is the question; how much is
          not, and a numeral turns an inbox into a chore list. */}
      {unread > 0 && <span className="inbox-dot" />}
    </button>
  );
}

/**
 * The notice that slides out of the button.
 *
 * Rendered by the parent so that it can outlive a closed panel, and so the
 * button's own state does not have to know about a queue.
 */
export function Toast({
  letter, onOpen,
}: { letter: Letter; onOpen: () => void }): JSX.Element {
  return (
    <button className="toast" onClick={onOpen}>
      <Sender from={letter.from} tint={letter.tint} size={30} />
      <span className="grow">
        <span className="toast-from">{letter.from}</span>
        {/* One line, cut at a word by `trim`. Not `text-overflow`, which on three
            paragraphs of markup clips the first and hides the rest — which looks
            like a bug rather than like a preview. */}
        <span className="toast-line">{trim(letter, 64)}</span>
      </span>
    </button>
  );
}

export function Inbox({
  advisor, tick, ticksPerDay, onClose,
}: {
  advisor: Advisor;
  tick: number;
  ticksPerDay: number;
  onClose: () => void;
}): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  // Newest first, which is the only order an inbox is ever read in.
  const letters = [...advisor.letters].reverse();
  const showing = open === null ? null : letters.find((l) => l.id === open) ?? null;

  if (showing) {
    return (
      /*
       * `reading` for the extra height. A list is a thing you scan and a letter is
       * a thing you read, and the panel that suits the first is too short for the
       * second — see the note on `.bubble.fixed.reading`.
       */
      <div className="bubble fixed reading">
        <div className="sheet-head">
          <button
            className="x"
            data-quiet
            onClick={() => setOpen(null)}
            aria-label="Back"
          >&lsaquo;</button>
          <Sender from={showing.from} tint={showing.tint} />
          <div className="grow">
            <div className="sheet-title">{showing.from}</div>
            <div className="sheet-sub">
              {showing.role} · {when(showing.at, tick, ticksPerDay)}
            </div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="bubble-body slide-in">
          <div className="letter-subject">{showing.subject}</div>
          {showing.body.map((para, i) => (
            // The index is the key, and legitimately: a letter's paragraphs never
            // reorder, because a letter never changes once it has been delivered.
            // eslint-disable-next-line react/no-array-index-key
            <p className="letter-para" key={i}>{para}</p>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bubble fixed">
      <div className="sheet-head">
        <span className="sheet-icon"><Icon /></span>
        <div className="grow">
          <div className="sheet-title">Inbox</div>
          <div className="sheet-sub">
            {letters.length === 0 ? 'Nothing yet'
              : advisor.unread > 0 ? `${advisor.unread} unread`
                : `${letters.length} ${letters.length === 1 ? 'letter' : 'letters'}`}
          </div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="bubble-body">
        {letters.length === 0 && (
          <div className="nowt">
            <span className="nowt-head">No post</span>
            <span className="nowt-sub">
              People round here will write when they have something to say.
            </span>
          </div>
        )}
        {letters.map((l) => (
          <button
            key={l.id}
            className={`post${advisor.wasRead(l.id) ? '' : ' fresh'}`}
            onClick={() => { advisor.markRead(l.id); setOpen(l.id); }}
          >
            <Sender from={l.from} tint={l.tint} />
            <span className="grow">
              <span className="post-head">
                <span className="post-from">{l.from}</span>
                <span className="post-when">{when(l.at, tick, ticksPerDay)}</span>
              </span>
              <span className="post-subject">{l.subject}</span>
              <span className="post-line">{trim(l, 62)}</span>
            </span>
            {/* A dot per unread letter, the same mark the button carries, so the
                thing you are looking for in the list is the thing that told you to
                come and look. */}
            {!advisor.wasRead(l.id) && <span className="inbox-dot still" />}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The tray again, at panel size. Local because nothing else wants it. */
function Icon(): JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3.2 13.4h4.1a1 1 0 0 1 1 .8 3.8 3.8 0 0 0 7.4 0 1 1 0 0 1 1-.8h4.1v5.2a1.8 1.8 0 0 1-1.8 1.8H5a1.8 1.8 0 0 1-1.8-1.8Z" />
      <path d="M6.4 4.4h11.2a1.4 1.4 0 0 1 1.35 1l1.85 6.2h-3.6a2.4 2.4 0 0 0-2.3 1.7 2.1 2.1 0 0 1-4.1 0 2.4 2.4 0 0 0-2.3-1.7H5.25l1.8-6.2a1.4 1.4 0 0 1 1.35-1Z" opacity="0.55" />
    </svg>
  );
}
