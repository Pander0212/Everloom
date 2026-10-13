# SPDX-License-Identifier: MIT
"""Synthetic .blend fixtures for the Blender conversion: one per failure cause found in real files
and one per skeleton family (docs/3d-import/blender-diagnosis.md, creatures.md). Boxes around bones,
made here; no third-party content.

    blender --background --factory-startup --python creature-fixtures.py -- <out dir> [name …]

Writes <name>.blend and <name>.json (what the conversion must produce) for each fixture.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

OUT = sys.argv[sys.argv.index("--") + 1]
ONLY = set(sys.argv[sys.argv.index("--") + 2:])
os.makedirs(OUT, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def armature(name, bones, deform=None):
    """bones: [(name, parent, head, tail)] in Blender space (Z up, the character facing -Y)."""
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for n, parent, head, tail in bones:
        b = data.edit_bones.new(n)
        b.head, b.tail = head, tail
        b.use_deform = deform(n) if deform else True
    for n, parent, head, tail in bones:
        if parent:
            data.edit_bones[n].parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def box_mesh(name, arm, bones, radius=0.04, skip=()):
    """A box around every deform bone, each weighted fully to its bone, as one skinned mesh."""
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    groups = []
    for b in arm.data.bones:
        if not b.use_deform or b.name in skip:
            continue
        h, t = b.head_local, b.tail_local
        d = (t - h)
        if d.length < 1e-6:
            continue
        a = d.orthogonal().normalized() * radius
        c = d.normalized().cross(a)
        start = len(bm.verts)
        for end in (h, t):
            for sx, sy in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
                bm.verts.new(end + a * sx + c * sy)
        bm.verts.ensure_lookup_table()
        v = bm.verts[start:start + 8]
        for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
            bm.faces.new([v[i] for i in f])
        groups.append((b.name, list(range(start, start + 8))))
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for n, idx in groups:
        obj.vertex_groups.new(name=n).add(idx, 1.0, "REPLACE")
    obj.modifiers.new("Armature", "ARMATURE").object = arm
    obj.parent = arm
    return obj


def save(name, expect):
    path = os.path.join(OUT, name + ".blend")
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=False)
    with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(expect, f, indent=1)
    print("FIXTURE", name)


# ------------------------------------------------------------------------------------------------
# Skeletons (metres; Z up; the character faces -Y, Blender's front)
# ------------------------------------------------------------------------------------------------

def humanoid_bones(prefix=""):
    p = lambda n: prefix + n  # noqa: E731
    out = [(p("Hips"), None, (0, 0, 0.95), (0, 0, 1.05)), (p("Spine"), p("Hips"), (0, 0, 1.05), (0, 0, 1.2)), (p("Chest"), p("Spine"), (0, 0, 1.2), (0, 0, 1.38)),
           (p("Neck"), p("Chest"), (0, 0, 1.38), (0, 0, 1.48)), (p("Head"), p("Neck"), (0, 0, 1.48), (0, 0, 1.7))]
    for s, x in (("L", 1), ("R", -1)):
        out += [(p("Shoulder." + s), p("Chest"), (0.04 * x, 0, 1.36), (0.17 * x, 0, 1.36)), (p("UpperArm." + s), p("Shoulder." + s), (0.17 * x, 0, 1.36), (0.42 * x, 0, 1.36)),
                (p("LowerArm." + s), p("UpperArm." + s), (0.42 * x, 0, 1.36), (0.66 * x, 0, 1.36)), (p("Hand." + s), p("LowerArm." + s), (0.66 * x, 0, 1.36), (0.76 * x, 0, 1.36)),
                (p("UpperLeg." + s), p("Hips"), (0.1 * x, 0, 0.95), (0.1 * x, 0, 0.52)), (p("LowerLeg." + s), p("UpperLeg." + s), (0.1 * x, 0, 0.52), (0.1 * x, 0.02, 0.09)),
                (p("Foot." + s), p("LowerLeg." + s), (0.1 * x, 0.02, 0.09), (0.1 * x, -0.1, 0.02)), (p("Toes." + s), p("Foot." + s), (0.1 * x, -0.1, 0.02), (0.1 * x, -0.16, 0.0))]
    return out


def quadruped_bones(wings=False, names=True):
    n = (lambda x: x) if names else None
    b = [("root", None, (0, 0, 0), (0, 0, 0.2)), ("pelvis", "root", (0, 0.4, 0.75), (0, 0.15, 0.78)), ("spine", "pelvis", (0, 0.15, 0.78), (0, -0.1, 0.8)),
         ("chest", "spine", (0, -0.1, 0.8), (0, -0.3, 0.82)), ("neck", "chest", (0, -0.3, 0.82), (0, -0.45, 1.0)), ("head", "neck", (0, -0.45, 1.0), (0, -0.65, 1.02)),
         ("jaw", "head", (0, -0.5, 0.95), (0, -0.66, 0.93))]
    for s, x in (("L", 1), ("R", -1)):
        b += [("thigh." + s, "pelvis", (0.14 * x, 0.4, 0.7), (0.14 * x, 0.42, 0.4)), ("shin." + s, "thigh." + s, (0.14 * x, 0.42, 0.4), (0.14 * x, 0.45, 0.1)), ("hoof." + s, "shin." + s, (0.14 * x, 0.45, 0.1), (0.14 * x, 0.42, 0.0)),
              ("frontleg." + s, "chest", (0.14 * x, -0.25, 0.72), (0.14 * x, -0.26, 0.4)), ("forearm_front." + s, "frontleg." + s, (0.14 * x, -0.26, 0.4), (0.14 * x, -0.27, 0.1)), ("fronthoof." + s, "forearm_front." + s, (0.14 * x, -0.27, 0.1), (0.14 * x, -0.3, 0.0)),
              ("ear." + s, "head", (0.06 * x, -0.5, 1.07), (0.08 * x, -0.48, 1.18))]
        if wings:
            b += [("wing1." + s, "chest", (0.08 * x, -0.15, 0.88), (0.35 * x, -0.12, 0.95)), ("wing2." + s, "wing1." + s, (0.35 * x, -0.12, 0.95), (0.6 * x, -0.08, 0.98)), ("wing3." + s, "wing2." + s, (0.6 * x, -0.08, 0.98), (0.85 * x, -0.02, 0.96))]
    b += [("tail1", "pelvis", (0, 0.45, 0.8), (0, 0.62, 0.75)), ("tail2", "tail1", (0, 0.62, 0.75), (0, 0.78, 0.65)), ("tail3", "tail2", (0, 0.78, 0.65), (0, 0.9, 0.5))]
    if not names:
        # The same skeleton with names that say nothing: only the shape can tell.
        rename = {x[0]: "b%02d" % i for i, x in enumerate(b)}
        b = [(rename[a], rename.get(p) if p else None, h, t) for a, p, h, t in b]
    return b


def dragon_bones():
    b = humanoid_bones()
    for s, x in (("L", 1), ("R", -1)):
        b += [("Wing1." + s, "Chest", (0.06 * x, 0.08, 1.32), (0.4 * x, 0.15, 1.55)), ("Wing2." + s, "Wing1." + s, (0.4 * x, 0.15, 1.55), (0.8 * x, 0.2, 1.6)), ("Wing3." + s, "Wing2." + s, (0.8 * x, 0.2, 1.6), (1.1 * x, 0.25, 1.4))]
    b += [("Tail1", "Hips", (0, 0.06, 0.95), (0, 0.3, 0.8)), ("Tail2", "Tail1", (0, 0.3, 0.8), (0, 0.55, 0.55)), ("Tail3", "Tail2", (0, 0.55, 0.55), (0, 0.8, 0.35)), ("Tail4", "Tail3", (0, 0.8, 0.35), (0, 1.0, 0.25))]
    return b


def serpent_bones():
    b = [("seg00", None, (0, 1.4, 0.08), (0, 1.25, 0.08))]
    for i in range(1, 15):
        y = 1.4 - 0.15 * i
        b.append(("seg%02d" % i, "seg%02d" % (i - 1), (0, y + 0.15, 0.08 + (0.02 if i > 11 else 0)), (0, y, 0.08 + (0.04 * (i - 11) if i > 11 else 0))))
    b.append(("head", "seg14", (0, -0.7, 0.2), (0, -0.9, 0.22)))
    return b


def generic_bones():
    # A little tree: a trunk standing on its root, branches reaching up and out.
    return [("trunk", None, (0, 0, 0), (0, 0, 0.6)), ("trunk2", "trunk", (0, 0, 0.6), (0, 0, 1.1)), ("branch.L", "trunk2", (0, 0, 0.9), (0.4, 0, 1.3)), ("branch.R", "trunk2", (0, 0, 0.9), (-0.4, 0, 1.3)), ("crown", "trunk2", (0, 0, 1.1), (0, 0, 1.5))]


def body(name, bones, **kw):
    arm = armature("Armature", bones)
    mesh = box_mesh("Body", arm, bones, **kw)
    return arm, mesh


# ------------------------------------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------------------------------------

def family_fixtures():
    for name, bones, family in (("family-humanoid", humanoid_bones(), "humanoid"), ("family-humanoid-unnamed", None, "humanoid"),
                                ("family-quadruped", quadruped_bones(), "quadruped"), ("family-quadruped-unnamed", quadruped_bones(names=False), "quadruped"),
                                ("family-winged-quadruped", quadruped_bones(wings=True), "wingedQuadruped"), ("family-dragon", dragon_bones(), "bipedCreature"),
                                ("family-serpent", serpent_bones(), "serpent"), ("family-generic", generic_bones(), "generic")):
        if ONLY and name not in ONLY:
            continue
        reset()
        if name == "family-humanoid-unnamed":
            # Meaningless names, the same hierarchy.
            src = humanoid_bones()
            rename = {n: "j%02d" % i for i, (n, p, h, t) in enumerate(src)}
            bones = [(rename[n], rename.get(p) if p else None, h, t) for n, p, h, t in src]
        body(name, bones)
        save(name, {"family": family, "check": True})


def control_rig():
    """Auto-Rig Pro style: deform bones flat under a control root, placed by copy constraints from a
    separate control chain; each deform bone's head at the previous one's tail."""
    reset()
    hb = humanoid_bones()
    bones = [("c_traj", None, (0, 0, 0), (0, 0.2, 0))]
    for n, p, h, t in hb:
        bones.append(("c_" + n, "c_" + p if p else "c_traj", h, t))   # controls (non-deform)
        bones.append((n.lower() + "_def", "c_traj", h, t))           # deform, flat
    arm = armature("rig", bones, deform=lambda n: n.endswith("_def"))
    for n, p, h, t in hb:
        pb = arm.pose.bones[n.lower() + "_def"]
        c = pb.constraints.new("COPY_LOCATION")
        c.target, c.subtarget = arm, "c_" + n
        c = pb.constraints.new("COPY_ROTATION")
        c.target, c.subtarget = arm, "c_" + n
    box_mesh("Body", arm, bones)
    save("cause-control-rig", {"check": True, "joints": len(hb), "parents": {"lowerarm.l_def": "upperarm.l_def", "hand.l_def": "lowerarm.l_def", "lowerleg.r_def": "upperleg.r_def", "head_def": "neck_def", "spine_def": "hips_def"}, "family": "humanoid"})


def rigid_parts():
    reset()
    arm, _ = body("rigid", humanoid_bones())
    bpy.ops.mesh.primitive_cone_add(radius1=0.1, depth=0.15, location=(0, 0, 1.8))
    hat = bpy.context.object
    hat.name = "Hat"
    hat.parent, hat.parent_type, hat.parent_bone = arm, "BONE", "Head"
    hat.matrix_world.translation = Vector((0, 0, 1.8))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.02, location=(0.04, -0.09, 1.6))
    eye = bpy.context.object
    eye.name = "Eye"
    eye.modifiers.new("Armature", "ARMATURE").object = arm  # an armature modifier but no weights
    mw = eye.matrix_world.copy()
    eye.parent, eye.parent_type, eye.parent_bone = arm, "BONE", "Head"
    eye.matrix_world = mw
    bpy.ops.mesh.primitive_cube_add(size=0.05, location=(0.1, -0.12, 1.3))
    badge = bpy.context.object
    badge.name = "Badge"
    badge.parent = arm  # parented to the armature object, no weights
    save("cause-rigid-parts", {"check": True, "rigid": ["Hat", "Eye", "Badge"]})


def modifiers_and_keys():
    reset()
    arm, mesh = body("mods", humanoid_bones())
    # Half a face mirrored, with a shape key on the half.
    bpy.ops.mesh.primitive_cube_add(size=0.1, location=(0.06, -0.1, 1.6))
    face = bpy.context.object
    face.name = "Face"
    face.vertex_groups.new(name="Head").add(list(range(len(face.data.vertices))), 1.0, "REPLACE")
    face.shape_key_add(name="Basis")
    k = face.shape_key_add(name="Smile")
    for v in k.data:
        v.co.z += 0.02
    m = face.modifiers.new("Mirror", "MIRROR")
    m.use_axis[0] = True
    m.mirror_object = None
    face.modifiers.new("Armature", "ARMATURE").object = arm
    face.parent = arm
    # A boolean cutting an eye with a shape key, its cutter hidden from render.
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.03, location=(0, -0.12, 1.62))
    eye = bpy.context.object
    eye.name = "EyeBall"
    eye.vertex_groups.new(name="Head").add(list(range(len(eye.data.vertices))), 1.0, "REPLACE")
    eye.shape_key_add(name="Basis")
    blink = eye.shape_key_add(name="Blink")
    for v in blink.data:
        v.co.z *= 0.3
    bpy.ops.mesh.primitive_cube_add(size=0.03, location=(0, -0.15, 1.62))
    cutter = bpy.context.object
    cutter.name = "Cutter"
    cutter.hide_render = True
    cutter.hide_viewport = True
    b = eye.modifiers.new("Cut", "BOOLEAN")
    b.object, b.operation = cutter, "DIFFERENCE"
    eye.modifiers.new("Armature", "ARMATURE").object = arm
    eye.parent = arm
    mesh.modifiers.new("Subdivision", "SUBSURF")  # dropped
    save("cause-modifiers-keys", {"check": True, "applied": ["Face", "EyeBall"], "morphs": ["Smile", "Blink"], "notIn": ["Cutter"]})


def hidden_parts():
    reset()
    arm, mesh = body("hidden", humanoid_bones())
    mesh.hide_select = True
    bpy.ops.mesh.primitive_cube_add(size=0.2, location=(0, 0.12, 1.25))
    pack = bpy.context.object
    pack.name = "Backpack"
    pack.vertex_groups.new(name="Chest").add(list(range(8)), 1.0, "REPLACE")
    pack.modifiers.new("Armature", "ARMATURE").object = arm
    pack.parent = arm
    coll = bpy.data.collections.new("Outfit")
    bpy.context.scene.collection.children.link(coll)
    bpy.context.scene.collection.objects.unlink(pack)
    coll.objects.link(pack)
    # Hidden in the viewport (a toggle the rig's UI drives), still rendering.
    lc = bpy.context.view_layer.layer_collection.children["Outfit"]
    lc.hide_viewport = True
    d = pack.driver_add("hide_viewport")
    d.driver.type = "SCRIPTED"
    d.driver.expression = "1"
    save("cause-hidden-parts", {"check": True, "objects": ["Backpack", "Body"]})


def transforms():
    reset()
    bones = humanoid_bones()
    arm, mesh = body("transforms", bones)
    # Centimetre-scale armature lying on its back, set upright by its object rotation.
    arm.rotation_euler = (math.radians(90), 0, 0)
    arm.scale = (0.01, 0.01, 0.01)
    bpy.context.view_layer.update()
    # Its bones in centimetres in Y-up armature space (what such files contain).
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for b in arm.data.edit_bones:
        b.head = Vector((b.head.x, b.head.z, -b.head.y)) * 100
        b.tail = Vector((b.tail.x, b.tail.z, -b.tail.y)) * 100
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.data.objects.remove(mesh)
    mesh = box_mesh("Body", arm, bones, radius=4.0)
    mesh.matrix_world = arm.matrix_world.copy()
    mesh.parent = arm
    # A part with a non-uniform scale and a turn.
    bpy.ops.mesh.primitive_cube_add(size=0.1, location=(0, -0.15, 1.2))
    belt = bpy.context.object
    belt.name = "Belt"
    belt.scale = (2.0, 0.5, 0.3)
    belt.rotation_euler = (0, 0, 0.6)
    belt.vertex_groups.new(name="Hips").add(list(range(8)), 1.0, "REPLACE")
    belt.modifiers.new("Armature", "ARMATURE").object = arm
    mw = belt.matrix_world.copy()
    belt.parent = arm
    belt.matrix_world = mw
    save("cause-transforms", {"check": True, "height": [1.6, 1.8]})


def materials():
    reset()
    arm, mesh = body("materials", humanoid_bones())
    img = bpy.data.images.new("SkinColour", 8, 8)
    img.pixels = [0.9, 0.6, 0.5, 1.0] * 64
    img.pack()
    toon = bpy.data.materials.new("Toon")
    toon.use_nodes = True
    nt = toon.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    emit = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(tex.outputs["Color"], diff.inputs["Color"])
    nt.links.new(diff.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs["Color"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], mix.inputs["A"])
    nt.links.new(tex.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], emit.inputs["Color"])
    nt.links.new(emit.outputs[0], out.inputs["Surface"])
    gloss = bpy.data.materials.new("RedGloss")
    gloss.use_nodes = True
    g = gloss.node_tree
    g.nodes.clear()
    o = g.nodes.new("ShaderNodeOutputMaterial")
    gl = g.nodes.new("ShaderNodeBsdfGlossy") if hasattr(bpy.types, "ShaderNodeBsdfGlossy") else g.nodes.new("ShaderNodeBsdfAnisotropic")
    gl.inputs["Color"].default_value = (1.0, 0.05, 0.1, 1.0)
    g.links.new(gl.outputs[0], o.inputs["Surface"])
    mesh.data.materials.append(toon)
    mesh.data.materials.append(gloss)
    for i, p in enumerate(mesh.data.polygons):
        p.material_index = 1 if i % 2 else 0
    save("cause-materials", {"check": True, "simplified": ["Toon", "RedGloss"], "red": "RedGloss", "textured": "Toon"})


def geometry():
    reset()
    arm, mesh = body("geometry", humanoid_bones())
    # A bevelled curve horn on the head bone.
    cu = bpy.data.curves.new("Horn", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 0.015
    sp = cu.splines.new("POLY")
    sp.points.add(2)
    for i, pt in enumerate(sp.points):
        pt.co = (0.05, -0.02, 1.68 + 0.06 * i, 1)
    horn = bpy.data.objects.new("Horn", cu)
    bpy.context.scene.collection.objects.link(horn)
    horn.parent, horn.parent_type, horn.parent_bone = arm, "BONE", "Head"
    horn.matrix_world = horn.matrix_world.copy()
    # Particle hair on a scalp mesh weighted to the head.
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.1, location=(0, 0, 1.62))
    scalp = bpy.context.object
    scalp.name = "Scalp"
    scalp.vertex_groups.new(name="Head").add(list(range(len(scalp.data.vertices))), 1.0, "REPLACE")
    scalp.modifiers.new("Armature", "ARMATURE").object = arm
    scalp.parent = arm
    ps = scalp.modifiers.new("Hair", "PARTICLE_SYSTEM").particle_system
    ps.settings.type = "HAIR"
    ps.settings.count = 60
    ps.settings.hair_length = 0.12
    save("cause-geometry", {"check": True, "converted": ["Horn", "Scalp"]})


def weights():
    reset()
    arm, mesh = body("weights", humanoid_bones())
    names = ["Hips", "Spine", "Chest", "Neck", "Head", "Shoulder.L"]
    for v in list(mesh.data.vertices)[:16]:
        for n in names:
            mesh.vertex_groups[n].add([v.index], 0.3, "ADD")
    # Some vertices that nothing weights.
    for v in list(mesh.data.vertices)[16:24]:
        for g in list(v.groups):
            mesh.vertex_groups[g.group].remove([v.index])
    save("cause-weights", {"check": True, "trimmed": 16, "filled": 8})


def clip():
    reset()
    arm, mesh = body("clip", humanoid_bones())
    arm.animation_data_create()
    act = bpy.data.actions.new("Nod")
    arm.animation_data.action = act
    pb = arm.pose.bones["Head"]
    pb.rotation_mode = "XYZ"
    for f, a in ((1, 0), (10, 0.4), (20, 0)):
        pb.rotation_euler = (a, 0, 0)
        pb.keyframe_insert("rotation_euler", frame=f)
    # An action only an Action constraint uses (a rig's internal driver): not a clip.
    helper = bpy.data.actions.new("rig_fist")
    arm.animation_data.action = helper
    pb2 = arm.pose.bones["Hand.L"]
    pb2.rotation_mode = "XYZ"
    for f, a in ((0, 0), (10, 0.5)):
        pb2.rotation_euler = (0, a, 0)
        pb2.keyframe_insert("rotation_euler", frame=f)
    c = arm.pose.bones["Hand.R"].constraints.new("ACTION")
    c.action = helper
    c.target, c.subtarget = arm, "Hips"
    arm.animation_data.action = None
    helper.use_fake_user = True
    act.use_fake_user = True
    save("cause-clip", {"check": True, "clips": ["Nod"]})


FIXTURES = {"control-rig": control_rig, "rigid-parts": rigid_parts, "modifiers-keys": modifiers_and_keys, "hidden-parts": hidden_parts, "transforms": transforms,
            "materials": materials, "geometry": geometry, "weights": weights, "clip": clip}
family_fixtures()
for key, make in FIXTURES.items():
    if not ONLY or "cause-" + key in ONLY:
        make()
print("FIXTURES_OK")
