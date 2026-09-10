# -*- coding: utf-8 -*-
# Every business is a building. design.md 4 and 10.
#
#   blender --background --python art/build_places.py
#
# There was a stretch where the game had fourteen industries the player could
# click, buy and supply, and *nothing on screen for any of them*. The renderer
# had been rebuilt from the ground up against the target frame - terrain,
# fields, hedges, roads, shadows, fleet - and the buildings did not come with
# it. A business you can own and cannot see is not in the game.
#
# Fourteen industries is not fourteen models, in the same way nine vehicles was
# not nine models. It is a vocabulary of ten farm and industrial parts and
# fourteen compositions of them. That is the whole argument for authoring shape
# as a function: a silo is written once, and the creamery, the mill, the feed
# mill and the concrete plant cannot disagree about what a silo looks like.
#
# Footprint: a business sits on about two tiles square, which is two world
# units - twice a lorry's length, so a farm reads as a place a lorry drives
# into rather than as scenery beside it. Nothing here exceeds 1.4 across.
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import lib  # noqa: E402
from boxmodel import Form  # noqa: E402

# Straight off palette.ts BUILT, which is straight off the target frame.
BRICK = (0.639, 0.384, 0.290, 1)
RENDER = (0.812, 0.769, 0.682, 1)
# Oak, banded. A cask is the one container in the district that is neither steel
# nor a box, and the colour is doing that work on its own.
CASK = (0.475, 0.333, 0.208, 1)
SLATE = (0.290, 0.302, 0.333, 1)
# Terracotta pantile, and adding it was not decoration.
#
# The first village went in with slate on everything and read as a cluster of
# grey lumps. From the game's camera - 38 degrees of elevation - a pitched roof
# is most of the pixels of a house, so roof colour is very nearly the only
# colour a building has. A street of slate is a street of nothing.
PANTILE = (0.710, 0.416, 0.290, 1)
PANTILE_PALE = (0.769, 0.541, 0.400, 1)
THATCH = (0.706, 0.596, 0.373, 1)
STEEL = (0.553, 0.573, 0.596, 1)
CONCRETE = (0.702, 0.675, 0.635, 1)
GLASS = (0.373, 0.478, 0.525, 1)
SILO = (0.847, 0.855, 0.871, 1)
TIMBER = (0.478, 0.360, 0.243, 1)
SAWN = (0.741, 0.612, 0.435, 1)
STONE = (0.667, 0.643, 0.596, 1)
GRAVEL = (0.596, 0.573, 0.529, 1)
# The parish's own three, and they are the only greens in this file.
#
# Everything else here is a works, and a works is brick, steel and concrete. A
# green has to read as *not that* from four hundred pixels away, which is a job
# colour does before shape gets a chance.
TURF = (0.400, 0.549, 0.286, 1)
TURF_WORN = (0.510, 0.588, 0.361, 1)
LEAF = (0.243, 0.420, 0.204, 1)
PATH = (0.729, 0.690, 0.596, 1)
RAIL = (0.310, 0.353, 0.322, 1)
DARK = (0.180, 0.180, 0.196, 1)
LEAD = (0.400, 0.412, 0.435, 1)


def _paint(obj, rgba, name, rough=0.75, metal=0.0):
    obj.data.materials.append(lib.material(name, rgba, rough=rough, metal=metal))
    return obj


# Warm, and warmer than you would guess. A window at night is tungsten, which is
# far more orange than daylight, and a lit window painted "pale yellow" reads as
# a hole in the wall rather than as a room with somebody in it.
WINDOW = (1.0, 0.72, 0.34, 1.0)
WINDOW_DIM = (0.26, 0.15, 0.05, 1.0)


def windows(name, w, d, wall, floor=0.0, rows=1, warm=WINDOW):
    """Lit windows on the two long walls.

    Painted with the reserved `lamp` slot, so `glb.ts` pulls them into the
    unlit geometry and the renderer fades them up as it gets dark — exactly the
    machinery the vehicle lamps already use. A building needs no new system to
    light up; it needs its windows to say they are lamps.

    This is most of what a village at night *is*. The district had cat's eyes on
    the roads and lights on the traffic and the houses were black lumps, which
    reads as an evacuation rather than as evening.
    """
    made = []
    lit = lib.material(lib.LAMP + '_win', warm, emissive=2.4, rough=0.3)
    halo = lib.material(lib.LAMP + '_winh', WINDOW_DIM, emissive=1.0, rough=0.4)
    ww = min(0.055, w * 0.16)
    wh = min(0.055, wall * 0.34)
    for r in range(rows):
        z = floor + wall * (0.34 + r * 0.42)
        for sy in (-1, 1):
            for k in (-1, 1):
                x = k * w * 0.24
                o = lib.box('%s_win%d%d%d' % (name, r, sy, k), (ww, 0.014, wh),
                            loc=(x, sy * (d / 2 + 0.004), z))
                o.data.materials.append(lit)
                made.append(o)
                # The spill on the wall round it. Additive and dim, so it reads
                # as light coming out rather than as a bigger window.
                h = lib.box('%s_winh%d%d%d' % (name, r, sy, k),
                            (ww * 2.6, 0.008, wh * 2.6),
                            loc=(x, sy * (d / 2 + 0.001), z))
                h.data.materials.append(halo)
                made.append(h)
    return made


