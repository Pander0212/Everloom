"""
Renders one region of a base body (grey clay, white background) from a chosen direction: the picture
an image editor adds detail to, so the 3D model made from it has exactly this body's shape there.

    blender --background --factory-startup --python tools/art/region-shot.py -- \
        --base body.glb --out shot.png --center 0.5 --span 0.3 --dir 0,1,-0.6 [--size 1024]

--center is the height of the region as a fraction of the body's height, --span the width of the
square picture in metres, --dir the direction from the region to the camera (x,y,z; +y is the back).
"""
import sys

import bpy  # type: ignore
from mathutils import Vector  # type: ignore

a = sys.argv[sys.argv.index("--") + 1:]
opt = {a[i][2:]: a[i + 1] for i in range(0, len(a) - 1) if a[i].startswith("--")}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=opt["base"])
for o in [o for o in bpy.data.objects if o.name == "Icosphere"]:
    bpy.data.objects.remove(o, do_unlink=True)
ms = [o for o in bpy.data.objects if o.type == "MESH"]
pts = [o.matrix_world @ v.co for o in ms for v in o.data.vertices]
lo = Vector([min(p[i] for p in pts) for i in range(3)])
hi = Vector([max(p[i] for p in pts) for i in range(3)])
c = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z + (hi.z - lo.z) * float(opt.get("center", 0.5))))

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.color_type = "SINGLE"
scene.display.shading.single_color = (0.62, 0.62, 0.62)
scene.display.shading.show_cavity = True
size = int(opt.get("size", 1024))
scene.render.resolution_x = scene.render.resolution_y = size
scene.world = bpy.data.worlds.new("w")
scene.world.color = (1, 1, 1)
scene.view_settings.view_transform = "Standard"
cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
scene.collection.objects.link(cam)
cam.data.type = "ORTHO"
cam.data.ortho_scale = float(opt.get("span", 0.3))
d = Vector([float(x) for x in opt.get("dir", "0,1,0").split(",")]).normalized()
cam.location = c + d * 2
cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam
scene.render.filepath = opt["out"]
bpy.ops.render.render(write_still=True)
print("SHOT", opt["out"], [round(x, 3) for x in c])
