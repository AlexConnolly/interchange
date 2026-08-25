# Shared modelling helpers. Nothing is built here.
#
# The job of this file is to make the build scripts read like descriptions of
# shapes rather than like Blender API calls, and to enforce the two things that
# are easy to get wrong and expensive to notice late: hard shading everywhere,
# and part origins that sit on the joint they rotate about.
import bpy
import bmesh
import math
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'packages', 'client', 'public', 'models')

# The material slot every model reserves for company colour.
#
# art-pipeline.md 4.2: Tribe Wars bakes faction colour into the material, which
# is right when there are two fixed sides and wrong here, where up to eight
# companies in one region run the same lorry. Faces painted with this material
# are tinted per company by the renderer at draw time; everything else keeps
# the colour it was authored with.
#
# It is a name rather than an index because a glTF material index depends on
# what order the exporter happened to write the slots in, and the renderer has
# to be able to find it without knowing that.
LIVERY = 'livery'


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # materials survive a scene reset by name, and reusing one across two
    # exports is how a red unit ends up wearing blue steel
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)


# ---------------------------------------------------------------- materials

def material(name, rgba, emissive=0.0, rough=0.72, metal=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = rgba
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emissive > 0:
        b.inputs['Emission Color'].default_value = rgba
        b.inputs['Emission Strength'].default_value = emissive
    return m


# ---------------------------------------------------------------- primitives
#
# Everything is flat shaded. At forty pixels a smooth normal is mush, and the
# toon ramp the game shades with wants facets to break against.

def _finish(obj, mesh, loc, rot, scale=(1, 1, 1)):
    obj.location = loc
    obj.rotation_euler = rot
    obj.scale = scale
    for p in mesh.polygons:
        p.use_smooth = False
    return obj


def _new(name):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj, mesh


def box(name, size, loc=(0, 0, 0), rot=(0, 0, 0), chamfer=0.0, taper=1.0,
        segments=1, shear=0.0):
    """A chamfered box, optionally narrowed at the top or sheared along Y.

    Chamfer rather than bevel-for-realism: a two degree rounding is invisible
    at this size and costs the same. A visible cut plane catches the key light
    and gives the form an edge to sit on, which is most of what separates a
    modelled shape from a stretched cube."""
    obj, mesh = _new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    if taper != 1.0:
        for v in bm.verts:
            if v.co.z > 0:
                v.co.x *= taper
                v.co.y *= taper
    if shear:
        for v in bm.verts:
            v.co.y += v.co.z * shear
    if chamfer > 0:
        bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                        offset=chamfer, segments=segments, affect='EDGES', profile=0.5)
    bm.to_mesh(mesh)
    bm.free()
    return _finish(obj, mesh, loc, rot)


def wedge(name, size, loc=(0, 0, 0), rot=(0, 0, 0), pinch=0.15):
    """A box pinched to a ridge along +Y. Crests, keels, blades, prows —
    anything whose job is to say which way the thing is pointing."""
    obj = box(name, size, loc, rot)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for v in bm.verts:
        if v.co.y > 0:
            v.co.x *= pinch
    bm.to_mesh(obj.data)
    bm.free()
    return obj


def cyl(name, r1, r2, h, loc=(0, 0, 0), rot=(0, 0, 0), segments=8, chamfer=0.0):
    obj, mesh = _new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=r1, radius2=r2, depth=h)
    if chamfer > 0:
        bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                        offset=chamfer, segments=1, affect='EDGES', profile=0.5)
    bm.to_mesh(mesh)
    bm.free()
    return _finish(obj, mesh, loc, rot)


def sphere(name, r, loc=(0, 0, 0), rot=(0, 0, 0), subdiv=1, scale=(1, 1, 1)):
    obj, mesh = _new(name)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    bm.to_mesh(mesh)
    bm.free()
    return _finish(obj, mesh, loc, rot, scale)


def plate(name, w, d, t, loc=(0, 0, 0), rot=(0, 0, 0), chamfer=0.03):
    """Armour: a thin slab with its edges cut. Used often enough to name."""
    return box(name, (w, d, t), loc, rot, chamfer=chamfer)


def tube(name, r, h, loc=(0, 0, 0), rot=(0, 0, 0), segments=6):
    return cyl(name, r, r, h, loc, rot, segments=segments)