# ------------------------------------------------------------- the vocabulary

def pitched(name, w, d, wall, rise, body, roof, ridge='x', eaves=0.07):
    """Walls with a pitched roof on top. The commonest thing in the district.

    The roof is a second object rather than a taper on the walls, because the
    two want different colours and a glTF material boundary has to be a mesh
    boundary somewhere. It also means the roof can overhang, and the shadow the
    eaves cast on the wall below is most of what stops a cottage reading as a
    painted box.
    """
    made = [_paint(lib.box(name + '_wall', (w, d, wall), loc=(0, 0, wall / 2)),
                   body, name + '_body')]
    rw = w + eaves * 2
    rd = d + eaves * 2
    f = Form(size=(rw, rd, rise), at=(0, 0, wall + rise / 2))
    top = f.faces(normal='up')
    # Collapse the top face along one axis and it is a ridge. Which axis is
    # which way the building faces, and a farmyard wants them not all the same.
    f.scale_faces(top, (0.04, 1.0, 1.0) if ridge == 'y' else (1.0, 0.04, 1.0))
    made.append(_paint(f.build(name + '_roof'), roof, name + '_roofmat'))
    return made


def spill(name, w, d, wall, warm=WINDOW):
    """Light on the ground outside a lit wall.

    Same problem as the vehicle lamps and the same answer: an emissive window is
    a bright shape and not a light source, so the pool it would throw is drawn.
    Three strips of decreasing brightness lying just off each long wall, additive,
    so at night a cottage stands in a patch of its own light.

    It is the single cheapest thing that makes a village read as inhabited rather
    than as a model. Twelve triangles a building.
    """
    made = []
    steps = 5
    for i in range(steps):
        f = i / steps
        g = (i + 1) / steps
        # Cubed rather than squared, and a quarter of the brightness the first
        # attempt used. At 0.50 with a square falloff the pools came out as flat
        # cream rectangles - paving slabs, not light. Additive blending is
        # unforgiving that way: anything approaching the value of the surface it
        # is added to stops reading as glow and starts reading as an object.
        bright = (1 - g) ** 3
        mat = lib.material(lib.LAMP + '_sp%d' % i,
                           # Dimmer again, because eight *real* lights now do the
                           # near work (see the lamp pool in scene.ts) and this
                           # only has to carry the distance. Two things drawing
                           # the same pool of light is how you get a cream slab.
                           (0.19 * bright, 0.13 * bright, 0.055 * bright, 1.0),
                           emissive=1.0, rough=0.6)
        reach = wall * 1.9
        # And it *narrows* going out, where the first version widened. A pool of
        # light from a window is a lozenge with soft ends; a rectangle that grows
        # away from the wall is a driveway.
        for sy in (-1, 1):
            o = lib.box('%s_sp%d%d' % (name, i, sy),
                        (w * (1.05 - 0.55 * ((f + g) / 2)),
                         reach * (g - f) * 2 * 1.34, 0.004),
                        loc=(0, sy * (d / 2 + reach * (f + g) / 2), 0.006))
            o.data.materials.append(mat)
            made.append(o)
    void = warm
    del void
    return made


def house(name, w=0.46, d=0.38, wall=0.26, body=BRICK, roof=SLATE, ridge='x'):
    """A dwelling: pitched, with a chimney.

    The chimney is doing a lot of work for four triangles - it is the one part
    of the silhouette that says lived in rather than stored in.
    """
    made = pitched(name, w, d, wall, wall * 0.80, body, roof, ridge)
    made.append(_paint(
        lib.box(name + '_stack', (0.055, 0.055, 0.18),
                loc=(w * 0.3, 0, wall + wall * 0.80)),
        BRICK, name + '_stackmat'))
    made += windows(name, w, d, wall)
    made += spill(name, w, d, wall)
    return made


def barn(name, w=0.80, d=0.42, wall=0.24, body=TIMBER, roof=STEEL, ridge='x',
         open_end=True):
    """A long shed. Open-ended ones get a dark recess, which reads as a doorway
    a lorry could back into and costs two triangles."""
    made = pitched(name, w, d, wall, wall * 0.55, body, roof, ridge)
    # One pair of windows on a shed rather than the house's two: a barn with a
    # light on has somebody working late in it, and a barn lit like a terrace
    # reads as a hotel.
    made += windows(name, w * 0.7, d, wall * 0.9)
    made += spill(name, w * 0.7, d, wall * 0.7)
    if open_end:
        made.append(_paint(
            lib.box(name + '_mouth', (0.02, d * 0.62, wall * 0.78),
                    loc=(-w / 2 + 0.008, 0, wall * 0.40)),
            DARK, name + '_mouthmat'))
    return made


def silo(name, r=0.10, h=0.52, at=(0, 0), body=SILO):
    """A cylinder with a cone on it.

    The tallest thing on a farm and the only part visible over a hedge, which is
    why the mill and the creamery both get one: at forty pixels a silo is how
    you tell an industry from a house.
    """
    made = [_paint(lib.cyl(name + '_body', r, r, h, loc=(at[0], at[1], h / 2),
                           segments=9), body, name + '_bodymat', rough=0.55)]
    made.append(_paint(
        lib.cyl(name + '_cap', r * 1.04, r * 0.18, r * 0.9,
                loc=(at[0], at[1], h + r * 0.45), segments=9),
        LEAD, name + '_capmat', rough=0.5, metal=0.3))
    return made


