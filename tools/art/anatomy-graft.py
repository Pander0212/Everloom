"""
Grafts a detailed anatomy close-up (a Tripo model of one body region, made from its own picture) onto
a rigged base body (18+, adult bodies only; outputs stay private, never in the repository).

    blender --background --factory-startup --python tools/art/anatomy-graft.py -- \
        --base ~/Everloom-Tripo/adult/adult-base-f-rigged.glb \
        --part ~/Everloom-Tripo/adult/adult-part-vulva-anus.glb --spec ~/Everloom-Tripo/adult/adult-part-vulva-anus.json \
        --out ~/Everloom-Tripo/adult/adult-f-detailed.glb

The spec (JSON next to the part) says, in the part's own coordinates as Tripo exported it:
  "facing": "back"         the side of the body the picture showed (the part is turned to match);
  "zone": {"center": [x, y, z], "radii": [rx, ry, rz]}   what is kept (an ellipsoid; the rest of the
                            close-up is only for placing it);
  "features": {"vulva": {"center": [...], "radius": r}, "anus": {...}}   where the sliders act.

What it does:
  1. turns the part to the body's side and registers it to the body's skin (scale from the width of
     the region, then iterative closest points with scale, the cut faces of the close-up ignored);
  2. keeps the zone, sinks its rim onto the body's skin so it blends in, and tucks the body's own
     skin under it;
  3. copies skin weights from the body to the grafted surface and joins it into the body mesh;
  4. adds slider shape keys (Vulva_Full, Vulva_Spread, Labia_Size, Anus_Size, Anus_Open);
  5. exports the body with its skeleton, and renders close-ups for review.
"""
import json
import math
import os
import sys

import bmesh  # type: ignore
import bpy  # type: ignore
from mathutils import Matrix, Vector  # type: ignore
from mathutils.bvhtree import BVHTree  # type: ignore
from mathutils.kdtree import KDTree  # type: ignore

a = sys.argv[sys.argv.index("--") + 1:]
opt = {a[i][2:]: a[i + 1] for i in range(0, len(a) - 1) if a[i].startswith("--")}
spec = json.load(open(os.path.expanduser(opt["spec"])))


def meshes_of(objs):
    return [o for o in objs if o.type == "MESH" and o.name != "Icosphere"]


def flatten(o):
    o.data.transform(o.matrix_world)
    o.matrix_world = Matrix.Identity(4)


def similarity(src, dst, scale=True):
    import numpy as np

    A, B = np.array(src), np.array(dst)
    ma, mb = A.mean(0), B.mean(0)
    ac, bc = A - ma, B - mb
    u, s, vt = np.linalg.svd(bc.T @ ac / len(A))
    d = np.eye(3)
    if np.linalg.det(u @ vt) < 0:
        d[2, 2] = -1
    r = u @ d @ vt
    k = np.trace(np.diag(s) @ d) / max(1e-12, (ac ** 2).sum() / len(A)) if scale else 1.0
    t = mb - k * r @ ma
    m = Matrix.Identity(4)
    for i in range(3):
        for j in range(3):
            m[i][j] = k * r[i, j]
        m[i][3] = t[i]
    return m


# ---- base -----------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.expanduser(opt["base"]))
for o in [o for o in bpy.data.objects if o.name == "Icosphere"]:
    bpy.data.objects.remove(o, do_unlink=True)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
body = max(meshes_of(bpy.data.objects), key=lambda o: len(o.data.vertices))
mw = body.matrix_world.copy()
bverts = [mw @ v.co for v in body.data.vertices]
bpolys = [list(p.vertices) for p in body.data.polygons]
btree = BVHTree.FromPolygons(bverts, bpolys)
blo = Vector([min(p[i] for p in bverts) for i in range(3)])
bhi = Vector([max(p[i] for p in bverts) for i in range(3)])
H = bhi.z - blo.z

# ---- part -----------------------------------------------------------------------------------------
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.expanduser(opt["part"]))
new = [o for o in bpy.data.objects if o not in before]
pm = meshes_of(new)
for o in new:
    if o.type != "MESH":
        o_children = [c for c in o.children]
        for c in o_children:
            mwc = c.matrix_world.copy()
            c.parent = None
            c.matrix_world = mwc
for o in [o for o in new if o.type != "MESH" or o.name == "Icosphere"]:
    bpy.data.objects.remove(o, do_unlink=True)
