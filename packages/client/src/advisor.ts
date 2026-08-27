/**
 * The advisor: a tutorial that arrives as post.
 *
 * The problem with a tutorial in a game like this is that nothing in it is
 * urgent. There is no level to fail and no boss to be unprepared for, so a modal
 * that stops the world to explain the market is interrupting a player who was
 * enjoying themselves in order to tell them something they would have found out
 * in four minutes. But *not* explaining the planning board means most people never
 * find rung seven at all.
 *
 * An inbox answers both. A letter waits. It has a dot on it until you read it, it
 * does not stop the lorry you were watching, and it is still there in ten minutes
 * when you have run out of things to do and want to know what the parish council
 * is for. The tips are the same tips a tutorial would give; the difference is
 * entirely in who chooses the moment.
 *
 * ## Who it is from
 *
 * Somebody, rather than the game. The first letter is from the man who left you
 * the yard, and every one after it is from a person in the district with a reason
 * to be writing — the parish clerk about the board, the dairy about its milk. A
 * tip signed by a name is a tip you can be pleased to get; the same words in a
 * grey box are homework.
 *
 * ## How the timing works
 *
 * Each letter has a `when` — a predicate over the world — and fires once, the
 * first time that predicate is true. So they arrive *because of what you did*
 * rather than on a schedule: the letter about the market turns up when you first
 * have something to sell, which is the one moment it is worth reading. A letter
 * with `when: () => true` arrives immediately, which is how the opening one works.
 *
 * Firing once and never again is the whole of the state here, and it is a set of
 * ids rather than a count so that adding a letter in the middle of the list cannot
 * shift which ones a saved game thinks it has had.
 */

/** What the advisor needs to be able to ask about the district. */
export interface AdvisorWorld {
  /** Ticks since the world began, for stamping a letter. */
  tick: number;
  /** How many lorries you have on the road. */
  fleet: number;
  /** How many businesses you own. */
  places: number;
  /** How many fields you own. */
  fields: number;
  /** Tonnes you have delivered, all told. */
  delivered: number;
  /** Money in the bank, in pence. */
  cash: number;
  /** Whether the planning board will see you yet. */
  boardOpen: boolean;
  /** Anything of yours cut off from the road network. */
  stranded: boolean;
  /** Anything of yours sitting on stock nobody has collected. */
  holdingStock: boolean;
}

/** A letter in the inbox. */
export interface Letter {
  /** Stable across builds: this is what "already had it" is remembered by. */
  id: string;
  from: string;
  /** Who they are, in a few words. Under the name, never in the body. */
  role: string;
  /** The colour of their portrait, so a sender is recognisable before reading. */
  tint: string;
  subject: string;
  /** Short paragraphs. The panel puts them on their own lines. */
  body: string[];
  /** The tick it arrived, for ordering and for showing when. */
  at: number;
}

interface Tip extends Omit<Letter, 'at'> {
  when: (w: AdvisorWorld) => boolean;
}

/**
 * The post, in the order it was written rather than the order it arrives.
 *
 * Kept as data because that is what makes it *editable* — the whole value of
 * putting a tutorial in letters is that a letter can be rewritten without
 * touching a line of game code, and a list of objects is the shape that stays
 * true. Bodies are short paragraphs on purpose: a letter nobody finishes is worse
 * than no letter.
 */
