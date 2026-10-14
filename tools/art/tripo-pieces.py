"""
Shows the big pieces of a Tripo "parts" model one by one (front and side, labelled), so a person can
say which is the stand-in head Tripo modelled under the hair. The answer goes into
~/Everloom-Tripo/<category>/<name>.json as {"standIn": ["tripo_part_3", ...]} and
tools/art/tripo-process.py uses exactly those pieces (no guessing).

    blender --background --factory-startup --python tools/art/tripo-pieces.py -- \
        --input ~/Everloom-Tripo/hair/hair-pixie.glb --out pieces-dir [--top 8]
"""
import math
import os
import sys

import bpy  # type: ignore
from mathutils import Vector  # type: ignore

a = sys.argv[sys.argv.index("--") + 1:]
opt = {a[i][2:]: a[i + 1] for i in range(0, len(a) - 1) if a[i].startswith("--")}
os.makedirs(opt["out"], exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.expanduser(opt["input"]))
ms = [o for o in bpy.data.objects if o.type == "MESH"]
pts = [o.matrix_world @ Vector(c) for o in ms for c in o.bound_box]
lo = Vector([min(p[i] for p in pts) for i in range(3)])
hi = Vector([max(p[i] for p in pts) for i in range(3)])
size = (hi - lo).length
c = (lo + hi) / 2

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "OBJECT"
scene.display.shading.show_backface_culling = False
scene.render.resolution_x = scene.render.resolution_y = 220
cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
scene.collection.objects.link(cam)
scene.camera = cam

# A head is chunky every way; strands are thin one way: rank by the smallest side of the box.
big = []
for o in ms:
    bb = [o.matrix_world @ Vector(x) for x in o.bound_box]
    ext = Vector([max(p[i] for p in bb) for i in range(3)]) - Vector([min(p[i] for p in bb) for i in range(3)])
    big.append((o, min(ext)))
big.sort(key=lambda x: -x[1])
big = big[: int(opt.get("top", 8))]
for o in ms:
    o.color = (0.85, 0.85, 0.85, 0.15)
lines = []
for o, d in big:
    for x in ms:
        x.hide_render = x is not o and True
    o.hide_render = False
    o.color = (0.3, 0.45, 0.85, 1)
    for i, ang in enumerate((0, 90)):
        t = math.radians(ang)
        v = Vector((math.sin(t), -math.cos(t), 0.1)).normalized()
        cam.location = c + v * size * 1.5
        cam.rotation_euler = (-v).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(opt["out"], f"{o.name}_{i}.png")
        bpy.ops.render.render(write_still=True)
    lines.append(f"{o.name} {len(o.data.polygons)} {d / size:.2f}")
print("PIECES " + " | ".join(lines))
