# Interchange

*Working title.* An isometric, browser-based transport and development sim spanning 1860 to 2100.
One continuous region. You start with a single horse dray hauling somebody else's ore, and you
finish shaping what the region's whole economy is.

Freeways' junction craft, wearing Transport Tycoon's clothes, on a simulation core that makes
shared worlds nearly free.

---

## Status

**Specification. No code is to be written until the open decisions in
[`docs/decisions.md`](docs/decisions.md) are closed.**

| | |
|---|---|
| Revision | A |
| Date | 2026-08-24 |
| Phase | Pre-production, spec only |
| Designed spec | https://claude.ai/code/artifact/b0bef335-7ffe-4dac-b2e6-eb26a7b8ab60 |

The artifact above is the same content laid out for reading. These markdown files are the
source of truth and the thing to edit; the artifact gets republished from them when it drifts.

---

## Index

| Document | What's in it |
|---|---|
| [`docs/decisions.md`](docs/decisions.md) | The decision log. Locked decisions with their consequences, and everything still open. **Read this first.** |
| [`docs/design.md`](docs/design.md) | The game: four acts, the signature mechanics, the ownership spine, the economy, eras. |
| [`docs/features.md`](docs/features.md) | Complete feature inventory by system, with phases — and what's explicitly out of scope. |
| [`docs/art-direction.md`](docs/art-direction.md) | What it looks like and what it deliberately does not. **The document to argue with.** |
| [`docs/art-pipeline.md`](docs/art-pipeline.md) | How assets get made, ported from `tribewars/art`. |
| [`docs/architecture.md`](docs/architecture.md) | The deterministic core, threading, traffic model, pathfinding, saves, multiplayer, stack. |
| [`docs/content-and-balance.md`](docs/content-and-balance.md) | Where AI does real work: content into schema, and balance by simulation. |
| [`docs/roadmap.md`](docs/roadmap.md) | Seven phases, each ending in something playable, with exit gates. |
| [`docs/risks.md`](docs/risks.md) | Risk register. |

---

## The one-paragraph version

You are granted **charters** by a regional authority, and each charter is a licence to do a
category of thing you could previously only pay someone else to do. Act I you own vehicles and
nothing else. Act II you may lay road and rail. Act III you may found industry, and discover that
a mine produces nothing until it has power, water and workers — three separate networks you have
to build. Act IV you develop land itself: towns, tourism, ports, airports, the energy transition.
One save carries all the way through, so the awkward river crossing you bodged in 1874 is still
annoying you in 2031.

## The verdict on feasibility

Everything here is known engineering in a 2026 browser. Individually simulated vehicles, a
thousand-tile region, six transport modes, a live economy — none of it is research.

What kills projects in this genre is that **the fun arrives last**. You build terrain, then
rendering, then pathfinding, then economy, then balance, and eighteen months in you finally play
it and find the core loop is flat. So the roadmap has one organising principle: every phase ends
in a game you can actually play. Act I — one region, roads only, a handful of contracts — is a
complete, finishable game. If it isn't fun, we learn that for a fraction of the cost.

The historic reason this genre is expensive is content: hundreds of vehicles across eras, dozens
of industries, thousands of balance numbers, art for all of it. That cost has collapsed — and in
this case it has already collapsed once, because the modelling pipeline in `tribewars/art` is
most of the answer and it already exists.

## The three things that make this cohere

1. **Ownership and access charges** ([`docs/design.md`](docs/design.md) §3) — the spine. Using
   someone else's road costs you money; buying it stops the cost and starts the income. Every
   access cost gives you three live options: **pay, buy, or bypass**. It makes Act I's
   powerlessness meaningful, gives the haulier-to-magnate arc a representation in the income
   statement, gives rivals a fair way to attack you, and is what entangles players in shared
   worlds rather than merely racing them.
2. **The deterministic core** ([`docs/architecture.md`](docs/architecture.md)) — the only choice
   here that cannot be revisited cheaply. Everything else is reversible.
3. **The Junction Lab** ([`docs/design.md`](docs/design.md) §2.1) — tile placement was right for
   six transport modes, but it throws away what made Freeways special. This is where that gets
   put back, deliberately, in one contained place.
