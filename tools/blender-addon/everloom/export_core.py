# SPDX-License-Identifier: MIT
"""The one export script behind every Blender conversion: the Everloom add-on, the server's worker
and the rented worker all call `export_model` (docs/3d-import/blend.md).

`export_model` changes the scene it works on (modifiers are applied, the armature is replaced by a
deform-only one), so callers run it in a throwaway Blender: the worker opens the .blend in a fresh
process, and the add-on exports a saved copy in a background Blender (`export_copy`). In order:

1. Geometry that renders but isn't a mesh (curves, text, surfaces, hair curves, particle hair)
   becomes mesh; hair strands become thin tubes that take their skin weights from the scalp.
2. Modifiers are applied the way a render shows them, shape keys included (each key is evaluated
   through the stack). Subdivision, simulations and deformers that only react to motion are
   dropped. Whatever can't be applied is listed, never silently lost.
3. Meshes that follow a bone rigidly (parented to a bone, or to the armature without weights) are
   skinned to that bone, so glTF moves them the same way.
4. A deform-only skeleton is built. Control rigs (Rigify, Auto-Rig Pro and similar) place their
   deform bones with constraints from a separate control hierarchy, which glTF can't carry: each
   deform bone's parent is found by following its constraint targets and parents to the nearest
   deform bone. Rest matrices are copied exactly. The file's own clips are baked onto it.
5. Skin weights: at most four per vertex, normalized; vertices nothing weights take their nearest
   weighted neighbour's weights.
6. Materials the glTF exporter can't read (toon shaders, node groups) become a Principled BSDF
   with the material's own colour texture; external textures that exist are packed.
7. The GLB is exported in the rest pose and read back (`validate_glb`): every kept bone present,
   parents as planned, rest positions, every vertex weighted, at most four influences, bounds.
"""
import json
import math
import os
import struct

import bpy

# Modifiers that are dropped before export (too heavy, simulation, or nothing to apply).
DROP = {"SUBSURF", "MULTIRES", "COLLISION", "CLOTH", "SOFT_BODY", "PARTICLE_SYSTEM", "DYNAMIC_PAINT", "FLUID",
        "OCEAN", "EXPLODE", "PARTICLE_INSTANCE", "TRIANGULATE", "SURFACE"}
# Deformers that react to the armature's motion or to time: they do nothing useful at rest.
MOTION_DEFORMERS = {"CORRECTIVE_SMOOTH", "SURFACE_DEFORM", "LAPLACIANDEFORM", "MESH_DEFORM", "LATTICE", "HOOK", "WAVE"}
# Constraints that decide where a bone sits (its "attachment"), at full strength.
CONSTRAINT_ATTACH = ("COPY_TRANSFORMS", "CHILD_OF", "ARMATURE", "COPY_LOCATION")
NON_MESH = ("CURVE", "SURFACE", "FONT", "META", "CURVES")


def _log(report, key, value):
    report.setdefault(key, []).append(value)


def _object_mode():
    active = bpy.context.view_layer.objects.active
    if active and active.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


# ------------------------------------------------------------------------------------------------
# 1. Non-mesh geometry
# ------------------------------------------------------------------------------------------------

def renders(obj, layer_names):
    if obj.name not in layer_names or obj.hide_render:
        return False
    return not any(c.hide_render for c in obj.users_collection)


def weights_from_surface(target, source, reach=0.2):
    """Skin weights for `target` from the nearest surface of `source` (hair from its scalp)."""
    if not source or source.type != "MESH" or not source.vertex_groups or not source.data.polygons:
        return False
    from mathutils.bvhtree import BVHTree
    sm = source.matrix_world
    sverts = [sm @ v.co for v in source.data.vertices]
    polys = [list(p.vertices) for p in source.data.polygons]
    tree = BVHTree.FromPolygons(sverts, polys)
    names = {g.index: g.name for g in source.vertex_groups}
    sw = [{names[g.group]: g.weight for g in v.groups if g.weight > 1e-4} for v in source.data.vertices]
    tm = target.matrix_world
    for v in target.data.vertices:
        loc, _n, idx, dist = tree.find_nearest(tm @ v.co)
        if idx is None or dist > reach:
            continue
        acc = {}
        for vi in polys[idx]:
            k = 1.0 / max((sverts[vi] - loc).length, 1e-5)
            for name, w in sw[vi].items():
                acc[name] = acc.get(name, 0.0) + w * k
        top = sorted(acc.items(), key=lambda t: -t[1])[:4]
        total = sum(w for _, w in top) or 1.0
        for name, w in top:
            g = target.vertex_groups.get(name) or target.vertex_groups.new(name=name)
            g.add([v.index], w / total, "REPLACE")
    for m in source.modifiers:
        if m.type == "ARMATURE" and m.object and not any(x.type == "ARMATURE" for x in target.modifiers):
            target.modifiers.new("Armature", "ARMATURE").object = m.object
    if source.parent and not target.parent:
        mw = target.matrix_world.copy()
        target.parent = source.parent
        target.matrix_world = mw
    return True


