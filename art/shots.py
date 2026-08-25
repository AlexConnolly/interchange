# Look at the thing you just built.
#
#   blender --background --python art/shots.py -- prop_tent 3.6
#   blender --background --python art/shots.py -- prop_tent 3.6 --no-ref
#
# Writes art/shots/<name>/{front,side,top,three-quarter,silhouette}.png, which
# an agent can Read. That is the whole point: nearly every bad model in this
# repo was bad in a way that is invisible in Python and obvious in a picture.
# Heights authored into Y instead of Z. A rotation sign inverted so a tent's
# canvas splayed outwards into a trough. A prop scaled against a comment that
# said a warrior was two units tall when the code says three. None of those
# were caught by reading the code, because reading the code is how they got
# written.
#
# It renders the EXPORTED .glb, not the Blender scene, deliberately. The axis
# convention only goes wrong at export — Blender is Z-up and glTF is Y-up —
# so a scene render would have shown a perfectly good model right up until it
# reached the game.
#
# The scale reference is a 3.0-unit figure, which is a warrior: models.ts
# measures every unit against HEAD_Y and warrior is 3. Anything you build is
# either taller or shorter than that man, and you should know which before you
# put it on the map.
import bpy
import sys
import os
import math
import mathutils

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, 'packages', 'client', 'public', 'models')
SHOTS = os.path.join(ROOT, 'art', 'shots')

# The ruler.
#
# Tribe Wars measured everything against a three-unit warrior. This game has no
# figures in it, so the reference is the tile: one world unit is one tile, and
# art-direction.md sets a tile at thirty-two metres. So a two-storey terraced
# house is about a quarter of a tile tall and a lorry is about a fifth of one
# long, and a model that comes out looking right on its own and absurd on the
# map is a model that was authored against the wrong ruler.
#
# A one-tile cube is the reference object for exactly that reason: everything
# in this game is smaller than it, and you should know by how much before you
# put it on the ground.
TILE = 1.0
RES = 900


def argv():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if not a:
        raise SystemExit('usage: shots.py -- <model-name> [target-height] [--no-ref]')
    name = a[0]
    height = None
    for tok in a[1:]:
        if not tok.startswith('--'):
            height = float(tok)
    return name, height, '--no-ref' not in a


def clear():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            block.remove(item)


def bounds(objs):
    lo = mathutils.Vector((1e9, 1e9, 1e9))
    hi = mathutils.Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != 'MESH':
            continue
        for corner in o.bound_box:
            p = o.matrix_world @ mathutils.Vector(corner)
            lo = mathutils.Vector((min(lo[i], p[i]) for i in range(3)))
            hi = mathutils.Vector((max(hi[i], p[i]) for i in range(3)))
    return lo, hi


def load(name, target_h):
    """Import the exported glb and put it at the size the game will use it."""
    path = os.path.join(MODELS, name + '.glb')
    if not os.path.exists(path):
        raise SystemExit('no such model: ' + path)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]

    root = bpy.data.objects.new('model', None)
    bpy.context.collection.objects.link(root)
    for o in objs:
        if not o.parent:
            o.parent = root

    if target_h:
        lo, hi = bounds(objs)
        # Z, not Y. glTF on disk is Y-up but the importer converts to Blender's
        # Z-up, so by the time it is in the scene height is Z again. I wrote
        # this file Y-up first and the scale reference came out lying on its
        # back in the first render, which is the exact mistake this script is
        # here to catch and a fair argument for its existence.
        # max.z, not the extent. props.ts scales by `box.max.y || 1` — the top
        # measured from the origin — so anything hanging below zero is ignored
        # there and counted here. Using the extent made this renderer show a
        # different size from the game for every prop with a SUNK warning, and
        # the whole value of the picture is that it is the shipped size.
        tall = max(hi.z, 1e-6)
        s = target_h / tall
        if s > 10 or s < 0.1:
            print('WARNING scale %.2fx — check the axes on export' % s)
        root.scale = (s, s, s)
        bpy.context.view_layer.update()

    lo, hi = bounds(objs)
    root.location.z -= lo.z            # stand it on the floor
    bpy.context.view_layer.update()
    return objs


def reference():
    """One tile, outlined. Not art — a ruler you can see in the same frame.

    Tribe Wars used a three-unit man here, because its subject was men. This
    game's subject is a region, its unit is the tile, and art-direction.md puts
    a tile at thirty-two metres — so the useful question about any model is not
    "how tall is it" but "what fraction of a tile does it cover".

    Drawn as a wireframe cage rather than a solid block, because a solid one
    tile cube hides everything in the game behind it.
    """
    mat = bpy.data.materials.new('ref')
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.16, 0.22, 0.38, 1)
    t = TILE / 2.0
    r = TILE * 0.012
    made = []
    # Twelve edges of a one-tile cube sitting on the floor.
    edges = []
    for sx in (-t, t):
        for sy in (-t, t):
            edges.append(((sx, sy, TILE / 2), (r, r, TILE / 2)))
    for sz in (0.0, TILE):
        for sy in (-t, t):
            edges.append(((0, sy, sz), (t, r, r)))
        for sx in (-t, t):
            edges.append(((sx, 0, sz), (r, t, r)))
    for i, (loc, size) in enumerate(edges):
        bpy.ops.mesh.primitive_cube_add(size=2, location=loc)
        o = bpy.context.object
        o.name = 'ref_edge_%d' % i
        o.scale = size
        o.data.materials.append(mat)
        made.append(o)
    return made

