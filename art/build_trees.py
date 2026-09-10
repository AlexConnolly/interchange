# -*- coding: utf-8 -*-
# Trees. design.md 10: "Trees with multi-lobe canopies."
#
#   blender --background --python art/build_trees.py
#
# The cheapest models in the game and among the most valuable. A district of
# fields and hedges with nothing standing in it reads as a diagram; a dozen
# hedgerow oaks and a copse in the awkward corner of a field read as country.
# They also do the one thing hedges cannot, which is break the horizon.
#
# Budget is the whole design constraint here, and it is different in kind from
# the vehicles'. A lorry is drawn a dozen times; a tree is drawn a thousand
# times. So the canopy is icospheres at subdivision *zero* - twenty triangles
# each - scaled into lobes rather than smoothed into balls. At forty pixels a
# twenty-triangle lobe and an eighty-triangle lobe are the same picture, and one
# of them costs four times as much a thousand times over.
#
# Three or four lobes rather than one, because a single sphere on a stick is a
# lollipop. The overlap between lobes is what gives the silhouette its notches,
# and the silhouette is all there is at this size.
#
# Snow needs no help here: the renderer's snow term lands on faces pointing up,
# so the top of every lobe whitens in January and the trunk does not.
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import lib  # noqa: E402

# palette.ts TREE, verbatim.
TRUNK = (0.329, 0.251, 0.184, 1)
CANOPY = (0.243, 0.420, 0.204, 1)
CANOPY_LIT = (0.322, 0.541, 0.255, 1)
CONIFER = (0.192, 0.322, 0.231, 1)
CONIFER_LIT = (0.255, 0.408, 0.286, 1)
AUTUMN = (0.545, 0.404, 0.180, 1)
AUTUMN_LIT = (0.667, 0.514, 0.235, 1)
BARE = (0.365, 0.310, 0.259, 1)
# The twig mass, a step lighter and greyer than the limbs it sits over.
#
# A bare crown in life is lighter than the branches inside it, because you are
# looking at ten thousand twigs with sky between them rather than at solid wood.
# One shade is the whole of that effect at this size, and without it the tree is a
# single flat silhouette with no depth in it at all.
BARE_TWIG = (0.412, 0.365, 0.325, 1)


def trunk(name, r, h, lean=0.0):
    """A tapered bole. Six sides, because nobody counts them.

    The lean is worth the one line: a row of perfectly upright trees along a
    hedge looks planted, and a hedgerow oak has spent eighty years being pushed
    about by the weather.
    """
    o = lib.cyl(name, r * 1.35, r * 0.8, h, loc=(0, 0, h / 2), segments=6)
    o.data.materials.append(lib.material('bark', TRUNK, rough=0.9))
    if lean:
        o.rotation_euler.y = lean
    return [o]


def lobes(name, spec, colour, lit):
    """The canopy, as overlapping scaled icospheres.

    `spec` is a list of (x, y, z, radius, squash). Written out rather than
    generated because four hand-placed lobes make a better silhouette than
    forty random ones, and because a tree that is the same every time is a
    tree the player can recognise.

    The topmost lobe gets the lit colour, which is a cheap standing-in for
    ambient occlusion: the crown catches the sky and the underside does not, and
    the renderer's hemisphere light alone does not make that difference big
    enough at this size.
    """
    made = []
    dark = lib.material(name + '_canopy', colour, rough=0.82)
    bright = lib.material(name + '_canopy_lit', lit, rough=0.82)
    top = max(s[2] for s in spec)
    for i, (x, y, z, r, squash) in enumerate(spec):
        o = lib.sphere('%s_lobe%d' % (name, i), r, loc=(x, y, z), subdiv=0,
                       scale=(1.0, 1.0, squash))
        o.data.materials.append(bright if z >= top - 1e-6 else dark)
        made.append(o)
    return made


def oak():
    """Broad, low, and the one everybody pictures. Hedgerow king."""
    p = trunk('oak_bole', 0.030, 0.30, lean=0.05)
    p += lobes('oak', [
        (0.00, 0.00, 0.44, 0.135, 0.80),
        (-0.09, 0.04, 0.36, 0.100, 0.85),
        (0.09, -0.03, 0.34, 0.095, 0.85),
        (0.01, -0.09, 0.38, 0.085, 0.90),
    ], CANOPY, CANOPY_LIT)
    return p


def ash():
    """Taller, narrower, later into leaf. Breaks the skyline."""
    p = trunk('ash_bole', 0.024, 0.42)
    p += lobes('ash', [
        (0.00, 0.00, 0.60, 0.105, 0.95),
        (-0.06, 0.02, 0.50, 0.085, 1.00),
        (0.06, -0.02, 0.47, 0.080, 1.00),
    ], CANOPY, CANOPY_LIT)
    return p


def hawthorn():
    """Small and scrubby. Goes in the corners a plough cannot reach, and in
    threes it reads as scrub rather than as three failed trees."""
    p = trunk('haw_bole', 0.018, 0.14, lean=-0.09)
    p += lobes('haw', [
        (0.00, 0.00, 0.22, 0.085, 0.72),
        (0.05, 0.03, 0.18, 0.060, 0.75),
    ], CANOPY, CANOPY_LIT)
    return p


def pine():
    """A conifer, as stacked cones. Different enough in silhouette that a
    plantation reads as a plantation from across the valley."""
    p = trunk('pine_bole', 0.022, 0.20)
    made = []
    dark = lib.material('pine_needle', CONIFER, rough=0.86)
    bright = lib.material('pine_needle_lit', CONIFER_LIT, rough=0.86)
    tiers = [(0.26, 0.135, 0.20), (0.40, 0.105, 0.17), (0.53, 0.070, 0.14)]
    for i, (z, r, h) in enumerate(tiers):
        o = lib.cyl('pine_tier%d' % i, r, r * 0.10, h, loc=(0, 0, z), segments=7)
        o.data.materials.append(bright if i == len(tiers) - 1 else dark)
        made.append(o)
    return p + made


