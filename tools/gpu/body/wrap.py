"""
Wraps Everloom's clean base topology (the character creator's MakeHuman-based body) onto a generated
body scan, keeping its quads, UVs, skeleton, weights and shape keys. Only the body's shape changes.

    blender -b --factory-startup -P tools/gpu/body/wrap.py -- <base.glb (uncompressed)> <scan.glb> <out dir> [options.json]

1. The scan is scaled to the base's height, stood on the floor and centred.
2. The base is posed to the scan: upper arms and thighs turn (about the forward axis) so the base's
   wrists and ankles point where the scan's do.
3. Each vertex of the posed base moves to the nearest point of the scan. The move is limited
   (max distance), smoothed over the mesh (so seams and wrinkles of the generated surface don't come
   through), and masked: hands, feet and the head keep the base's own detail, the breasts follow
   only partly (generated references wear a bra; the breast sliders shape them).
4. The posed result is un-posed (inverse linear blend skinning), giving the new rest shape.

Writes <out>/deltas.bin (Float32 x, y, z per glTF vertex of the Body mesh, in glTF axes), which
tools/gpu/body/apply-deltas.mjs adds to the original GLB, plus report.json and before/after renders.
"""
import bpy, bmesh, json, math, os, sys
from array import array
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index("--") + 1:]
base_path, scan_path, out = args[0], args[1], args[2]
opts = json.load(open(args[3])) if len(args) > 3 else {}
MAX_DIST = opts.get("maxDistance", 0.06)      # metres: farther than this is a mismatch, not body shape
SMOOTH = opts.get("smoothIterations", 12)
BREAST = opts.get("breastFollow", 0.4)
os.makedirs(out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=base_path)
for o in list(bpy.context.scene.objects):
    if o.type == "MESH" and o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o, do_unlink=True)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
body = bpy.data.objects["Body"]
base_objs = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=scan_path)
scan_objs = [o for o in bpy.context.scene.objects if o not in base_objs and o.type == "MESH"]
for o in list(bpy.context.scene.objects):
    if o not in base_objs and o.type != "MESH":
        bpy.data.objects.remove(o, do_unlink=True)

# One scan mesh, applied transforms.
bpy.ops.object.select_all(action="DESELECT")
for o in scan_objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = scan_objs[0]
if len(scan_objs) > 1:
    bpy.ops.object.join()
scan = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def world_verts(o):
    dg = bpy.context.evaluated_depsgraph_get()
    e = o.evaluated_get(dg)
    m = e.to_mesh()
    pts = [e.matrix_world @ v.co for v in m.vertices]
    e.to_mesh_clear()
    return pts


# 1. Scale and place the scan.
for kb in (body.data.shape_keys.key_blocks if body.data.shape_keys else []):
    kb.value = 0.0
bv = world_verts(body)
b_lo, b_hi = min(p.z for p in bv), max(p.z for p in bv)
sv = [scan.matrix_world @ v.co for v in scan.data.vertices]
s_lo, s_hi = min(p.z for p in sv), max(p.z for p in sv)
k = (b_hi - b_lo) / (s_hi - s_lo)
def mid(pts, z0, z1):
    """Centre of the torso between two heights: the middle of its bounding box, arms left out."""
    sel = [p for p in pts if z0 < p.z < z1]
    cx = (min(p.x for p in sel) + max(p.x for p in sel)) / 2
    w = max(abs(p.x - cx) for p in sel)
    core = [p for p in sel if abs(p.x - cx) < 0.45 * w] or sel
    cx = sum(p.x for p in core) / len(core)
    return Vector((cx, (min(p.y for p in core) + max(p.y for p in core)) / 2, 0))
bh, sh = b_hi - b_lo, s_hi - s_lo
b_c = mid(bv, b_lo + 0.62 * bh, b_lo + 0.7 * bh)
s_c = mid(sv, s_lo + 0.62 * sh, s_lo + 0.7 * sh)
for v in scan.data.vertices:
    p = scan.matrix_world @ v.co
    v.co = Vector(((p.x - s_c.x) * k + b_c.x, (p.y - s_c.y) * k + b_c.y, (p.z - s_lo) * k + b_lo))
scan.matrix_world = Matrix.Identity(4)
scan.data.update()
sv = [v.co.copy() for v in scan.data.vertices]

# 2. Pose the base to the scan.
pb = arm.pose.bones
bones = {b.name for b in arm.data.bones}
def first(*names):
    return next((n for n in names if n in bones), None)
