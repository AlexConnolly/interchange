# Vehicles. art-direction.md 7 and 9.
#
#   blender --background --python art/build_vehicles.py
#
# Two things make this harder than it looks, and both are in art-pipeline.md.
#
# 4.2: livery is a runtime slot, not a baked colour. Up to eight companies in
# one region run the same lorry, so the bodywork is painted with the reserved
# `livery` material and the renderer tints it per company at draw time. Wheels,
# glass and chassis keep the colours they are authored with — a company's
# colour is its paint, not its tyres.
#
# 4.3: the far LOD is authored, not decimated. These are twelve to twenty
# pixels long over a region, and decimating a detailed lorry at that size is a
# smear. Each build therefore has a `far=` form whose only job is to say
# "lorry" at fourteen pixels, which is a design task and not an optimisation.
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import lib  # noqa: E402
from boxmodel import Form  # noqa: E402

# A tile is thirty-two metres, so a five-metre car is 0.16 of a tile and an
# eighteen-metre artic is 0.56. These are small numbers and they are the whole
# reason the far LOD exists.
CAR_L = 0.15
DRAY_L = 0.13
LORRY_L = 0.26

TYRE = (0.11, 0.11, 0.12, 1)
GLASS = (0.30, 0.38, 0.44, 1)
IRON = (0.24, 0.24, 0.26, 1)
TIMBER = (0.44, 0.34, 0.24, 1)
HORSE = (0.36, 0.26, 0.20, 1)


def _wheels(name, length, width, r, pairs=2, mat=None, far=False):
    """Wheels, or the absence of them.

    art-pipeline.md 4.3 wants the far LOD to be a cheaper *design*, not a
    decimation, and a wheel is the clearest case there is: at fourteen pixels a
    wheel is under one pixel, and four six-sided cylinders were two thirds of
    the far model's triangles describing something nobody can see. The far form
    has none, and its body sits on the road instead.
    """
    """Real wheels, on the ground.

    The first version of this function narrowed the underside of the body and
    called that wheels, which is a comment pretending to be geometry: the
    export report duly said `floor +0.02`, meaning every vehicle in the game
    hovered two hundredths of a tile — about half a metre — above the road.
    Nothing in the source said so and nothing ever would have.

    Cylinders, and the body is dropped to sit on them. At fifteen pixels a
    wheel is two pixels of dark under a light body, which is exactly the cue
    that says the thing rolls; what matters is that it is *there* and that the
    body rests on it.
    """
    if far:
        return [], 0.0
    m = mat or lib.material('tyre', TYRE)
    out = []
    for i in range(pairs):
        # Spread the axles along the body, inboard of the ends.
        t = 0.5 if pairs == 1 else i / (pairs - 1)
        y = -length * 0.34 + t * length * 0.68
        for sx in (-1, 1):
            out.append(lib.cyl('%s_w%d%s' % (name, i, '+' if sx > 0 else '-'),
                               r, r, width * 0.14,
                               loc=(sx * width * 0.46, y, r),
                               rot=(0, 1.5707963, 0), segments=6))
    for o in out:
        o.data.materials.append(m)
    return out, r


def car(far=False):
    """A private car. The visible face of transit.ts's car share, which took a
    growing share of every town's travel from era four and could not be seen."""
    wheels, r = _wheels('car', CAR_L, 0.062, 0.010, pairs=2, far=far)
    f = Form(size=(0.062, CAR_L, 0.026), at=(0, 0, r + 0.010))
    if not far:
        # The cabin, pulled up out of the back half of the roof — which is what
        # makes the silhouette a car rather than a loaf.
        roof = f.faces(normal='up')
        cabin = f.extrude(roof, move=(0, -0.012, 0.018), scale=(0.86, 0.60, 1.0))
        f.scale_faces(cabin, (0.9, 1.0, 1.0))
        # A bonnet: drop the front of the body a little.
        f.move(f.faces(normal='+y', above=r + 0.020), (0, 0, -0.004))
    f.bevel(amount=0.0035)
    body = f.build('car_body')
    lib.repaint(body, [
        (lib.livery_material(), lambda c: True),
        (lib.material('glass_car', GLASS), lambda c: c.z > r + 0.024),
    ])
    return lib.merge_into('car', [body] + wheels, None) if wheels else body


