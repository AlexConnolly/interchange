# Town buildings. art-direction.md 8, and the first thing anybody complains
# about.
#
#   blender --background --python art/build_town.py
#
# You do not place houses in this game — features.md is explicit that town
# growth is influenced and never authored — so what a town needs from the art
# side is not a set of buildings but a *kit* that a placement rule can deal
# from and get a street out of. Four types, three eras, and enough variation
# within each that fourteen towns do not look like fourteen copies.
#
# The reason this is here rather than in the renderer's TypeScript is the whole
# argument of art-pipeline.md: a model authored as code that nobody ever
# *looks* at goes wrong in ways that are invisible in the source. The first
# version of these buildings was written directly in models.ts as a chamfered
# box with a flat slab on top, and it was reviewed by reading it, and it read
# fine. On screen it was a heap of grey squares. Nothing but a picture was ever
# going to say so.
#
# The second version fixed the shape and not the two things underneath it: its
# own BRICK and RENDER, half a shade darker and a lot greyer than the ones
# every other building in the district draws with, and a wall height authored
# from scratch rather than against the cottage this kit was always going to
# stand beside. `town_terrace_2` came out 108 triangles and 0.365 tile tall —
# `vil_cottage_a`, next to it on the same street, is 252 triangles and 0.759.
# Colour now comes from `palette.py`, the one place both build scripts get
# their brick from, and the shells below are grown from `build_places.py`'s
# own `pitched`, `house`, `windows` and `spill` rather than a second telling of
# what a wall and a lit window are.
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import lib  # noqa: E402
from boxmodel import Form  # noqa: E402
from palette import (  # noqa: E402
    BRICK, STONE, RENDER, SLATE, PANTILE, CONCRETE, GLASS, DARK,
)
import build_places as places  # noqa: E402

# These are dealt one per tile onto a released field, directly beside
# `vil_cottage_a/b/stone` (`App.tsx`'s TOWN_FIRST run), so they use the same
# plan-to-world scale build_places.py gives a village dwelling — PREMISES
# (1.7) * 0.80 — rather than an independently guessed one. Everything below is
# authored in the same "about one tile" plan units a `house()` call uses.
SCALE = 1.36


def terrace(bays=3, bay_w=0.16, d=0.30, wall=0.26,
            wall_mat=BRICK, roof=SLATE, win_rows=1):
    """A row of `bays` dwellings under one roof: the workhorse of every era
    one town.

    Grown from `places.pitched` rather than a parallel wall-and-roof
    implementation, so a terrace is provably built from the same bricks a
    cottage is. What makes it read as a *terrace* and not one house scaled
    wide is the repeat: a chimney, a lit window pair and a door on every bay,
    landing near the party wall the way a real stack does.
    """
    w = bay_w * bays
    rise = wall * 0.80
    parts = places.pitched('twn_tr', w, d, wall, rise, wall_mat, roof, eaves=0.06)
    ridge_z = wall + rise
    for i in range(bays):
        bx = -w / 2 + bay_w * (i + 0.5)
        # Offset toward the party wall rather than centred on the bay, which
        # is what makes `bays` stacks read as one roofline instead of `bays`
        # separate houses that happen to touch.
        sx = bx + bay_w * 0.34
        parts.append(places._paint(
            lib.box('twn_tr_stk%d' % i, (0.040, 0.040, wall * 0.55),
                    loc=(sx, 0, ridge_z)),
            BRICK, 'twn_tr_stkmat'))
        parts += places.moved(
            places.windows('twn_tr_w%d' % i, bay_w * 0.85, d, wall, rows=win_rows),
            bx, 0)
        parts += places.moved(
            places.spill('twn_tr_s%d' % i, bay_w * 0.85, d, wall), bx, 0)
        # A door: the one dark reveal that turns a wall carrying windows into
        # a row of front doors rather than a wall carrying windows.
        parts.append(places._paint(
            lib.box('twn_tr_dr%d' % i, (0.040, 0.018, wall * 0.42),
                    loc=(bx - bay_w * 0.20, -d / 2 - 0.006, wall * 0.21)),
            DARK, 'twn_tr_drmat'))
    return parts


def villa(storeys=2, w=0.46, d=0.40, wall=0.31, body=RENDER, roof=PANTILE):
    """Detached, hipped, with a porch — the terrace's opposite number.

    The hip is the single clearest difference between a house on a terrace
    and a house standing on its own, and nothing in `places.pitched` makes
    one, so the shell stays bespoke. Everything that says somebody lives in
    it — the chimney, the lit windows, the light they throw on the ground —
    is `places`' own, the same parts a cottage is built from.
    """
    f = Form(size=(w, d, wall), at=(0, 0, wall / 2))
    top = f.faces(normal='+z')
    # A small oversailing lip before the hip starts drawing in, so there is a
    # shadow line at the eaves instead of the roof picking up exactly where
    # the wall left off — the same job `pitched`'s `eaves` argument does for
    # everything else in the kit.
    eave = f.extrude(top, move=(0, 0, 0.006), scale=(1.12, 1.12, 1.0))
    rise = wall * 0.42
    cap = f.extrude(eave, move=(0, 0, rise), scale=(0.34, 0.34, 1.0))
    f.scale_faces(cap, (0.6, 0.6, 1.0))
    f.bevel(amount=0.004)
    obj = f.build('twn_vl_body')
    lib.repaint(obj, [
        (lib.material('twn_vl_wall', body), lambda c: True),
        (lib.material('twn_vl_roof', roof), lambda c: c.z > wall - 0.004),
    ])
    ridge_z = wall + rise
    parts = [obj, places._paint(
        lib.box('twn_vl_stk', (0.050, 0.050, wall * 0.62),
                loc=(w * 0.28, 0, ridge_z)),
        BRICK, 'twn_vl_stkmat')]
    # The porch: a proud box in front of the door, in the same idiom as
    # `places.canopy`'s posts and deck, rather than a whole-face extrude on
    # the wall itself — extruding the *entire* front face and shrinking it
    # deletes that face and leaves only the small shrunk stub behind, which
    # opens the whole front of the house into its own hollow interior. That
    # is exactly the fault `side.png` is for: a wall that photographs fine
    # from three angles and is a hole in the fourth.
    parts.append(places._paint(
        lib.box('twn_vl_porch', (w * 0.30, 0.09, wall * 0.46),
                loc=(0, -d / 2 - 0.045, wall * 0.23)),
        body, 'twn_vl_porchmat'))
    parts.append(places._paint(
        lib.box('twn_vl_porchr', (w * 0.34, 0.11, 0.012),
                loc=(0, -d / 2 - 0.045, wall * 0.46 + 0.006)),
        roof, 'twn_vl_porchrmat'))
    parts += places.windows('twn_vl_w', w, d, wall, rows=1 if storeys < 3 else 2)
    parts += places.spill('twn_vl_s', w, d, wall)
    return parts