for o in pm:
    flatten(o)
if len(pm) > 1:
    bpy.ops.object.select_all(action="DESELECT")
    for o in pm:
        o.select_set(True)
    bpy.context.view_layer.objects.active = pm[0]
    bpy.ops.object.join()
part = pm[0]
part.name = "Graft"
for g in list(part.vertex_groups):
    part.vertex_groups.remove(g)

# The zone and feature points ride along with the part through every transform: an empty per point.
marks = {}
def mark(name, p):
    e = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(e)
    e.location = Vector(p)
    marks[name] = e
zc = Vector(spec["zone"]["center"])
zr = Vector(spec["zone"]["radii"])
mark("zone", zc)
# Unit markers along each axis: after all transforms their distances give the final scale.
mark("ux", zc + Vector((0.1, 0, 0)))
if "anchor" in spec:
    mark("anchor", spec["anchor"]["part"])
for k, f in spec.get("features", {}).items():
    mark(k, f["center"])
# Which part vertices are in the zone (ellipsoid, part coordinates as exported).
inzone = [((v.co.x - zc.x) / zr.x) ** 2 + ((v.co.y - zc.y) / zr.y) ** 2 + ((v.co.z - zc.z) / zr.z) ** 2 for v in part.data.vertices]
# The skin the picture showed faces the camera (-Y as exported); Tripo guesses the rest (a deep block),
# so only that skin, around the zone, is used to place the part.
part.data.update()
facing = [v.normal.y < -0.35 for v in part.data.vertices]
rz = spec.get("regZ")
reg_ok = [fc and z < 4.0 and (rz is None or rz[0] <= v.co.z <= rz[1]) for fc, z, v in zip(facing, inzone, part.data.vertices)]


def apply(m):
    part.data.transform(m)
    part.data.update()
    for e in marks.values():
        e.location = m @ e.location


# 1. Orientation and first placement.
if "view" in spec:
    # Made from tools/art/region-shot.py: the camera direction, region centre and picture width are
    # known. Tripo's export faces its camera at -Y with picture right at +X and up at +Z.
    view = Vector(spec["view"]).normalized()
    cam = (-view).to_track_quat("-Z", "Y").to_matrix()
    right, up = cam.col[0], cam.col[1]
    rot = Matrix((right, -view, up)).transposed().to_4x4()
    apply(rot)
    pv = [v.co.copy() for v in part.data.vertices]
    span = float(spec["span"])
    width = max(p.dot(right) for p in pv) - min(p.dot(right) for p in pv)
    k = span / max(1e-6, width)
    c = Vector(((blo.x + bhi.x) / 2, (blo.y + bhi.y) / 2, blo.z + H * float(spec["center"])))
    # The picture is cut by its frame on all sides: the model's extent across and up is the picture,
    # its middle is the picture's middle.
    rs = [p.dot(right) for p in pv]
    us = [p.dot(up) for p in pv]
    pc = right * ((max(rs) + min(rs)) / 2) + up * ((max(us) + min(us)) / 2) + view * (sum(p.dot(view) for p in pv) / len(pv))
    k = span / max(1e-6, max(max(rs) - min(rs), max(us) - min(us)))
    if "anchor" in spec:
        # A landmark both share (e.g. the perineum): the part's point (marked in exported coordinates,
        # turned with the part above) onto the body's point (world), at a given scale.
        k = float(spec["anchor"]["scale"])
        pa = marks["anchor"].location.copy()
        apply(Matrix.Translation(Vector(spec["anchor"]["body"])) @ Matrix.Scale(k, 4) @ Matrix.Translation(-pa))
        c = Vector(spec["anchor"]["body"])
    else:
        apply(Matrix.Translation(c) @ Matrix.Scale(k, 4) @ Matrix.Translation(-pc))
        # Depth: the picture-facing skin at the centre onto the body's skin there.
        pt = BVHTree.FromPolygons([v.co.copy() for v in part.data.vertices], [list(p.vertices) for p in part.data.polygons])
        hb = btree.ray_cast(c + view * 1.0, -view)
        hp = pt.ray_cast(c + view * 1.0, -view)
        if hb[0] is not None and hp[0] is not None:
            apply(Matrix.Translation(view * (hb[0] - hp[0]).dot(view)))
    near_c = span * 0.8
    rpolys = [p for p in bpolys if all((bverts[i] - c).length < near_c for i in p) and Vector(bverts[p[1]] - bverts[p[0]]).cross(bverts[p[2]] - bverts[p[0]]).dot(view) > 0]
    band_lo, band_hi = c.z - near_c, c.z + near_c