def tank(name, r=0.13, h=0.20, at=(0, 0), body=SILO):
    """A squat cylinder on short legs. Milk, water, fuel."""
    made = [_paint(lib.cyl(name + '_body', r, r, h, loc=(at[0], at[1], h / 2 + 0.05),
                           segments=10), body, name + '_bodymat', rough=0.4, metal=0.3)]
    for i, sx in enumerate((-1, 1)):
        made.append(_paint(
            lib.box('%s_leg%d' % (name, i), (0.02, 0.02, 0.06),
                    loc=(at[0] + sx * r * 0.6, at[1], 0.03)),
            LEAD, name + '_legmat'))
    return made


def chimney(name, r=0.035, h=0.60, at=(0, 0)):
    """Tapered, because a straight tube is a pipe and a taper is a chimney."""
    return [_paint(lib.cyl(name, r * 1.5, r, h, loc=(at[0], at[1], h / 2), segments=7),
                   BRICK, name + '_mat')]


def pad(name, w, d, at=(0, 0), body=CONCRETE):
    """Hardstanding.

    Sits a hair above the field so it z-fights with nothing, and it is what
    makes a cluster of separate sheds read as one premises rather than as three
    objects that happen to be near each other.
    """
    return [_paint(lib.box(name, (w, d, 0.012), loc=(at[0], at[1], 0.006)),
                   body, name + '_mat', rough=0.85)]


def heap(name, r=0.16, h=0.14, at=(0, 0), body=GRAVEL):
    """A cone. Aggregate, grain, sand - a stockpile, and the only part of a
    quarry that says what comes out of it."""
    return [_paint(lib.cyl(name, r, r * 0.06, h, loc=(at[0], at[1], h / 2), segments=8),
                   body, name + '_mat', rough=0.95)]


def stack(name, at=(0, 0), rot=0.0, body=SAWN, n=3):
    """Timber, stacked. Three diminishing boxes, which at this size is more
    convincing than any number of individual planks."""
    made = []
    for i in range(n):
        made.append(_paint(
            lib.box('%s_%d' % (name, i),
                    (0.30 - i * 0.03, 0.13 - i * 0.012, 0.05),
                    loc=(at[0], at[1], 0.025 + i * 0.05), rot=(0, 0, rot)),
            body, name + '_mat'))
    return made


def canopy(name, w=0.52, d=0.34, h=0.26):
    """A flat roof on four posts. A filling station, and nothing else looks like
    one."""
    made = [_paint(lib.box(name + '_deck', (w, d, 0.035), loc=(0, 0, h)),
                   RENDER, name + '_deckmat')]
    for i, sx in enumerate((-1, 1)):
        for j, sy in enumerate((-1, 1)):
            made.append(_paint(
                lib.box('%s_post%d%d' % (name, i, j), (0.03, 0.03, h),
                        loc=(sx * w * 0.42, sy * d * 0.36, h / 2)),
                STEEL, name + '_postmat', rough=0.5, metal=0.3))
    return made


def tower(name, w=0.20, h=0.62, at=(0, 0)):
    """A church tower.

    The village needs one landmark or it is a row of houses, and this is the
    cheapest recognisable thing in the whole vocabulary.
    """
    made = [_paint(lib.box(name + '_shaft', (w, w, h), loc=(at[0], at[1], h / 2)),
                   STONE, name + '_mat')]
    made.append(_paint(
        lib.box(name + '_parapet', (w * 1.16, w * 1.16, 0.05),
                loc=(at[0], at[1], h + 0.02)),
        STONE, name + '_parapetmat'))
    return made


def moved(parts, dx, dy, rot=0.0):
    """Place a sub-assembly.

    Authoring each part at the origin and moving the group is what keeps a
    farmyard readable as code: `house` then `barn` then `moved(barn(...), 0.5,
    -0.3)` is a plan of the yard.
    """
    for o in parts:
        if rot:
            x, y = o.location.x, o.location.y
            c, s = math.cos(rot), math.sin(rot)
            o.location.x = x * c - y * s
            o.location.y = x * s + y * c
            o.rotation_euler.z += rot
        o.location.x += dx
        o.location.y += dy
    return parts


# ------------------------------------------------------------ the fourteen
#
# Each of these is a *farmyard plan*, not a model. Read them as "a house here,
# two barns at right angles there, hardstanding between them" - which is what a
# real one is, and why they come out looking like places rather than assets.

def dairy_farm():
    p = pad('dfp', 1.05, 0.90)
    p += moved(house('dfh', body=RENDER, roof=PANTILE), -0.34, 0.22)
    p += moved(barn('dfb1', w=0.62, d=0.34), 0.22, 0.24)
    p += moved(barn('dfb2', w=0.56, d=0.30, ridge='y'), 0.26, -0.22, math.pi / 2)
    p += moved(tank('dft', r=0.10, h=0.17), -0.30, -0.24)
    return p


