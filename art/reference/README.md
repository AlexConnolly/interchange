# Reference

`TARGET-FRAME.png` is the goal. Do not delete it.

It is the picture the whole project is aimed at, made by `art/target_frame.py`
before any renderer code, and confirmed as the target. Everything the renderer
produces is judged against it by looking at the two side by side.

What it establishes, concretely:

- **Fields, not tiles.** The ground is parcels by recursive subdivision, each
  one crop, with crop rows. Not per-tile biome colour.
- **Hedgerows as geometry** on the parcel boundaries, thin and dark, with gaps
  where a road crosses.
- **Roads that are roads**: verge, cambered surface, worn wheel tracks, dashed
  centre lining.
- **Real directional shadows**, low afternoon sun.
- **A saturated pastel palette under a standard view transform.** Not
  desaturated, not film-emulated. The colours authored are the colours seen.
- **Vehicles about a tile long**, symbolically oversized so they read.
- **Multi-lobe tree canopies**, not spheres on sticks.

If a change makes the game look less like this picture, the change is wrong.
