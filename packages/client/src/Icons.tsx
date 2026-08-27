/**
 * One pictogram per kind of business.
 *
 * Icons and not text, and that is a hard rule rather than a style. A marker
 * floating over the district has to be readable at about twenty pixels from a
 * moving camera, and at twenty pixels a word is a smudge — you recognise the
 * *shape* of "Builders' merchant" long before you can read it, so the shape is
 * what should be there. It also means the marker never has to grow to fit a
 * long name, which is what would break the eight-control budget: fourteen
 * labels on screen is a wall of text pretending to be a map.
 *
 * Each one is a handful of primitives in a 24-square, drawn in `currentColor`
 * so the marker decides the colour. They are deliberately blunt — a churn, an
 * ear of wheat, a fir tree, a fuel pump — because a detailed icon and a blunt
 * one are the same number of pixels here and only one of them survives.
 */

import type { JSX } from 'react';

/** A milk churn: the dairy farm, and the first thing you ever haul. */
function Churn(): JSX.Element {
  return (
    <>
      <path d="M9 8h6l1 11H8Z" />
      <rect x="8.5" y="5" width="7" height="2.4" rx="0.8" />
      <rect x="10.6" y="3" width="2.8" height="2" rx="0.6" />
    </>
  );
}

/** An ear of wheat. */
function Wheat(): JSX.Element {
  return (
    <>
      <rect x="11.2" y="10" width="1.6" height="10" rx="0.7" />
      <path d="M12 4.4 14.6 7 12 9.6 9.4 7Z" />
      <path d="M12 8.4 14.6 11 12 13.6 9.4 11Z" />
      <path d="M12 12.4 14.6 15 12 17.6 9.4 15Z" />
    </>
  );
}

/** A bottle: the creamery. */
function Bottle(): JSX.Element {
  return (
    <>
      <path d="M10 3h4v3.2l2 3V20H8V9.2l2-3Z" />
      <rect x="8" y="12" width="8" height="1.6" fill="#fff" opacity="0.5" />
    </>
  );
}

/** A silo with a conical cap: the feed mill. */
function Silo(): JSX.Element {
  return (
    <>
      <path d="M12 3 17 7.6H7Z" />
      <rect x="7.6" y="8" width="8.8" height="12" rx="1" />
      <rect x="7.6" y="12" width="8.8" height="1.4" fill="#fff" opacity="0.45" />
    </>
  );
}

/** A worked face with spoil beneath it: the quarry. */
function Quarry(): JSX.Element {
  return (
    <>
      <path d="M3 20h18L16 9l-3 5-2.5-3Z" />
      <path d="M14.5 4.2 20 6.6l-1.2 3-5.5-2.4Z" />
    </>
  );
}

/** A fir: forestry. */
function Fir(): JSX.Element {
  return (
    <>
      <path d="M12 3 16 9H8Z" />
      <path d="M12 7.4 17.4 15H6.6Z" />
      <rect x="10.9" y="15" width="2.2" height="5" rx="0.6" />
    </>
  );
}

/** A blade: the sawmill. */
function Blade(): JSX.Element {
  return (
    <>
      <circle cx="12" cy="12" r="6.6" />
      <circle cx="12" cy="12" r="2.1" fill="#fff" opacity="0.85" />
      <path d="M12 2.2l1.5 2.4h-3ZM21.8 12l-2.4 1.5v-3ZM12 21.8l-1.5-2.4h3ZM2.2 12l2.4-1.5v3Z" />
    </>
  );
}

/** A tilted drum: the concrete plant. */
function Mixer(): JSX.Element {
  return (
    <>
      <path d="M6.4 8.6 17.2 4.8l2.4 6.8-10.8 3.8Z" />
      <rect x="4" y="16.4" width="16" height="3.2" rx="1.2" />
    </>
  );
}

/** A ribbed container: the freight terminal. */
function Container(): JSX.Element {
  return (
    <>
      <rect x="3" y="7.4" width="18" height="9.2" rx="1" />
      <g fill="#fff" opacity="0.42">
        <rect x="6.4" y="9" width="1.3" height="6" />
        <rect x="10" y="9" width="1.3" height="6" />
        <rect x="13.6" y="9" width="1.3" height="6" />
        <rect x="17.2" y="9" width="1.3" height="6" />
      </g>
    </>
  );
}

/** Stacked bricks: the builders' merchant. */
function Bricks(): JSX.Element {
  return (
    <>
      <rect x="4" y="14.6" width="7.4" height="4.4" rx="0.7" />
      <rect x="12.6" y="14.6" width="7.4" height="4.4" rx="0.7" />
      <rect x="8.3" y="9.4" width="7.4" height="4.4" rx="0.7" />
      <rect x="4" y="4.2" width="7.4" height="4.4" rx="0.7" />
      <rect x="12.6" y="4.2" width="7.4" height="4.4" rx="0.7" />
    </>
  );
}

