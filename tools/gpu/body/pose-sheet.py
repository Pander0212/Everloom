"""
A test-pose sheet for a creator base: rest, squat, arms up, sitting, walking, a dance pose, and the
body sliders at their extremes, each rendered front and three-quarter (Cycles, CPU). Used to check a
base body before it ships: candy-wrapper joints, clipping, seams, sliders that don't combine.

    blender -b --factory-startup -P tools/gpu/body/pose-sheet.py -- <base.glb (uncompressed)> <out.png> [label]

Poses are rotations about world axes at each joint, applied parents first, so they don't depend on
how the bones are rolled. X is the body's left-right axis, Y front-back (the body faces -Y), Z up.
"""
import bpy, math, os, sys, tempfile
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
src, out_png = args[0], args[1]
label = args[2] if len(args) > 2 else os.path.basename(src)

# (bone, axis, degrees). Forward bend of a leg: negative about X. Raising a left (+X) arm: negative about Y.
POSES = {
    "rest": [],
    "squat": [("pelvis", "X", 0), ("thigh_l", "X", -105), ("thigh_r", "X", -105), ("calf_l", "X", 125), ("calf_r", "X", 125),
              ("foot_l", "X", -20), ("foot_r", "X", -20), ("spine_01", "X", 25), ("upperarm_l", "X", -60), ("upperarm_r", "X", -60)],
    "arms up": [("upperarm_l", "Y", -115), ("upperarm_r", "Y", 115), ("lowerarm_l", "Y", -15), ("lowerarm_r", "Y", 15)],
    "sitting": [("thigh_l", "X", -90), ("thigh_r", "X", -90), ("calf_l", "X", 90), ("calf_r", "X", 90), ("upperarm_l", "Y", 35), ("upperarm_r", "Y", -35)],
    "walking": [("thigh_l", "X", -30), ("calf_l", "X", 15), ("thigh_r", "X", 22), ("calf_r", "X", 35), ("upperarm_l", "X", 25), ("upperarm_r", "X", -25),
                ("upperarm_l", "Y", 35), ("upperarm_r", "Y", -35), ("lowerarm_l", "X", -20), ("lowerarm_r", "X", -20)],
    "dance": [("spine_01", "Z", 20), ("spine_02", "Y", -10), ("upperarm_l", "Y", -140), ("upperarm_r", "Y", -10), ("lowerarm_r", "X", -90),
              ("thigh_l", "X", -50), ("calf_l", "X", 80), ("thigh_l", "Y", -15), ("thigh_r", "Y", 8)],
}
SLIDERS = {
    "sliders max": {"Weight_Heavy": 1, "Muscular": 1, "Hips_Wide": 1, "Butt_Big": 1, "Thighs_Thick": 1, "Breast_Large": 1, "Shoulders_Wide": 1, "Arms_Thick": 1},
    "sliders min": {"Weight_Thin": 1, "Hips_Narrow": 1, "Butt_Small": 1, "Thighs_Thin": 1, "Breast_Small": 1, "Shoulders_Narrow": 1, "Waist_Thin": 1},
    "max + squat": None,
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in list(bpy.context.scene.objects):
    if o.type == "MESH" and o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o, do_unlink=True)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
body = bpy.data.objects["Body"]
keys = body.data.shape_keys.key_blocks if body.data.shape_keys else {}
skin = bpy.data.materials.new("skin")
skin.use_nodes = True
bsdf = skin.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.86, 0.7, 0.62, 1)
bsdf.inputs["Roughness"].default_value = 0.55
for o in bpy.context.scene.objects:
    if o.name == "Body":
        o.data.materials.clear(); o.data.materials.append(skin)

sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 16; sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 300, 400
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.82, 0.86, 1); sc.world = w
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3; sun.rotation_euler = (math.radians(55), 0, math.radians(-35)); sc.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = 2.0


def reset():
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    for k in keys:
        if k.name != "Basis":
            k.value = 0.0
    bpy.context.view_layer.update()


def pose(steps):
    for bone, axis, deg in steps:
        pb = arm.pose.bones.get(bone)
        if not pb or not deg:
            continue
        m = arm.matrix_world @ pb.matrix
        head = m.translation.copy()
        r = Matrix.Translation(head) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-head)
        pb.matrix = arm.matrix_world.inverted() @ (r @ m)
        bpy.context.view_layer.update()


def bounds():
    dg = bpy.context.evaluated_depsgraph_get()
    e = body.evaluated_get(dg); m = e.to_mesh()
    pts = [e.matrix_world @ v.co for v in m.vertices]
    e.to_mesh_clear()
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


tiles = []
tmp = tempfile.mkdtemp()
shots = list(POSES.items()) + [(k, None) for k in SLIDERS]
for name, steps in shots:
    reset()
    if name in SLIDERS:
        vals = SLIDERS[name] or SLIDERS["sliders max"]
        for k, v in vals.items():
            if k in keys:
                keys[k].value = v
        if name == "max + squat":
            pose(POSES["squat"])
    else:
        pose(steps)
    lo, hi = bounds()
    c = (lo + hi) / 2
    cam.data.ortho_scale = max(hi.z - lo.z, hi.x - lo.x) * 1.12
    for tag, ang in (("front", 0), ("34", 40)):
        a = math.radians(ang)
        cam.location = c + Vector((4 * math.sin(a), -4 * math.cos(a), 0))
        cam.rotation_euler = (math.radians(90), 0, a)
        p = os.path.join(tmp, f"{len(tiles):02d}.png")
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        tiles.append((f"{name} ({'front' if ang == 0 else '3/4'})", p))

# Contact sheet: two rows per pose pair, labels drawn by PIL if available, else plain.
try:
    from PIL import Image, ImageDraw
    cols = 6
    rows = math.ceil(len(tiles) / cols)
    sheet = Image.new("RGB", (cols * 300, rows * 420 + 40), (235, 236, 240))
    d = ImageDraw.Draw(sheet)
    d.text((10, 10), label, fill=(30, 30, 30))
    for i, (t, p) in enumerate(tiles):
        x, y = (i % cols) * 300, (i // cols) * 420 + 40
        sheet.paste(Image.open(p).convert("RGB"), (x, y))
        d.text((x + 6, y + 402), t, fill=(30, 30, 30))
    sheet.save(out_png)
except ImportError:
    import shutil
    os.makedirs(out_png + ".d", exist_ok=True)
    for i, (t, p) in enumerate(tiles):
        shutil.copy(p, os.path.join(out_png + ".d", f"{i:02d}-{t.replace(' ', '_').replace('/', '')}.png"))
print("SHEET_OK", out_png, len(tiles))