LIMBS = {
    "arm_l": (first("upperarm_l", "upperarm.L", "upper_arm.L"), first("hand_l", "hand.L"), +1, "arm"),
    "arm_r": (first("upperarm_r", "upperarm.R", "upper_arm.R"), first("hand_r", "hand.R"), -1, "arm"),
    "leg_l": (first("thigh_l", "thigh.L"), first("foot_l", "foot.L"), +1, "leg"),
    "leg_r": (first("thigh_r", "thigh.R"), first("foot_r", "foot.R"), -1, "leg"),
}
bpy.context.view_layer.update()
report = {"scale": k, "limbs": {}}


def scan_tip(side, kind, root):
    """Where the scan's wrist or ankle is: the farthest point of that limb from its root, inward a bit."""
    if kind == "arm":
        # Above the hips only: below them the spread legs reach farther out than the hands.
        cand = [p for p in sv if side * (p.x - b_c.x) > abs(root.x - b_c.x) + 0.08 and b_lo + 0.42 * bh < p.z < root.z + 0.1]
        far = max(cand, key=lambda p: side * p.x)  # the hand: the most lateral point above the hips
        return root + (far - root) * 0.82  # the wrist sits ~18% in from the fingertips
    cand = [p for p in sv if side * (p.x - b_c.x) > 0.02 and p.z < root.z - 0.2]
    low = min(p.z for p in cand)
    feet = [p for p in cand if p.z < low + 0.06]
    c = Vector((sum(p.x for p in feet) / len(feet), sum(p.y for p in feet) / len(feet), low + 0.07))
    return c


for name, (root_b, tip_b, side, kind) in LIMBS.items():
    if not root_b or not tip_b:
        continue
    root = arm.matrix_world @ pb[root_b].head
    tip = arm.matrix_world @ pb[tip_b].head
    want = scan_tip(side, kind, root)
    a_now = math.atan2(tip.z - root.z, abs(tip.x - root.x))
    a_want = math.atan2(want.z - root.z, abs(want.x - root.x))
    turn = a_want - a_now  # positive: raise towards the side
    # Rotate about the forward axis (world Y), in the bone's own space.
    rot_world = Matrix.Rotation(-side * turn, 4, "Y")
    bm = arm.matrix_world @ pb[root_b].matrix
    new = rot_world @ bm
    new.translation = bm.translation
    pb[root_b].matrix = arm.matrix_world.inverted() @ new
    bpy.context.view_layer.update()
    report["limbs"][name] = {"degrees": round(math.degrees(turn), 1), "root": [round(c, 3) for c in root], "tip": [round(c, 3) for c in tip], "want": [round(c, 3) for c in want]}

# 3. Fit the posed base to the scan.
posed = world_verts(body)
sbm = bmesh.new()
sbm.from_mesh(scan.data)
tree = BVHTree.FromBMesh(sbm)
vg = {g.index: g.name for g in body.vertex_groups}
KEEP = ("hand", "finger", "thumb", "index", "middle", "ring", "pinky", "foot", "toe", "ball", "head", "neck", "eye", "jaw", "teeth", "tongue")
mask, disp, far, dists = [], [], 0, []
for i, v in enumerate(body.data.vertices):
    keep = breast = 0.0
    for g in v.groups:
        n = vg.get(g.group, "").lower()
        if any(s in n for s in KEEP):
            keep += g.weight
        if "breast" in n:
            breast += g.weight
    m = max(0.0, 1.0 - keep) * (1.0 - (1.0 - BREAST) * min(1.0, breast))
    loc, nrm, idx, dist = tree.find_nearest(posed[i])
    d = (loc - posed[i]) if loc is not None and dist < MAX_DIST else Vector()
    if loc is None or dist >= MAX_DIST:
        far += 1
    dists.append(dist if loc is not None else 9)
    mask.append(m)
    disp.append(d)
# Smooth the displacement over the mesh (and the mask, so the edges of kept regions blend). The
# base is split along its UV seams; the smoothing runs on welded positions, so both sides of a seam
# move exactly alike (otherwise hairline cracks open along the seams).
bm = bmesh.new()
bm.from_mesh(body.data)
bm.verts.ensure_lookup_table()
weld, gid = {}, []
for v in body.data.vertices:
    k = (round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5))
    gid.append(weld.setdefault(k, len(weld)))
G = len(weld)
members = [[] for _ in range(G)]
for i, g in enumerate(gid):
    members[g].append(i)
gn = [set() for _ in range(G)]
for e in bm.edges:
    a, b = gid[e.verts[0].index], gid[e.verts[1].index]
    if a != b:
        gn[a].add(b); gn[b].add(a)