else:
    view = Vector((0, 1 if spec.get("facing", "back") == "back" else -1, 0))
    if spec.get("facing", "back") == "back":
        apply(Matrix.Rotation(math.pi, 4, "Z"))
    pv = [v.co.copy() for v in part.data.vertices]
    plo = Vector([min(p[i] for p in pv) for i in range(3)])
    phi = Vector([max(p[i] for p in pv) for i in range(3)])
    hint = spec.get("place", {})
    band_lo, band_hi = blo.z + H * hint.get("bandLow", 0.38), blo.z + H * hint.get("bandHigh", 0.52)
    band = [p for p in bverts if band_lo < p.z < band_hi]
    bw = max(p.x for p in band) - min(p.x for p in band)
    k = bw / max(1e-6, phi.x - plo.x)
    bcx = (max(p.x for p in band) + min(p.x for p in band)) / 2
    back = max(p.y for p in band)
    apply(Matrix.Translation(Vector((bcx, back, band_lo))) @ Matrix.Scale(k, 4) @ Matrix.Translation(-Vector(((plo.x + phi.x) / 2, phi.y, plo.z))))
    cy = (blo.y + bhi.y) / 2
    side = 1 if spec.get("facing", "back") == "back" else -1
    rpolys = [p for p in bpolys if all((bverts[i].y - cy) * side > -0.01 and band_lo - H * 0.12 < bverts[i].z < band_hi + H * 0.12 for i in p)]
rtree = BVHTree.FromPolygons(bverts, rpolys)
gp = [v.co for v in part.data.vertices]
print("INITIAL", len(gp), [round(min(p[i] for p in gp), 3) for i in range(3)], [round(max(p[i] for p in gp), 3) for i in range(3)], "body", [round(x, 3) for x in blo], [round(x, 3) for x in bhi])
cut = set()
for p in part.data.polygons:
    nrm = p.normal
    if abs(nrm.z) > 0.97 or abs(nrm.x) > 0.97 or abs(nrm.y) > 0.97:
        cut.add(p.index)
