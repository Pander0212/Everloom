"""
Smooths a creator base's skin weights where the hips deform badly (the buttocks "balloon" in a
squat, a crease at the front of the hip when a leg goes back): the thigh, pelvis, butt and lower
spine weights are smoothed over the hip region, then normalised.

    blender -b --factory-startup -P tools/gpu/body/reweight.py -- <base.glb (uncompressed)> <out weights.json> [iterations] [factor]

Writes, per glTF vertex of the Body, its four strongest bones and weights; apply-deltas.mjs --weights
puts them into the GLB (positions, shape keys and UVs untouched).
"""
import bpy, json, sys

args = sys.argv[sys.argv.index("--") + 1:]
src, out = args[0], args[1]
ITER = int(args[2]) if len(args) > 2 else 12
FACTOR = float(args[3]) if len(args) > 3 else 0.5
HIP = ("thigh_l", "thigh_r", "pelvis", "butt_l", "butt_r", "spine_01")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
body = bpy.data.objects["Body"]
groups = {g.name: g.index for g in body.vertex_groups}
hip_idx = {groups[n] for n in HIP if n in groups}
# The hip region: vertices with some weight on those bones, but not the lower thigh (knee side).
region = [v.index for v in body.data.vertices if sum(g.weight for g in v.groups if g.group in hip_idx) > 0.05]
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="DESELECT")
bpy.ops.object.mode_set(mode="OBJECT")
for i in region:
    body.data.vertices[i].select = True
bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
body.data.use_paint_mask_vertex = True
for n in HIP:
    if n in groups:
        body.vertex_groups.active_index = groups[n]
        bpy.ops.object.vertex_group_smooth(group_select_mode="ACTIVE", factor=FACTOR, repeat=ITER)
bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
bpy.ops.object.mode_set(mode="OBJECT")
names = {g.index: g.name for g in body.vertex_groups}
# Vertices split along UV seams must keep identical weights, or the seams open when the body bends.
weld = {}
for v in body.data.vertices:
    weld.setdefault((round(v.co.x, 5), round(v.co.y, 5), round(v.co.z, 5)), []).append(v.index)
avg = {}
for members in weld.values():
    acc = {}
    for i in members:
        for g in body.data.vertices[i].groups:
            acc[g.group] = acc.get(g.group, 0.0) + g.weight / len(members)
    for i in members:
        avg[i] = acc
res = []
for v in body.data.vertices:
    top = sorted(((names[g], w) for g, w in avg[v.index].items() if w > 0), key=lambda x: -x[1])[:4]
    s = sum(w for _, w in top) or 1
    res.append([[n, round(w / s, 5)] for n, w in top])
json.dump({"vertices": res, "region": len(region)}, open(out, "w"))
print("REWEIGHT_OK", len(res), "region", len(region))