def works_shed(width=0.62, depth=0.46, wall=0.13, bays=2):
    """A shed with a saw-tooth roof. Not an industry — those are their own
    kit — but the thing that fills the edge of an industrial town, and the
    reason an industrial town does not look like a market one.

    The sawtooth panels are glazed rather than painted the wall colour: a
    shed roof is the one roof in the kit that is partly a window, which is
    where the shop floor gets its daylight from.
    """
    f = Form(size=(width, depth, wall), at=(0, 0, wall / 2))
    f.cut(axis=1, cuts=max(0, bays - 1))
    for bay in f.faces(normal='+z', above=wall - 0.001):
        grown = f.extrude([bay], move=(0, 0, wall * 0.30))
        f.scale_faces(grown, (1.0, 0.46, 1.0))
    f.bevel(amount=0.003)
    obj = f.build('twn_sh_body')
    lib.repaint(obj, [
        (lib.material('twn_sh_wall', BRICK), lambda c: True),
        (lib.material('twn_sh_glaze', GLASS),
         lambda c, n: c.z > wall - 0.01 and n.z < 0.85),
        (lib.material('twn_sh_roof', SLATE),
         lambda c, n: c.z > wall - 0.01 and n.z >= 0.85),
    ])
    parts = [obj]
    for i, sx in enumerate((-1, 1)):
        parts.append(places._paint(
            lib.box('twn_sh_dr%d' % i, (0.10, 0.012, wall * 0.62),
                    loc=(sx * width * 0.22, -depth / 2 - 0.006, wall * 0.31)),
            DARK, 'twn_sh_drmat'))
    return parts


def slab(storeys=6, width=0.30, depth=0.28):
    """The later eras. Flat roofed with a parapet, banded by floor.

    Deliberately plain: art-direction.md 5.2 keeps the saturation for the
    network, and a 1970s block that competes with a railway for attention is a
    block drawn wrong. What it has to do is be visibly *taller* and visibly
    *flatter* than what came before, so the skyline dates itself. Kept on its
    own per-storey unit rather than the cottage-derived scale the rest of the
    kit uses: it is meant to dwarf a terrace, not stand level with one.
    """
    h = 0.105 * storeys
    f = Form(size=(width, depth, h), at=(0, 0, h / 2))
    # A parapet: inset the roof and drop it, so there is a lip round the edge.
    top = f.faces(normal='+z')
    inner = f.inset(top, thickness=0.018)
    f.move(inner, (0, 0, -0.012))
    # Floor bands, which is what gives a plain slab any scale at all — but
    # not one per storey. A twelve-storey block cut eleven times came out at
    # seven hundred and eighty triangles against a budget of two hundred and
    # sixty, and at the size these are drawn the bands are a texture rather
    # than a feature: three reads as "many floors" exactly as well as eleven
    # does, for a fifth of the cost.
    f.cut(axis=2, cuts=3)
    f.bevel(amount=0.003)
    obj = f.build('twn_sl_body')
    lib.repaint(obj, [
        (lib.material('twn_sl_wall', CONCRETE), lambda c: True),
        (lib.material('twn_sl_glass', GLASS),
         lambda c: 0.02 < c.z < h - 0.02 and abs(c.y) > depth * 0.42),
    ])
    return [obj]


BUILDS = [
    ('town_terrace_2', lambda: terrace(), True),
    ('town_terrace_3',
     lambda: terrace(bays=3, bay_w=0.145, wall=0.36, win_rows=2), True),
    ('town_terrace_stone',
     lambda: terrace(bays=3, bay_w=0.165, wall_mat=STONE, roof=SLATE), True),
    ('town_villa', lambda: villa(2), True),
    ('town_villa_large', lambda: villa(3, w=0.56, d=0.46, wall=0.40), True),
    ('town_shed', lambda: works_shed(), False),
    ('town_slab_6', lambda: slab(6), False),
    ('town_slab_12', lambda: slab(12, width=0.26), False),
]


def main():
    report = []
    for name, build, scaled in BUILDS:
        lib.reset()
        parts = build()
        if scaled:
            for o in parts:
                o.scale = (SCALE, SCALE, SCALE)
                o.location = (o.location.x * SCALE, o.location.y * SCALE,
                              o.location.z * SCALE)
        lib.merge_into(name, parts, None)
        lib.export(name, report)
    # 1100 — the same budget `build_places.py` draws a cottage against. These
    # stand on the same street and are judged by the same eye.
    lib.summarise(report, budget=1100)


if __name__ == '__main__':
    main()
