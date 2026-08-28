/**
 * What the parish thinks of you: the dial at the top, and the reasons behind it.
 *
 * The dial sits next to the clock because it belongs to the same class of thing —
 * a fact about the world you glance at without being asked, rather than a screen
 * you visit. Approval used to be a screen you visited, and that was the problem
 * with it: a number you had to go and look at is a number you only look at when
 * you already suspect it, and this one now decides what you are allowed to build.
 *
 * ## A face, not a bar
 *
 * A progress bar says "fill me". This is not a thing to be filled — a haulier at a
 * hundred and a haulier at thirty are both playing the game correctly, and the
 * mechanic is about *where* you are welcome rather than about a total. A face is
 * read in one glance, has no implied direction of travel, and is honest about
 * being an opinion.
 *
 * Five of them, and deliberately not more: the difference between 61 and 64 is not
 * a difference a player can act on, and a face that changed every few seconds
 * would draw the eye every few seconds.
 *
 * ## What the number is
 *
 * The population-weighted average across the towns, which is a different figure
 * from the one that gates any particular build. That is not a fudge, it is the
 * point: there is no single approval any more, so the top of the screen shows the
 * parish's general regard and the *placement preview* shows the local one where
 * your cursor is. The panel below closes the gap by naming both.
 */

import { useState, type JSX } from 'react';
import type { World } from '@interchange/sim';
import { COUNTED_AT } from '@interchange/sim';
import { Icon } from './Icons.tsx';
import { mood, mouthPath, type Mood } from './parish.ts';

/**
 * The face itself.
 *
 * Drawn rather than written, and the mouth is the whole of it: the eyes never
 * move, so the only thing changing between states is one curve, which is what
 * makes the five read as one thing in five moods rather than as five icons.
 */