/** A pump: the filling station. */
function Pump(): JSX.Element {
  return (
    <>
      <path d="M6 4h8a1 1 0 0 1 1 1v15H5V5a1 1 0 0 1 1-1Z" />
      <rect x="7" y="6.4" width="5.6" height="4" rx="0.6" fill="#fff" opacity="0.6" />
      <path d="M15 8h2.6a2 2 0 0 1 2 2v6a1.4 1.4 0 0 1-2.8 0v-4.6H15Z" />
    </>
  );
}

/** A beast in a pen: the livestock farm. */
function Beast(): JSX.Element {
  return (
    <>
      <path d="M5.4 9.6h9.8a2.4 2.4 0 0 1 2.4 2.4v2.4H5.4Z" />
      <path d="M17.6 8.4h2.6l0.8 3.6h-3.4Z" />
      <rect x="6.4" y="14.4" width="1.8" height="4.2" rx="0.6" />
      <rect x="13.2" y="14.4" width="1.8" height="4.2" rx="0.6" />
    </>
  );
}

/** A cleaver: the abattoir. */
function Cleaver(): JSX.Element {
  return (
    <>
      <path d="M5 4.6h9.4a1 1 0 0 1 1 1v7.8H5Z" />
      <rect x="15.4" y="11.4" width="4" height="2.2" rx="0.9" />
      <rect x="10.8" y="13.8" width="2.2" height="6" rx="0.9" />
    </>
  );
}

/** A shopfront with an awning: the village shop. */
function Shop(): JSX.Element {
  return (
    <>
      <path d="M3.6 5.6h16.8l-1.4 4H5Z" />
      <rect x="5" y="10.4" width="14" height="9.2" rx="0.8" />
      <rect x="9.6" y="13" width="4.8" height="6.6" rx="0.5" fill="#fff" opacity="0.62" />
    </>
  );
}

/** A lorry: the yard, which is yours. */
function Lorry(): JSX.Element {
  return (
    <>
      <rect x="2.6" y="8" width="10" height="7.4" rx="0.9" />
      <path d="M13.4 10.2h4.2l3.4 3.2v2h-7.6Z" />
      <circle cx="6.6" cy="17" r="2.1" />
      <circle cx="16.6" cy="17" r="2.1" />
    </>
  );
}

/** A pound sign, for a marker whose only news is that there is work going. */
function Work(): JSX.Element {
  return (
    <path d="M14.6 5.4a3.8 3.8 0 0 0-5.9 3.2V11H7.2v1.9h1.5v2.3c0 .9-.3 1.5-1 2v1.4h8.6V17H11c.4-.6.6-1.3.6-2.1v-2h3.1V11h-3.1V8.7a1.9 1.9 0 0 1 3.4-1.2Z" />
  );
}

/** A lane with a track running off it. The road tool. */
function Track(): JSX.Element {
  return (
    <>
      <path d="M3.2 19.4 7.6 4.6h2.1L5.3 19.4Z" />
      <path d="M14.3 4.6h2.1l4.4 14.8h-2.1Z" />
      <rect x="11" y="5" width="2" height="3.4" rx="0.9" opacity="0.55" />
      <rect x="11" y="10.3" width="2" height="3.4" rx="0.9" opacity="0.55" />
      <rect x="11" y="15.6" width="2" height="3.4" rx="0.9" opacity="0.55" />
    </>
  );
}

/** A pick, for taking a track up again. */
function Pick(): JSX.Element {
  return (
    <>
      <path d="M4.4 6.1c3.4-2 8.5-2.2 12.4.6l-1.3 1.7c-3-2.1-7-2-9.8-.4Z" />
      <path d="M10.6 9.9l2.6 1.9-6.1 8.2a1.1 1.1 0 0 1-1.8-1.3Z" />
      <path d="M16.8 6.7l2.7 2-2.2 2.9-2.6-1.9Z" opacity="0.55" />
    </>
  );
}

/**
 * Content id to pictogram.
 *
 * Keyed by the industry's own `id`, so adding an industry to the content and
 * forgetting an icon shows the fallback rather than crashing — and the fallback
 * is a pound sign, which at least says "a business, with work".
 */
/**
 * A brewing copper with its chimney: the brewery.
 *
 * A vessel rather than a bottle, because the creamery is already a bottle and two
 * businesses with the same silhouette in one tray is a tray you have to read
 * rather than glance at.
 */