def tube_mesh(name, strands, radius):
    """Thin three-sided tubes along polylines in world space (hair strands), as one mesh object."""
    import bmesh
    from mathutils import Vector
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    sides = 3
    for pts in strands:
        if len(pts) < 2:
            continue
        rings = []
        for i, p in enumerate(pts):
            d = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
            if d.length < 1e-9:
                d = Vector((0, 0, 1))
            d.normalize()
            a = d.orthogonal().normalized()
            b = d.cross(a)
            r = radius * (1 - 0.8 * i / (len(pts) - 1))
            rings.append([bm.verts.new(p + (a * math.cos(t) + b * math.sin(t)) * r) for t in (2 * math.pi * s / sides for s in range(sides))])
        for r0, r1 in zip(rings, rings[1:]):
            for s in range(sides):
                bm.faces.new((r0[s], r0[(s + 1) % sides], r1[(s + 1) % sides], r1[s]))
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def strands_from_edges(me, matrix):
    nbr = {}
    for e in me.edges:
        a, b = e.vertices
        nbr.setdefault(a, []).append(b)
        nbr.setdefault(b, []).append(a)
    seen = set()
    strands = []
    for start, ns in nbr.items():
        if len(ns) != 1 or start in seen:
            continue
        line, prev, cur = [start], None, start
        seen.add(start)
        while True:
            nxt = [n for n in nbr[cur] if n != prev and n not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            seen.add(cur)
            line.append(cur)
        strands.append([matrix @ me.vertices[i].co for i in line])
    return strands


def convert_non_mesh(objects, report, max_strands=3000):
    """Renderable curves, text, surfaces, hair curves and particle hair become mesh objects."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    out = []
    for obj in list(objects):
        try:
            if obj.type in ("CURVE", "SURFACE", "FONT", "META"):
                me = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), preserve_all_data_layers=True, depsgraph=depsgraph)
                if not me.polygons:
                    bpy.data.meshes.remove(me)
                    continue  # a path, a bevel profile or a taper: nothing visible
                new = bpy.data.objects.new(obj.name + "_mesh", me)
                bpy.context.scene.collection.objects.link(new)
                new.parent, new.parent_type, new.parent_bone = obj.parent, obj.parent_type, obj.parent_bone
                new.matrix_world = obj.matrix_world.copy()
                out.append(new)
                _log(report, "converted", "%s (%s) to a mesh" % (obj.name, obj.type.lower()))
            elif obj.type == "CURVES":
                me = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), depsgraph=depsgraph)
                if me.polygons:
                    new = bpy.data.objects.new(obj.name + "_mesh", me)
                    bpy.context.scene.collection.objects.link(new)
                    new.matrix_world = obj.matrix_world.copy()
                    kept = "as modelled"
                else:
                    strands = strands_from_edges(me, obj.matrix_world)
                    bpy.data.meshes.remove(me)
                    step = max(1, len(strands) // max_strands)
                    new = tube_mesh(obj.name + "_mesh", strands[::step], 0.0015)
                    kept = "%d of %d strands" % (len(strands[::step]), len(strands))
                    for m in obj.data.materials:
                        if m:
                            new.data.materials.append(m)
                weights_from_surface(new, getattr(obj.data, "surface", None))
                out.append(new)
                _log(report, "converted", "%s (hair curves, %s) to a mesh" % (obj.name, kept))
            elif obj.type == "MESH":
                for mod in [m for m in obj.modifiers if m.type == "PARTICLE_SYSTEM"]:
                    ps = mod.particle_system
                    st = ps.settings
                    if st.type != "HAIR" or st.render_type != "PATH":
                        continue
                    # Blender's own conversion (the strands as the depsgraph makes them, child
                    # hairs included): a mesh of edges, one polyline per strand.
                    before = set(bpy.data.objects)
                    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
                        bpy.ops.object.modifier_convert(modifier=mod.name)
                    made = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
                    if not made:
                        continue
                    edges = made[0]
                    strands = strands_from_edges(edges.data, edges.matrix_world)
                    bpy.data.objects.remove(edges, do_unlink=True)
                    if not strands:
                        continue
                    step = max(1, len(strands) // max_strands)
                    radius = 0.0015
                    if hasattr(st, "root_radius") and hasattr(st, "radius_scale"):
                        radius = max(0.0005, st.root_radius * st.radius_scale * 0.5)
                    new = tube_mesh(obj.name + "_" + ps.name, strands[::step], radius)
                    if 0 < st.material <= len(obj.material_slots) and obj.material_slots[st.material - 1].material:
                        new.data.materials.append(obj.material_slots[st.material - 1].material)
                    weights_from_surface(new, obj)
                    out.append(new)
                    _log(report, "converted", "%s particle hair %s (%d of %d strands)" % (obj.name, ps.name, len(strands[::step]), len(strands)))
        except Exception as e:  # noqa: BLE001
            _log(report, "notConverted", "%s: %s" % (obj.name, str(e)[:120]))
    return out


# ------------------------------------------------------------------------------------------------
# 2. Modifiers, shape keys included
# ------------------------------------------------------------------------------------------------

def _evaluated_mesh(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    return bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)


def apply_modifiers(obj, report):
    """Applies what a render shows (except the armature): per shape key when the mesh has keys."""
    to_apply = []
    for m in list(obj.modifiers):
        if m.type == "ARMATURE":
            continue
        if not m.show_render or m.type in DROP or m.type in MOTION_DEFORMERS:
            _log(report, "modifiersDropped", "%s: %s (%s)" % (obj.name, m.name, m.type.lower()))
            obj.modifiers.remove(m)
            continue
        to_apply.append(m.name)
    if not to_apply:
        return
    arms = [m for m in obj.modifiers if m.type == "ARMATURE"]
    saved = [(m, m.show_viewport) for m in arms]
    for m in arms:
        m.show_viewport = False
    for name in to_apply:
        obj.modifiers[name].show_viewport = True
    if obj.data.users > 1:
        obj.data = obj.data.copy()
    kinds = ", ".join(obj.modifiers[n].type.lower() for n in to_apply)
    try:
        if obj.data.shape_keys:
            _bake_with_keys(obj)
        else:
            # Replaced meshes are left as orphans (the export takes objects, not data): freeing one
            # here can leave the depsgraph pointing at it from another object's boolean or mirror.
            name = obj.data.name
            obj.data = _evaluated_mesh(obj)
            obj.data.name = name
        _log(report, "modifiersApplied", "%s: %s" % (obj.name, kinds))
    except Exception as e:  # noqa: BLE001
        # A modifier that changes topology between shape keys (a boolean): left out, and said so.
        import traceback
        where = traceback.extract_tb(e.__traceback__)[-1]
        _log(report, "modifiersNotApplied", "%s: %s (%s; line %d)" % (obj.name, kinds, str(e)[:100], where.lineno))
    finally:
        for name in to_apply:
            if name in obj.modifiers:
                obj.modifiers.remove(obj.modifiers[name])
        for m, v in saved:
            m.show_viewport = v


def _transfer_keys(base, blocks):
    """Shape key positions for `base` (the mesh after its modifiers): each vertex takes the offset
    of the nearest original vertex (mirrored copies take the mirrored offset)."""
    from mathutils import Vector, kdtree
    basis = blocks[0].data
    tree = kdtree.KDTree(len(basis))
    for i, v in enumerate(basis):
        tree.insert(v.co, i)
    tree.balance()
    match = []
    for v in base.vertices:
        co, i, d = tree.find(v.co)
        mco, mi, md = tree.find(Vector((-v.co.x, v.co.y, v.co.z)))
        match.append((mi, True) if md + 1e-6 < d else (i, False))
    out = []
    for b in blocks[1:]:
        key = b.data
        rows = []
        for v, (i, mirrored) in zip(base.vertices, match):
            delta = key[i].co - basis[i].co
            if mirrored:
                delta.x = -delta.x
            rows.append(v.co + delta)
        out.append(rows)
    return out


def _bake_with_keys(obj):
    data = obj.data
    keys = data.shape_keys
    blocks = list(keys.key_blocks)
    meta = [(b.name, b.value, b.slider_min, b.slider_max, b.vertex_group, b.interpolation, b.mute) for b in blocks]
    # Drivers would overwrite the values set below while each key is evaluated.
    drivers = [d for d in (keys.animation_data.drivers if keys.animation_data else []) if not d.mute]
    for d in drivers:
        d.mute = True
    try:
        use_relative = keys.use_relative
        obj.show_only_shape_key = False
        for b in blocks:
            b.value = 0.0
            b.mute = False
        base = _evaluated_mesh(obj)
        coords = []
        for b in blocks[1:]:
            for x in blocks:
                x.value = 0.0
            b.slider_max = max(b.slider_max, 1.0)
            b.value = 1.0
            me = _evaluated_mesh(obj)
            same = len(me.vertices) == len(base.vertices)
            if same:
                coords.append([v.co.copy() for v in me.vertices])
            bpy.data.meshes.remove(me)
            if not same:
                # The stack changes topology with the shape (a boolean cutting a moving part):
                # every key is carried over from the original mesh instead.
                coords = _transfer_keys(base, blocks)
                break
        base.name = data.name
        obj.data = base
        obj.shape_key_add(name=meta[0][0], from_mix=False)
        for (name, value, smin, smax, vgroup, interp, mute), co in zip(meta[1:], coords):
            kb = obj.shape_key_add(name=name, from_mix=False)
            for v, c in zip(kb.data, co):
                v.co = c
            kb.slider_min, kb.slider_max = smin, max(smax, value)
            kb.value = value
            kb.vertex_group = vgroup if vgroup in obj.vertex_groups else ""
            kb.interpolation = interp
            kb.mute = mute
        obj.data.shape_keys.use_relative = use_relative
    finally:
        if obj.data == data:
            # Not replaced (an error above): the mesh is left exactly as it was.
            for d in drivers:
                d.mute = False
            for b, m in zip(data.shape_keys.key_blocks, meta):
                b.value = m[1]
    # The old mesh stays as an orphan (see apply_modifiers); its drivers go nowhere (glTF has none).


# ------------------------------------------------------------------------------------------------
# 3 + 4. The deform skeleton
# ------------------------------------------------------------------------------------------------

def attach_source(pb, arm):
    """The bone a pose bone takes its place from: a full-strength copy/child-of target, else its parent."""
    for c in pb.constraints:
        if c.mute or c.influence < 0.99 or c.type not in CONSTRAINT_ATTACH:
            continue
        if c.type == "ARMATURE":
            best = max((t for t in c.targets if t.target == arm and t.subtarget), key=lambda t: t.weight, default=None)
            if best:
                return best.subtarget
            continue
        if getattr(c, "target", None) == arm and getattr(c, "subtarget", ""):
            return c.subtarget
    return pb.bone.parent.name if pb.bone.parent else None


def _chain_up(name, parents):
    """`name` and its planned ancestors (stops on a loop)."""
    out, p = [name], parents.get(name)
    while p and p not in out:
        out.append(p)
        p = parents.get(p)
    return out


def plan_deform_rig(arm):
    """Which bones the export keeps and each one's parent: (keep, parents, how many changed)."""
    bones = arm.data.bones
    deform = {b.name for b in bones if b.use_deform}
    # Blender's armature modifier ignores weights on non-deform bones, so the export does too.
    keep = set(deform) if deform else {b.name for b in bones}
    attach = {pb.name: attach_source(pb, arm) for pb in arm.pose.bones}
    # A kept bone that follows another bone stands in for it (a DEF bone copying its ORG bone).
    stand_in = {}
    for name in sorted(keep):
        src = attach.get(name)
        if src and src not in keep and src not in stand_in:
            stand_in[src] = name

    def descendants(n):
        out, todo = set(), [n]
        while todo:
            for c in bones[todo.pop()].children:
                if c.name not in out:
                    out.add(c.name)
                    todo.append(c.name)
        return out

    def original(name):
        p = bones[name].parent
        while p and p.name not in keep:
            p = p.parent
        return p.name if p else None

    def helper(n):
        return any(w in n.lower() for w in ("twist", "roll", "helper", "offset", "pin", "bend"))

    def touching(name, below):
        """Kept bones whose tail is at this bone's head: the joint it hangs from (a twist or
        helper bone ending at the same joint is the weaker choice)."""
        b = bones[name]
        found = [k for k in keep if k != name and k not in below
                 and (bones[k].tail_local - b.head_local).length <= max(1e-4, 0.03 * min(bones[k].length, b.length))]
        found.sort(key=lambda k: (helper(k), -bones[k].length))
        return found[0] if found else None

    parents = {}
    for name in keep:
        below = descendants(name)
        orig = bones[name].parent
        # Driven by a control rig: the deform bone hangs off a control bone, or a constraint
        # places it. An ordinary deform hierarchy keeps its own parents.
        controlled = (orig is None and attach.get(name) is not None) or (orig is not None and orig.name not in keep) or attach.get(name) != (orig.name if orig else None)
        seen = {name}
        s = attach.get(name)
        parent = None
        while s and s not in seen:
            seen.add(s)
            if s in keep and s not in below:
                parent = s
                break
            k = stand_in.get(s)
            if k and k != name and k not in below:
                parent = k
                break
            s = attach.get(s)
        if controlled:
            # Control rigs (Auto-Rig Pro) chain their deform limbs only through constraints;
            # where one bone's tail meets this one's head, that is the joint.
            touch = touching(name, below)
            if touch:
                parent = touch
        parents[name] = parent
    # Twist and helper bones of a control rig are leaves: a main bone never hangs from one, it
    # hangs from the helper's own main bone (the hand from the forearm, not the forearm's twist).
    for name in keep:
        if helper(name) or not (bones[name].parent is None or bones[name].parent.name not in keep):
            continue
        seen = {name}
        p = parents[name]
        while p and helper(p) and p not in seen:
            seen.add(p)
            p = parents.get(p)
        parents[name] = p
    # One skeleton, one root: stray roots join the kept bone nearest their head. The main root is
    # named like one (root, hips, pelvis, centre), else holds the most bones.
    roots = [n for n in keep if parents[n] is None]
    if len(roots) > 1:
        size = {r: len([n for n in keep if r in _chain_up(n, parents)]) for r in roots}
        rootish = ("root", "hip", "pelvis", "cog", "center", "centre", "torso")
        main = max(roots, key=lambda r: (any(w in r.lower() for w in rootish), size[r]))
        for r in roots:
            if r == main:
                continue
            below = {n for n in keep if r in _chain_up(n, parents)}
            h = bones[r].head_local
            near = min((n for n in keep if n not in below), key=lambda n: min((bones[n].head_local - h).length, (bones[n].tail_local - h).length), default=None)
            parents[r] = near
    # Never a loop: a bone that would close one keeps its original deform ancestor.
    for name in sorted(parents):
        seen, p = {name}, parents[name]
        while p:
            if p in seen:
                parents[name] = original(name)
                break
            seen.add(p)
            p = parents.get(p)
    changed = sum(1 for name, p in parents.items() if original(name) != p)
    return keep, parents, changed


def rigid_to_skinned(meshes, arm, keep, parents, report):
    """Meshes parented to a bone, or to the armature without weights, are skinned to that bone."""
    def kept(bone_name):
        b = arm.data.bones.get(bone_name)
        guard = set()
        while b and b.name not in keep and b.name not in guard:
            guard.add(b.name)
            src = attach_source(arm.pose.bones[b.name], arm)
            b = arm.data.bones.get(src) if src else None
        return b.name if b and b.name in keep else None

    roots = sorted(n for n, p in parents.items() if p is None)
    bone_names = {b.name for b in arm.data.bones}
    for obj in meshes:
        if obj.parent != arm:
            continue
        has_mod = any(m.type == "ARMATURE" and m.object == arm for m in obj.modifiers)
        groups = {g.index for g in obj.vertex_groups if g.name in bone_names}
        weighted = has_mod and groups and any(g.weight > 0 and g.group in groups for v in obj.data.vertices for g in v.groups)
        if obj.parent_type == "BONE" and obj.parent_bone and not weighted:
            target = kept(obj.parent_bone)
        elif not weighted:
            target = roots[0] if roots else None
        else:
            continue
        if not target:
            continue
        mw = obj.matrix_world.copy()
        for g in list(obj.vertex_groups):
            if g.name in bone_names:
                obj.vertex_groups.remove(g)
        obj.vertex_groups.new(name=target).add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
        if not has_mod:
            obj.modifiers.new("Armature", "ARMATURE").object = arm
        obj.parent = arm
        obj.parent_type = "OBJECT"
        obj.matrix_world = mw
        _log(report, "rigidSkinned", "%s → %s" % (obj.name, target))


def bone_curves(action):
    try:
        return list(action.fcurves)
    except AttributeError:  # Blender 5 layered actions
        return [fc for layer in action.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]


def clip_actions(arm):
    """Actions that move this armature's bones over time and aren't driven by Action constraints."""
    names = {b.name for b in arm.data.bones}
    used_by_constraints = {c.action for pb in arm.pose.bones for c in pb.constraints if c.type == "ACTION" and c.action}
    out = []
    for act in bpy.data.actions:
        if act in used_by_constraints:
            continue
        # An old pose library (Blender 2.9x) keeps one pose per frame: poses, not a motion.
        if len(getattr(act, "pose_markers", [])) or act.name.lower().startswith("poselib"):
            continue
        hits = sum(1 for fc in bone_curves(act) if fc.data_path.startswith('pose.bones["') and fc.data_path.split('"')[1] in names)
        start, end = act.frame_range
        if hits and end - start >= 1:
            out.append(act)
    return out


def assign_action(obj, act):
    obj.animation_data_create()
    obj.animation_data.action = act
    if act is not None and getattr(act, "slots", None) and hasattr(obj.animation_data, "action_slot"):
        try:
            if obj.animation_data.action_slot is None and len(act.slots):
                obj.animation_data.action_slot = act.slots[0]
        except (AttributeError, TypeError, RuntimeError):
            pass


def build_deform_rig(arm, meshes, report, animations=True, max_frames=1200):
    """Replaces `arm` with a deform-only armature: same object transform, same rest matrices."""
    keep, parents, changed = plan_deform_rig(arm)
    rigid_to_skinned(meshes, arm, keep, parents, report)
    bpy.context.view_layer.update()
    clips = clip_actions(arm) if animations else []

    name = arm.name
    data = bpy.data.armatures.new(arm.data.name + "_deform")
    rig = bpy.data.objects.new(name + "_deform", data)
    bpy.context.scene.collection.objects.link(rig)
    rig.matrix_world = arm.matrix_world.copy()
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = rig
    order = [b.name for b in arm.data.bones if b.name in keep]
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        for n in order:
            src = arm.data.bones[n]
            eb = data.edit_bones.new(n)
            eb.head = src.head_local
            eb.tail = src.tail_local
            eb.matrix = src.matrix_local.copy()
            eb.length = max(src.length, 1e-4)
            eb.use_deform = True
        for n in order:
            if parents.get(n):
                data.edit_bones[n].parent = data.edit_bones[parents[n]]
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")

    baked = bake_clips(arm, rig, clips, order, report, max_frames) if clips else []
    for obj in meshes:
        for m in obj.modifiers:
            if m.type == "ARMATURE" and m.object == arm:
                m.object = rig
    for child in list(arm.children):
        mw = child.matrix_world.copy()
        child.parent = rig
        child.parent_type = "OBJECT"
        child.matrix_world = mw
    bpy.data.objects.remove(arm, do_unlink=True)
    rig.name = name
    report["skeleton"] = {"bones": len(order), "reparented": changed, "clips": baked}
    return rig, {n: parents.get(n) for n in order}


def bake_clips(src, rig, actions, order, report, max_frames):
    """Each clip sampled on the source rig (constraints, IK and drivers included), keyed on the deform rig."""
    from mathutils import Matrix
    scene = bpy.context.scene
    rest = {n: src.data.bones[n].matrix_local.copy() for n in order}
    parent_of = {b.name: (b.parent.name if b.parent else None) for b in rig.data.bones}
    saved_action = src.animation_data.action if src.animation_data else None
    saved_frame = scene.frame_current
    saved_pose = src.data.pose_position
    src.data.pose_position = "POSE"
    done = []
    rig.animation_data_create()
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
    for act in actions:
        start, end = int(math.floor(act.frame_range[0])), int(math.ceil(act.frame_range[1]))
        if end - start > max_frames:
            _log(report, "clipsSkipped", "%s (%d frames)" % (act.name, end - start))
            continue
        assign_action(src, act)
        new = bpy.data.actions.new("__baked__" + act.name)
        assign_action(rig, new)
        for f in range(start, end + 1):
            scene.frame_set(f)
            pose = {n: src.pose.bones[n].matrix.copy() for n in order}
            for n in order:
                p = parent_of[n]
                local_rest = rest[p].inverted() @ rest[n] if p else rest[n]
                basis = local_rest.inverted() @ (pose[p] if p else Matrix.Identity(4)).inverted() @ pose[n]
                loc, rot, scl = basis.decompose()
                pb = rig.pose.bones[n]
                pb.location, pb.rotation_quaternion, pb.scale = loc, rot, scl
                for prop in ("location", "rotation_quaternion", "scale"):
                    pb.keyframe_insert(prop, frame=f, group=n)
        rig.animation_data.action = None
        track = rig.animation_data.nla_tracks.new()
        track.name = act.name
        track.strips.new(act.name, start, new)
        done.append(act.name)
    for pb in rig.pose.bones:
        pb.location, pb.rotation_quaternion, pb.scale = (0, 0, 0), (1, 0, 0, 0), (1, 1, 1)
    assign_action(src, saved_action)
    src.data.pose_position = saved_pose
    scene.frame_set(saved_frame)
    # The source's actions name the same bones: only the baked ones may be exported.
    for act in list(bpy.data.actions):
        if not act.name.startswith("__baked__"):
            bpy.data.actions.remove(act)
    for act in bpy.data.actions:
        act.name = act.name[len("__baked__"):]
    return done


# ------------------------------------------------------------------------------------------------
# 5. Weights
# ------------------------------------------------------------------------------------------------

def clean_weights(meshes, rig, report, limit=4):
    """At most `limit` bone weights per vertex, normalized; unweighted vertices borrow a neighbour's."""
    from mathutils import kdtree
    bones = {b.name for b in rig.data.bones}
    filled = trimmed = 0
    for obj in meshes:
        if not any(m.type == "ARMATURE" and m.object == rig for m in obj.modifiers):
            continue
        groups = {g.index: g for g in obj.vertex_groups if g.name in bones}
        if not groups:
            continue
        verts = obj.data.vertices
        weights = []
        for v in verts:
            ws = sorted(((g.group, g.weight) for g in v.groups if g.group in groups and g.weight > 1e-4), key=lambda t: -t[1])
            trimmed += len(ws) > limit
            weights.append(ws[:limit])
        have = [i for i, w in enumerate(weights) if w]
        if not have:
            continue
        if len(have) < len(weights):
            tree = kdtree.KDTree(len(have))
            for i in have:
                tree.insert(verts[i].co, i)
            tree.balance()
            for i, w in enumerate(weights):
                if not w:
                    weights[i] = list(weights[tree.find(verts[i].co)[1]])
                    filled += 1
        for i, ws in enumerate(weights):
            total = sum(w for _, w in ws) or 1.0
            keepers = {gi for gi, _ in ws}
            for g in list(verts[i].groups):
                if g.group in groups and g.group not in keepers:
                    groups[g.group].remove([i])
            for gi, w in ws:
                groups[gi].add([i], w / total, "REPLACE")
    report["weights"] = {"filled": filled, "trimmed": trimmed}


# ------------------------------------------------------------------------------------------------
# 6. Materials and textures
# ------------------------------------------------------------------------------------------------

NOT_COLOUR = ("normal", "nrm", "rough", "spec", "metal", "ao", "occlusion", "mask", "matcap", "height", "bump", "disp", "shadow", "ramp", "emis", "gloss", "opacity", "alpha", "sss")
COLOUR = ("col", "diff", "base", "albedo", "tex", "main", "skin", "body")


def _upstream(tree, start, depth=0):
    """Every node feeding `start`, following into node groups."""
    seen, todo, guard = [], [(tree, start, 0)], set()
    while todo:
        t, n, d = todo.pop(0)
        if (t.name, n.name) in guard:
            continue
        guard.add((t.name, n.name))
        seen.append(n)
        for inp in n.inputs:
            for link in inp.links:
                todo.append((t, link.from_node, d))
        if n.type == "GROUP" and n.node_tree and d < 4:
            out = next((x for x in n.node_tree.nodes if x.type == "GROUP_OUTPUT"), None)
            if out:
                todo.append((n.node_tree, out, d + 1))
    return seen


def _readable(out):
    links = out.inputs["Surface"].links
    if not links:
        return True
    node = links[0].from_node
    if node.type in ("BSDF_PRINCIPLED", "BSDF_DIFFUSE"):
        return True
    if node.type == "EMISSION":
        # Plain emission (a colour, or straight from a texture) exports; a toon ramp feeding it
        # (shader to RGB, colour ramps, mixes) comes out as a flat glow.
        col = node.inputs["Color"].links
        return not col or col[0].from_node.type == "TEX_IMAGE"
    if node.type == "MIX_SHADER":
        kinds = {l.from_node.type for i in list(node.inputs)[1:] for l in i.links}
        return "BSDF_PRINCIPLED" in kinds and kinds <= {"BSDF_PRINCIPLED", "BSDF_TRANSPARENT", "EMISSION", "BSDF_DIFFUSE"}
    return False


def _colour_score(n):
    name = (n.image.name + " " + n.label + " " + n.name).lower()
    cs = n.image.colorspace_settings.name.lower()
    s = 0
    if "non-color" in cs or cs in ("raw", "linear", "linear rec.709"):
        s -= 10
    if any(k in name for k in NOT_COLOUR):
        s -= 5
    if any(k in name for k in COLOUR):
        s += 3
    return s


def _flat_colour(mat, nodes):
    """The colour a material shows without a texture: the nearest shader's own colour (any BSDF,
    emission or toon shader), else an RGB node or a colour ramp's end, else the viewport colour."""
    for n in nodes:
        if n.type.startswith("BSDF_") or n.type in ("EMISSION", "SUBSURFACE_SCATTERING"):
            for i in n.inputs:
                if i.type == "RGBA" and i.name in ("Color", "Base Color") and not i.links:
                    return tuple(i.default_value)
    for n in nodes:
        if n.type == "RGB":
            return tuple(n.outputs[0].default_value)
        if n.type == "VALTORGB":
            return tuple(n.color_ramp.elements[-1].color)
    c = tuple(mat.diffuse_color)
    return c if any(abs(x - 0.8) > 0.01 for x in c[:3]) else None


def simplify_materials(meshes, report):
    """Toon and custom node setups become a Principled BSDF with the material's colour texture."""
    done = set()
    for obj in meshes:
        for slot in obj.material_slots:
            mat = slot.material
            if not mat or mat.name in done or not mat.use_nodes or not mat.node_tree:
                continue
            done.add(mat.name)
            nt = mat.node_tree
            outs = [n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"]
            out = next((n for n in outs if n.is_active_output), outs[0] if outs else None)
            if not out or _readable(out):
                continue
            nodes = _upstream(nt, out)
            images = sorted((n for n in nodes if n.type == "TEX_IMAGE" and n.image), key=_colour_score, reverse=True)
            colour = _flat_colour(mat, nodes)
            bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
            bsdf.location = (out.location.x - 300, out.location.y - 400)
            bsdf.inputs["Roughness"].default_value = 0.85
            if "Specular IOR Level" in bsdf.inputs:
                bsdf.inputs["Specular IOR Level"].default_value = 0.2
            if images and _colour_score(images[0]) > -5:
                src = images[0]
                tex = nt.nodes.new("ShaderNodeTexImage")
                tex.image = src.image
                tex.interpolation = src.interpolation
                tex.location = (bsdf.location.x - 300, bsdf.location.y)
                nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
                blended = getattr(mat, "surface_render_method", "") == "BLENDED" or getattr(mat, "blend_method", "OPAQUE") in ("BLEND", "CLIP", "HASHED")
                if blended and src.image.alpha_mode != "NONE":
                    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
                how = "its colour texture %s" % src.image.name
            elif colour:
                bsdf.inputs["Base Color"].default_value = tuple(colour[:3]) + (1.0,)
                how = "a flat colour"
            else:
                how = "plain grey"
            for l in list(out.inputs["Surface"].links):
                nt.links.remove(l)
            nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
            _log(report, "materialsSimplified", "%s (%s)" % (mat.name, how))


def pack_textures(report):
    packed = 0
    missing = []
    for img in bpy.data.images:
        if img.source != "FILE" or img.packed_file or not img.filepath:
            continue
        if os.path.exists(bpy.path.abspath(img.filepath)):
            try:
                img.pack()
                packed += 1
            except RuntimeError:
                pass
        elif img.users:
            missing.append(img.name)
    report["texturesPacked"] = packed
    if missing:
        report["texturesMissing"] = sorted(missing)[:30]


# ------------------------------------------------------------------------------------------------
# Export and validation
# ------------------------------------------------------------------------------------------------

def read_gltf(path):
    with open(path, "rb") as f:
        header = f.read(20)
        if len(header) != 20 or header[:4] != b"glTF" or header[16:20] != b"JSON":
            raise RuntimeError("Exporter produced an invalid GLB")
        length = struct.unpack_from("<I", header, 12)[0]
        if length > 64 * 1024 * 1024:
            raise RuntimeError("Exported GLB metadata exceeds the limit")
        return json.loads(f.read(length))


def gather_facts(rig, meshes):
    """What the GLB must reproduce: bone rest heads (glTF Y-up world), parents, bounds."""
    from mathutils import Vector
    facts = {"bones": {}, "parents": {}, "bounds": None}
    if rig:
        mw = rig.matrix_world
        for b in rig.data.bones:
            h = mw @ b.head_local
            facts["bones"][b.name] = [h.x, h.z, -h.y]
            facts["parents"][b.name] = b.parent.name if b.parent else None
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    facts["objects"] = {}
    for obj in meshes:
        # The basis vertices themselves: the GLB stores the basis (shape keys are applied as
        # morph weights), every other modifier is applied by now, and the armature is at rest.
        # (A rotated object's bounding-box corners would overstate its size.)
        olo, ohi = [math.inf] * 3, [-math.inf] * 3
        mw = obj.matrix_world
        for vert in obj.data.vertices:
            w = mw @ vert.co
            for i, v in enumerate((w.x, w.z, -w.y)):
                lo[i], hi[i] = min(lo[i], v), max(hi[i], v)
                olo[i], ohi[i] = min(olo[i], v), max(ohi[i], v)
        facts["objects"][obj.name] = [olo, ohi]
    if meshes and math.isfinite(lo[0]):
        facts["bounds"] = [lo, hi]
    return facts


def validate_glb(path, facts):
    """Reads the GLB back and compares it with the facts gathered before export."""
    from mathutils import Matrix, Quaternion, Vector
    gltf = read_gltf(path)
    with open(path, "rb") as f:
        raw = f.read()
    binary = raw[28 + struct.unpack_from("<I", raw, 12)[0]:]
    nodes = gltf.get("nodes", [])
    parent = {c: i for i, node in enumerate(nodes) for c in node.get("children", [])}
    cache = {}

    def world(i):
        if i not in cache:
            node = nodes[i]
            if "matrix" in node:
                m = Matrix([node["matrix"][j:j + 4] for j in range(0, 16, 4)]).transposed()
            else:
                q = node.get("rotation", [0, 0, 0, 1])
                m = Matrix.LocRotScale(Vector(node.get("translation", [0, 0, 0])), Quaternion((q[3], *q[:3])), Vector(node.get("scale", [1, 1, 1])))
            cache[i] = world(parent[i]) @ m if i in parent else m
        return cache[i]
    joints = sorted({j for s in gltf.get("skins", []) for j in s.get("joints", [])})
    by_name = {nodes[j].get("name"): j for j in joints}
    out = {"joints": len(joints), "missingBones": [], "parentMismatches": [], "worstBoneError": 0.0, "worstBone": None,
           "verticesChecked": 0, "unweightedVertices": 0, "maxInfluences": 0, "boundsError": None,
           "animations": [a.get("name") for a in gltf.get("animations", [])]}
    for name, head in facts["bones"].items():
        j = by_name.get(name)
        if j is None:
            out["missingBones"].append(name)
            continue
        t = world(j).to_translation()
        d = math.dist((t.x, t.y, t.z), head)
        if d > out["worstBoneError"]:
            out["worstBoneError"], out["worstBone"] = d, name
        p = parent.get(j)
        while p is not None and p not in by_name.values():
            p = parent.get(p)
        got = nodes[p].get("name") if p is not None else None
        if facts["parents"].get(name) != got:
            out["parentMismatches"].append("%s: %s, exported %s" % (name, facts["parents"].get(name), got))
    acc, views = gltf.get("accessors", []), gltf.get("bufferViews", [])
    comp = {5126: ("f", 4), 5121: ("B", 1), 5123: ("H", 2)}

    def read(ai):
        a = acc[ai]
        fmt, size = comp[a["componentType"]]
        v = views[a["bufferView"]]
        stride = v.get("byteStride", size * 4)
        base = v.get("byteOffset", 0) + a.get("byteOffset", 0)
        scale = {"B": 255.0, "H": 65535.0}.get(fmt, 1.0) if a.get("normalized") else 1.0
        return [[x / scale for x in struct.unpack_from("<4" + fmt, binary, base + i * stride)] for i in range(a["count"])]
    def bind(skin_index):
        # Skinned vertices sit where joint world × inverse bind puts them (the same for every
        # joint in the bind pose), not where the mesh node is.
        skin = gltf["skins"][skin_index]
        if "inverseBindMatrices" not in skin:
            return Matrix.Identity(4)
        a = acc[skin["inverseBindMatrices"]]
        v = views[a["bufferView"]]
        vals = struct.unpack_from("<16f", binary, v.get("byteOffset", 0) + a.get("byteOffset", 0))
        return world(skin["joints"][0]) @ Matrix([vals[k:k + 4] for k in range(0, 16, 4)]).transposed()
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    per = {}
    for i, node in enumerate(nodes):
        if "mesh" not in node:
            continue
        m = bind(node["skin"]) if "skin" in node else world(i)
        box = per.setdefault(node.get("name", ""), [[math.inf] * 3, [-math.inf] * 3])
        for prim in gltf["meshes"][node["mesh"]]["primitives"]:
            attrs = prim["attributes"]
            pa = acc[attrs["POSITION"]]
            for k in range(8):
                c = m @ Vector([pa["max"][d] if k >> d & 1 else pa["min"][d] for d in range(3)])
                for d in range(3):
                    lo[d], hi[d] = min(lo[d], c[d]), max(hi[d], c[d])
                    box[0][d], box[1][d] = min(box[0][d], c[d]), max(box[1][d], c[d])
            if "skin" not in node or "WEIGHTS_0" not in attrs:
                continue
            w0 = read(attrs["WEIGHTS_0"])
            w1 = read(attrs["WEIGHTS_1"]) if "WEIGHTS_1" in attrs else None
            out["verticesChecked"] += len(w0)
            for k, w in enumerate(w0):
                ws = w + (w1[k] if w1 else [])
                out["maxInfluences"] = max(out["maxInfluences"], sum(1 for x in ws if x > 1e-4))
                out["unweightedVertices"] += sum(ws) < 0.5
    size = 1.0
    if facts.get("bounds") and math.isfinite(lo[0]):
        want_lo, want_hi = facts["bounds"]
        size = max(1e-6, max(b - a for a, b in zip(want_lo, want_hi)))
        out["boundsError"] = round(max(abs(a - c) + abs(b - d) for a, b, c, d in zip(want_lo, want_hi, lo, hi)) / size, 4)
        out["height"] = round(hi[1] - lo[1], 4)
        out["bounds"] = {"blender": [[round(x, 3) for x in want_lo], [round(x, 3) for x in want_hi]], "glb": [[round(x, 3) for x in lo], [round(x, 3) for x in hi]]}
        # Which objects differ, worst first (names match: the exporter names mesh nodes after objects).
        diffs = []
        for name, (blo, bhi) in facts.get("objects", {}).items():
            g = per.get(name)
            if g:
                diffs.append((round(max(abs(a - c) + abs(b - d) for a, b, c, d in zip(blo, bhi, g[0], g[1])) / size, 4), name))
        out["objectsOff"] = ["%s: %s" % (n, e) for e, n in sorted(diffs, reverse=True)[:5] if e > 0.01]
    out["ok"] = (not out["missingBones"] and not out["parentMismatches"] and out["worstBoneError"] < 0.002 * max(1.0, size)
                 and out["unweightedVertices"] == 0 and out["maxInfluences"] <= 4 and (out["boundsError"] is None or out["boundsError"] < 0.05))
    out["worstBoneError"] = round(out["worstBoneError"], 6)
    out["missingBones"] = out["missingBones"][:20]
    out["parentMismatches"] = out["parentMismatches"][:20]
    return out


def make_selectable(obj):
    """The exporter takes the selection, and only visible, selectable objects can be selected.

    Character files often switch parts on and off with drivers on the object's visibility (outfit
    toggles), hide whole collections, or disable selection; whether a part renders was decided
    when the file was opened, so here it is simply made visible and selectable.
    """
    ad = obj.animation_data
    if ad:
        for d in list(ad.drivers):
            if d.data_path in ("hide_viewport", "hide_render", "hide_select"):
                ad.drivers.remove(d)
    obj.hide_viewport = False
    obj.hide_select = False
    names = {c.name for c in obj.users_collection}

    def walk(lc):
        for child in lc.children:
            if child.collection.name in names or walk(child):
                child.exclude = False
                child.hide_viewport = False
                child.collection.hide_viewport = False
                child.collection.hide_select = False
                return True
        return False
    walk(bpy.context.view_layer.layer_collection)
    if obj.name not in bpy.context.view_layer.objects:
        bpy.context.scene.collection.objects.link(obj)
    try:
        obj.hide_set(False)
    except RuntimeError:
        pass


def prepare_scene(objects, animations=True, report=None):
    """Steps 1–6 on these objects (the scene is changed). Returns (meshes, rig, planned parents)."""
    report = report if report is not None else {}
    _object_mode()
    # Everything is measured and baked in the rest pose (a mesh on a bone sits where the rest pose
    # puts it, not where the file was last posed).
    for o in objects:
        if o.type == "ARMATURE":
            o.data.pose_position = "REST"
    bpy.context.view_layer.update()
    layer = {o.name for o in bpy.context.view_layer.objects}
    extra = convert_non_mesh([o for o in objects if o.type in NON_MESH and renders(o, layer)] + [o for o in objects if o.type == "MESH" and o.particle_systems], report)
    gone = [o for o in objects if o.type in NON_MESH]
    objects = [o for o in objects if o.type not in NON_MESH] + extra
    for o in gone:
        bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in objects if o.type == "MESH"]
    for o in meshes:
        apply_modifiers(o, report)
    arms = [o for o in objects if o.type == "ARMATURE"]
    for m in meshes:
        for mod in m.modifiers:
            if mod.type == "ARMATURE" and mod.object and mod.object not in arms:
                arms.append(mod.object)
    rig, planned = None, {}
    if arms:
        # The armature most meshes use; meshes bound to another one move to it when the bones match.
        use = {a: sum(1 for m in meshes for x in m.modifiers if x.type == "ARMATURE" and x.object == a) for a in arms}
        main = max(arms, key=lambda a: (use[a], len(a.data.bones)))
        names = {b.name for b in main.data.bones}
        for a in arms:
            if a is main:
                continue
            for m in meshes:
                for x in m.modifiers:
                    if x.type == "ARMATURE" and x.object == a and {g.name for g in m.vertex_groups} & names:
                        x.object = main
                        _log(report, "rebound", "%s from %s to %s" % (m.name, a.name, main.name))
        for m in meshes:
            # Several armature modifiers on one mesh: the main rig's is enough.
            mods = [x for x in m.modifiers if x.type == "ARMATURE"]
            for x in mods[1:]:
                if x.object == main or not x.object:
                    m.modifiers.remove(x)
        rig, planned = build_deform_rig(main, meshes, report, animations=animations)
        clean_weights(meshes, rig, report)
        for a in arms:
            if a is not main and a.name in bpy.data.objects and not any(x.type == "ARMATURE" and x.object == a for m in meshes for x in m.modifiers):
                bpy.data.objects.remove(a, do_unlink=True)
    simplify_materials(meshes, report)
    pack_textures(report)
    return meshes, rig, planned


def export_model(path, animations=False, selection=False, extras=False, prepare=True, clips=True):
    """Exports the scene (or the selection) as a validated GLB; see the module docstring.

    animations=True writes a motion file (the clips as they are); otherwise a model in its rest
    pose, with the file's own clips baked onto the deform skeleton when `clips` is set.
    """
    objects = list(bpy.context.selected_objects if selection else bpy.context.scene.objects)
    for obj in objects:
        if not all(math.isfinite(v) for row in obj.matrix_world for v in row):
            raise RuntimeError("Non-finite object transform: " + obj.name)
    _object_mode()
    report = {}
    meshes = [o for o in objects if o.type == "MESH"]
    rig = next((o for o in objects if o.type == "ARMATURE"), None)
    if prepare and not animations:
        meshes, rig, _planned = prepare_scene(objects, animations=clips, report=report)
        report["objects"] = sorted(o.name for o in meshes)
    if rig and not animations:
        rig.data.pose_position = "REST"
    bpy.context.view_layer.update()
    facts = gather_facts(rig, meshes) if not animations else None
    chosen = set(objects) if animations else set(meshes) | ({rig} if rig else set())
    for o in chosen:
        make_selectable(o)
    bpy.context.view_layer.update()
    for o in bpy.context.view_layer.objects:
        try:
            o.select_set(o in chosen)
        except RuntimeError:
            pass
    hidden = [o.name for o in chosen if not o.select_get()]
    if hidden:
        raise RuntimeError("Could not select for export: " + ", ".join(hidden[:10]))
    baked = bool(rig and rig.animation_data and len(rig.animation_data.nla_tracks))
    kwargs = dict(
        filepath=path, export_format="GLB", use_selection=True,
        export_animations=bool(animations or (clips and baked)),
        export_skins=True, export_morph=True,
        export_yup=True, export_apply=False, export_extras=extras,
        export_materials="EXPORT", export_image_format="AUTO",
        export_cameras=False, export_lights=False,
        export_rest_position_armature=True, export_current_frame=False,
        export_all_influences=False,
    )
    if kwargs["export_animations"] and not animations:
        kwargs["export_animation_mode"] = "NLA_TRACKS"
    bpy.ops.export_scene.gltf(**kwargs)
    gltf = read_gltf(path)
    nodes = gltf.get("nodes", [])
    joints = {nodes[i].get("name", "") for skin in gltf.get("skins", []) for i in skin.get("joints", [])}
    result = {"exportedJoints": len(joints), "restPose": not animations, **report}
    if facts is not None:
        check = validate_glb(path, facts)
        result["check"] = check
        result["weightedBones"] = len(facts["bones"])
        result["unweightedVertices"] = check["unweightedVertices"]
        result["reparentedDeformBones"] = report.get("skeleton", {}).get("reparented", 0)
        if check["missingBones"]:
            raise RuntimeError("Export lost bones: " + ", ".join(check["missingBones"]))
    return result


def render_check(path, size=200, samples=6):
    """A small picture of the converted character in a test pose, front and side, for the import
    report: each chain off the body bends a little, so a bad skin shows as a tear or a stretch.
    Cycles on the CPU (no graphics card needed). Changes the scene; call after exporting."""
    import base64
    from mathutils import Euler, Vector
    scene = bpy.context.scene
    # What was exported is still selected; nothing else is drawn.
    chosen = set(bpy.context.selected_objects)
    for o in scene.objects:
        o.hide_render = o not in chosen
    rig = next((o for o in chosen if o.type == "ARMATURE"), None)
    meshes = [o for o in chosen if o.type == "MESH"]
    if not meshes:
        return None
    if rig:
        rig.data.pose_position = "POSE"
        for pb in rig.pose.bones:
            pb.rotation_mode = "XYZ"
            depth = len(pb.parent_recursive)
            # Bend each bone a little (more toward the ends): limbs, tails, wings and the spine all move.
            if depth >= 1 and pb.children:
                pb.rotation_euler = Euler((0.18 + 0.03 * min(depth, 6), 0, 0.08), "XYZ")
    bpy.context.view_layer.update()
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    dg = bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        ev = o.evaluated_get(dg)
        for c in ev.bound_box:
            w = ev.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    centre = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.01)
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = False
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    world = bpy.data.worlds.new("CheckWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.92, 0.92, 0.94, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.4
    scene.world = world
    cam = bpy.data.objects.new("CheckCam", bpy.data.cameras.new("CheckCam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = 50
    dist = radius / math.tan(cam.data.angle / 2) * 1.05
    shots = []
    out_dir = os.path.dirname(os.path.abspath(path))
    for i, (dx, dy) in enumerate(((0, -1), (1, 0))):
        cam.location = centre + Vector((dx * dist, dy * dist, radius * 0.15))
        cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
        f = os.path.join(out_dir, "check_%d.png" % i)
        scene.render.filepath = f
        bpy.ops.render.render(write_still=True)
        with open(f, "rb") as fh:
            shots.append("data:image/png;base64," + base64.b64encode(fh.read()).decode())
        os.remove(f)
    return shots


def export_copy(path, selection_names=None, animations=False, extras=False, timeout=1200):
    """For the add-on: exports a saved copy of the open file in a background Blender, so the open
    file is never changed (export_model changes the scene it works on)."""
    import shutil
    import subprocess
    import tempfile
    tmp = tempfile.mkdtemp(prefix="everloom-")
    try:
        blend = os.path.join(tmp, "copy.blend")
        bpy.ops.wm.save_as_mainfile(filepath=blend, copy=True, compress=False)
        job = os.path.join(tmp, "job.json")
        with open(job, "w", encoding="utf-8") as f:
            json.dump({"blend": blend, "output": path, "selection": selection_names, "animations": animations, "extras": extras}, f)
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "export_job.py")
        r = subprocess.run([bpy.app.binary_path, "--background", "--factory-startup", "--disable-autoexec", "--python-exit-code", "3", "--python", script, "--", job], capture_output=True, text=True, timeout=timeout)
        res = os.path.join(tmp, "result.json")
        if not os.path.exists(res):
            raise RuntimeError("Blender stopped without a result: " + (r.stdout + r.stderr)[-400:])
        with open(res, encoding="utf-8") as f:
            out = json.load(f)
        if not out.get("ok"):
            raise RuntimeError(out.get("error", "export failed"))
        return out["result"]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