def ground():
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.002))
    p = bpy.context.object
    mat = bpy.data.materials.new('grid')
    mat.use_nodes = True
    nt = mat.node_tree
    chk = nt.nodes.new('ShaderNodeTexChecker')
    chk.inputs['Scale'].default_value = 200.0        # one square per unit
    chk.inputs['Color1'].default_value = (0.30, 0.33, 0.28, 1)
    chk.inputs['Color2'].default_value = (0.25, 0.28, 0.24, 1)
    nt.links.new(chk.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    p.data.materials.append(mat)
    return p


def light():
    bpy.ops.object.light_add(type='SUN', location=(6, -8, 12))
    sun = bpy.context.object
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(52), math.radians(18), math.radians(35))
    world = bpy.data.worlds.new('w')
    bpy.context.scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.42, 0.50, 0.58, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9


def camera(name, loc, look_at, ortho_scale=None):
    cam_data = bpy.data.cameras.new(name)
    if ortho_scale:
        cam_data.type = 'ORTHO'
        cam_data.ortho_scale = ortho_scale
    else:
        cam_data.lens = 52
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = loc
    d = mathutils.Vector(look_at) - mathutils.Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return cam


def shoot(cam, out):
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('wrote', out)


def main():
    name, target_h, want_ref = argv()
    clear()

    objs = load(name, target_h)
    # Two sets of bounds, deliberately. mlo/mhi is the model and never changes,
    # because it is what gets reported at the end. lo/hi is whatever the camera
    # has to frame, which grows once the scale figure is in the shot. Sharing
    # one pair meant the closing measurement quietly included the man, and a
    # 1.75-unit fence reported itself as 3.00.
    mlo, mhi = bounds(objs)
    lo, hi = mlo.copy(), mhi.copy()
    span = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z, 0.5)
    mid = (lo + hi) / 2

    ground()
    light()
    if want_ref:
        ref = reference()
        # Diagonally clear, not just clear in X. Offset along one axis only, he
        # stands directly behind the prop in the view that looks down that axis
        # and you lose the ruler in exactly the shot you wanted it in.
        for o in ref:
            o.location.x += hi.x + 1.4
            o.location.y += hi.y + 1.4
        # Reframe around the pair. Framing on the prop alone pushed the man off
        # the edge of the shot, which loses the one thing he is there for.
        bpy.context.view_layer.update()
        lo, hi = bounds(objs + ref)
        span = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z, 0.5)
        mid = (lo + hi) / 2

    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in \
        {i.identifier for i in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items} else 'BLENDER_EEVEE'
    sc.render.resolution_x = sc.render.resolution_y = RES
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.view_transform = 'Standard'

    out_dir = os.path.join(SHOTS, name)
    os.makedirs(out_dir, exist_ok=True)
    d = span * 2.4
    frame = span * 1.35

    # Orthographic front, side and top read proportion without perspective
    # lying to you about it. The three-quarter is how it will actually be seen.
    shoot(camera('front', (mid.x, mid.y - d, mid.z), mid, frame),
          os.path.join(out_dir, 'front.png'))
    shoot(camera('side', (mid.x + d, mid.y, mid.z), mid, frame),
          os.path.join(out_dir, 'side.png'))
    shoot(camera('top', (mid.x, mid.y + 0.001, mid.z + d), mid, frame),
          os.path.join(out_dir, 'top.png'))
    shoot(camera('tq', (mid.x + d * 0.62, mid.y - d * 0.62, mid.z + d * 0.45), mid),
          os.path.join(out_dir, 'three-quarter.png'))

    # The game's own camera: 58 degrees above the horizon. This is the shot
    # that matters most and the one nobody thinks to take. At 58 degrees a
    # vertical length arrives on screen at about 53% while a width arrives at
    # 100%, so height is nearly halved and everything reads squatter than it
    # was drawn. A tower authored at 2.3:1 lands as 1.2:1. Almost every "it
    # looks a bit squat" note in this project traces back to here.
    import math as _m
    el = _m.radians(58)
    shoot(camera('game', (mid.x, mid.y - d * _m.cos(el), mid.z + d * _m.sin(el)), mid),
          os.path.join(out_dir, 'game-58.png'))

    # Silhouette last: everything flat black on white. If it is not readable
    # here it will not be readable at a hundred metres, whatever the detail.
    black = bpy.data.materials.new('black')
    black.use_nodes = True
    bsdf = black.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
    # Flat, or the highlights put shading back into a pass whose whole job is
    # to remove it — a silhouette with detail in it is just a dark render.
    bsdf.inputs['Roughness'].default_value = 1.0
    for slot in ('Specular IOR Level', 'Specular'):
        if slot in bsdf.inputs:
            bsdf.inputs[slot].default_value = 0.0
    for o in bpy.data.objects:
        if o.type == 'MESH' and not o.name.startswith('Plane'):
            o.data.materials.clear()
            o.data.materials.append(black)
    bpy.context.scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    bpy.context.scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 4.0
    for o in list(bpy.data.objects):
        if o.name.startswith('Plane'):
            bpy.data.objects.remove(o)
    shoot(camera('sil', (mid.x + d * 0.62, mid.y - d * 0.62, mid.z + d * 0.30), mid),
          os.path.join(out_dir, 'silhouette.png'))

    tall = mhi.z - mlo.z
    print('%s: %.2f x %.2f x %.2f world units - %.2f of a tile'
          % (name, mhi.x - mlo.x, mhi.y - mlo.y, tall, tall / TILE))


# Guarded so lineup.py can import the rig — front, side, top, the scale man
# and the lighting are the same job whether you are shooting one prop or all
# of them.
if __name__ == '__main__':
    main()