def arable_farm():
    p = pad('afp', 1.05, 0.90)
    p += moved(house('afh', body=BRICK, roof=PANTILE), -0.34, -0.20)
    p += moved(barn('afb', w=0.74, d=0.40, body=STEEL, roof=STEEL), 0.10, 0.22)
    p += silo('afs', r=0.09, h=0.44, at=(0.40, -0.22))
    return p


def creamery():
    p = pad('crp', 1.20, 1.00)
    p += moved(barn('crs', w=0.86, d=0.50, wall=0.30, body=RENDER, roof=STEEL),
               -0.05, 0.18)
    p += moved(tank('crt1', r=0.11, h=0.22), 0.34, -0.26)
    p += moved(tank('crt2', r=0.11, h=0.22), 0.08, -0.28)
    p += chimney('crc', h=0.50, at=(-0.42, -0.26))
    return p


def mill():
    p = pad('mlp', 1.00, 0.86)
    p += moved(pitched('mlb', 0.44, 0.40, 0.52, 0.15, RENDER, SLATE), -0.20, 0.10)
    p += silo('mls1', r=0.095, h=0.48, at=(0.24, 0.20))
    p += silo('mls2', r=0.095, h=0.42, at=(0.24, -0.06))
    p += moved(barn('mlsh', w=0.48, d=0.28, body=STEEL, roof=STEEL), -0.12, -0.28)
    return p


def quarry():
    p = pad('qup', 1.20, 1.05, body=GRAVEL)
    p += heap('quh1', r=0.19, h=0.17, at=(0.28, 0.24))
    p += heap('quh2', r=0.14, h=0.12, at=(-0.02, -0.28), body=(0.62, 0.58, 0.53, 1))
    p += heap('quh3', r=0.11, h=0.09, at=(0.38, -0.16))
    p += moved(barn('qus', w=0.40, d=0.26, body=STEEL, roof=STEEL), -0.38, 0.18)
    # The conveyor, and it is the one part that says this is a working quarry.
    p += [_paint(lib.box('qucv', (0.42, 0.07, 0.03), loc=(0.02, 0.24, 0.20),
                         rot=(0, -0.42, 0)), LEAD, 'qucv_mat', rough=0.6, metal=0.3)]
    return p


def forestry():
    p = pad('fop', 0.95, 0.80, body=(0.42, 0.38, 0.30, 1))
    p += moved(barn('foh', w=0.34, d=0.26, wall=0.20, body=TIMBER, roof=TIMBER,
                    open_end=False), -0.28, 0.18)
    p += stack('fos1', at=(0.16, 0.18), body=TIMBER)
    p += stack('fos2', at=(0.06, -0.20), rot=0.25, body=TIMBER)
    return p


def sawmill():
    p = pad('swp', 1.15, 0.95)
    p += moved(barn('sws', w=0.78, d=0.44, wall=0.28, body=STEEL, roof=STEEL),
               -0.06, 0.22)
    p += stack('swt1', at=(0.30, -0.24))
    p += stack('swt2', at=(-0.06, -0.26), rot=0.12)
    p += chimney('swc', r=0.028, h=0.40, at=(-0.44, -0.20))
    return p


def concrete_plant():
    p = pad('cpp', 1.05, 0.90)
    p += silo('cps1', r=0.085, h=0.56, at=(-0.12, 0.20))
    p += silo('cps2', r=0.085, h=0.50, at=(0.10, 0.20))
    # The hopper: a tapered box, which is what a batching plant actually is.
    p += [_paint(lib.box('cph', (0.26, 0.24, 0.24), loc=(0.30, -0.10, 0.24),
                         taper=2.6), LEAD, 'cph_mat', rough=0.6, metal=0.25)]
    p += heap('cpa', r=0.15, h=0.12, at=(-0.32, -0.24))
    return p


def terminal():
    p = pad('tep', 1.35, 1.10)
    p += moved(barn('tes1', w=0.92, d=0.42, wall=0.30, body=STEEL, roof=STEEL),
               -0.10, 0.28)
    p += moved(barn('tes2', w=0.72, d=0.34, wall=0.26, body=RENDER, roof=STEEL),
               0.06, -0.14)
    # Containers, stacked. A freight terminal with nothing waiting on it looks
    # closed.
    boxes = [(-0.46, -0.30, 0, (0.58, 0.30, 0.24, 1)),
             (-0.46, -0.30, 1, (0.24, 0.36, 0.48, 1)),
             (-0.16, -0.34, 0, (0.36, 0.44, 0.32, 1))]
    for i, (x, y, lvl, c) in enumerate(boxes):
        p += [_paint(lib.box('tec%d' % i, (0.24, 0.11, 0.10),
                             loc=(x, y, 0.05 + lvl * 0.10)),
                     c, 'tec%d_mat' % i)]
    return p


def builders_merchant():
    p = pad('bmp', 1.10, 0.92)
    p += moved(barn('bms', w=0.58, d=0.36, body=STEEL, roof=STEEL), -0.20, 0.22)
    p += stack('bmt1', at=(0.28, 0.18))
    p += stack('bmt2', at=(0.18, -0.22), rot=math.pi / 2)
    p += [_paint(lib.box('bmb', (0.20, 0.16, 0.09), loc=(-0.28, -0.24, 0.045)),
                 BRICK, 'bmb_mat')]
    return p


