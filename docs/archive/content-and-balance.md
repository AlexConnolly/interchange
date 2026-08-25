# Content and balance

Where AI does real work. Follows from D11 in [`decisions.md`](decisions.md).

"AI-first" is easy to say and easy to waste. Three places it earns its keep, and one place it
must not go.

---

## 1. Assets

See [`art-pipeline.md`](art-pipeline.md). Summarised: models are Python programs through headless
Blender, reviewed by rendering the exported file and looking at it.

---

## 2. Content into the schema

Industries, vehicle stat lines across eras, contract text, place names, event copy, tutorial
prose — all generated as JSON validated against Zod schemas.

**The schema is a hard contract, so generated content cannot break the engine.** Worst case it is
boring, and boring is caught by review.

```
data/
  cargo/          type, density, perishability, handling class
  industries/     inputs, outputs, rates, requirements, footprint, kit
  vehicles/       era, class, capacity, speed, cost, running cost, model ref
  eras/           dates, unlocks, obsolescence
  contracts/      templates and generation weights
  events/         triggers, effects, copy
  terrain/        biomes, generation parameters
  towns/          growth curves, demand profiles, names
```

Everything above is hot-reloadable in development. Rebalancing is a JSON change, not a rebuild —
which is what makes §3 possible.

Modding falls out of this for free (D9), and is a Phase 3 concern only in the sense that the
schemas need to be stable and documented by then.

---

## 3. Balance by simulation, not intuition

The most valuable of the three, and it falls straight out of the deterministic core.

The simulation runs headless at thousands of times real speed, with AI rivals as players. So:

1. Run thousands of complete games overnight across a parameter sweep.
2. Report which configurations produce a **dominant strategy**, a **dead industry**, a **runaway
   snowball**, or a **difficulty cliff at 1912**.
3. Tune the data. Run again.

Balancing a game this size has historically been years of human play-testing intuition. It
becomes an overnight job that produces evidence.

### What the harness must measure

| Signal | Why |
|---|---|
| Win-rate spread across rival personalities | A single dominant personality means a dominant strategy |
| Cargo utilisation across all types | A cargo nobody moves is dead content |
| Industry survival rates by type and era | Reveals chains that never work |
| Income mix over time | D14's arc should show as operating income giving way to rent. If it doesn't, the ownership economy is mistuned |
| Toll revenue vs bypass rate | Tests the §3.3 self-balancing curve directly |
| Time-to-first-profit and time-to-charter | Difficulty cliffs |
| Wealth Gini across companies | Snowball detection |
| Amenity trajectory | Whether the environment axis is a real choice or an obvious sacrifice |

The last three are the ones specific to this design, and the two that matter most are **toll
revenue vs bypass rate** and **income mix over time**, because they are the only way to tell
whether the ownership spine is actually working before humans play it.

---

## 4. Where AI must not go

**Not inside the simulation.** LLM-driven citizens, companies or advisors would be
non-deterministic and unaffordable per tick, and would have destroyed lockstep, saves, replays
and multiplayer in one stroke.

Rivals are ordinary planning code and will be better for it — a bounded, tunable, testable
opponent is more fun than an unpredictable one.

---

## 5. The fourth place

The build itself. Which is the working arrangement here, and is worth documenting as we go
because D13 makes it part of the product's story.
