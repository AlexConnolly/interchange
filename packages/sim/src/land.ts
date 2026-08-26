/**
 * Land you can buy, as a grid of uniform squares.
 *
 * The district already had a notion of owned land and it was the wrong shape for
 * buying. It came *with* a business — the parcel a farm stands in and the ones its
 * tile touches — so it was irregular, implicit, and impossible to point at: field
 * boundaries follow hedges, and a hedge is not a thing you can offer for sale at a
 * price. "They have to be in uniform squares" is therefore not a simplification, it
 * is the requirement: a market in land needs a unit, and the unit has to be one
 * everybody can see the edges of.
 *
 * So there are two ideas of land in the game now and they do different jobs. A
 * *parcel* is a field, which is what the countryside is made of and what the
 * renderer draws hedges around. A *block* is four tiles by four, which is what
 * changes hands. They coexist without interfering because neither is derived from
 * the other.
 *
 * ## Why four
 *
 * A block has to be big enough to put a building on and small enough that buying
 * one is a decision rather than a commitment. Four by four is sixteen tiles: room
 * for a works and its yard with space to spare, about the footprint of the largest
 * thing in the content, and a thousand-odd of them in a district — enough that the
 * map has a market in it and few enough that the whole grid can be walked every
 * frame without thinking about it.
 */

/** Tiles along one edge of a land block. */
export const LAND_BLOCK = 4;

/** Nobody's, and the value stored for unowned land. */
export const NO_OWNER = -1;

/**
 * The land register: who owns which block.
 *
 * One flat array indexed by block, sized from the district. Kept here rather than
 * on the world so that the rules about *what land is* live next to the data, and
 * the world can stay the thing that knows about money and vehicles.
 */
export class LandRegister {
  /** Blocks along one edge of the district. */
  readonly across: number;

  readonly owner: Int16Array;

  constructor(size: number) {
    this.across = Math.ceil(size / LAND_BLOCK);
    this.owner = new Int16Array(this.across * this.across).fill(NO_OWNER);
  }

  /** Which block a tile falls in. */
  blockAt(tile: number, size: number): number {
    const x = tile % size;
    const y = (tile / size) | 0;
    return ((y / LAND_BLOCK) | 0) * this.across + ((x / LAND_BLOCK) | 0);
  }

  /** The tile range a block covers, inclusive. */
  bounds(block: number): { x0: number; y0: number; x1: number; y1: number } {
    const bx = block % this.across;
    const by = (block / this.across) | 0;
    return {
      x0: bx * LAND_BLOCK,
      y0: by * LAND_BLOCK,
      x1: bx * LAND_BLOCK + LAND_BLOCK - 1,
      y1: by * LAND_BLOCK + LAND_BLOCK - 1,
    };
  }

  /** The middle of a block, in tiles, for putting a label on. */
  centre(block: number): { x: number; y: number } {
    const b = this.bounds(block);
    return { x: (b.x0 + b.x1 + 1) / 2, y: (b.y0 + b.y1 + 1) / 2 };
  }

  /** The four blocks orthogonally touching this one. */
  neighbours(block: number): number[] {
    const bx = block % this.across;
    const by = (block / this.across) | 0;
    const out: number[] = [];
    if (bx > 0) out.push(block - 1);
    if (bx + 1 < this.across) out.push(block + 1);
    if (by > 0) out.push(block - this.across);
    if (by + 1 < this.across) out.push(block + this.across);
    return out;
  }
}

/**
 * What a block costs, before anybody has bought anything.
 *
 * Three things move it, and the shape matters more than the figures: land is
 * dearer near a town, dearer with a road on it, and worthless if it is mostly
 * water. Nothing about *what you could build there* enters into it, because the
 * game does not restrict that and a price that pretended to would be a lie.
 *
 * The base is set against the one price the player already knows. A business costs
 * forty to fifty thousand pounds; a block of open country is about three, so a
 * dozen blocks is a business. That is the intended exchange rate — "it should be
 * cheaper to buy a business in most cases, but not buy a massive amount" — and it
 * means land is the patient purchase and a business is the quick one.
 */
export const LAND_BASE = 300_000;

/** Doubles at the town gate. A field beside the market square is not a field. */
export const LAND_TOWN_PREMIUM = 1.9;

/** And half again with a road already on it: you are buying the frontage too. */
export const LAND_ROAD_PREMIUM = 1.5;

/** Beyond this many tiles from any town, land is simply land. */
export const LAND_TOWN_REACH = 34;
