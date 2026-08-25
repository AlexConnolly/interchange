# Design

A fun, casual game about running a haulage firm in a small, beautiful district,
and slowly ending up owning the place.

The look is settled: [`art/reference/TARGET-FRAME.png`](../art/reference/TARGET-FRAME.png).
That picture is the goal. Everything here serves it.

---

## 0. The two rules

**Simple.** Icons and short text. No spreadsheet. If a screen needs a
paragraph to explain it, it is the wrong screen.

**Beautiful.** Low poly, pastel, real shadows, late afternoon light. It should
feel like doing something in a place you like looking at.

Every feature below is checked against both. The last spec failed because it
was checked against neither — it had 133 features, twenty overlay modes, and
the word "fun" appeared once in two thousand lines. See
[`postmortem.md`](postmortem.md).

---

## 1. Where you start

A small yard with a couple of trucks. Farms around you. A little village.

You do not own the farms, the dairy or the roads. You own two trucks and the
yard they sleep in.

## 2. The core loop, and it is one sentence

**Click a place, take a contract, put a truck on it, get paid.**

- Click a farm. It has **contracts**: *milk to the creamery, 3 collections a
  week, £48 a load.*
- Accept it. Assign a truck.
- The truck drives there and back, through the day, and the money comes in.
- Buy another truck. Take another contract.

That is the whole of the first half hour and there is nothing else in it. Two
spots, back and forth, paid per load. No route editor, no stop list, no
timetable.

**Contracts are the interaction.** The previous spec cut them as "paperwork"
and replaced them with a route editor, which was exactly backwards: a route
editor is a tool, and a contract is *somebody offering you work*, which is a
thing that happens to you and is much more legible.

## 3. The ladder

Each rung is one purchase and one new problem. Nothing unlocks by date.

| | You buy | The new problem |
|---|---|---|
| 1 | **trucks** | which contracts are worth taking |
| 2 | **production** — a dairy, a mill, a quarry | you make your own freight now, and it needs *different vehicles* |
| 3 | **facilities** — a weighbridge, a chiller, a tank bay | this yard cannot handle that vehicle |
| 4 | **more yards** | where they go decides what you can reach |
| 5 | **distribution centres** | consolidation: many small drops instead of one big haul |
| 6 | **influence** | you cannot expand until the district lets you |

The arc in the player's words: *I work for someone, then I start buying the
land.*

### Why buying production is the pivot

Taking contracts is working for other people. Buying the creamery means the
milk contract is now *yours to set*, and it means you need a tanker rather than
a flatbed, and a tanker needs a bay your yard has not got.

That single purchase creates three problems at once, all of them concrete, all
of them solved by another purchase. That is the engine of the whole game and it
needs no new systems to work.

### Facilities, which are the good constraint

A yard is not a spawn point. It has **facilities**, and a vehicle needs the
right one:

| Facility | Needed by |
|---|---|
| Weighbridge | tippers, bulk |
| Chiller | refrigerated |
| Tank bay | tankers |
| Long bay | artics |
| Workshop | keeps the whole fleet running |

So "buy a tanker" fails with *your yard has no tank bay*, and that is a good
failure: it is one sentence, it is obviously true, and the fix is a purchase.

## 4. Influence, and how it stays out of the way

Late on, you want to expand — a bigger yard, a new distribution centre, a road.
The district has to allow it, and whether it does depends on an **approval
rating** you have been affecting all along without being asked to care.

- It goes up when you pay your taxes, keep lorries out of villages, and serve
  places nobody else serves.
- It goes down when you put quarries next to houses and run artics down lanes.

**Nobody looks at this number for the first several hours, and that is the
design.** It sits in the background until the moment it gates something you
want, and then it is suddenly the most interesting thing on screen — and it is
too late to fix quickly, which is what makes it a real constraint rather than a
slider.

This is the "almost the mayor's job" ending, arrived at from the haulage side.

## 5. What is explicitly not in it

**No price negotiation.** The player's own call, and right: haggling adds a
dialogue to every transaction and buys nothing a purchase decision does not
already give.

**No AI rival companies.** With rivals the district changes for reasons that
are not yours, which is fatal to a building game.

**No route editor, no stop lists, no timetables.** A contract is two places.

**No eras.** One time, one visual language, no obsolescence.

**No multiplayer**, and therefore no deterministic-lockstep constraint on every
line of code.

## 6. The screens, and there are five

| Screen | What is on it |
|---|---|
| **The district** | The map. Click anything. |
| **Contracts** | On a place: what work it is offering. Accept, decline. |
| **Yard** | Its trucks, its facilities, what it cannot take and why. |
| **Vehicles** | Buy one. Greyed out with a reason if no yard can take it. |
| **Books** | One page: money in, money out, what you own. |

That is the whole interface. If something does not fit on those five, it is not
in the game yet.

The old build had fifteen buttons in one rail and twenty overlay modes. The cap
here is a number and a breach is a bug: **no more than eight controls visible at
once.**

## 7. Scale, derived from the camera

The old spec picked a tile size and a world size and then discovered what a
lorry looked like. Backwards. Run it the other way:

- A lorry has to read. Call that **40 px**.
- So a tile is 40 px, and a 1920 px frame shows **26 tiles**.
- A lorry is drawn **about one tile long** — generous in metres, correct on
  screen. Every game in this genre draws its vehicles oversized; this one says
  so.
- **A tile has no metric size.** A tile is a fifth of a field. A haul is twenty
  to fifty tiles. There is nothing left to reconcile, which is why there is no
  longer a document apologising for the scale.

| | |
|---|---|
| District | 128 × 128 tiles |
| Field | 5–13 tiles across, by recursive subdivision |
| Settlements | one village, one small town, a hamlet |
| Farms and works | ~12 at the start |
| A haul | 20–50 tiles, under a minute |

## 8. What the world is made of

Straight off the target frame, and this is the renderer's contract:

- **Fields by recursive subdivision**, each one crop, with crop rows. Not
  per-tile biome colour — that reads as camouflage.
- **Hedgerows as geometry** on the parcel boundaries, thin and dark, with gaps
  where a road crosses.
- **Roads with hierarchy**: an A-road spine, lanes, farm tracks. Drawn as verge
  plus cambered surface plus worn wheel tracks plus dashed lining. Few of them,
  each one properly.
- **Real directional shadows** from a low sun.
- **A saturated pastel palette** under a standard view transform.
- **Trees with multi-lobe canopies.**

## 9. Order of work

Look first. The old roadmap put art in phase six of six and by the time it
arrived the mistakes were geometric.

1. **The district, looking like the frame.** Terrain, fields, hedges, roads,
   shadows, one truck driving. No economy at all. If this is not lovely with one
   truck on one road, nothing later saves it.
2. **Contracts.** Click a farm, take the milk run, get paid.
3. **Fleet and yards.** Buy trucks. Facilities gate them.
4. **Buying production.** The pivot.
5. **Distribution centres.**
6. **Influence and the planning board.**

Each step is playable and each step gets deployed so it can be played.