def filling_station():
    p = pad('fsp', 1.00, 0.80)
    p += moved(canopy('fsc'), 0.06, 0.10)
    p += moved(house('fss', w=0.32, d=0.26, wall=0.20, body=RENDER, roof=PANTILE), -0.36, -0.20)
    for i, x in enumerate((-0.08, 0.16)):
        p += [_paint(lib.box('fspu%d' % i, (0.07, 0.10, 0.13), loc=(x, 0.10, 0.065)),
                     (0.72, 0.30, 0.26, 1), 'fspump_mat')]
    return p


def livestock_farm():
    p = pad('lfp', 1.10, 0.95)
    p += moved(house('lfh', body=STONE, roof=PANTILE_PALE), -0.34, 0.20)
    p += moved(barn('lfb1', w=0.58, d=0.32, body=TIMBER), 0.22, 0.22)
    p += moved(barn('lfb2', w=0.50, d=0.28, body=TIMBER, ridge='y'), 0.30, -0.20,
               math.pi / 2)
    # Pens. Low rails, and the reason a livestock farm does not read as a dairy.
    for i, y in enumerate((-0.16, -0.30)):
        p += [_paint(lib.box('lfr%d' % i, (0.44, 0.012, 0.055),
                             loc=(-0.20, y, 0.055)), TIMBER, 'lfr_mat')]
    return p


def abattoir():
    p = pad('abp', 1.10, 0.92)
    p += moved(barn('abs', w=0.70, d=0.44, wall=0.32, body=RENDER, roof=STEEL),
               -0.04, 0.20)
    p += chimney('abc', r=0.030, h=0.46, at=(0.40, -0.14))
    p += moved(barn('abd', w=0.40, d=0.26, body=CONCRETE, roof=STEEL), -0.24, -0.26)
    return p


def _tree(name, at=(0, 0), h=0.30, spread=0.13):
    """One tree, as two stacked cones on a stem.

    Not the tree from `build_trees.py`: that one is instanced ten thousand times
    and is budgeted accordingly, where these are a handful inside a model drawn
    once. Two cones read as a crown at this size and one does not - a single cone
    is a Christmas tree, which is the wrong tree for an English green.
    """
    made = [_paint(lib.cyl(name + '_stem', 0.016, 0.014, h * 0.42,
                           loc=(at[0], at[1], h * 0.21), segments=6),
                   TIMBER, name + '_stemmat', rough=0.9)]
    made.append(_paint(
        lib.cyl(name + '_c1', spread, spread * 0.62, h * 0.40,
                loc=(at[0], at[1], h * 0.62), segments=7),
        LEAF, name + '_leafmat', rough=0.95))
    made.append(_paint(
        lib.cyl(name + '_c2', spread * 0.66, spread * 0.10, h * 0.32,
                loc=(at[0], at[1], h * 0.92), segments=7),
        LEAF, name + '_leafmat', rough=0.95))
    return made


def _rails(name, w, d, h=0.075, n=5):
    """Post-and-rail along the two long sides.

    Only two sides. A full enclosure doubles the triangles to draw a fence whose
    far side the camera cannot see, and the near rail is what says "this ground is
    kept" - which is the entire job.
    """
    made = []
    for j, sy in enumerate((-1, 1)):
        made.append(_paint(
            lib.box('%s_r%d' % (name, j), (w, 0.012, 0.012),
                    loc=(0, sy * d * 0.5, h)),
            RAIL, name + '_mat'))
        for i in range(n):
            x = -w * 0.5 + w * (i / float(n - 1))
            made.append(_paint(
                lib.box('%s_p%d%d' % (name, j, i), (0.018, 0.018, h),
                        loc=(x, sy * d * 0.5, h / 2)),
                RAIL, name + '_mat'))
    return made


def village_green():
    """Turf, a path across it, a few trees and a bench.

    The cheapest thing a player can put up and the one they will put up most, so
    it has to read at a glance and cost almost nothing to draw. The path is what
    makes it a green rather than a field: a field is grass nobody crosses.
    """
    p = pad('vgp', 1.05, 0.92, body=TURF)
    # The path, on the diagonal, because a green is crossed corner to corner.
    p += [_paint(lib.box('vgpath', (1.12, 0.10, 0.008), loc=(0, 0, 0.014),
                         rot=(0, 0, math.radians(19))), PATH, 'vgpath_mat', rough=0.9)]
    p += _tree('vgt1', at=(-0.34, 0.26), h=0.34, spread=0.145)
    p += _tree('vgt2', at=(0.32, -0.24), h=0.27, spread=0.115)
    p += _tree('vgt3', at=(0.36, 0.28), h=0.23, spread=0.10)
    # A bench: a seat and two legs, and it is the thing that gives the scale.
    p += [_paint(lib.box('vgb', (0.15, 0.045, 0.014), loc=(-0.14, -0.28, 0.056)),
                 SAWN, 'vgb_mat')]
    for i, x in enumerate((-0.205, -0.075)):
        p += [_paint(lib.box('vgbl%d' % i, (0.016, 0.045, 0.05),
                             loc=(x, -0.28, 0.025)), SAWN, 'vgb_mat')]
    return p


