"""
Renders a base body's head and shoulders, bald, straight from the front on white: the picture an
image editor draws a hairstyle onto, so Tripo models the hair around exactly this head (and the
head, cut off afterwards, places the hair on the base).

    blender --background --factory-startup --python tools/art/base-bust.py -- \
        --base apps/web/public/avatar/bases/anime-f.glb --out bust-f.png [--view front|three-quarter] [--size 1024]
"""
import math
import sys

import bpy  # type: ignore
from mathutils import Vector  # type: ignore

a = sys.argv[sys.argv.index("--") + 1:]
opt = {a[i][2:]: a[i + 1] for i in range(0, len(a) - 1) if a[i].startswith("--")}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=opt["base"])
for o in [o for o in bpy.data.objects if o.type == "MESH" and o.name == "Icosphere"]:
    bpy.data.objects.remove(o, do_unlink=True)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
# Arms down a little so the shoulders read naturally in a bust.
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")
for side, s in (("l", -1), ("r", 1)):
    b = arm.pose.bones.get(f"upperarm_{side}")
    if b:
        b.rotation_mode = "XYZ"
        b.rotation_euler = (0, 0, math.radians(55) * s)
bpy.ops.object.mode_set(mode="OBJECT")

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_WORKBENCH"
if scene.render.engine == "BLENDER_WORKBENCH":
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
size = int(opt.get("size", 1024))
scene.render.resolution_x = scene.render.resolution_y = size
scene.world = bpy.data.worlds.new("w")
scene.world.color = (1, 1, 1)
scene.view_settings.view_transform = "Standard"
if scene.render.engine != "BLENDER_WORKBENCH":
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 1.0
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 2.5
    sun.rotation_euler = (math.radians(40), 0, math.radians(20))
    scene.collection.objects.link(sun)

head = arm.matrix_world @ arm.data.bones["head"].head_local
top = arm.matrix_world @ arm.data.bones["head"].tail_local
c = Vector((0, head.y, (head.z + top.z) / 2 - 0.06))
cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
scene.collection.objects.link(cam)
cam.data.type = "ORTHO"
cam.data.ortho_scale = 0.62
ang = math.radians(30 if opt.get("view") == "three-quarter" else 0)
d = Vector((math.sin(ang), -math.cos(ang), 0))
cam.location = c + d * 2
cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam
scene.render.filepath = opt["out"]
bpy.ops.render.render(write_still=True)
print("BUST", opt["out"], scene.render.engine)
