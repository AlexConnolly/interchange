# Scale, and the one thing that is deliberately inconsistent

Referenced from `packages/sim/src/constants.ts`. Short, because there is only
one decision here, but it is the sort of decision that looks like a bug to
anybody who finds it later without an explanation.

---

## The units

| Quantity | Unit | Value |
|---|---|---|
| Tile | metres | 32 |
| Height unit | metres | 0.5 |
| Region | tiles | 1024 x 1024, so 32 km square |
| Tick | Hz | 20, fixed, never varies |
| Game day | ticks at 1x | 48 |
| Game month | days | 20 |
| Game year | days | 240, so 11,520 ticks, so 9.6 real minutes at 1x |
| Money | pence | integer throughout; nothing divides by 100 except the formatter |

## The inconsistency

Vehicle speeds are tuned for **legibility** and the calendar is tuned for
**progression**, and the two are not reconciled.

A horse dray covers forty tiles in about nine hundred ticks. That is
forty-five seconds of real time, which is the right length for a round trip
you can watch — long enough to feel like a journey, short enough to stay with.
The same nine hundred ticks is nineteen game days, and a dray does not take
nineteen days to go a mile and a quarter.

There is no setting of the constants that fixes this. Make a day long enough
for the haul to be plausible and Act I takes forty-five real hours. Make the
year short enough for Act I to be an evening and every journey spans a season.

Every game in this genre picks the second and says nothing about it. Transport
Tycoon's day is under two minutes of travel. We pick the second and write it
down.

**The practical consequence:** contract deadlines are quoted in months, not
days, and the UI never puts a speed in km/h next to a duration in days. The two
scales are kept apart in the interface so the player never has the arithmetic
put in front of them.

`displayKph` on a vehicle is flavour. `speed`, in Q16.16 tiles per tick, is the
simulation. They are separate fields on purpose.

## What *is* consistent

Everything else. Distances, areas, gradients, elevation, cargo tonnage, money,
and every rate expressed per day or per year are internally consistent and can
be reasoned about directly.
