# -*- coding: utf-8 -*-
# Thumbnails: every vehicle and every business, rendered, for the interface.
#
#   blender --background --python art/build_thumbs.py
#
# The Vehicles list said "Refrigerated van · 2 t" and nothing else, so choosing
# between nine vehicles meant reading nine names. A picture of the lorry answers
# "what am I buying" in the way the name never will — and the models already
# exist, so the only question was where the picture comes from.
#
# Three ways to get one, and this is the cheapest of them at runtime by a long
# way. A WebGL canvas per row is nine GL contexts on a list. One shared offscreen
# renderer is a pile of machinery, and it renders with the *game's* lighting,
# which is tuned for a district seen from four hundred feet rather than for an
# object on a card. Rendering at build time gives properly lit three-quarter
# views, costs a PNG each, and needs no code in the client beyond an `img` tag.
#
# Transparent background on purpose: the card decides its own colour, and these
# are used on a light panel now and might be used on a dark one later.
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh
import bpy  # noqa: E402
import mathutils  # noqa: E402

from shots import clear, bounds, camera, shoot  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, 'packages', 'client', 'public', 'models')
OUT = os.path.join(ROOT, 'packages', 'client', 'public', 'thumbs')

# Small. These are read at about eighty pixels wide in a list, and the whole set
# has to be cheap enough to ship: nine vehicles and fifteen businesses at 256
# square with alpha is under a megabyte.
RES = 256


def stage():
    """Light for an object on a card, not for a district.

    Two lamps and no ground. A key from the front-left so the near side of the
    cab is the bright one, and a much weaker fill from behind-right so the far
    edge does not disappear into nothing — the silhouette is most of what
    identifies a lorry at this size, and a single lamp loses one side of it.
    """
    bpy.ops.object.light_add(type='SUN', location=(5, -7, 9))
    key = bpy.context.object
    # 2.1, not 4. At 4 the mid-grey the pipeline paints the livery slot came out
    # pure white, so every vehicle was a white lorry and the thumbnails told you
    # nothing the name did not. Light for what the surface is, not for brightness.
    key.data.energy = 2.1
    key.data.angle = math.radians(14)
    key.rotation_euler = (math.radians(50), math.radians(12), math.radians(38))

    bpy.ops.object.light_add(type='SUN', location=(-6, 6, 5))
    fill = bpy.context.object
    fill.data.energy = 0.7
    fill.rotation_euler = (math.radians(66), math.radians(-8), math.radians(-140))

    world = bpy.data.worlds.new('thumb')
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.68, 0.74, 0.80, 1)
    bg.inputs['Strength'].default_value = 0.55


def render_settings():
    sc = bpy.context.scene
    # The engine's identifier moved between Blender versions, so ask rather than
    # assert. shots.py does the same and for the same reason: a hard-coded
    # 'BLENDER_EEVEE_NEXT' is a crash on one machine and fine on another.
    engines = {i.identifier for i in
               bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items}
    sc.render.engine = ('BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines
                        else 'BLENDER_EEVEE')
    sc.render.resolution_x = RES
    sc.render.resolution_y = RES
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    # Standard, for the same reason the game renders through Standard: whatever
    # the palette says is what should appear, with no film curve in between
    # quietly having opinions.
    sc.view_settings.view_transform = 'Standard'


# The player's colour, from palette.ts LIVERY[1] — the company the client hands
# the human. A thumbnail of a lorry in somebody else's colours is a small lie.
PLAYER_LIVERY = (0.184, 0.431, 0.659, 1.0)


#: Matches `LAMP` in `lib.py` and `LAMP_MATERIAL` in `glb.ts`. Named once here
#: rather than spelt inline, because it is the third place that has to agree.
LAMP_SLOT = 'lamp'


def load(name):
    path = os.path.join(MODELS, name + '.glb')
    if not os.path.exists(path):
        return None
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]
    objs = drop_lamps(objs)
    paint_livery(objs)
    return objs


