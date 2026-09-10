/**
 * Land you can buy, by the field.
 *
 * This started as a grid of four-by-four squares, on the reasoning that a market
 * needs a unit whose edges everybody can see. The reasoning was right and the unit
 * was wrong: "it should be field based, not random squares — otherwise it's super
 * not right to buy half one field half another." Which is exactly what it did, and
 * the district makes the point better than any argument, because the renderer has
 * been drawing hedges round the fields since long before any of this existed. The
 * edges were already there and already visible; a grid laid over them cut every
 * one of them in half.
 *
 * So the unit is the **parcel** — the thing `fields.ts` divides the district into
 * by recursive subdivision, the thing the hedges enclose, the thing one crop grows
 * in. A field is what a farmer sells and what a hedge encloses, and now it is what
 * changes hands.
 *
 * The one thing the grid had going for it was uniformity, and losing it costs
 * nothing: parcels differ in size, so they differ in price, which is more honest
 * than pretending four acres of hillside is four acres of river meadow.
 */

/** Nobody's, and the value stored for unowned land. */
export const NO_OWNER = -1;

/**
 * What a field is for.
 *
 * Farmland is the default and the only thing a field was until now. `Housing` is
 * land you have released to developers — you keep the title, they put the houses
 * up, and the parish gets bigger. It is deliberately not a *building* the player
 * places: the verb is "release this field", and the moment a player is choosing
 * where each house goes the game has stopped being about haulage.
 */
export const LandUse = {
  Farmland: 0,
  Housing: 1,
} as const;
export type LandUse = (typeof LandUse)[keyof typeof LandUse];

/**
 * How many tiles of a released field one house takes up, and the cap.
 *
 * Four, which at 32 m a tile is a generous plot with a garden and a lane. The cap
 * matters more than the divisor: the renderer draws places out of a fixed pool and
 * a single large field could otherwise fill it on its own.
 */
export const TILES_PER_PLOT = 4;
export const MAX_PLOTS_PER_FIELD = 12;

/**
 * The land register: who owns which field, and where each field is.
 *
 * The tile lists are built once from the parcel map and never change — parcels are
 * a property of the terrain, which is a pure function of the seed. Everything that
 * wants to draw a field, price it or test what stands on it needs its tiles, and
 * walking sixteen thousand tiles to answer that would make every one of those a
 * scan of the whole district.
 */
export class LandRegister {
  readonly owner: Int16Array;

  /**
   * What a field of yours has been given over to. `LandUse`.
   *
   * Three typed arrays rather than one array of objects, and that is a
   * persistence requirement rather than a taste: `state.ts` walks a table's
   * fields and keeps **only typed arrays and scalars**, so anything else here
   * would vanish on save with no error — and the round-trip test covers `World`'s
   * own arrays, not a table's, so it would pass while doing it.
   */
  readonly use: Int8Array;

  /**
   * How many houses the field would take, once released, and how many are up.
   *
   * Fixed at release rather than recomputed, because the answer is a promise: the
   * panel says "nine plots" and the player is entitled to nine of them however
   * the road network changes afterwards.
   */
  readonly plots: Int16Array;
  readonly made: Int16Array;

  /** Tiles making up each parcel. */
  readonly tiles: number[][];

  /** Where to put a label: the middle of the field, in tiles. */
  readonly centres: { x: number; y: number }[];

  constructor(parcelMap: Int32Array, parcelCount: number, size: number) {
    const n = Math.max(1, parcelCount);
    this.owner = new Int16Array(n).fill(NO_OWNER);
    this.use = new Int8Array(n);
    this.plots = new Int16Array(n);
    this.made = new Int16Array(n);
    this.tiles = Array.from({ length: Math.max(1, parcelCount) }, () => [] as number[]);
    for (let t = 0; t < parcelMap.length; t++) {
      const p = parcelMap[t];
      if (p >= 0 && p < parcelCount) this.tiles[p].push(t);
    }
    /*
     * The centroid, not the middle of the bounding box.
     *
     * An enclosure field is rarely a rectangle — it is whatever shape the
     * subdivision left — so the centre of its bounds can easily fall outside it,
     * on the far side of a hedge. A label there points at somebody else's grass.
     */
    this.centres = this.tiles.map((list) => {
      if (list.length === 0) return { x: 0, y: 0 };
      let sx = 0;
      let sy = 0;
      for (const t of list) {
        sx += t % size;
        sy += (t / size) | 0;
      }
      const cx = sx / list.length;
      const cy = sy / list.length;
      /*
       * And then snapped to the tile of the field nearest that point, because a
       * centroid is not necessarily *in* the shape.
       *
       * An enclosure field is whatever the subdivision left, and plenty of them
       * are L-shaped or wrap round a wood — measured, the centroid of the fifth
       * field in the opening district lands on unenclosed ground outside it. A
       * price label there points at somebody else's grass, which is worse than
       * being a tile off centre.
       */
      let best = list[0];
      let bestD = Infinity;
      for (const t of list) {
        const dx = (t % size) - cx;
        const dy = ((t / size) | 0) - cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = t; }
      }
      return { x: (best % size) + 0.5, y: ((best / size) | 0) + 0.5 };
    });
  }

  /** How many tiles this field covers. */
  acres(parcel: number): number {
    return this.tiles[parcel]?.length ?? 0;
  }

  /** Has this field been given over to housing? */
  housing(parcel: number): boolean {
    return this.use[parcel] === LandUse.Housing;
  }
}

/**
 * What a field costs, per tile of it.
 *
 * Priced by the acre rather than by the field, which is the whole reason losing
 * the uniform grid costs nothing: a big field is dearer than a small one for the
 * obvious reason, and the player can see which is which without being told.
 *
 * The figure is set against the one price the player already knows. A business is
 * forty to fifty thousand pounds; a middling field of open country comes out around
 * three, so a dozen fields is a business. Land is the patient purchase.
 */
export const LAND_PER_TILE = 22_000;

/** Doubles at the town gate. A field beside the market square is not a field. */
export const LAND_TOWN_PREMIUM = 1.9;

/** And half again with a road on it: you are buying the frontage too. */
export const LAND_ROAD_PREMIUM = 1.5;

/** Beyond this many tiles from any town, land is simply land. */
export const LAND_TOWN_REACH = 34;
