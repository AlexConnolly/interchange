# The material contact sheet: what you look at between passes.
#
#   blender --background --python texshots.py -- <model-name>
#
# Modelling has the flat-black silhouette — the shot that strips away
# everything you could hide behind. Texturing needs a different one, because a
# material has no correct outline to check against. The equivalent here is
# `mask_*.png`: each placement mask rendered on its own, in grey, on the model.
#
# That shot exists because "the moss is wrong" is not actionable and "the moss
# mask is covering the whole south wall instead of the bottom two metres" is.
# You cannot fix a placement you cannot see, and a colour render only tells you
# the model got greener.
#
# The other shot that earns its place is `rake.png`. Under flat front light a
# painted-on suggestion of texture and real micro-surface relief look the same;
# under a light skimming along the surface they do not. A material that only
# reads under flat light is not finished.
import bpy
import bmesh
import sys
import os
import math
import mathutils

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.append(HERE)
import texconfig as cfg     # noqa: E402
import texlib as tx         # noqa: E402


def argv():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


def setup(engine='CYCLES'):
    """Cycles by default, not EEVEE.

    EEVEE evaluates the Ambient Occlusion node as a constant, so `mask_cavity`
    - the one mask that works on flat-faced geometry - renders as flat grey and
    the mask view lies. EEVEE is fine for a quick colour look; it is not fine
    for anything you intend to judge a placement from."""
    sc = bpy.context.scene
    avail = [i.identifier for i in
             sc.render.bl_rna.properties['engine'].enum_items]
    for cand in (engine, 'BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        if cand in avail:
            sc.render.engine = cand
            break
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.render.resolution_x = sc.render.resolution_y = cfg.RES
    try:
        sc.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    # Cycles' own default is 4096 samples, which nothing here sets otherwise:
    # switching the default engine to CYCLES turned a one-minute contact sheet
    # into an hour of it. Denoising does the rest.
    try:
        sc.cycles.samples = getattr(cfg, 'SHOT_SAMPLES', 96)
        sc.cycles.use_denoising = True
    except AttributeError:
        pass


def world(hex_value, strength=0.85, name='texworld'):
    w = bpy.data.worlds.get(name) or bpy.data.worlds.new(name)
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = tx.srgb(hex_value)
    bg.inputs['Strength'].default_value = strength
    return w


def studio_world(name='texworld_studio', strength=None, horizon=None,
                 zenith=None, ground=None, sun_size=0.12, sun_strength=6.0):
    """A world with variation in it, so a mirror has something to reflect.

    This is not decoration. A polished surface shows you its surroundings and
    nothing else, so against a uniform sky colour chrome renders as flat grey
    card no matter how correct the material is — you cannot tell a mirror from
    matt paint, and no amount of work on the material fixes it because the
    problem is that there is nothing to see.

    A sky gradient, a darker ground below the horizon, and one bright soft disc
    standing in for a key light give a metal three things to do: a horizon line
    across curved panels, a dark half, and a highlight that travels. That is
    most of what reads as polished.

    Enable it for anything with metal or glass. It changes the lighting, so if
    you are comparing against a baseline, re-render the baseline under it too.
    """
    cfgv = lambda k, d: getattr(cfg, k, d)                        # noqa: E731
    strength = cfgv('WORLD_STRENGTH', 1.0) if strength is None else strength
    horizon = cfgv('WORLD_HORIZON', 0xBFC7CE) if horizon is None else horizon
    zenith = cfgv('WORLD_ZENITH', 0x5C6B7A) if zenith is None else zenith
    ground = cfgv('WORLD_GROUND', 0x2A2A2C) if ground is None else ground

    w = bpy.data.worlds.get(name) or bpy.data.worlds.new(name)
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_WORLD':
            nt.nodes.remove(n)
    out = nt.nodes['World Output']

    tex = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tex.outputs['Generated'], sep.inputs['Vector'])

    # Sky gradient above the horizon, a flat darker value below it.
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'EASE'
    e = ramp.color_ramp.elements
    e[0].position, e[0].color = 0.48, tx.srgb(ground)
    e[1].position, e[1].color = 0.52, tx.srgb(horizon)
    top = ramp.color_ramp.elements.new(0.95)
    top.color = tx.srgb(zenith)
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])

    # One bright disc, so a curved metal panel gets a highlight that moves
    # across it as the form turns.
    dot = nt.nodes.new('ShaderNodeVectorMath')
    dot.operation = 'DOT_PRODUCT'
    nt.links.new(tex.outputs['Generated'], dot.inputs[0])
    v = mathutils.Vector(cfg.SUN_FROM).normalized() * 0.5
    dot.inputs[1].default_value = (v.x + 0.5, v.y + 0.5, v.z + 0.5)
    disc = nt.nodes.new('ShaderNodeMapRange')
    nt.links.new(dot.outputs['Value'], disc.inputs['Value'])
    disc.inputs['From Min'].default_value = 0.75 - sun_size
    disc.inputs['From Max'].default_value = 0.75
    disc.clamp = True

    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    nt.links.new(disc.outputs['Result'],
                 [s for s in mix.inputs if s.name == 'Factor' and s.enabled][0])
    nt.links.new(ramp.outputs['Color'],
                 [s for s in mix.inputs if s.name == 'A' and s.enabled][0])
    [s for s in mix.inputs
     if s.name == 'B' and s.enabled][0].default_value = (
        sun_strength, sun_strength, sun_strength * 0.94, 1.0)

    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    nt.links.new([s for s in mix.outputs if s.name == 'Result'
                  and s.enabled][0], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    return w


def sun(from_vec, energy, name='sun'):
    d = bpy.data.lights.new(name, type='SUN')
    d.energy = energy
    d.color = tx.srgb(cfg.SUN)[:3]
    d.angle = math.radians(2.0)
    o = bpy.data.objects.new(name, d)
    v = mathutils.Vector((0, 0, 0)) - mathutils.Vector(from_vec)
    o.rotation_euler = v.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.collection.objects.link(o)
    return o


def studio_cards(objs, floor=0x111316):
    """A floor and two black flags, to go with `studio_world()` above.

    FOR POLISHED AND METALLIC SURFACES. Set STUDIO_ENV = True in texconfig to
    turn both on; without the flag nothing here runs and `sheet()` is
    unchanged.

    studio_world() gives a mirror a gradient and a highlight to reflect. This
    adds the other half, measured on a sports car whose chrome would not read:
    a gradient sky ALONE changed almost nothing, because a gradient is one
    smooth value and a flat-faced bumper takes a single sample of it per facet.
    What made chrome read as chrome was DARK - a black ceiling card and a black
    side card, out of shot, so each facet reflects black next to the bright
    strip. The bumper went from uniform pale blue-grey to a bright rim over a
    hard black band in one render, with no change to the material.

    The cards are invisible to camera rays and present in every other ray. A
    card positioned to be reflected in the bumper is otherwise a black wall
    across the hero shot - the close cameras are inside it and the hero camera
    is behind it.
    """
    lo, hi = bounds(objs)
    size = max(hi[i] - lo[i] for i in range(3))
    made = []

    def card(loc, sx, sy, rot, hexcol, rough, cam_visible):
        bpy.ops.mesh.primitive_plane_add(size=1.0, location=loc, rotation=rot)
        o = bpy.context.object
        o.name = '_studio_' + ('floor' if cam_visible else 'flag')
        o.scale = (sx, sy, 1.0)
        m = bpy.data.materials.new(o.name)
        m.use_nodes = True
        b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        b.inputs['Base Color'].default_value = tx.srgb(hexcol)
        b.inputs['Roughness'].default_value = rough
        o.data.materials.append(m)
        if not cam_visible:
            try:
                o.visible_camera = False
            except AttributeError:
                o.cycles_visibility.camera = False
        made.append(o)
        return o

    card((0, 0, lo[2] - size * 0.001), size * 40, size * 40, (0, 0, 0),
         floor, 0.16, True)
    card((0, 0, hi[2] + size * 3.2), size * 4, size * 2.5, (0, 0, 0),
         0x090A0B, 0.65, False)
    card((0, -size * 1.2, hi[2] + size * 2.0), size * 4, size * 1.3,
         (math.pi / 2, 0, 0), 0x090A0B, 0.65, False)
    return made


def clear_studio():
    for o in list(bpy.context.scene.objects):
        if o.name.startswith('_studio_'):
            bpy.data.objects.remove(o, do_unlink=True)


def rake_light(target_size):
    """A sun almost level with the surface. Grazing light is the only thing
    that separates relief from a picture of relief."""
    el = math.radians(cfg.RAKE_ELEVATION_DEG)
    az = math.radians(cfg.RAKE_AZIMUTH_DEG)
    d = target_size * 8
    return sun((math.cos(el) * math.sin(az) * d,
                -math.cos(el) * math.cos(az) * d,
                math.sin(el) * d), cfg.SUN_ENERGY * 1.6, 'rake')


def camera(loc, look, lens=50, ortho=None):
    cam = bpy.data.cameras.new('cam')
    cam.lens = lens
    cam.clip_start = 0.001
    cam.clip_end = 5000
    if ortho:
        cam.type = 'ORTHO'
        cam.ortho_scale = ortho
    ob = bpy.data.objects.new('cam', cam)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    d = mathutils.Vector(look) - mathutils.Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = ob
    return ob


def bounds(objs):
    lo = [1e9] * 3
    hi = [-1e9] * 3
    for o in objs:
        if o.type != 'MESH':
            continue
        m = o.matrix_world
        for v in o.data.vertices:
            w = m @ v.co
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    return lo, hi


def render(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('SHOT', path)


# ---------------------------------------------------------------- mask view

class MaskView:
    """Render one mask on the model as flat grey.

    Swaps every material for an emission driven by the mask socket, so what
    you see is exactly where the mask is strong — no lighting, no base colour,
    nothing to misread. White is 1, black is 0.

    This is the shot to reach for first when a material is wrong. Nine times
    out of ten the surface is fine and the placement is not."""

    def __init__(self, objs, build_mask):
        self.objs = [o for o in objs if o.type == 'MESH']
        self.build_mask = build_mask
        self.stash = []

    def __enter__(self):
        mat = bpy.data.materials.new('_maskview')
        mat.use_nodes = True
        nt = mat.node_tree
        for n in list(nt.nodes):
            if n.type != 'OUTPUT_MATERIAL':
                nt.nodes.remove(n)
        out = nt.nodes['Material Output']
        em = nt.nodes.new('ShaderNodeEmission')
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])

        g = tx.Graph.__new__(tx.Graph)
        g.mat, g.nt, g._x, g._coord = mat, nt, -400, None
        g.bsdf = em
        socket = self.build_mask(g)
        nt.links.new(socket, em.inputs['Color'])

        self.mat = mat
        for o in self.objs:
            self.stash.append((o, list(o.data.materials),
                               [p.material_index for p in o.data.polygons]))
            o.data.materials.clear()
            o.data.materials.append(mat)
        self.world = bpy.context.scene.world
        world(0x000000, strength=0.0, name='texworld_mask')
        return self

    def __exit__(self, *exc):
        for o, mats, idx in self.stash:
            o.data.materials.clear()
            for m in mats:
                o.data.materials.append(m)
            for p, i in zip(o.data.polygons, idx):
                p.material_index = i
        bpy.context.scene.world = self.world
        bpy.data.materials.remove(self.mat)
        return False