def drop_lamps(objs):
    """Throw the lamp geometry away before framing.

    The reserved `lamp` slot is everything that emits — headlamps, tail lights,
    lit windows — and the game draws it as a *separate* additive mesh over the
    body, which is why it can go out at dusk. Imported into a thumbnail it is
    just more geometry: the lorry comes out with its lights on in broad
    daylight, and worse, the beams and lit panels stick out beyond the bodywork
    so `frame` sizes the camera to them and the whole vehicle shrinks. "It zooms
    back rather than close up."

    A thumbnail is a picture of the shape you are buying. Drop the slot, and the
    framing is the bodywork again.
    """
    keep = []
    for o in objs:
        if o.type != 'MESH' or not o.data.materials:
            keep.append(o)
            continue
        me = o.data
        slots = {i for i, m in enumerate(me.materials)
                 if m is not None and m.name.startswith(LAMP_SLOT)}
        if slots:
            # Faces, not objects. The glTF importer puts every primitive of a
            # mesh on one object as separate *material slots*, so a van arrives
            # as a single object carrying both its bodywork and its headlamps —
            # which is why removing whole objects changed nothing at all.
            bm = bmesh.new()
            bm.from_mesh(me)
            doomed = [f for f in bm.faces if f.material_index in slots]
            if doomed:
                bmesh.ops.delete(bm, geom=doomed, context='FACES')
            bm.to_mesh(me)
            bm.free()
        # An object that was *only* lamp now has no faces left; drop it so it
        # does not contribute an empty bounding box to the framing.
        if len(me.polygons) == 0:
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        keep.append(o)
    return keep


def paint_livery(objs):
    """Tint the reserved livery slot, the way the renderer does at draw time.

    The pipeline authors bodywork in a neutral mid-grey and the game multiplies
    the company's colour into it in the vertex shader. A thumbnail that skipped
    that step showed a grey lorry, which is not a vehicle anybody owns — so it
    is done here too, by name, exactly as `glb.ts` matches it.
    """
    for o in objs:
        if o.type != 'MESH' or not o.data.materials:
            continue
        for m in o.data.materials:
            if m is None or not m.name.startswith('livery'):
                continue
            if not m.use_nodes:
                continue
            for node in m.node_tree.nodes:
                if 'Base Color' in getattr(node, 'inputs', {}):
                    node.inputs['Base Color'].default_value = PLAYER_LIVERY


def frame(objs, pad=1.18):
    """An orthographic three-quarter view, scaled to whatever it is looking at.

    Orthographic rather than perspective, and framed from the object's own
    bounds, so a van and an artic both fill their card. A shared perspective
    camera would make the artic large and the van a speck, which is truthful and
    useless: the list is for telling them apart, and the size is written next to
    it in tonnes.
    """
    lo, hi = bounds(objs)
    centre = (lo + hi) / 2
    size = max(hi[0] - lo[0], hi[1] - lo[1], (hi[2] - lo[2]) * 1.6, 1e-3)
    d = size * 4
    # Front three-quarter, from a little above: the view that shows a cab, a
    # flank and the wheels at once.
    eye = mathutils.Vector((
        centre[0] + d * 0.62,
        centre[1] - d * 0.74,
        centre[2] + d * 0.46,
    ))
    return camera('thumb', eye, centre, ortho_scale=size * pad)


def names():
    """Everything worth a thumbnail, from what the pipeline actually exported.

    Read off the directory rather than listed, so a vehicle added to the content
    and built by `build_vehicles.py` gets a thumbnail without this file being
    touched — and one that failed to export is absent here too, which is the
    right kind of failure.
    """
    out = []
    for f in sorted(os.listdir(MODELS)):
        if not f.endswith('.glb'):
            continue
        stem = f[:-4]
        if stem.startswith('veh_') or stem.startswith('plc_'):
            out.append(stem)
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    render_settings()
    made = 0
    for name in names():
        clear()
        objs = load(name)
        if not objs:
            print('skip', name)
            continue
        stage()
        cam = frame(objs)
        shoot(cam, os.path.join(OUT, name + '.png'))
        made += 1
    print('=== thumbnails ===')
    print('%d written to %s' % (made, OUT))


if __name__ == '__main__':
    main()