gn = [list(x) for x in gn]
gd = [sum((disp[i] for i in m), Vector()) / len(m) for m in members]
gm = [min(mask[i] for i in m) for m in members]
for _ in range(SMOOTH):
    gd = [(gd[g] + sum((gd[h] for h in gn[g]), Vector())) / (1 + len(gn[g])) for g in range(G)]
# A long falloff: a short one leaves a visible step where the kept hands, feet and head begin.
for _ in range(SMOOTH * 3):
    gm = [(gm[g] + sum(gm[h] for h in gn[g])) / (1 + len(gn[g])) for g in range(G)]
disp = [gd[gid[i]] for i in range(len(disp))]
mask = [gm[gid[i]] for i in range(len(mask))]
new_posed = [posed[i] + disp[i] * mask[i] for i in range(len(posed))]
moved = [disp[i].length * mask[i] for i in range(len(disp))]
srt = sorted(dists)
report["nearest"] = {"over_max": far, "p50Mm": round(1000 * srt[len(srt) // 2], 1), "p90Mm": round(1000 * srt[int(len(srt) * 0.9)], 1)}
report["fit"] = {"meanMm": round(1000 * sum(moved) / len(moved), 1), "maxMm": round(1000 * max(moved), 1), "vertices": len(moved)}

# 4. Un-pose (inverse linear blend skinning), in the body's local space.
inv_body = body.matrix_world.inverted()
skin = {}
for b in arm.data.bones:
    skin[b.name] = arm.matrix_world @ pb[b.name].matrix @ b.matrix_local.inverted() @ arm.matrix_world.inverted()
deltas = array("f")
for i, v in enumerate(body.data.vertices):
    M = Matrix(((0,) * 4,) * 4)
    tot = 0.0
    for g in v.groups:
        n = vg.get(g.group)
        if n in skin and g.weight > 0:
            M = M + skin[n] * g.weight
            tot += g.weight
    M = M * (1 / tot) if tot > 0 else Matrix.Identity(4)
    rest_world = M.inverted_safe() @ new_posed[i]
    rest_local = inv_body @ rest_world
    d = rest_local - v.co
    # Legs may grow outward, forward and back but not inward: the scan's legs stand apart, the
    # base's closer together, so inward growth would push one thigh into the other at rest.
    leg = sum(g.weight for g in v.groups if any(t in vg.get(g.group, "").lower() for t in ("thigh", "calf")))
    if leg > 0 and (v.co.x - b_c.x) * d.x < 0:
        d.x *= 1.0 - min(1.0, leg)
    # Blender (x, y, z) → glTF (x, z, -y)
    deltas.extend((d.x, d.z, -d.y))
with open(os.path.join(out, "deltas.bin"), "wb") as f:
    deltas.tofile(f)
json.dump(report, open(os.path.join(out, "report.json"), "w"), indent=1)
if opts.get("debugRender"):
    # The posed, fitted base (blue) over the scan (grey), front and side.
    me = bpy.data.meshes.new("fitted")
    src = body.data
    me.from_pydata([tuple(p) for p in new_posed], [], [tuple(p.vertices) for p in src.polygons])
    fo = bpy.data.objects.new("fitted", me)
    bpy.context.scene.collection.objects.link(fo)
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH" and o not in (scan, fo):
            o.hide_render = True
    for o, col in ((fo, (0.2, 0.4, 0.9, 1)), (scan, (0.8, 0.8, 0.8, 1))):
        mat = bpy.data.materials.new(o.name); mat.diffuse_color = col; mat.use_nodes = True
        mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = col
        if o is scan:
            mat.node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.35; mat.blend_method = "BLEND"
        o.data.materials.clear(); o.data.materials.append(mat)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.samples = 16; sc.cycles.device = "CPU"
    sc.render.resolution_x, sc.render.resolution_y = 600, 800
    w = bpy.data.worlds.new("w"); w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.95, 0.95, 0.95, 1); sc.world = w
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = "ORTHO"; cam.data.ortho_scale = (b_hi - b_lo) * 1.1
    for tag, loc, rot in (("front", (b_c.x, -4, (b_lo + b_hi) / 2), (math.radians(90), 0, 0)), ("side", (4, b_c.y, (b_lo + b_hi) / 2), (math.radians(90), 0, math.radians(90)))):
        cam.location, cam.rotation_euler = loc, rot
        sc.render.filepath = os.path.join(out, f"overlay-{tag}.png")
        bpy.ops.render.render(write_still=True)
print("WRAP_OK", json.dumps(report))
