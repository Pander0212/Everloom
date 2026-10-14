"""
Renders a processed part on its base body from four sides (front, side, back, three-quarter back)
into one strip, for review: tools/art/tripo-process.py's thumbnail only shows the front.

    blender --background --factory-startup --python tools/art/tripo-views.py -- \
        --part ~/Everloom-Tripo/processed/hair-spiky/anime-f.glb --base apps/web/public/avatar/bases/anime-f.glb \
        --out views.png [--focus head|body]
"""
import math
import sys

import bpy  # type: ignore
from mathutils import Vector  # type: ignore

a = sys.argv[sys.argv.index("--") + 1:]
opt = {a[i][2:]: a[i + 1] for i in range(0, len(a) - 1) if a[i].startswith("--")}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=opt["base"])
body = [o for o in bpy.data.objects if o.type == "MESH"]
for o in body:
    if o.name == "Icosphere":
        bpy.data.objects.remove(o, do_unlink=True)
body = [o for o in bpy.data.objects if o.type == "MESH"]
for o in body:
    o.color = (0.86, 0.7, 0.62, 1.0)
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=opt["part"])
part = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
for o in part:
    o.color = (0.35, 0.45, 0.75, 1.0)
for o in bpy.data.objects:
    if o not in before and o.type == "ARMATURE":
        o.hide_render = True

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "OBJECT"
scene.display.shading.show_backface_culling = False
scene.render.resolution_x = scene.render.resolution_y = 400
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new("w")
scene.world.color = (1, 1, 1)

arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
head = arm.matrix_world @ arm.data.bones["head"].head_local
pts = [o.matrix_world @ v.co for o in part for v in o.data.vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
print("BOUNDS", tuple(round(x, 3) for x in lo), tuple(round(x, 3) for x in hi))
if opt.get("focus", "head") == "head":
    c = Vector((head.x, head.y, head.z + 0.02))
    r = 0.16
else:
    c = (lo + hi) / 2
    r = (hi - lo).length * 0.65
cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
scene.collection.objects.link(cam)
cam.data.lens = 50
scene.camera = cam
files = []
for i, ang in enumerate((0, 90, 180, 225)):
    t = math.radians(ang)
    d = Vector((math.sin(t), -math.cos(t), 0.12)).normalized()
    cam.location = c + d * r * 3.0
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    path = opt["out"].replace(".png", f"_{i}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    files.append(path)
print("VIEWS", ";".join(files))
