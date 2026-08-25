# The whole library, at the size the game uses it, beside one tile.
#
#   blender --background --python art/lineup.py
#   blender --background --python art/lineup.py -- veh
#
# One picture instead of fifteen. The point is comparative: art-pipeline.md's
# note on `assembly.py` records four beautifully detailed towers being a net
# loss because nobody had seen them next to the crude wall they stood on, and
# calls that the most useful observation in the folder. A model that is wrong on
# its own is arguable; wrong beside fourteen others it is obvious.
#
# Sizes come out of the game's own scale — one world unit is one tile — so this
# is what ships rather than what anybody intended.
import bpy
import sys
import os
import math
import mathutils

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shots import clear, bounds, ground, light, camera, shoot, TILE, RES  # noqa: E402

MODELS = os.path.join(ROOT, 'packages', 'client', 'public', 'models')
OUT = os.path.join(ROOT, 'art', 'shots', '_lineup')


def argv():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return a[0] if a else ''


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def tile_marks(count, pitch):
    """A one-tile square under every model.

    The single most useful thing in the picture. Every model here is a fraction
    of a tile, and the question that decides whether it is right is not how
    tall it is but how much of its tile it fills — a house that covers a tile
    is a house the size of a city block.
    """
    mat = bpy.data.materials.new('tilemark')
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.20, 0.26, 0.42, 1)
    made = []
    r = TILE * 0.008
    for i in range(count):
        x = i * pitch
        for (loc, size) in (
            ((x, -TILE / 2, 0.001), (TILE / 2, r, r)),
            ((x, TILE / 2, 0.001), (TILE / 2, r, r)),
            ((x - TILE / 2, 0, 0.001), (r, TILE / 2, r)),
            ((x + TILE / 2, 0, 0.001), (r, TILE / 2, r)),
        ):
            bpy.ops.mesh.primitive_cube_add(size=2, location=loc)
            o = bpy.context.object
            o.scale = size
            o.data.materials.append(mat)
            made.append(o)
    return made


def main():
    prefix = argv()
    names = sorted(
        f[:-4] for f in os.listdir(MODELS)
        if f.endswith('.glb') and f.startswith(prefix)
    )
    if not names:
        raise SystemExit('no models matching %r in %s' % (prefix, MODELS))

    clear()
    ground()
    light()

    # A tile apart, so nothing overlaps and the spacing is itself a ruler.
    pitch = TILE * 1.25
    models = []
    for i, name in enumerate(names):
        objs = load(os.path.join(MODELS, name + '.glb'))
        lo, hi = bounds(objs)
        for o in objs:
            if o.parent is None:
                o.location.x += i * pitch - (lo.x + hi.x) / 2
                o.location.y += -(lo.y + hi.y) / 2
                o.location.z -= lo.z
        models.extend(o for o in objs if o.type == 'MESH')
    models.extend(tile_marks(len(names), pitch))

    bpy.context.view_layer.update()
    # The models and their tile marks, and emphatically not the ground plane.
    #
    # Measuring every mesh in the scene included the ground — which is two
    # hundred units across — so the orthographic scale came out two hundred
    # times too large and fifteen models rendered as a smudge forty pixels
    # wide. The frame has to be measured from the subject.
    lo, hi = bounds(models)
    mid = (lo + hi) / 2
    span = max(hi.x - lo.x, 1.0)

    os.makedirs(OUT, exist_ok=True)
    tag = prefix or 'all'
    # The play camera's elevation, because that is the only angle that matters.
    # art-direction.md 1: a low orthographic camera keeps most of height and
    # eats footprint along the view axis, so a model judged from a raised
    # three-quarter view is judged at the wrong foreshortening.
    # Orthographic, and framed on the row rather than on a lens.
    #
    # A perspective camera placed a multiple of the span away put fifteen
    # models into forty pixels in the middle of an empty field, which is the
    # kind of mistake that is obvious in the picture and invisible in the
    # arithmetic. The game's camera is orthographic anyway, so matching it
    # removes the guesswork: set the scale to the row and the framing is right
    # by construction.
    scale = span * 1.06
    back = span * 2.0
    shoot(camera('lineup', (mid.x, mid.y - back * 0.8, mid.z + back * 0.42), mid, ortho_scale=scale),
          os.path.join(OUT, '%s-game.png' % tag))
    shoot(camera('lineup_f', (mid.x, mid.y - back, mid.z + span * 0.04), mid, ortho_scale=scale),
          os.path.join(OUT, '%s-front.png' % tag))
    print('%d models -> %s' % (len(names), OUT))
    for name in names:
        print('   ', name)


if __name__ == '__main__':
    main()