export const POST: Tip[] = [
  {
    id: 'ashbury-handover',
    from: 'Tom Ashbury',
    role: 'left you the yard',
    tint: '#7f9a68',
    subject: 'The yard is yours',
    body: [
      'Well — it is done, and I am glad it is you. Forty-one years I ran that '
      + 'yard and I never once got the office door to shut properly. You will '
      + 'want a plane on it.',
      'The van has been good to me. She pulls to the left on a wet road and the '
      + 'heater takes a mile to think about it, but she has never let me down and '
      + 'she will not let you down either.',
      'Start with the milk. The farms round here have more of it than they know '
      + 'what to do with and the creamery is always short — that was my first run '
      + 'in 1944 and it is still the one that pays the rent.',
      'I hope the yard and the truck keep you well. Write if you get stuck; I am '
      + 'only up the road at my daughter’s.',
    ],
    when: () => true,
  },
  {
    id: 'ashbury-second-lorry',
    from: 'Tom Ashbury',
    role: 'left you the yard',
    tint: '#7f9a68',
    subject: 'On buying a second one',
    body: [
      'Two lorries is not twice one lorry, and it took me a year to understand '
      + 'why. One lorry is a job. Two is a *business*, because the second one can '
      + 'be somewhere the first one is not.',
      'What that means in practice: do not put them both on the same run. Put the '
      + 'new one where the old one keeps having to drive empty to get to.',
    ],
    when: (w) => w.fleet >= 1 && w.cash > 300_000_00,
  },
  {
    id: 'creamery-buy-a-place',
    from: 'Margaret Vaile',
    role: 'Kirholm creamery',
    tint: '#c08a4a',
    subject: 'A thought, if you will forgive me',
    body: [
      'You have been very reliable with the milk and I wanted to say so.',
      'A thought, and you may tell me to mind my own: hauling for other people '
      + 'pays by the tonne, and *owning* the place at one end of the run pays by '
      + 'the tonne twice. The farms round here come up for sale more often than '
      + 'you would think.',
    ],
    when: (w) => w.delivered >= 40 && w.places === 0,
  },
  {
    id: 'market-standing-stock',
    from: 'Margaret Vaile',
    role: 'Kirholm creamery',
    tint: '#c08a4a',
    subject: 'You are sitting on stock',
    body: [
      'There is produce standing in your yard that nobody has come for, and it '
      + 'will not improve with keeping.',
      'You can sell it at market rather than waiting on a lorry — you will take '
      + 'less than a proper contract pays, but less today beats a fair price for '
      + 'something that has gone off.',
    ],
    when: (w) => w.holdingStock && w.places >= 1,
  },
  {
    id: 'clerk-board',
    from: 'Arthur Penhale',
    role: 'parish clerk',
    tint: '#6a7f9a',
    subject: 'The council would hear you',
    body: [
      'You have four vehicles on the parish roads now, which by our own standing '
      + 'orders makes you a party with an interest. In plain words: we will listen '
      + 'to you.',
      'What that is worth is roads. You cannot build a lane yourself and the '
      + 'parish can, and where it chooses to spend is a matter the council votes '
      + 'on. Fund us, ask to be counted, and propose the widening you actually '
      + 'want. It is slow. It is also the only way the map changes.',
    ],
    when: (w) => w.boardOpen,
  },
  {
    id: 'clerk-land',
    from: 'Arthur Penhale',
    role: 'parish clerk',
    tint: '#6a7f9a',
    subject: 'On buying ground',
    body: [
      'Now that you own land, two things follow that people are forever coming in '
      + 'to ask me about.',
      'You may lay a farm track on your own field, joined to a road — no approval '
      + 'needed, it is your ground. And you may build on it, which is the only way '
      + 'to put a works exactly where you want one rather than where somebody put '
      + 'it in 1890.',
      'What you may *not* do is lay a proper road. That is the council’s, and '
      + 'that is rather the point of the council.',
    ],
    when: (w) => w.fields >= 1,
  },
  {
    id: 'ashbury-stranded',
    from: 'Tom Ashbury',
    role: 'left you the yard',
    tint: '#7f9a68',
    subject: 'Something of yours has no road',
    body: [
      'I drove past one of your places and there is no way in to it. Nothing will '
      + 'run there — no deliveries, no collections, and it makes nothing at all '
      + 'while it stands cut off.',
      'A mud track from the nearest lane will do it. Cheapest thing in the '
      + 'catalogue and it takes a minute.',
    ],
    when: (w) => w.stranded,
  },
];

/**
 * The inbox, as state.
 *
 * Deliberately not a React thing: it is a list and a set of ids, and keeping it
 * out of the component means the tests can run the whole post through a fake
 * district without rendering anything.
 */
export class Advisor {
  readonly letters: Letter[] = [];

  /** Ids already delivered, so nothing arrives twice. */
  private readonly had = new Set<string>();

  /** Ids read, so the dot can go out. */
  private readonly read = new Set<string>();

  /**
   * Ask the post whether anything has arrived, and return only what is new.
   *
   * Returning the new ones rather than the whole list is what lets the caller
   * decide what to do about them — a toast for each, in order — without having to
   * work out for itself which it had already seen.
   */
  check(w: AdvisorWorld): Letter[] {
    const fresh: Letter[] = [];
    for (const tip of POST) {
      if (this.had.has(tip.id)) continue;
      if (!tip.when(w)) continue;
      this.had.add(tip.id);
      const { when, ...rest } = tip;
      void when;
      const letter: Letter = { ...rest, at: w.tick };
      this.letters.push(letter);
      fresh.push(letter);
    }
    return fresh;
  }

  /**
   * Put a letter in by hand.
   *
   * The hook the rest of the game writes through, and the reason the post above is
   * not the only way in: a letter about something that just happened — a purchase,
   * a bad winter — belongs to the code that knows it happened, not to a predicate
   * that has to go looking. Ignored if that id has already been delivered, so
   * calling it twice for the same event is safe.
   */
  post(letter: Letter): boolean {
    if (this.had.has(letter.id)) return false;
    this.had.add(letter.id);
    this.letters.push(letter);
    return true;
  }

  /** How many are still unread, which is the whole of what the dot means. */
  get unread(): number {
    let n = 0;
    for (const l of this.letters) if (!this.read.has(l.id)) n++;
    return n;
  }

  wasRead(id: string): boolean {
    return this.read.has(id);
  }

  markRead(id: string): void {
    this.read.add(id);
  }

  /*
   * There is deliberately no `markAllRead`. It was written, went unused, and is
   * gone — which is the right end for it: the dot means "there is something here
   * you have not seen", and a method that clears it wholesale exists only to make
   * that a lie.
   */
}

/**
 * The one line a toast can show, trimmed.
 *
 * A toast is a *notice*, not a delivery: it says who wrote and roughly what
 * about, and the reading happens in the inbox. So the body is flattened to one
 * line and cut — and cut here rather than by CSS, because `text-overflow` on
 * three paragraphs of markup clips the first paragraph and hides the rest, which
 * looks like a bug rather than like a preview.
 */
export function trim(letter: Letter, most = 78): string {
  const one = letter.body.join(' ').replace(/\s+/g, ' ').trim();
  if (one.length <= most) return one;
  /*
   * Cut at a word, not mid-word. A preview that ends "the creamery is always sho"
   * reads as broken; one that ends "the creamery is always…" reads as a preview.
   */
  const cut = one.slice(0, most);
  const at = cut.lastIndexOf(' ');
  return `${(at > most * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
