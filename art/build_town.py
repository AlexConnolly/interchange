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
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import lib  # noqa: E402
from boxmodel import Form  # noqa: E402

# One world unit is one tile is thirty-two metres, so everything here is a
# small fraction of one. A two-storey terrace is about seven metres to the
# eaves: 0.22 of a tile.
STOREY = 0.105
DEPTH = 0.26

BRICK = (0.54, 0.44, 0.38, 1)
STONE = (0.58, 0.56, 0.51, 1)
RENDER = (0.62, 0.59, 0.52, 1)
SLATE = (0.30, 0.30, 0.33, 1)
TILE_ROOF = (0.42, 0.26, 0.21, 1)
CONCRETE = (0.56, 0.56, 0.55, 1)
GLASS = (0.24, 0.32, 0.38, 1)


def terrace(storeys=2, width=0.30, pitch=0.10, roof=SLATE, wall=BRICK):
    """A terraced house: the workhorse of every era one town.

    Grown rather than stacked. The walls are one continuous surface from the
    ground to the eaves, the roof is pulled out of the top face and pinched to
    a ridge, and the chimney is pulled out of the roof — so the silhouette
    flows instead of being three objects that happen to be touching. That is
    the difference art-pipeline.md 3 means by `boxmodel.py`, and it is visible
    at twenty pixels: a stack reads as a stack because the joints catch the
    light in a straight line all the way round.
    """
    h = STOREY * storeys
    f = Form(size=(width, DEPTH, h), at=(0, 0, h / 2))

    # The roof. Pull the top face up, then squeeze it to a line along the
    # length of the terrace — which is what makes a row of these read as one
    # roof rather than as a row of separate ones.
    top = f.faces(normal='up')
    ridge = f.extrude(top, move=(0, 0, pitch))
    f.scale_faces(ridge, (1.0, 0.02, 1.0))

    # Eaves: the roof oversails the wall a little. A small number that does a
    # lot of work, because the shadow line under it is what separates roof from
    # wall when the sun is high and the shading is flat.
    f.scale_faces(f.faces(normal='up', above=h - 0.001), (1.06, 1.0, 1.0))

    # A chimney on the party wall, pulled out of the roof itself.
    stack = f.face(normal='up', above=h)
    if stack:
        f.extrude(stack, move=(0, 0, 0.055), scale=(0.16, 3.0, 1.0))

    f.bevel(amount=0.004)
    obj = f.build('terrace')
    lib.repaint(obj, [
        (lib.material('wall', wall), lambda c: True),
        (lib.material('roof', roof), lambda c: c.z > h - 0.004),
    ])
    return obj


def villa(storeys=2, width=0.34, roof=TILE_ROOF):
    """Detached, with a hipped roof and a porch. The building a market town
    puts on its good street, and the one that says a town is prospering."""
    h = STOREY * storeys
    f = Form(size=(width, DEPTH * 1.15, h), at=(0, 0, h / 2))

    # Hipped rather than gabled: pulled up and shrunk on both axes, so it
    # slopes on all four sides. That is the single clearest difference between
    # a house on a terrace and a house standing on its own.
    top = f.faces(normal='up')
    cap = f.extrude(top, move=(0, 0, 0.085), scale=(0.34, 0.34, 1.0))
    f.scale_faces(cap, (0.6, 0.6, 1.0))

    # A porch pulled out of the front wall, at the bottom.
    front = f.face(normal='-y', below=STOREY * 0.8)
    if front:
        f.extrude(front, move=(0, -0.05, 0), scale=(0.42, 1.0, 0.5))

    f.bevel(amount=0.004)
    obj = f.build('villa')
    lib.repaint(obj, [
        (lib.material('wall_v', RENDER), lambda c: True),
        (lib.material('roof_v', roof), lambda c: c.z > h - 0.004),
    ])
    return obj


def works_shed(width=0.44, depth=0.36, h=0.14):
    """A shed with a saw-tooth roof. Not an industry — those are their own
    kit — but the thing that fills the edge of an industrial town, and the
    reason an industrial town does not look like a market one."""
    f = Form(size=(width, depth, h), at=(0, 0, h / 2))
    top = f.faces(normal='up')
    # Two bays, each pulled up and sheared to a north light.
    f.cut(axis=1, cuts=1)
    for bay in f.faces(normal='up', above=h - 0.001):
        grown = f.extrude([bay], move=(0, 0, 0.035))
        f.scale_faces(grown, (1.0, 0.45, 1.0))
    f.bevel(amount=0.003)
    obj = f.build('works_shed')
    lib.repaint(obj, [
        (lib.material('wall_s', BRICK), lambda c: True),
        (lib.material('roof_s', SLATE), lambda c: c.z > h - 0.002),
    ])
    return obj


def slab(storeys=6, width=0.30, depth=0.28):
    """The later eras. Flat roofed with a parapet, banded by floor.

    Deliberately plain: art-direction.md 5.2 keeps the saturation for the
    network, and a 1970s block that competes with a railway for attention is a
    block drawn wrong. What it has to do is be visibly *taller* and visibly
    *flatter* than what came before, so the skyline dates itself.
    """
    h = STOREY * storeys
    f = Form(size=(width, depth, h), at=(0, 0, h / 2))
    # A parapet: inset the roof and drop it, so there is a lip round the edge.
    top = f.faces(normal='up')
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
    obj = f.build('slab')
    lib.repaint(obj, [
        (lib.material('wall_c', CONCRETE), lambda c: True),
        (lib.material('glass_c', GLASS),
         lambda c: 0.02 < c.z < h - 0.02 and abs(c.y) > depth * 0.42),
    ])
    return obj


BUILDS = [
    ('town_terrace_2', lambda: terrace(2)),
    ('town_terrace_3', lambda: terrace(3, width=0.26)),
    ('town_terrace_stone', lambda: terrace(2, width=0.32, wall=STONE, roof=SLATE)),
    ('town_villa', lambda: villa(2)),
    ('town_villa_large', lambda: villa(3, width=0.38)),
    ('town_shed', lambda: works_shed()),
    ('town_slab_6', lambda: slab(6)),
    ('town_slab_12', lambda: slab(12, width=0.26)),
]


def main():
    report = []
    for name, build in BUILDS:
        lib.reset()
        obj = build()
        lib.export(name, [obj], report)
    # A building is a fraction of a tile on screen and there can be several
    # hundred in view, so the budget is tight. Three hundred and twenty is the
    # tallest block with its parapet and three floor bands; anything that needs
    # more than that is asking for detail the player cannot see.
    lib.summarise(report, budget=320)


if __name__ == '__main__':
    main()