def dray(far=False):
    """1860. A horse and a flat cart, which is what the game starts you with
    and therefore the first model anybody sees."""
    wheels, r = _wheels('dray', DRAY_L, 0.055, 0.014, pairs=2,
                        mat=lib.material('ironshod', IRON), far=far)
    f = Form(size=(0.055, DRAY_L, 0.016), at=(0, 0, r + 0.008))
    if not far:
        # A flat bed with sides, inset so the load sits down in it.
        bed = f.faces(normal='up')
        inner = f.inset(bed, thickness=0.008)
        f.move(inner, (0, 0, -0.009))
    f.bevel(amount=0.003)
    cart = f.build('dray_cart')
    lib.repaint(cart, [
        (lib.material('timber', TIMBER), lambda c: True),
        (lib.livery_material(), lambda c: abs(c.x) > 0.024),
    ])
    if far:
        return cart
    # The horse, in front. A separate mesh because it is a separate animal, and
    # the one place in this library where two objects is the honest answer.
    h = Form(size=(0.026, 0.058, 0.028), at=(0, DRAY_L * 0.72, 0.030))
    neck = h.face(normal='+y', above=0.034)
    if neck:
        h.extrude(neck, move=(0, 0.016, 0.008), scale=(0.6, 1.0, 0.5))
    h.bevel(amount=0.003)
    horse = h.build('dray_horse')
    horse.data.materials.append(lib.material('horse', HORSE))
    return lib.merge_into('dray', [cart, horse] + wheels, None)


def lorry(era=4, far=False):
    """A motor lorry: a cab and a body, the shape that carries most of the
    tonnage from era three onward."""
    length = LORRY_L * (0.8 if era < 5 else 1.0)
    wheels, r = _wheels('lorry', length, 0.075, 0.012,
                        pairs=2 if era < 5 else 3, far=far)
    f = Form(size=(0.075, length, 0.034), at=(0, 0, r + 0.014))
    if not far:
        # The cab, pulled up at the front.
        top = f.faces(normal='up')
        f.cut(axis=1, cuts=1)
        cab = f.faces(normal='up', ymin=length * 0.1)
        if cab:
            grown = f.extrude(cab, move=(0, 0, 0.026))
            f.scale_faces(grown, (0.94, 0.9, 1.0))
        del top
    f.bevel(amount=0.003)
    body = f.build('lorry_body')
    lib.repaint(body, [
        (lib.livery_material(), lambda c: True),
        (lib.material('glass_l', GLASS), lambda c: c.z > r + 0.042 and c.y > 0),
        (lib.material('chassis', IRON), lambda c: c.z < r + 0.002),
    ])
    return lib.merge_into('lorry', [body] + wheels, None) if wheels else body


BUILDS = [
    ('veh_car', lambda: car()),
    ('veh_car_far', lambda: car(far=True)),
    ('veh_dray', lambda: dray()),
    ('veh_dray_far', lambda: dray(far=True)),
    ('veh_lorry_early', lambda: lorry(era=3)),
    ('veh_lorry', lambda: lorry(era=5)),
    ('veh_lorry_far', lambda: lorry(era=5, far=True)),
]


def main():
    report = []
    for name, build in BUILDS:
        lib.reset()
        obj = build()
        lib.export(name, [obj], report)
    # There can be several hundred vehicles moving in one view and each is one
    # instanced draw, so a near model gets a couple of hundred triangles and a
    # far model wants to be under thirty.
    lib.summarise(report, budget=240)


if __name__ == '__main__':
    main()
