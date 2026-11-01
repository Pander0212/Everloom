# SPDX-License-Identifier: MIT
"""Shared export contract for the add-on, local server and rented Blender workers."""
import json
import math
import struct
import bpy


def repair_flat_deform(arm):
    """Some control rigs constrain every DEF bone under one root. glTF has no constraints.
    Rebuild only a recognized flat humanoid DEF hierarchy, preserving armature-space rest matrices.
    Target-chain links recover secondary bones; core links use unambiguous anatomical names.
    """
    bones = arm.data.bones
    deform = [b for b in bones if b.use_deform and b.name.lower().startswith("def-")]
    if len(deform) < 12:
        return []
    names = {b.name[4:].lower(): b.name for b in deform}
    if not all(k in names for k in ("hips", "spine", "chest", "head")):
        return []
    root = bones[names["hips"]].parent
    if not root or sum(b.parent == root for b in deform) < len(deform) * .7:
        return []
    targets = {}
    for b in deform:
        for constraint in arm.pose.bones[b.name].constraints:
            if constraint.type == "COPY_TRANSFORMS" and constraint.target == arm and constraint.subtarget and constraint.influence >= .99:
                targets[constraint.subtarget] = b.name
    if len(targets) < len(deform) * .7:
        return []
    parents = {"spine": "hips", "chest": "spine", "neck": "chest", "head": "neck" if "neck" in names else "chest"}
    for side in (".l", ".r"):
        for child, parent in (("shoulder", "chest"), ("arm", "shoulder" + side), ("forearm", "arm" + side), ("hand", "forearm" + side), ("leg", "hips"), ("shin", "leg" + side), ("foot", "shin" + side)):
            parents[child + side] = parent
    planned = {}
    for target, name in targets.items():
        bone = bones.get(target)
        ancestor = bone.parent if bone else None
        while ancestor:
            if ancestor.name in targets and targets[ancestor.name] != name:
                planned[name] = targets[ancestor.name]
                break
            ancestor = ancestor.parent
    for child, parent in parents.items():
        if child in names and parent in names:
            planned[names[child]] = names[parent]
    # Guard unusual control graphs: never export a parent cycle.
    for name in list(planned):
        seen = {name}
        parent = planned[name]
        while parent in planned:
            if parent in seen:
                raise RuntimeError("Cannot resolve flat deform hierarchy: " + name)
            seen.add(parent)
            parent = planned[parent]
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    saved = []
    try:
        for name, parent in planned.items():
            bone = arm.data.edit_bones[name]
            saved.append((name, bone.parent.name if bone.parent else None, bone.use_connect, bone.matrix.copy(), bone.length))
            matrix, length = bone.matrix.copy(), bone.length
            bone.use_connect = False
            bone.parent = arm.data.edit_bones[parent]
            bone.matrix, bone.length = matrix, length
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")
    return saved


def restore_parents(arm, saved):
    if not saved:
        return
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    try:
        for name, parent, connect, matrix, length in saved:
            bone = arm.data.edit_bones[name]
            bone.use_connect = False
            bone.parent = arm.data.edit_bones.get(parent) if parent else None
            bone.matrix, bone.length = matrix, length
            bone.use_connect = connect
    finally:
        bpy.ops.object.mode_set(mode="OBJECT")


def export_model(path, animations=False, selection=False, extras=False):
    objects = list(bpy.context.selected_objects if selection else bpy.context.scene.objects)
    arms = [o for o in objects if o.type == "ARMATURE"]
    weighted = set()
    unweighted = 0
    for obj in objects:
        if not all(math.isfinite(v) for row in obj.matrix_world for v in row):
            raise RuntimeError("Non-finite object transform: " + obj.name)
        if obj.type != "MESH":
            continue
        modifiers = [m for m in obj.modifiers if m.type == "ARMATURE" and m.object]
        if not modifiers:
            continue
        bone_names = {b.name for m in modifiers for b in m.object.data.bones}
        groups = {g.index: g.name for g in obj.vertex_groups}
        for vertex in obj.data.vertices:
            if any(not math.isfinite(g.weight) for g in vertex.groups):
                raise RuntimeError("Invalid skin weight: " + obj.name)
            weights = [g for g in vertex.groups if groups.get(g.group) in bone_names and g.weight > 0]
            unweighted += not bool(weights)
            for group in weights:
                if not math.isfinite(group.weight):
                    raise RuntimeError("Invalid skin weight: " + obj.name)
                weighted.add(groups[group.group])
    poses = [(a, a.data.pose_position) for a in arms]
    active = bpy.context.view_layer.objects.active
    original_mode = active.mode if active else "OBJECT"
    repaired = []
    try:
        if original_mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        if not animations:
            for arm in arms:
                repaired.append((arm, repair_flat_deform(arm)))
            for arm, _ in poses:
                arm.data.pose_position = "REST"
            bpy.context.view_layer.update()
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", use_selection=selection,
            export_animations=animations, export_skins=True, export_morph=True,
            export_yup=True, export_apply=False, export_extras=extras,
            export_materials="EXPORT", export_image_format="AUTO",
            export_cameras=False, export_lights=False,
            export_rest_position_armature=True, export_current_frame=False,
            export_all_influences=False,
        )
    finally:
        for arm, saved in repaired:
            restore_parents(arm, saved)
        bpy.context.view_layer.objects.active = active
        for arm, pose in poses:
            arm.data.pose_position = pose
        bpy.context.view_layer.update()
        if active and original_mode != "OBJECT":
            bpy.ops.object.mode_set(mode=original_mode)
    with open(path, "rb") as f:
        header = f.read(20)
        if len(header) != 20 or header[:4] != b"glTF" or header[16:20] != b"JSON":
            raise RuntimeError("Exporter produced an invalid GLB")
        length = struct.unpack_from("<I", header, 12)[0]
        if length > 64 * 1024 * 1024:
            raise RuntimeError("Exported GLB metadata exceeds the limit")
        gltf = json.loads(f.read(length))
    nodes = gltf.get("nodes", [])
    joints = {nodes[i].get("name", "") for skin in gltf.get("skins", []) for i in skin.get("joints", [])}
    missing = sorted(weighted - joints)
    if missing:
        raise RuntimeError("Export lost weighted bones: " + ", ".join(missing[:20]))
    return {"weightedBones": len(weighted), "exportedJoints": len(joints), "unweightedVertices": unweighted, "restPose": not animations, "reparentedDeformBones": sum(len(saved) for _, saved in repaired)}
