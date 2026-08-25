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

A tiny village. Farms all round it. One truck, and just enough money to buy a
second.

That last part is the whole opening: you are not given a fleet, you are given
the *first purchase*, and making it is what starts the loop.

You own the truck and nothing else. Not the farms, not the dairy, not the roads.

## 2. The core loop

**See a contract, take it, run it, get paid, buy another truck.**

Contracts live on the map. As you move around, a place with work going shows a
**pin above it** — a map marker with a contract mark on it. Click the pin and a
floating panel opens over the world showing what the place is and what it is
offering:

> **Marchford Farm**
> Livestock to the abattoir at Aldbridge · 18 tiles
> Needs: a livestock box · Pays: £340 a load · About 2 days a run

Accept it if you have a vehicle free. The truck drives out, loads, drives back,
unloads, and the money arrives. Then you buy the second truck and take the
second contract.

Two places, back and forth. No route editor, no stop lists, no timetables.

**Renting.** When you cannot afford a truck, you can hire one by the week. It
costs more over time and it gets you moving now, which is the right kind of bad
deal to be offered — and it keeps the loop alive at the one moment it could
stall.

## 3. The ladder, thought through to the end

Each rung is one purchase. Each one creates the problem the next one solves.

| | You buy | What you now have | The new problem |
|---|---|---|---|
| 1 | **a truck** | capacity | which contracts are worth taking |
| 2 | **a farm** | *goods of your own* | nobody is buying them yet |
| 3 | **a shop in a town** | *demand of your own* | it wants things your farm does not make |
| 4 | **the rest of the chain** | the whole margin | it only works if the vehicles are in the right places |
| 5 | **more yards** | reach | closer to the city costs far more |
| 6 | **distribution** | consolidation | many small drops, not one big haul |
| 7 | **influence** | permission | the district has to let you build |

### Rung 2 is the real turn, and it is not what I had before

Taking a contract is somebody telling you A to B. **Owning a farm inverts it:
now you have output and nobody has asked for it.** You have to go and find
buyers.

That is the moment the game stops being a job and starts being a business, and
it needs no new systems — a buyer is a place with a requirement, which is a
contract seen from the other end.

### Rung 3, and the chain

A shop has **requirements**: it wants meat *and* vegetables, and it wants them
steadily. Supply it and it pays well, because you are its supplier rather than
its haulier.

Own the farm and the shop and you hold the whole chain — you produce, you carry,
you sell, and every margin in between is yours. Then you buy a second shop, and
the farm cannot feed both.

That is the engine for the rest of the game and none of it is a new mechanic. It
is the same click-a-place-see-what-it-wants interaction all the way up.

### The influence area

**What you can see is what you can work in, and it starts very small.**

At the beginning your influence covers your yard, the lane outside it and a
handful of farms. Beyond that the district fades out — you cannot see it, you
cannot take contracts in it, and you cannot buy anything there. You do not know
the city is over the hill.

Influence grows two ways, and both are things you were doing anyway:

- **Trading.** The more you move, the further your name goes.
- **Owning.** Every place you buy is a beachhead that extends influence around
  *itself*. Buy the shop in the next village and the village and its
  surroundings open up.

That second one is the good part. It turns a purchase into a *foothold* rather
than an income, so "buy the far shop" and "buy the near farm" become genuinely
different decisions — one is cheap and pays, the other is dear and opens the
map.

This one mechanic does four jobs that were previously four mechanics:

| It replaces | Because |
|---|---|
| A land-value gradient stopping you reaching the city | You cannot see the city |
| A tutorial | The only things visible are the things to do next |
| A tech tree | Progress is a place on the map, not a list |
| A minimap and a fog overlay | The world is the map |

And it gives the district a shape it did not have: **the city exists from the
first minute and you cannot see it.** The moment it comes into view is a moment,
and it costs nothing to build because it is the same mechanic arriving somewhere
new.

**Rendered as fade, not as a black shroud.** Beyond the boundary the world
desaturates toward a pale mist and loses its detail. That fits the pastel look,
it never puts a hard line on the ground, and it keeps the district legible as
scenery while making it unusable as territory.

### What each place gives you

Places are not interchangeable, and that is what makes buying one a decision:

| | Gives | Wants | Needs to be served by |
|---|---|---|---|
| Livestock farm | animals | feed | livestock box |
| Dairy farm | milk | feed | tanker, chilled |
| Arable farm | grain, vegetables | — | tipper, flatbed |
| Abattoir | meat | animals | chilled |
| Creamery | dairy goods | milk | chilled |
| Mill | feed, flour | grain | tipper |
| Village shop | — | meat, vegetables, dairy | small box van |
| Town shop | — | everything, steadily | box van |
| Depot | — | everything | artic |

Each row needs a different vehicle, and every vehicle needs a facility at a
yard. That is the whole of rungs 3 to 5 and it comes out of this table rather
than out of a new system.

### Later, and only later

**Vehicle wear.** Trucks get worse. A worn truck on a bad road is slow, and it
breaks down. Which leads to —

**Road quality.** A better road is faster and kinder to the fleet. You cannot
build one, but the district can, and whether it does is —

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