function Face({ face, size = 21 }: { face: Mood; size?: number }): JSX.Element {
  const mouth = mouthPath(face);
  return (
    <svg
      className={`mood mood-${face}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.4" fill="currentColor" opacity="0.16" />
      <circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="9" cy="10" r="1.15" fill="currentColor" />
      <circle cx="15" cy="10" r="1.15" fill="currentColor" />
      <path
        d={mouth}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The dial, for the top bar. */
export function ApprovalDial({
  approval, onClick,
}: {
  approval: number;
  onClick: () => void;
}): JSX.Element {
  const m = mood(approval);
  return (
    <button
      className="mood-dial"
      onClick={onClick}
      data-quiet
      title={`${m.word} — click to see why`}
      aria-label={`Approval ${Math.round(approval)}. ${m.word}.`}
    >
      <Face face={m.face} />
      <span className="mood-num">{Math.round(approval)}</span>
    </button>
  );
}

/**
 * And the panel: what has moved it, and where.
 *
 * Two questions, in the order they are asked. "How do they feel about me" is the
 * overall figure and the towns it is made of — which is where a player finds out
 * that the parish is not one opinion. "Why can't I build there" is the list of
 * your own buildings and what each is doing, which is the half that names things
 * the player put up themselves.
 */
export function Approval({
  world, onGoSite, onClose,
}: {
  world: World;
  onGoSite: (site: number) => void;
  onClose: () => void;
}): JSX.Element {
  const overall = world.approvalOverall();
  const m = mood(overall);
  /** Which town's reasons are open, or -1 for the parish as a whole. */
  const [town, setTown] = useState(-1);

  /*
   * What you have built, which is the direct answer to "what has moved this".
   *
   * First on the panel, ahead of the towns, because it is the list the player has
   * agency over and the only one guaranteed to have anything in it. The towns list
   * led at first and it was the wrong lead: build your first works out by your yard
   * rather than in a village — which is what everybody does, because that is where
   * the land is cheap — and all three towns read the same number as the dial, so
   * the panel opened on three identical rows explaining nothing.
   *
   * Each row is what it does at its own doorstep, which is its full impact: the
   * falloff means the figure anywhere else is smaller, and "what this building is
   * doing" is most honestly answered where the building is.
   */
  const mine: { site: number; name: string; points: number }[] = [];
  for (const src of world.approvalSources()) {
    mine.push({
      site: src.site,
      name: world.content.industries[world.sites.def[src.site]]?.name ?? 'Something of yours',
      points: src.impact,
    });
  }
  mine.sort((a, b) => a.points - b.points);

  const towns: { id: number; name: string; here: number; counted: boolean }[] = [];
  for (let t = 0; t < world.towns.count; t++) {
    const here = world.approvalAt(world.towns.x[t], world.towns.y[t]);
    towns.push({
      id: t,
      name: world.towns.names[t],
      here,
      counted: here >= COUNTED_AT,
    });
  }
  towns.sort((a, b) => a.here - b.here);

  const at = town >= 0 ? towns.find((t) => t.id === town) : undefined;
  const reasons = at
    ? world.approvalReasons(world.towns.x[at.id], world.towns.y[at.id])
    : [];

  if (at) {
    return (
      <div className="bubble fixed">
        <div className="sheet-head">
          <button
            className="x"
            data-quiet
            onClick={() => setTown(-1)}
            aria-label="Back"
          >&lsaquo;</button>
          <div className="grow">
            <div className="sheet-title">{at.name}</div>
            <div className="sheet-sub">{mood(at.here).word.toLowerCase()}</div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="bubble-body slide-in">
          <div className="mood-big">
            <Face face={mood(at.here).face} size={44} />
            <span className="mood-big-num">{Math.round(at.here)}</span>
          </div>
          {/*
            * The reasons, worst first, because the question this panel is open to
            * answer is nearly always "what is stopping me" and the answer to that
            * is the largest negative.
            */}
          <div className="head">What is behind it</div>
          {reasons.map((r, i) => (
            <button
              key={`${r.site}-${i}`}
              className="why-row"
              onClick={() => r.site >= 0 && onGoSite(r.site)}
              disabled={r.site < 0}
            >
              <span className={`why-bar ${r.points >= 0 ? 'up' : 'down'}`} />
              <span className="grow">{r.label}</span>
              <span className={`why-pts ${r.points >= 0 ? 'up' : 'down'}`}>
                {r.points >= 0 ? '+' : ''}{r.points.toFixed(1)}
              </span>
              {r.site >= 0 && <span className="why-go">&rsaquo;</span>}
            </button>
          ))}
          {at.counted && (
            <div className="fact">
              <span className="grow">
                <span className="fact-name">{at.name} counts you as one of their own</span>
                <span className="fact-sub">Your name carries further because of it</span>
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bubble fixed">
      <div className="sheet-head">
        <span className="sheet-icon"><Face face={m.face} size={24} /></span>
        <div className="grow">
          <div className="sheet-title">The parish</div>
          <div className="sheet-sub">{m.word.toLowerCase()}</div>
        </div>
        <button className="x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="bubble-body slide-in">
        <div className="mood-big">
          <Face face={m.face} size={44} />
          <span className="mood-big-num">{Math.round(overall)}</span>
        </div>
        {/*
          * Yours first: what you put up and what each of them does.
          *
          * "Every change you make has an impact on your approval rating" is the
          * rule, so this is the rule made visible — and it is the list a player
          * can do something about. The empty state matters as much as the list:
          * before you have built anything the parish's opinion is entirely your
          * record, and saying so is how a player learns there are two halves.
          */}
        <div className="head">What you have built</div>
        {mine.length === 0 ? (
          <div className="nowt">
            <span className="nowt-head">You have not built anything yet</span>
            <span className="nowt-sub">
              Their opinion is all from the job so far. What you put up will change
              it, near where you put it.
            </span>
          </div>
        ) : mine.map((b) => (
          <button key={b.site} className="why-row" onClick={() => onGoSite(b.site)}>
            <span className={`why-bar ${b.points >= 0 ? 'up' : 'down'}`} />
            <span className="grow">{b.name}</span>
            <span className={`why-pts ${b.points >= 0 ? 'up' : 'down'}`}>
              {b.points >= 0 ? '+' : ''}{b.points}
            </span>
            <span className="why-go">&rsaquo;</span>
          </button>
        ))}

        {/*
          * Then the towns, worst first, and this is the part that teaches the rest
          * of the mechanic.
          *
          * A player who has only ever seen one number does not know that approval
          * is a *place*. Seeing Marchford at 61 and Coombe at 34 on the same list
          * is the whole idea, delivered without a word of instruction — and the
          * one at the bottom is the one they cannot build in.
          */}
        <div className="head">Town by town</div>
        {towns.map((t) => (
          <button key={t.id} className="mood-town" onClick={() => setTown(t.id)}>
            <Face face={mood(t.here).face} size={19} />
            <span className="grow">
              <span className="running-name">{t.name}</span>
              <span className="running-sub">
                {t.counted ? 'counts you as one of their own' : mood(t.here).word.toLowerCase()}
              </span>
            </span>
            <span className="mood-town-num">{Math.round(t.here)}</span>
            <span className="why-go">&rsaquo;</span>
          </button>
        ))}
        <div className="fact">
          <span className="sheet-icon"><Icon id="village-shop" size={18} /></span>
          <span className="grow">
            <span className="fact-name">What moves it</span>
            <span className="fact-sub">
              Running loads into the parish and keeping shelves stocked, everywhere.
              What you build, only near where you build it.
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