function Copper(): JSX.Element {
  return (
    <>
      <path d="M6.6 9h10.8l-1.1 10.4a1 1 0 0 1-1 .9H8.7a1 1 0 0 1-1-.9Z" />
      <rect x="5.8" y="7.3" width="12.4" height="1.9" rx="0.9" />
      <rect x="14.6" y="3" width="2.2" height="4.4" rx="0.9" />
      <rect x="8.6" y="12.4" width="6.8" height="1.3" fill="#fff" opacity="0.45" />
    </>
  );
}

/**
 * A shed with a shutter and a loading bay: the distribution centre.
 *
 * The one industry that is nothing but a door. It takes seven cargoes in and
 * makes nothing, so what it looks like is the place lorries back up to.
 */
function Shed(): JSX.Element {
  return (
    <>
      <path d="M2.6 9.4 12 5l9.4 4.4v1.5H2.6Z" />
      <rect x="4.2" y="11.6" width="15.6" height="8.4" rx="1" />
      <rect x="8.4" y="14" width="7.2" height="6" fill="#fff" opacity="0.5" />
      <g fill="#fff" opacity="0.28">
        <rect x="8.4" y="15.6" width="7.2" height="0.9" />
        <rect x="8.4" y="17.6" width="7.2" height="0.9" />
      </g>
    </>
  );
}

const BY_ID: Record<string, () => JSX.Element> = {
  'dairy-farm': Churn,
  'arable-farm': Wheat,
  creamery: Bottle,
  mill: Silo,
  quarry: Quarry,
  forestry: Fir,
  sawmill: Blade,
  'concrete-plant': Mixer,
  terminal: Container,
  'builders-merchant': Bricks,
  'filling-station': Pump,
  'livestock-farm': Beast,
  abattoir: Cleaver,
  'village-shop': Shop,
  brewery: Copper,
  'distribution-centre': Shed,
  yard: Lorry,
  track: Track,
  pick: Pick,
};

/** A plain box. General haulage. */
function BoxBody(): JSX.Element {
  return (
    <>
      <rect x="3" y="7" width="14" height="9" rx="1" />
      <path d="M17.4 9.6h2.2l2.4 2.6v3.8h-4.6Z" />
      <circle cx="7" cy="18" r="1.9" />
      <circle cx="17" cy="18" r="1.9" />
    </>
  );
}

/** A box with a snowflake. Refrigerated. */
function ChilledBody(): JSX.Element {
  return (
    <>
      <rect x="3" y="7" width="14" height="9" rx="1" />
      <path d="M17.4 9.6h2.2l2.4 2.6v3.8h-4.6Z" />
      <circle cx="7" cy="18" r="1.9" />
      <circle cx="17" cy="18" r="1.9" />
      <g fill="#fff" opacity="0.92">
        <rect x="9.3" y="8.6" width="1.4" height="6" rx="0.6" />
        <rect x="7" y="10.9" width="6" height="1.4" rx="0.6" />
      </g>
    </>
  );
}

/** A cylinder on wheels. Liquid. */
function TankerBody(): JSX.Element {
  return (
    <>
      <rect x="2.6" y="8" width="15" height="7.4" rx="3.7" />
      <path d="M17.8 9.8h2l2.2 2.6v3h-4.2Z" />
      <circle cx="7" cy="18" r="1.9" />
      <circle cx="16.6" cy="18" r="1.9" />
    </>
  );
}

/** A tipped skip. Bulk. */
function TipperBody(): JSX.Element {
  return (
    <>
      <path d="M4 14.6 6.6 6.4l11 3-1.6 5.2Z" />
      <rect x="3" y="14.8" width="16.4" height="2.2" rx="0.9" />
      <circle cx="7" cy="18.6" r="1.6" />
      <circle cx="16" cy="18.6" r="1.6" />
    </>
  );
}

const BODY: Record<string, () => JSX.Element> = {
  refrigerated: ChilledBody,
  liquid: TankerBody,
  bulk: TipperBody,
  general: BoxBody,
};

/**
 * The body a cargo needs, drawn.
 *
 * It had been a nine-pixel grey caption under the contract row, which is not
 * "obvious what vehicle type is needed" by any reading. The requirement is the
 * single most consequential thing on the row - it decides whether the job is
 * takeable at all - so it gets a pictogram and a pill of its own.
 */
export function BodyIcon(
  { handling, size = 18 }: { handling: string; size?: number },
): JSX.Element {
  const Glyph = BODY[handling] ?? BoxBody;
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <Glyph />
    </svg>
  );
}

export function Icon({ id, size = 20 }: { id: string; size?: number }): JSX.Element {
  const Glyph = BY_ID[id] ?? Work;
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <Glyph />
    </svg>
  );
}