def mask_stats(mask_png, all_png):
    """Measure a mask view: what fraction of the model it actually covers.

    "The moss looks thin" is not something you can act on twice. "8.5 percent,
    target 15" is. Reported against `all_png`, a constant-1 render of the same
    view, so coverage is a fraction of the *model* rather than of the frame.

    `soft` is the fraction sitting in the mushy middle — a mask that is mostly
    soft is a gradient, and a gradient is what weathering never looks like."""
    import numpy as np
    out = {}
    ref = bpy.data.images.load(all_png)
    ref.colorspace_settings.name = 'Non-Color'
    w, h = ref.size
    rbuf = np.empty(w * h * 4, dtype=np.float32)
    ref.pixels.foreach_get(rbuf)
    body = rbuf.reshape(-1, 4)[:, 0] > 0.02
    bpy.data.images.remove(ref)
    n_body = int(body.sum())
    if not n_body:
        return {'error': 'the constant-1 view is empty; is the model in frame?'}

    img = bpy.data.images.load(mask_png)
    img.colorspace_settings.name = 'Non-Color'
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    v = buf.reshape(-1, 4)[:, 0][body]
    bpy.data.images.remove(img)
    # Undo the view transform, or every threshold below is measuring the wrong
    # number. Measured in this Blender: a MaskView emitting exactly 0.50 writes
    # 0.7354 to the PNG — srgb_encode(0.5) to four places — and `pixels`
    # returns that same 0.7354 whether the image is loaded as Non-Color or as
    # sRGB, so the colorspace setting changes nothing on read. Thresholding the
    # stored value at 0.5 therefore counts everything above a mask value of
    # 0.214 as strong, which is the twenty-point optimism this was trying to
    # avoid rather than a cure for it.
    v = np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)
    out['strong'] = float((v > 0.5).mean() * 100.0)
    out['soft'] = float(((v > 0.15) & (v < 0.5)).mean() * 100.0)
    out['mean'] = float(v.mean())
    return out


