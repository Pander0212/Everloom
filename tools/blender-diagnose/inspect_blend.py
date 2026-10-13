# SPDX-License-Identifier: MIT
"""Ground truth for a .blend, for diagnosing conversions.

    blender --background --factory-startup --disable-autoexec --python inspect_blend.py -- in.blend out.json

Records what Blender itself sees: armatures (bones, hierarchy, rest matrices, rolls), object
transforms, modifiers in order, shape keys, drivers, constraints, materials and textures (packed,
external, missing), the saving version, and anything unusual (several armatures, linked libraries,
Geometry Nodes, curves, particle hair, mirror modifiers, meshes parented to bones, vertex groups that
match no bone, vertices with more than four weights or none). Never runs the file's scripts.
"""
import json
import math
import os
import sys

import bpy  # type: ignore


def r(v, n=4):
    return [round(float(x), n) for x in v]


def mat(m):
    return [r(row) for row in m]


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    src, out = argv[0], argv[1]
    bpy.ops.wm.open_mainfile(filepath=src, load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    layer = bpy.context.view_layer
    in_layer = {o.name for o in layer.objects}
    info = {
        "file": os.path.basename(src),
        "bytes": os.path.getsize(src),
        "savedWith": ".".join(str(v) for v in bpy.data.version),
        "openedWith": bpy.app.version_string,
        "scene": scene.name,
        "scenes": [s.name for s in bpy.data.scenes],
        "unitScale": scene.unit_settings.scale_length,
        "frameRange": [scene.frame_start, scene.frame_end],
        "currentFrame": scene.frame_current,
        "libraries": [{"path": l.filepath, "exists": os.path.exists(bpy.path.abspath(l.filepath))} for l in bpy.data.libraries],
        "objects": [],
        "armatures": [],
        "actions": [],
        "materials": [],
        "images": [],
        "warnings": [],
    }

    def renders(o):
        if o.name not in in_layer or o.hide_render:
            return False
        return not any(c.hide_render for c in o.users_collection)

    arm_objs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    bone_sets = {a.name: {b.name for b in a.data.bones} for a in arm_objs}

    for o in bpy.data.objects:
        e = {
            "name": o.name, "type": o.type, "inViewLayer": o.name in in_layer, "renders": renders(o),
            "hideViewport": o.hide_viewport, "library": o.library.filepath if o.library else None,
            "parent": o.parent.name if o.parent else None, "parentType": o.parent_type,
            "parentBone": o.parent_bone or None,
            "location": r(o.location), "rotationMode": o.rotation_mode,
            "rotation": r(o.rotation_quaternion) if o.rotation_mode == "QUATERNION" else r(o.rotation_euler),
            "scale": r(o.scale), "worldMatrix": mat(o.matrix_world),
            "modifiers": [], "constraints": [{"type": c.type, "name": c.name, "mute": c.mute} for c in o.constraints],
            "drivers": len(o.animation_data.drivers) if o.animation_data else 0,
            "action": o.animation_data.action.name if o.animation_data and o.animation_data.action else None,
            "collections": [c.name for c in o.users_collection],
        }
        for m in o.modifiers:
            me = {"type": m.type, "name": m.name, "show_viewport": m.show_viewport, "show_render": m.show_render}
            if m.type == "ARMATURE":
                me["object"] = m.object.name if m.object else None
                me["use_vertex_groups"] = m.use_vertex_groups
                me["use_bone_envelopes"] = m.use_bone_envelopes
                me["preserve_volume"] = m.use_deform_preserve_volume
            elif m.type == "MIRROR":
                me["axes"] = list(m.use_axis)
                me["mirror_vertex_groups"] = m.use_mirror_vertex_groups
            elif m.type == "NODES":
                me["group"] = m.node_group.name if m.node_group else None
            elif m.type in ("SUBSURF", "MULTIRES"):
                me["levels"] = getattr(m, "levels", None)
            o_mods = me
            e["modifiers"].append(o_mods)
        if o.type == "MESH":
            me = o.data
            e["mesh"] = {
                "name": me.name, "users": me.users, "vertices": len(me.vertices), "polygons": len(me.polygons),
                "triangles": sum(len(p.vertices) - 2 for p in me.polygons),
                "shapeKeys": [k.name for k in me.shape_keys.key_blocks] if me.shape_keys else [],
                "shapeKeyDrivers": len(me.shape_keys.animation_data.drivers) if me.shape_keys and me.shape_keys.animation_data else 0,
                "materials": [s.material.name if s.material else None for s in o.material_slots],
                "uvLayers": [u.name for u in me.uv_layers],
                "vertexGroups": len(o.vertex_groups),
            }
            arms = [m.object for m in o.modifiers if m.type == "ARMATURE" and m.object]
            bones = set().union(*[bone_sets.get(a.name, set()) for a in arms]) if arms else set()
            groups = {g.index: g.name for g in o.vertex_groups}
            if arms:
                over4 = 0
                none = 0
                maxinf = 0
                unmatched = sorted({n for n in groups.values() if n not in bones})
                for v in me.vertices:
                    ws = [g for g in v.groups if groups.get(g.group) in bones and g.weight > 1e-6]
                    maxinf = max(maxinf, len(ws))
                    over4 += len(ws) > 4
                    none += not ws
                e["mesh"].update({"weightsOver4": over4, "unweighted": none, "maxInfluences": maxinf,
                                  "groupsMatchingNoBone": len(unmatched), "groupsMatchingNoBoneSample": unmatched[:15]})
        elif o.type in ("CURVE", "CURVES", "SURFACE", "FONT"):
            info["warnings"].append("non-mesh geometry: %s (%s)" % (o.name, o.type))
        if o.type == "MESH" and o.particle_systems:
            e["particles"] = [{"name": p.name, "type": p.settings.type, "render_type": p.settings.render_type, "count": p.settings.count} for p in o.particle_systems]
        info["objects"].append(e)

    for a in arm_objs:
        data = a.data
        bones = []
        for b in data.bones:
            bones.append({
                "name": b.name, "parent": b.parent.name if b.parent else None, "deform": b.use_deform,
                "connect": b.use_connect, "head": r(b.head_local), "tail": r(b.tail_local),
                "length": round(b.length, 5), "roll": round(_roll(b), 4),
                "inheritScale": b.inherit_scale, "inheritRotation": b.use_inherit_rotation,
                "children": len(b.children),
            })
        pose = []
        for pb in a.pose.bones:
            moved = pb.location.length > 1e-5 or abs(pb.rotation_quaternion.w - 1) > 1e-5 or any(abs(x) > 1e-5 for x in pb.rotation_euler) or any(abs(s - 1) > 1e-5 for s in pb.scale)
            if moved or pb.constraints:
                pose.append({"bone": pb.name, "posed": moved, "constraints": [(c.type, getattr(c, "subtarget", "") or "") for c in pb.constraints]})
        drivers = []
        if data.animation_data:
            drivers += [d.data_path for d in data.animation_data.drivers]
        if a.animation_data:
            drivers += [d.data_path for d in a.animation_data.drivers]
        roots = [b["name"] for b in bones if not b["parent"]]
        info["armatures"].append({
            "object": a.name, "data": data.name, "bones": len(bones), "deformBones": sum(b["deform"] for b in bones),
            "roots": roots, "posePosition": data.pose_position, "displayType": data.display_type,
            "bonesList": bones, "posedOrConstrained": pose, "drivers": drivers[:50], "driverCount": len(drivers),
            "maxDepth": _depth(data.bones),
        })

    for act in bpy.data.actions:
        try:
            curves = len(act.fcurves)
        except AttributeError:  # Blender 5 layered actions
            curves = sum(len(cb.fcurves) for layer in act.layers for strip in layer.strips for cb in strip.channelbags)
        info["actions"].append({"name": act.name, "frameRange": r(act.frame_range, 1), "curves": curves, "users": act.users, "fake": act.use_fake_user})

    for m in bpy.data.materials:
        if not m.users:
            continue
        nodes = []
        if m.node_tree:
            nodes = sorted({n.bl_idname for n in m.node_tree.nodes})
        info["materials"].append({"name": m.name, "nodes": nodes, "blend": getattr(m, "surface_render_method", None)})
    for i in bpy.data.images:
        if i.source in ("FILE", "SEQUENCE", "TILED"):
            p = bpy.path.abspath(i.filepath) if i.filepath else ""
            info["images"].append({"name": i.name, "source": i.source, "packed": bool(i.packed_file), "path": i.filepath, "exists": bool(i.packed_file) or (bool(p) and os.path.exists(p)), "size": list(i.size)})

    info["nodeGroups"] = [{"name": g.name, "type": g.bl_idname, "users": g.users} for g in bpy.data.node_groups if g.bl_idname == "GeometryNodeTree"]
    info["summary"] = {
        "armatures": len(arm_objs), "bones": sum(len(a.data.bones) for a in arm_objs),
        "meshes": sum(o.type == "MESH" for o in bpy.data.objects), "renderingMeshes": sum(o.type == "MESH" and renders(o) for o in bpy.data.objects),
        "missingImages": sum(not im["exists"] for im in info["images"]), "packedImages": sum(im["packed"] for im in info["images"]),
        "shapeKeys": sum(len(o.data.shape_keys.key_blocks) for o in bpy.data.objects if o.type == "MESH" and o.data.shape_keys),
        "geometryNodes": sum(any(m.type == "NODES" for m in o.modifiers) for o in bpy.data.objects),
        "mirrorModifiers": sum(any(m.type == "MIRROR" for m in o.modifiers) for o in bpy.data.objects),
        "boneParentedMeshes": sum(o.type == "MESH" and o.parent_type == "BONE" for o in bpy.data.objects),
        "particleSystems": sum(len(o.particle_systems) for o in bpy.data.objects if o.type == "MESH"),
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(info, f, indent=1)
    print("INSPECT_OK", json.dumps(info["summary"]))


def _roll(b):
    # Roll as edit mode shows it, from the rest matrix (no edit mode needed).
    import mathutils  # type: ignore
    m = b.matrix_local.to_3x3()
    y = m.col[1].normalized()
    # The bone's x axis with roll 0 (Blender's vec_roll_to_mat3 convention).
    ref = mathutils.Vector((0, 1, 0))
    q = ref.rotation_difference(y)
    x0 = q @ mathutils.Vector((1, 0, 0))
    x = m.col[0].normalized()
    ang = x0.angle(x, 0.0)
    return ang if x0.cross(x).dot(y) >= 0 else -ang


def _depth(bones):
    best = 0
    for b in bones:
        d, p = 0, b.parent
        while p:
            d += 1
            p = p.parent
        best = max(best, d)
    return best


main()