def park():
    """A green with a keeper: railings, a proper walk, a pond and more trees.

    Three tiles where the green is two, and the difference has to be visible or
    the dearer one is a worse deal that only the numbers know about.
    """
    p = pad('pkp', 1.30, 1.14, body=TURF)
    p += [_paint(lib.box('pkwalk', (1.34, 0.13, 0.008), loc=(0, 0.10, 0.014)),
                 PATH, 'pkwalk_mat', rough=0.9)]
    p += [_paint(lib.box('pkwalk2', (0.13, 0.86, 0.008), loc=(-0.22, -0.20, 0.014)),
                 PATH, 'pkwalk_mat', rough=0.9)]
    # The pond. Flat, dark, and the one part of a park that is not green.
    p += [_paint(lib.cyl('pkpond', 0.20, 0.20, 0.010, loc=(0.34, -0.26, 0.014),
                         segments=10), GLASS, 'pkpond_mat', rough=0.25)]
    for i, (x, y, h, sp) in enumerate((
            (-0.46, 0.36, 0.40, 0.17), (-0.10, 0.40, 0.32, 0.14),
            (0.30, 0.34, 0.36, 0.155), (0.50, 0.02, 0.28, 0.12),
            (-0.44, -0.30, 0.34, 0.145))):
        p += _tree('pkt%d' % i, at=(x, y), h=h, spread=sp)
    p += _rails('pkr', 1.30, 1.14, h=0.085, n=7)
    # A shelter, so the park has one built thing in it.
    p += [_paint(lib.box('pksh', (0.20, 0.16, 0.115), loc=(0.06, -0.34, 0.058)),
                 RENDER, 'pksh_mat')]
    p += [_paint(lib.box('pkshr', (0.24, 0.20, 0.022), loc=(0.06, -0.34, 0.126)),
                 PANTILE, 'pkshr_mat')]
    return p


def playing_field():
    """Marked out, with a pavilion. Flat where the others are planted.

    It has to be told apart from the green at a glance and the two are the same
    colour, so the difference is all in the layout: mown stripes, a white line
    round the edge, goals at the ends, and every tree pushed to the boundary.
    """
    p = pad('pfp', 1.30, 1.06, body=TURF)
    # Mown stripes. Pale bands, which is what a cut pitch looks like from above
    # and is two triangles each.
    for i in range(4):
        p += [_paint(lib.box('pfs%d' % i, (1.30, 0.13, 0.006),
                             loc=(0, -0.39 + i * 0.26, 0.013)),
                     TURF_WORN, 'pfs_mat', rough=0.95)]
    # The touchline, as four thin white boxes.
    for i, (w, d, x, y) in enumerate((
            (1.06, 0.016, 0, 0.41), (1.06, 0.016, 0, -0.41),
            (0.016, 0.82, -0.53, 0), (0.016, 0.82, 0.53, 0))):
        p += [_paint(lib.box('pfl%d' % i, (w, d, 0.006), loc=(x, y, 0.017)),
                     SILO, 'pfl_mat', rough=0.9)]
    # Goals, which are the one unmistakable shape on the whole model.
    for i, sx in enumerate((-1, 1)):
        p += [_paint(lib.box('pfgb%d' % i, (0.014, 0.24, 0.014),
                             loc=(sx * 0.53, 0, 0.088)), SILO, 'pfg_mat')]
        for j, sy in enumerate((-1, 1)):
            p += [_paint(lib.box('pfgp%d%d' % (i, j), (0.014, 0.014, 0.088),
                                 loc=(sx * 0.53, sy * 0.12, 0.044)),
                         SILO, 'pfg_mat')]
    # The pavilion, off one corner and outside the lines.
    p += [_paint(lib.box('pfpav', (0.30, 0.18, 0.10), loc=(-0.34, -0.47, 0.05)),
                 TIMBER, 'pfpav_mat')]
    p += [_paint(lib.box('pfpavr', (0.34, 0.22, 0.020), loc=(-0.34, -0.47, 0.109)),
                 STEEL, 'pfpavr_mat')]
    p += _tree('pft1', at=(0.44, 0.46), h=0.26, spread=0.115)
    p += _tree('pft2', at=(-0.50, 0.44), h=0.22, spread=0.10)
    return p


def village_shop():
    p = pad('vsp', 0.80, 0.66)
    p += moved(house('vsh', w=0.42, d=0.34, wall=0.34, body=RENDER, roof=PANTILE),
               -0.06, 0.06)
    # The awning is the shopfront, and at this size it is the whole difference
    # between a shop and a cottage.
    p += [_paint(lib.box('vsa', (0.40, 0.10, 0.02), loc=(-0.06, -0.16, 0.24)),
                 (0.42, 0.30, 0.26, 1), 'vsa_mat')]
    p += [_paint(lib.box('vsw', (0.28, 0.02, 0.12), loc=(-0.06, -0.115, 0.15)),
                 GLASS, 'vsw_mat', rough=0.2)]
    return p