def ring(name, r_in, r_out, w, loc=(0, 0, 0), rot=(0, 0, 0), segments=9):
    """An annulus with thickness: a wheel rim, a collar, a hoop.

    A cylinder cannot be this. It is solid, and a solid disc standing where a
    cartwheel should be is the difference between a wheel and a lump — the hole
    between the spokes is most of what says the thing rolls. Four quads a
    segment: outer, inner, and the two faces."""
    obj, mesh = _new(name)
    bm = bmesh.new()
    rows = [[bm.verts.new((math.cos(i / segments * math.tau) * r,
                           math.sin(i / segments * math.tau) * r, z))
             for i in range(segments)]
            for r in (r_out, r_in) for z in (w / 2, -w / 2)]
    ot, ob, it, ib = rows
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((ot[i], ot[j], ob[j], ob[i]))
        bm.faces.new((ib[i], ib[j], it[j], it[i]))
        bm.faces.new((it[i], it[j], ot[j], ot[i]))
        bm.faces.new((ob[i], ob[j], ib[j], ib[i]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    return _finish(obj, mesh, loc, rot)


# ---------------------------------------------------------------- hierarchy
#
# A unit is exported as a tree of named nodes because the animator in
# units.js drives it by name. The names are a contract; see the README.

def part(name, loc=(0, 0, 0), parent=None):
    """An empty at a joint. Its origin is the pivot the animator rotates
    about, so an arm's `part` sits at the shoulder and the meshes hang below
    it. Get this wrong and the limb windmills from the elbow."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.08
    bpy.context.collection.objects.link(e)
    e.location = loc
    if parent:
        e.parent = parent
    return e


def attach(obj, parent, mat=None):
    """Parent a mesh to a part without moving it. Blender's plain assignment
    keeps the local transform, which is what we want: everything is authored
    in world coordinates and the parent's origin is subtracted on export."""
    if mat:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    if parent:
        # The depsgraph has to be evaluated first. Setting an empty's
        # location does not update its matrix_world until Blender
        # re-evaluates, so taking the inverse straight away yields the
        # identity and every child ends up displaced by its parent's
        # position — a soldier a metre off the ground with no legs.
        bpy.context.view_layer.update()
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def merge_into(name, parts, parent, mat=None):
    """Join a bag of meshes into one and hang it off a part. Fewer draw calls
    and fewer nodes; used for everything that does not need to move on its
    own, which is most of a model."""
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    # A join leaves the origin wherever the active object's was. Put it back at
    # the world origin so the parenting maths below is predictable — this is
    # the bug that buried the first batch of units to the knee.
    bpy.context.scene.cursor.location = (0.0, 0.0, 0.0)
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    return attach(obj, parent, mat)


def repaint(obj, rules):
    """Per-face materials on a grown mesh.

    A pauldron that grows out of the chest is *the same mesh* as the chest —
    that is the point of growing it — so steel over cloth cannot be a second
    object. It has to be a face assignment. Rules are (material, test) applied
    in order against the face centre, so a later rule wins where they overlap
    and the list reads outermost-last."""
    slot = {}
    for mat, _ in rules:
        if mat.name not in slot:
            obj.data.materials.append(mat)
            slot[mat.name] = len(obj.data.materials) - 1
    for p in obj.data.polygons:
        c = p.center
        for mat, test in rules:
            if test(c):
                p.material_index = slot[mat.name]
    return obj


# ---------------------------------------------------------------- export

def livery_material():
    """The reserved slot. Authored mid-grey so a model that is never tinted —
    in a review render, say — still reads as bodywork rather than as a hole."""
    return material(LIVERY, (0.55, 0.55, 0.57, 1.0), rough=0.55)


def export(name, roots, report):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True, export_cameras=False,
        export_lights=False, export_extras=False,
    )
    tris = 0
    lo, hi = 1e9, -1e9
    for o in bpy.context.scene.objects:
        if o.type != 'MESH':
            continue
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
        for v in o.data.vertices:
            z = (o.matrix_world @ v.co).z
            lo = min(lo, z)
            hi = max(hi, z)
    report.append((name, tris, lo, hi))
    return path


def summarise(report, budget=None):
    print('=== exported ===')
    worst = 0
    for name, tris, lo, hi in sorted(report):
        flag = ''
        if budget and tris > budget:
            flag = '  OVER BUDGET (%d)' % budget
        if lo < -0.02:
            flag += '  SUNK %.2f' % lo
        worst = max(worst, tris)
        print('%-26s %5d tris   floor %+.2f  top %+.2f%s' % (name, tris, lo, hi, flag))
    print('%d models, heaviest %d tris' % (len(report), worst))