cut_verts = {vi for pi in cut for vi in part.data.polygons[pi].vertices}
samples_idx = [i for i in range(0, len(part.data.vertices), max(1, len(part.data.vertices) // 8000)) if i not in cut_verts and reg_ok[i]]
print("SAMPLES", len(samples_idx))
for it in range(int(spec.get("icp", 30))):
    pts = [part.data.vertices[i].co.copy() for i in samples_idx]
    src, dst = [], []
    lim = 0.05 if it < 10 else 0.015
    for p in pts:
        hit = rtree.find_nearest(p)
        if hit[0] is not None and hit[3] < lim and band_lo - H * 0.1 < hit[0].z < band_hi + H * 0.1:
            src.append(tuple(p))
            dst.append(tuple(hit[0]))
    if len(src) < 100:
        break
    m = similarity(src, dst, scale=it < 20 and "view" not in spec)
    apply(m)
fit = sum(rtree.find_nearest(part.data.vertices[i].co)[3] for i in samples_idx[::5]) / max(1, len(samples_idx[::5]))
gp = [v.co for v in part.data.vertices]
print("AFTER_ICP", len(gp), [round(min(p[i] for p in gp), 3) for i in range(3)], [round(max(p[i] for p in gp), 3) for i in range(3)], "body", [round(x, 3) for x in blo], [round(x, 3) for x in bhi])
print("REGISTERED", len(src), "mean distance", round(fit, 4))

if opt.get("debug"):
    for e in marks.values():
        e.empty_display_size = 0.01
    bpy.ops.wm.save_as_mainfile(filepath=os.path.expanduser(opt["debug"]))
# 2. Relief transfer: the close-up's detail (its surface minus a smoothed copy of it) is pressed into
#    the body's own skin, so the body stays one continuous, rigged surface with no seam.
zone_w = marks["zone"].location.copy()
k = (marks["ux"].location - zone_w).length / 0.1
zone_r = Vector((zr.x * k, zr.y * k, zr.z * k))
print("SCALE", round(k, 4), "zone radii", [round(x, 3) for x in zone_r], "centre", [round(x, 3) for x in zone_w])

def zone_d(p):
    q = p - zone_w
    return (q.x / zone_r.x) ** 2 + (q.y / zone_r.y) ** 2 + (q.z / zone_r.z) ** 2

# Smoothed copy of the part: the broad shape; part minus smooth = the detail.
pverts = [v.co.copy() for v in part.data.vertices]
ppolys = [list(p.vertices) for p in part.data.polygons]
nbr = [[] for _ in pverts]
for e in part.data.edges:
    i, j = e.vertices
    nbr[i].append(j)
    nbr[j].append(i)
smooth = [p.copy() for p in pverts]
for _ in range(int(spec.get("smooth", 60))):
    smooth = [(smooth[i] * 0.5 + sum((smooth[j] for j in nbr[i]), Vector()) * (0.5 / max(1, len(nbr[i])))) if nbr[i] else smooth[i] for i in range(len(smooth))]
ok_face = [all(reg_ok[i] or inzone[i] < 1.5 for i in p) for p in ppolys]
ptree = BVHTree.FromPolygons(pverts, [p for p, ok in zip(ppolys, ok_face) if ok])
fpolys = [p for p, ok in zip(ppolys, ok_face) if ok]

if spec.get("mode") == "graft":
    # The close-up's own surface replaces the body's there (the body may have no skin where the close-up
    # has anatomy, e.g. between the thighs): its zone is kept, its rim feathered onto the body's skin,
    # the body's skin under it sunk out of sight; weights come from the body.
    bm = bmesh.new()
    bm.from_mesh(part.data)
    bm.verts.ensure_lookup_table()
    doomed = [fc for fc in bm.faces if any(inzone[v.index] > 1.0 or not facing[v.index] for v in fc.verts)]
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.verts.ensure_lookup_table()
    seen, best = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        comp, stack = [], [v]
        seen.add(v.index)
        while stack:
            x = stack.pop()
            comp.append(x)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in seen:
                    seen.add(y.index)
                    stack.append(y)
        if len(comp) > len(best):
            best = comp
    keep_ = {v.index for v in best}
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep_], context="VERTS")
    bm.verts.ensure_lookup_table()
    ring = {v.index: 0 for v in bm.verts if v.is_boundary}
    front_ = list(ring)
    rings = int(spec.get("feather", 10))
    for step in range(1, rings):
        nxt = []
        for i in front_:
            for e in bm.verts[i].link_edges:
                j = e.other_vert(bm.verts[i]).index
                if j not in ring:
                    ring[j] = step
                    nxt.append(j)
        front_ = nxt
    for v in bm.verts:
        dd = ring.get(v.index, 99)
        if dd < rings:
            hit = btree.find_nearest(v.co)
            if hit[0] is not None:
                v.co = v.co.lerp(hit[0] + hit[1] * 0.0004, 1 - dd / rings)
    bm.to_mesh(part.data)
    bm.free()
    part.data.update()
    print("GRAFT", len(part.data.vertices), "verts")
    gtree = BVHTree.FromPolygons([v.co.copy() for v in part.data.vertices], [list(p.vertices) for p in part.data.polygons])
    invm = mw.inverted()
    sunk = 0
    for v in body.data.vertices:
        p = mw @ v.co
        hit = gtree.find_nearest(p)
        if hit[0] is not None and hit[3] < 0.015 and zone_d(p) < 1.5:
            v.co = invm @ (p - hit[1] * 0.004)
            sunk += 1
    print("SUNK", sunk)
    names = [g.name for g in body.vertex_groups]
    bvw = [{names[e.group]: e.weight for e in v.groups if e.weight > 0} for v in body.data.vertices]
    for g in list(part.vertex_groups):
        part.vertex_groups.remove(g)
    groups = {}
    for v in part.data.vertices:
        loc, _n, idx, _d = btree.find_nearest(v.co)
        corners = bpolys[idx]
        ks = [1 / max((bverts[i] - loc).length, 1e-5) for i in corners]
        tot = sum(ks)
        acc = {}
        for i, kk in zip(corners, ks):
            for g, w in bvw[i].items():
                acc[g] = acc.get(g, 0) + w * kk / tot
        for g, w in sorted(acc.items(), key=lambda x: -x[1])[:4]:
            if g not in groups:
                groups[g] = part.vertex_groups.get(g) or part.vertex_groups.new(name=g)
            groups[g].add([v.index], w, "REPLACE")
    # Join (the graft is in world space; the body has its own transform).
    part.data.transform(mw.inverted())
    part.data.update()
    bpy.ops.object.select_all(action="DESELECT")
    part.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    part = None
    inv3 = mw.inverted().to_3x3()
else:
    # Subdivide the body's skin in the zone so it can hold the detail.
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    sel_edges = set()
    for f in bm.faces:
        c = mw @ f.calc_center_median()
        if zone_d(c) < 1.3:
            for e in f.edges:
                sel_edges.add(e)
    cuts = int(spec.get("cuts", 3))
    bmesh.ops.subdivide_edges(bm, edges=list(sel_edges), cuts=cuts, use_grid_fill=True, use_single_edge=False)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()
    print("SUBDIVIDED", len(sel_edges), "edges; body now", len(body.data.vertices), "verts")

    # Displace: the close-up is a height map seen along the picture's view axis (Y). Each body vertex in
    # the zone looks straight along that axis at the close-up and at its smoothed copy; the difference is
    # the detail, applied along the same axis.
    stree = BVHTree.FromPolygons(smooth, fpolys)
    inv3 = mw.inverted().to_3x3()
    moved = 0
    for v in body.data.vertices:
        p = mw @ v.co
        d = zone_d(p)
        if d >= 1.0:
            continue
        o = p + view * 0.5
        hp = ptree.ray_cast(o, -view)
        hs = stree.ray_cast(o, -view)
        if hp[0] is None or hs[0] is None:
            continue
        # wrap: onto the close-up itself (it was made from this body, so only the anatomy differs);
        # relief: only its detail (close-up minus its smoothed copy).
        detail = (hp[0] - (p if spec.get("mode") == "wrap" else hs[0])).dot(view)
        if spec.get("mode") == "wrap" and abs(detail) > float(spec.get("maxMove", 0.02)):
            continue
        fall = 0.5 * (1 + math.cos(math.pi * min(1.0, d)))
        v.co = v.co + inv3 @ (view * detail * fall * float(spec.get("strength", 1.0)))
        moved += 1
    print("DISPLACED", moved)
body.data.update()

# 3. Sliders as shape keys on the body, around the features.
if not body.data.shape_keys:
    body.shape_key_add(name="Basis", from_mix=False)
body.data.update()
bnorm = [mw.to_3x3() @ v.normal for v in body.data.vertices]
mid_x = zone_w.x


def sphere_key(name, feature, fn):
    f = marks.get(feature)
    if f is None:
        return
    r = spec["features"][feature]["radius"] * k
    c = f.location
    kb = body.shape_key_add(name=name, from_mix=False)
    n = 0
    for v in body.data.vertices:
        p = mw @ v.co
        dd = (p - c).length
        if dd < r:
            w = 0.5 * (1 + math.cos(math.pi * dd / r))
            kb.data[v.index].co = v.co + inv3 @ (fn(v, p, c, r) * w)
            n += 1
    print("KEY", name, n)


sphere_key("Vulva_Full", "vulva", lambda v, p, c, r: bnorm[v.index] * r * 0.35)
sphere_key("Vulva_Spread", "vulva", lambda v, p, c, r: Vector((math.copysign(r * 0.45, p.x - mid_x) * min(1, abs(p.x - mid_x) / (r * 0.25)), 0, 0)))
sphere_key("Labia_Size", "vulva", lambda v, p, c, r: bnorm[v.index] * r * 0.3 * min(1, abs(p.x - mid_x) / (r * 0.15)))
sphere_key("Anus_Size", "anus", lambda v, p, c, r: (p - c) * 0.6)
sphere_key("Anus_Open", "anus", lambda v, p, c, r: -bnorm[v.index] * r * 0.8 * max(0, 1 - (p - c).length / (r * 0.45)) + (p - c) * 0.35)

# 4. Export the body.
if part is not None:
    bpy.data.objects.remove(part, do_unlink=True)
for e in marks.values():
    bpy.data.objects.remove(e, do_unlink=True)
out = os.path.expanduser(opt["out"])
bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
body.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_skins=True, export_morph=True, export_morph_normal=False, export_animations=False, export_yup=True)
print("OUT", out, os.path.getsize(out))