def pub():
    """A pub: the village shop's cousin, not its twin.

    Same footprint, same yard kit, because a pub belongs on the street the shop
    is on. What separates the two silhouettes is the sign board on a post
    rather than an awning over the window — a shop's whole cue is the awning,
    so giving the pub one too would put two identical shapes in one tray. A
    pub also gets a bench outside, because it is a place people stop rather
    than a counter they pass.
    """
    p = pad('pup', 0.80, 0.66)
    p += moved(house('puh', w=0.42, d=0.34, wall=0.34, body=RENDER, roof=SLATE),
               -0.06, 0.06)
    # The sign: a post with a hanging board on a bracket, well clear of the
    # eaves so it silhouettes on its own rather than merging into the wall.
    # Sized against the house — the shop's whole cue is its awning (0.40 wide,
    # a good third of the wall), so the sign board has to be similarly bold or
    # it reads as a fence post, not a pub.
    p += [_paint(lib.box('pupost', (0.025, 0.025, 0.34), loc=(0.36, -0.34, 0.17)),
                 DARK, 'pupost_mat')]
    p += [_paint(lib.box('pubracket', (0.13, 0.018, 0.02), loc=(0.29, -0.34, 0.325)),
                 DARK, 'pubracket_mat')]
    # The board itself: bigger again — this was still bench-sized and lost the
    # fight with the bench and the wall at the game's real render size. Nearly
    # doubled in area and pushed further off the wall on its own bracket so its
    # shadow falls clear of the building mass instead of pooling into it, and
    # painted a warm gold (WINDOW) rather than CASK — CASK's value sits too
    # close to both the dark post and the pale wall at a few pixels across;
    # WINDOW reads as a hot, high-contrast shape against both.
    p += [_paint(lib.box('pusign', (0.26, 0.022, 0.20), loc=(0.22, -0.34, 0.225)),
                 WINDOW, 'pusign_mat')]
    # A dark surround, sized strictly smaller than the board on every side, so
    # it reads as a border rather than occluding it.
    p += [_paint(lib.box('pusignframe', (0.30, 0.014, 0.24), loc=(0.22, -0.334, 0.225)),
                 DARK, 'pusignframe_mat')]
    # A bench outside, big enough to survive at the game's real size: a seat,
    # a backrest and legs, standing clear of the wall rather than a slab lost
    # against it.
    p += [_paint(lib.box('pubenchseat', (0.26, 0.09, 0.03), loc=(-0.18, -0.28, 0.09)),
                 TIMBER, 'pubench_mat')]
    p += [_paint(lib.box('pubenchback', (0.26, 0.025, 0.10), loc=(-0.18, -0.315, 0.145)),
                 TIMBER, 'pubenchback_mat')]
    for lx in (-0.28, -0.08):
        p += [_paint(lib.box('pubenchleg%.2f' % lx, (0.025, 0.09, 0.09),
                             loc=(lx, -0.28, 0.045)), DARK, 'pubenchleg_mat')]
    return p


def distribution_centre():
    """A big shed and a lot of hardstanding. design.md 4.

    The only building in the set whose *scale* is the point. A depot exists to
    break bulk - an artic brings twenty-four tonnes in and three vans take it
    out - so it has to look like somewhere an artic turns round in, which means
    a footprint half again on anything else and a shed long enough to read as a
    shed rather than as a barn.

    Loading doors along the flank, which is the one detail that says what it is
    for. A farm building has one door at the end; a distribution centre has
    twelve down the side, and at forty pixels that row of dark marks is the
    whole silhouette.
    """
    p = pad('dcp', 1.55, 1.25)
    p += moved(barn('dcs', w=1.15, d=0.58, wall=0.36, body=STEEL, roof=STEEL,
                    open_end=False), -0.02, 0.26)
    # The doors. Twelve marks along the near flank.
    for i in range(12):
        x = -0.54 + i * 0.098
        p += [_paint(lib.box('dcd%d' % i, (0.055, 0.02, 0.19),
                             loc=(x, 0.26 - 0.30, 0.10)), DARK, 'dcd_mat')]
    p += moved(house('dco', w=0.28, d=0.24, wall=0.20, body=BRICK, roof=PANTILE),
               -0.62, -0.36)
    # A trailer standing in the yard, because a depot with nothing waiting on it
    # looks shut.
    p += [_paint(lib.box('dct', (0.46, 0.14, 0.16), loc=(0.24, -0.38, 0.10)),
                 (0.88, 0.90, 0.92, 1), 'dct_mat')]
    return p


def yard():
    """A yard is a business with no inputs and no outputs - design.md 4 - so it
    gets a building like any other: hardstanding, an office and a workshop."""
    p = pad('ydp', 1.15, 1.00)
    p += moved(house('ydo', w=0.30, d=0.26, wall=0.22, body=BRICK, roof=PANTILE), -0.38, 0.24)
    p += moved(barn('ydw', w=0.62, d=0.38, body=STEEL, roof=STEEL), 0.12, 0.24)
    return p


# --------------------------------------------------------------- the village
#
# Housing, which is not a business and is drawn anyway: a village of nothing but
# the one shop you can buy is not a village, and the target frame has a street
# of cottages in it.