def sheet(objs, name, masks=None, hero=None):
    """The full set. `masks` is {label: fn(graph) -> socket}."""
    out = os.path.join(cfg.SHOTS, name)
    lo, hi = bounds(objs)
    size = max(hi[i] - lo[i] for i in range(3))
    centre = tuple((lo[i] + hi[i]) / 2 for i in range(3))

    el = math.radians(35.264389682754654)
    az = math.radians(45.0)
    hero_loc = (centre[0] + math.cos(el) * math.sin(az) * size * 4,
                centre[1] - math.cos(el) * math.cos(az) * size * 4,
                centre[2] + math.sin(el) * size * 4)

    # 1. lit hero
    key = sun(cfg.SUN_FROM, cfg.SUN_ENERGY)
    if getattr(cfg, 'STUDIO_ENV', False):
        studio_world()            # gradient and highlight, for a mirror
        studio_cards(objs)        # floor and black flags: the other half
    else:
        world(cfg.SKY)
    camera(hero_loc, centre, ortho=size * 1.5)
    render(os.path.join(out, 'hero.png'))

    # 2. close, under raking light
    clear_studio()
    bpy.data.objects.remove(key, do_unlink=True)
    rake_light(size)
    world(cfg.SKY, strength=0.15)
    close = (centre[0] + size * 0.75, centre[1] - size * 0.75,
             centre[2] + size * 0.35)
    camera(close, centre, lens=85)
    render(os.path.join(out, 'rake.png'))

    # 3. flat front light: the albedo on its own, no relief, no shadow
    for o in list(bpy.context.scene.objects):
        if o.type == 'LIGHT':
            bpy.data.objects.remove(o, do_unlink=True)
    world(0xFFFFFF, strength=1.0)
    camera(close, centre, lens=85)
    render(os.path.join(out, 'flat.png'))

    # 4. every mask, on its own — at hero framing and close, with numbers.
    #
    # Close framing matters: a 2.5 m band is about twenty pixels wide in the
    # hero shot, and you cannot judge whether an edge is ragged or smooth at
    # twenty pixels. Two passes of a mask can look identical at hero size and
    # obviously different close up.
    if masks:
        all_png = os.path.join(out, 'mask__all.png')
        with MaskView(objs, lambda g: g.colour(0xFFFFFF)):
            camera(hero_loc, centre, ortho=size * 1.5)
            render(all_png)
        stats = {}
        for label, fn in masks.items():
            with MaskView(objs, fn):
                camera(hero_loc, centre, ortho=size * 1.5)
                p = os.path.join(out, 'mask_%s.png' % label)
                render(p)
                camera(close, centre, lens=85)
                render(os.path.join(out, 'maskc_%s.png' % label))
            try:
                stats[label] = mask_stats(p, all_png)
            except Exception as e:                      # numpy or a bad render
                stats[label] = {'error': str(e)}
        print()
        print('%-14s %8s %8s %8s' % ('mask', 'strong%', 'soft%', 'mean'))
        for label, s in sorted(stats.items()):
            if 'error' in s:
                print('%-14s  %s' % (label, s['error']))
            else:
                print('%-14s %8.1f %8.1f %8.3f'
                      % (label, s['strong'], s['soft'], s['mean']))
        print('strong is the fraction of the model the mask actually covers.')
        print('a high soft fraction means a gradient, and weathering is not a')
        print('gradient - if soft exceeds strong, tighten the mask.')

    print('SHEET  %s' % out)
    return out


def main():
    args = argv()
    if not args:
        raise SystemExit('usage: texshots.py -- <model-name>')
    name = args[0]
    path = os.path.join(cfg.MODELS, name + '.glb')
    if not os.path.exists(path):
        raise SystemExit('no such model: ' + path)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup()
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.context.scene.objects if o not in before]
    sheet(objs, name)
    print()
    print('NOTE  no mask views were rendered.')
    print('      A baked glb carries no procedural graph, so there are no masks')
    print('      left to show. The mask views are the point of this sheet, so')
    print('      call sheet(objs, name, masks={...}) from your own skin script,')
    print('      before baking, while the graph still exists.')


if __name__ == '__main__':
    main()