def autumn():
    """An oak in copper. One tree in eight, so a hedgerow is not one colour -
    which is the single cheapest thing that stops a row of trees reading as a
    stamp repeated."""
    p = trunk('aut_bole', 0.028, 0.28, lean=-0.04)
    p += lobes('aut', [
        (0.00, 0.00, 0.42, 0.125, 0.82),
        (-0.08, 0.03, 0.35, 0.095, 0.86),
        (0.08, -0.03, 0.33, 0.090, 0.86),
    ], AUTUMN, AUTUMN_LIT)
    return p


def bare():
    """A winter skeleton, and a dead elm in July.

    This was a bole and three straight cylinders, and it read as exactly that:
    "trees without leaves look horrific". Three sticks in a tripod is not a tree,
    and for a quarter of the year it is the most numerous object on screen, so it
    sets the tone of the whole picture.

    What a bare tree looks like at forty pixels is two things at once: a few
    strong limbs you can pick out, and above them a soft grey *mass* of twigs with
    no individual parts at all. Modelling twigs is out of the question - a tree is
    drawn a thousand times a frame - so the mass is built the way the summer canopy
    is, from flattened icospheres at subdivision zero in a winter grey-brown. It is
    the leafy-lobe trick with the leaves taken out, which is fitting, because that
    is what winter is.

    And the limbs fork. One generation of forking is the whole difference between a
    stick and a branch: a limb that splits has a direction, and a limb that does
    not is a spoke.

    ## The budget decided the shape

    First attempt came out at 300 triangles against a budget of 140, with five
    primaries, ten forks and four lobes - the pipeline's own report caught it,
    which is what the report is for. Cutting it was not a compromise but a
    clarification: what actually earns its triangles here is the *twig mass* and
    the *forking*, not the count of limbs. Four primaries with one fork each and
    two lobes reads better than five bare spokes did, at less than half the cost of
    the version that was too dear.
    """
    p = trunk('bare_bole', 0.030, 0.30, lean=0.04)
    limb = lib.material('bare_limb', BARE, rough=0.9)

    # Four primaries, unevenly spaced. Even spacing round the bole is part of what
    # made the old one read as a diagram of a tree rather than as a tree.
    for i, (ang, tilt, ln, base) in enumerate([
        (0.35, 0.64, 0.21, 0.285),
        (1.75, 0.48, 0.24, 0.310),
        (3.20, 0.68, 0.19, 0.270),
        (4.85, 0.54, 0.22, 0.300),
    ]):
        cx = math.cos(ang) * 0.035
        cy = math.sin(ang) * 0.035
        o = lib.cyl('bare_limb%d' % i, 0.017, 0.008, ln,
                    loc=(cx, cy, base),
                    rot=(math.sin(ang) * tilt, math.cos(ang) * tilt, 0),
                    segments=4)
        o.data.materials.append(limb)
        p.append(o)

        # Where that primary ends up, so the fork starts from the tip rather than
        # from a guess. `cyl` is drawn about its own midpoint, so the tip is half a
        # length further along the limb's own tilt.
        reach = ln
        tipx = cx + math.cos(ang) * math.sin(tilt) * reach
        tipy = cy + math.sin(ang) * math.sin(tilt) * reach
        tipz = base + math.cos(tilt) * reach * 0.5
        a2 = ang + (0.40 if i % 2 == 0 else -0.44)
        t2 = tilt * 0.70
        o = lib.cyl('bare_fork%d' % i, 0.009, 0.004, ln * 0.60,
                    loc=(tipx, tipy, tipz),
                    rot=(math.sin(a2) * t2, math.cos(a2) * t2, 0),
                    segments=3)
        o.data.materials.append(limb)
        p.append(o)

    # And the twig mass, which is the part that makes it a tree.
    #
    # Wide and flattened, sitting over the fork tips, in a grey-brown a shade
    # lighter than the limbs so the silhouette has depth instead of being one flat
    # shape. Two lobes rather than one, because the overlap is what gives the
    # outline its notches - the same reason the summer canopy is never a sphere.
    twig = lib.material('bare_twig', BARE_TWIG, rough=0.95)
    for i, (x, y, z, r, flat) in enumerate([
        (0.010, -0.005, 0.455, 0.134, 0.46),
        (-0.052, 0.048, 0.402, 0.096, 0.52),
    ]):
        o = lib.sphere('bare_twigs%d' % i, r, loc=(x, y, z), subdiv=0,
                       scale=(1.0, 0.94, flat))
        o.data.materials.append(twig)
        p.append(o)
    return p


BUILDS = [
    ('tree_oak', oak),
    ('tree_ash', ash),
    ('tree_hawthorn', hawthorn),
    ('tree_pine', pine),
    ('tree_autumn', autumn),
    ('tree_bare', bare),
]


def main():
    report = []
    for name, build in BUILDS:
        lib.reset()
        parts = build()
        lib.merge_into(name, parts, None)
        lib.export(name, report)
    # A hundred and forty, against the fleet's four-eighty and the buildings'
    # nine hundred. Lowest budget in the project and correctly so: this is the
    # only model drawn a thousand times in one frame, so its cost is the only
    # one that is really multiplied.
    lib.summarise(report, budget=140)


if __name__ == '__main__':
    main()