def cottage(body, roof, ridge='x', w=0.40, d=0.32):
    return house('cot', w=w, d=d, wall=0.26, body=body, roof=roof, ridge=ridge)


def church():
    return tower('vch') + moved(
        pitched('vcn', 0.46, 0.26, 0.24, 0.14, STONE, SLATE), 0.34, 0.0)


def brewery():
    """A country brewery, and it is a *tower*.

    Every other works in the district is wider than it is tall. A brewery is the
    exception and always was: brewing runs downhill, so the malt goes in at the
    top and the beer comes out at the bottom, and a Victorian tower brewery is
    four floors of that stacked up with a chimney beside it. That silhouette is
    the whole identification — the tallest roof in the parish next to the tallest
    chimney, and nothing else here looks remotely like it.

    The casks are the second cue and they are why the yard is deep: rows of barrels
    outside a building is a thing only one trade does.
    """
    p = pad('brp', 1.05, 0.92)
    # The tower itself: narrow, tall, steep roof.
    #
    # Tall *for this district*, which is 0.44 and not the 0.62 I first gave it.
    # The mill's silo is the current record at 0.67 and everything else is between
    # a third and a half; a brewery that topped out at one and a half tiles was
    # not the tallest roof in the parish, it was a cathedral, and it would have
    # made every other works look like a shed by comparison.
    p += moved(pitched('brt', 0.36, 0.34, 0.44, 0.16, BRICK, SLATE, ridge='y'),
               -0.22, 0.14)
    # The chimney, taller than the tower, which is what makes it read as steam.
    p += chimney('brc', r=0.038, h=0.72, at=(-0.44, -0.10))
    # Malt silos, because the grain has to get up there somehow.
    p += silo('brs1', r=0.078, h=0.40, at=(0.02, 0.26))
    p += silo('brs2', r=0.078, h=0.34, at=(0.02, 0.04))
    # The cask store, low and long against the tower.
    p += moved(barn('brb', w=0.44, d=0.26, body=RENDER, roof=SLATE), 0.26, -0.24)
    # And the casks, on their side in two rows. A brewery yard, in four boxes.
    for i in range(4):
        p += [_paint(lib.cyl('brk%d' % i, 0.036, 0.036, 0.058,
                             loc=(-0.10 + i * 0.085, -0.34, 0.036),
                             rot=(0, math.pi / 2, 0), segments=8),
                     CASK, 'brk_mat', rough=0.7)]
    return p


BUILDS = [
    ('plc_dairy_farm', dairy_farm),
    ('plc_arable_farm', arable_farm),
    ('plc_creamery', creamery),
    ('plc_mill', mill),
    ('plc_brewery', brewery),
    ('plc_quarry', quarry),
    ('plc_forestry', forestry),
    ('plc_sawmill', sawmill),
    ('plc_concrete_plant', concrete_plant),
    ('plc_terminal', terminal),
    ('plc_builders_merchant', builders_merchant),
    ('plc_filling_station', filling_station),
    ('plc_livestock_farm', livestock_farm),
    ('plc_abattoir', abattoir),
    ('plc_village_shop', village_shop),
    ('plc_pub', pub),
    ('plc_village_green', village_green),
    ('plc_park', park),
    ('plc_playing_field', playing_field),
    ('plc_yard', yard),
    ('plc_distribution_centre', distribution_centre),
    # Three cottages, and the point of three is that no two next to each other
    # match. Roof first, because roof is what you see.
    ('vil_cottage_a', lambda: cottage(RENDER, PANTILE)),
    ('vil_cottage_b', lambda: cottage(BRICK, SLATE, ridge='y')),
    ('vil_cottage_stone', lambda: cottage(STONE, THATCH, w=0.36, d=0.30)),
    ('vil_church', church),
    ('vil_barn', lambda: barn('vbn', w=0.52, d=0.30, body=TIMBER)),
]


# How big a premises is, in tiles.
#
# The plans above are authored in units of "about one tile", because that is the
# scale it is possible to hold in your head while writing a farmyard: a barn is
# 0.6 long, a house is 0.45. Then the whole thing is scaled once, here, to the
# size the game wants.
#
# 1.7 comes from the first render, which had a whole dairy farm the same
# footprint as a single lorry. A business has to read as a place a lorry drives
# *into*, and that means it has to be several lorries across. Everything else in
# the file stays readable as a plan.
PREMISES = 1.7


def main():
    report = []
    for name, build in BUILDS:
        lib.reset()
        parts = build()
        scale = PREMISES if name.startswith('plc_') else PREMISES * 0.80
        for o in parts:
            o.scale = (scale, scale, scale)
            o.location = (o.location.x * scale, o.location.y * scale,
                          o.location.z * scale)
        lib.merge_into(name, parts, None)
        lib.export(name, [], report)
    # Nine hundred, against the fleet's four-eighty. A building does not move,
    # there are a dozen or two in a district, and each is drawn once - where a
    # vehicle is drawn per instance. The budget follows the draw cost, not the
    # object's importance.
    # 1100. The lit windows and the pools of light they throw are worth it:
    # they are the whole difference between a village at night and a silhouette.
    lib.summarise(report, budget=1100)


if __name__ == '__main__':
    main()
