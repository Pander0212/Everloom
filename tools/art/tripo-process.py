"""
Turns a Tripo Studio model into a wearable Everloom part for one base body (docs/art/TRIPO_LEDGER.md).

    blender --background --factory-startup --python tools/art/tripo-process.py -- \
        --input ~/Everloom-Tripo/hair/hair-short-messy.glb --base apps/web/public/avatar/bases/anime-f.glb \
        --slot hair --name hair-short-messy --out ~/Everloom-Tripo/processed [--ref reference.jpg]

What it does, in order:
  1. cleans the model: welds duplicate vertices, drops dust (tiny loose bits) and any stand-in
     mannequin or head Tripo modelled under the part, decimates to the slot's triangle budget and
     shrinks textures to 1024 px;
  2. fits it to the base: hair sits on the skull (scaled to the head, its crown on the head's top),
     clothing spans the bones its slot covers; then whatever is inside the skin is wrapped just
     outside it;
  3. weights: clothing copies the nearest skin's weights. Hair gets swing chains: each part Tripo
     separated ("Generate in Parts") that hangs away from the scalp becomes a chain of bones
     hair_<n>_<k> under `head` (one mesh with no parts is cut into sectors around the head);
     clothing below the hips that hangs free (skirts, coat tails) gets skirt_<n>_<k> chains. The app
     adopts bones the body doesn't have and swings them (runtime/garments.ts);
  4. body sliders: every body shape key (Breast_Large, Face_Round, ...) is copied onto the part from
     the nearest skin, fading with distance, so the part follows the sliders. Expressions are not
     copied (hair must not blink);
  5. a hair material the app can tint (runtime/skin.ts applyHairColour): texture turned to its
     brightness, the original colour kept as the base colour;
  6. exports <out>/<name>/<base>.glb (the base's skeleton plus the part, no body), a thumbnail
     <base>.png over the body, and <base>.json with what was done.

Nothing here goes into the repository: the inputs and outputs live in ~/Everloom-Tripo.
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

# Triangles a part may have, by slot.
BUDGET = {"hair": 30000, "top": 25000, "outer": 30000, "bottom": 20000, "full": 35000, "feet": 12000, "hands": 8000, "head": 15000, "accessory": 10000, "tail": 12000, "wings": 20000, "ears": 6000}
# Where each slot sits: (lower bone, upper bone, padding as a fraction of the span); hair has its own fit.
SPAN = {
    "top": ("pelvis", "neck_01", 0.08),
    "outer": ("pelvis", "neck_01", 0.12),
    "full": ("foot_l", "neck_01", 0.04),
    "bottom": ("foot_l", "pelvis", 0.06),
}
TEXTURE_MAX = 1024
MAX_CHAINS = 24


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return {a[i][2:]: a[i + 1] for i in range(0, len(a) - 1) if a[i].startswith("--")}


def world_box(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    return Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))), Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))


def apply_all(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def tris(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


# ---------------------------------------------------------------------------------------------
# 1. The base and the part


def load_base(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    body = max((o for o in bpy.data.objects if o.type == "MESH" and o.data.shape_keys), key=lambda o: len(o.data.vertices))
    keep = {arm, body} | {o for o in bpy.data.objects if o.type == "MESH" and o.parent == arm and o.name in ("Eyes", "Iris")}
    for o in [o for o in bpy.data.objects if o not in keep]:
        bpy.data.objects.remove(o, do_unlink=True)
    return arm, body


def load_part(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
        for m in list(o.modifiers):
            o.modifiers.remove(m)
        if o.data.shape_keys:
            o.shape_key_clear()
        for g in list(o.vertex_groups):
            o.vertex_groups.remove(g)
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    for o in meshes:
        apply_all(o)
    return meshes


def clean(meshes, report):
    """Welds, splits single meshes into their loose pieces, drops dust."""
    merged = 0
    for o in meshes:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        n = len(bm.verts)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        merged += n - len(bm.verts)
        bm.to_mesh(o.data)
        bm.free()
    report["welded"] = merged
    # One mesh: its loose pieces are its parts (strands, a bow, a belt), as Tripo's parts would be.
    if len(meshes) == 1 and len(meshes[0].data.vertices) > 0:
        bpy.ops.object.select_all(action="DESELECT")
        meshes[0].select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.separate(type="LOOSE")
        bpy.ops.object.mode_set(mode="OBJECT")
        meshes = [o for o in bpy.context.selected_objects if o.type == "MESH"]
    lo, hi = world_box(meshes)
    size = (hi - lo).length
    dust = [o for o in meshes if len(o.data.polygons) < 24 or (Vector(o.dimensions)).length < size * 0.01]
    # Dust is joined to nothing: removed (specks and floating triangles Tripo leaves).
    for o in dust:
        bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in meshes if o not in dust]
    # Many tiny pieces (a strand texture modelled as loose cards): joined back by proximity later.
    report["parts"] = len(meshes)
    report["dust"] = len(dust)
    return meshes


def decimate(meshes, budget, report):
    report["trianglesIn"] = tris(meshes)
    total = report["trianglesIn"]
    if total > budget:
        ratio = max(0.01, budget / total)
        for o in meshes:
            m = o.modifiers.new("Decimate", "DECIMATE")
            m.ratio = ratio
            m.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=m.name)
    report["triangles"] = tris(meshes)


def strip_fused_head(meshes, report, most=0.4):
    """
    A stand-in head fused to the hair (one piece; Tripo's parts mode keeps it separate): a ray up
    through the middle from below meets a solid chin instead of the hollow under the crown. The smooth
    surface it hits is grown out to the creases where strands start and removed.
    """
    for o in meshes:
        pts = [v.co for v in o.data.vertices]
        lo, hi = box(pts)
        band = [p for p in pts if p.z > hi.z - (hi.z - lo.z) * 0.3]
        blo, bhi = box(band)
        cap_w = bhi.x - blo.x
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        tree = BVHTree.FromBMesh(bm)
        start = Vector(((blo.x + bhi.x) / 2, (blo.y + bhi.y) / 2, lo.z - 1))
        loc, _n, idx, _d = tree.ray_cast(start, Vector((0, 0, 1)))
        if loc is None or hi.z - loc.z < cap_w * 0.6:
            bm.free()
            continue
        total = sum(f.calc_area() for f in bm.faces)
        seen = {idx}
        todo = [bm.faces[idx]]
        area = 0.0
        while todo:
            f = todo.pop()
            area += f.calc_area()
            if area > total * most:
                break
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen and f.normal.angle(g.normal, 0) < math.radians(25):
                        seen.add(g.index)
                        todo.append(g)
        if area > total * most or area < total * 0.02:
            report["fusedHeadSkipped"] = round(area / total, 3)
            bm.free()
            continue
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in seen], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()
        report["fusedHead"] = report.get("fusedHead", 0) + len(seen)


def shrink_textures(report):
    n = 0
    for img in bpy.data.images:
        w, h = img.size[0], img.size[1]
        if max(w, h) > TEXTURE_MAX:
            k = TEXTURE_MAX / max(w, h)
            img.scale(max(1, int(w * k)), max(1, int(h * k)))
            n += 1
    report["texturesShrunk"] = n


# ---------------------------------------------------------------------------------------------
# 2. Fitting


def region(arm, body, bones, threshold=0.5):
    """Skin vertices (world) mostly weighted to these bones."""
    ids = {body.vertex_groups[b].index for b in bones if b in body.vertex_groups}
    mw = body.matrix_world
    return [mw @ v.co for v in body.data.vertices if sum(e.weight for e in v.groups if e.group in ids) >= threshold]


def box(pts):
    return Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))), Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))


def move(meshes, k, offset):
    for o in meshes:
        for v in o.data.vertices:
            v.co = v.co * k + offset
        o.data.update()


def remove_smooth(o, seed, most):
    """Removes the smooth surface around face `seed` (grown to creases, at most `most` of the area)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    total = sum(f.calc_area() for f in bm.faces)
    seen = {seed}
    todo = [bm.faces[seed]]
    area = 0.0
    while todo:
        f = todo.pop()
        area += f.calc_area()
        if area > total * most:
            break
        for e in f.edges:
            for g in e.link_faces:
                if g.index not in seen and f.normal.angle(g.normal, 0) < math.radians(25):
                    seen.add(g.index)
                    todo.append(g)
    if area > total * most:
        # Smooth all over: the whole piece is shell.
        seen = {f.index for f in bm.faces}
    elif area < total * 0.02:
        bm.free()
        return 0
    bmesh.ops.delete(bm, geom=[bm.faces[i] for i in seen], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return len(seen)


def stand_in_hits(tree, owner, centre, r):
    """The pieces of a stand-in head met from `centre` (down to a chin, forward to a face), or None."""
    met = {}
    for name, d in (("down", Vector((0, 0, -1))), ("front", Vector((0, -1, 0))), ("diagonal", Vector((0, -0.7, -0.7)).normalized())):
        loc, _n, idx, dist = tree.ray_cast(centre, d)
        if loc is not None:
            met[name] = (owner[idx], dist)
    if os.environ.get("TRIPO_DEBUG"):
        print("STANDIN", tuple(round(x, 3) for x in centre), round(r, 3), {k: (v[0][0].name, round(v[1], 3)) for k, v in met.items()})
    down, front = met.get("down"), met.get("front")
    if not down or not front:
        return None
    same = down[0][0] is front[0][0]
    close = down[1] < r * 1.3 and front[1] < r * 1.3
    # A stand-in with a neck: the face is close, the way down runs inside the neck to its end.
    necked = not close and front[1] < r * 1.3 and "diagonal" in met and met["diagonal"][1] < r * 1.6 and down[1] < r * 2.5
    if not (same or close or necked):
        return None
    hits = {}
    for (o, face), dist in met.values():
        if same and o is down[0][0] or (close or necked) and dist < r * (1.6 if necked else 1.3):
            hits.setdefault(o, face)
    if necked:
        hits.setdefault(down[0][0], down[0][1])
    return hits


def drop_enclosing(meshes, report):
    """
    Stand-in heads, before fitting (a stand-in fills the hollow the fit measures). From the middle
    of the hollow under the crown, whatever is met close by going down (a chin) or forward (a face)
    is the stand-in's shell; Tripo may cut it into several pieces, and may leave locks (the middle of
    a fringe) on them. Each such piece loses its smooth shell, grown from where the ray met it; a
    piece with nothing of note left goes. The stand-in's points guide the fit.
    """
    verts, polys, owner = [], [], []
    for o in meshes:
        base = len(verts)
        verts += [v.co.copy() for v in o.data.vertices]
        for p in o.data.polygons:
            polys.append([base + i for i in p.vertices])
            owner.append((o, p.index))
    tree = BVHTree.FromPolygons(verts, polys)
    lo, hi = box(verts)
    band = [p for p in verts if p.z > hi.z - (hi.z - lo.z) * 0.25]
    blo, bhi = box(band)

    # The middle of the skull under the crown (the cap is about a head and a bit wide). The crown is
    # the highest slice nearly as wide as the head: a bun or an ahoge on top is not the crown.
    slices = []
    for i in range(24):
        z0 = hi.z - (hi.z - lo.z) * 0.6 * i / 23
        sl = [p for p in verts if abs(p.z - z0) < (hi.z - lo.z) * 0.015]
        if len(sl) > 8:
            slices.append((z0, max(p.x for p in sl) - min(p.x for p in sl), sl))
    w = max(x[1] for x in slices) if slices else bhi.x - blo.x
    crown = next((x for x in slices if x[1] >= w * 0.6), None)
    top = crown[0] if crown else hi.z
    cx = (min(p.x for p in crown[2]) + max(p.x for p in crown[2])) / 2 if crown else (blo.x + bhi.x) / 2
    cy = (min(p.y for p in crown[2]) + max(p.y for p in crown[2])) / 2 if crown else (blo.y + bhi.y) / 2
    # Two guesses at the middle of the skull: under the crown slice, and under the top band (as wide
    # as the cap). The first that finds a stand-in is taken.
    wb = bhi.x - blo.x
    guesses = [(Vector((cx, cy, top - w * 0.45)), w * 0.4), (Vector(((blo.x + bhi.x) / 2, (blo.y + bhi.y) / 2, hi.z - wb * 0.45)), wb * 0.4)]
    report["standInHead"] = []
    hits = None
    for centre, r in guesses:
        hits = stand_in_hits(tree, owner, centre, r)
        if hits:
            break
    if not hits:
        return
    pts = []
    for o, face in hits.items():
        pts += [v.co.copy() for v in o.data.vertices]
        report["fusedHead"] = report.get("fusedHead", 0) + remove_smooth(o, face, 0.98)
        report["standInHead"].append(o.name)
        if len(o.data.polygons) < 60:
            meshes.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
    report["_standIn"] = pts


def hollow(points, tree, lo, hi, covered, steps=14):
    """The largest sphere clear of the surface in `tree` within the box lo..hi that `covered(centre, r)` accepts."""
    best = (None, 0.0)
    span = hi - lo
    for rnd in range(3):
        cands = []
        for i in range(steps):
            for j in range(steps):
                for k in range(steps):
                    cands.append(lo + Vector((span.x * (i + 0.5) / steps, span.y * (j + 0.5) / steps, span.z * (k + 0.5) / steps)))
        for c in cands:
            # Distance to the surface itself (between vertices too), not to the nearest vertex.
            hit = tree.find_nearest(c)
            r = hit[3] if hit[0] is not None else 0.0
            if r > best[1] and covered(c, r):
                best = (c, r)
        if best[0] is None:
            return None, 0.0
        # Again, finer, around the best so far.
        span = span * 0.3
        lo = best[0] - span / 2
        hi = best[0] + span / 2
    return best


def fit_hair(meshes, arm, body, report):
    """
    Sets the hair on the skull, in this order of trust:
      1. a stand-in head Tripo modelled under the hair (its box goes on the base's head);
      2. the hair's inside: rays from the hollow under the crown find the inner crown and the inner
         width at temple height, matched to the head's top and widest point (repeated, as the
         temple height inside the hair depends on the scale);
      3. the hollow alone: the largest sphere clear of the hair under the crown, on the same sphere
         inside the base's skull.
    The hollow also gives the front: the side where the hair stops highest (the fringe). Tripo
    sometimes turns a model sideways; it is turned back to face -Y (only quarter turns: a fringe and
    a short nape are too alike to tell front from back).
    """
    from mathutils import Matrix  # type: ignore

    def gather():
        vs, ps = [], []
        for o in meshes:
            base = len(vs)
            vs += [v.co.copy() for v in o.data.vertices]
            ps += [[base + i for i in p.vertices] for p in o.data.polygons]
        return vs, BVHTree.FromPolygons(vs, ps)

    verts, tree = gather()
    lo, hi = box(verts)
    band = [p for p in verts if p.z > hi.z - (hi.z - lo.z) * 0.25]
    blo, bhi = box(band)
    cap = max(bhi.x - blo.x, bhi.y - blo.y)
    sides = [Vector((1, 0, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0)), Vector((0, -1, 0))]

    def hair_covered(c, r):
        up = tree.ray_cast(c, Vector((0, 0, 1)))
        if up[0] is None or up[3] > r * 1.2:
            return False
        return sum(1 for d in sides if tree.ray_cast(c, d)[0] is not None) >= 3

    centre, r = hollow(verts, tree, Vector((blo.x, blo.y, hi.z - cap * 1.1)), Vector((bhi.x, bhi.y, hi.z)), hair_covered)
    if centre is None:
        centre, r = Vector(((blo.x + bhi.x) / 2, (blo.y + bhi.y) / 2, hi.z - cap * 0.45)), cap * 0.38

    def lowest(d):
        zs = [p.z for p in verts if Vector((p.x - centre.x, p.y - centre.y, 0)).length > r * 0.5 and Vector((p.x - centre.x, p.y - centre.y, 0)).normalized().dot(d) > 0.9]
        return min(zs) if zs else hi.z
    ends = {i: lowest(d) for i, d in enumerate(sides)}
    front = 3
    best = max((0, 1), key=lambda i: ends[i])
    # A stand-in head was found by its face at -Y: that is the front.
    if not report.get("_standIn") and ends[best] - ends[3] > r * 0.6 and ends[best] - ends[1 - best] > r * 0.6:
        front = best
    if front != 3:
        rot = Matrix.Rotation(-math.pi / 2 if front == 0 else math.pi / 2, 3, "Z")
        for o in meshes:
            for v in o.data.vertices:
                v.co = rot @ (v.co - centre) + centre
            o.data.update()
        verts, tree = gather()
        lo, hi = box(verts)
        if "_standIn" in report:
            report["_standIn"] = [rot @ (p - centre) + centre for p in report["_standIn"]]

    # The base head: its top, its widest slice (the temples) and the skull's hollow.
    head = region(arm, body, ["head"])
    hlo, hhi = box(head)
    widest = None
    for i in range(20):
        z0 = hlo.z + (hhi.z - hlo.z) * (0.35 + i * 0.03)
        sl = [p for p in head if abs(p.z - z0) < 0.006]
        if len(sl) < 8:
            continue
        w = (max(p.x for p in sl) - min(p.x for p in sl)) / 2
        if not widest or w > widest[1]:
            widest = (z0, w, (max(p.y for p in sl) + min(p.y for p in sl)) / 2)
    temple_z, half_w, mid_y = widest
    head_cx = (hlo.x + hhi.x) / 2
    drop = hhi.z - temple_z
    btree = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    skull, rb = hollow(head, btree, Vector((hlo.x, hlo.y, (hlo.z + hhi.z) / 2)), hhi, lambda c, _r: all(btree.ray_cast(c, d)[0] is not None for d in sides + [Vector((0, 0, 1))]), steps=10)
    if skull is None:
        skull, rb = Vector((head_cx, mid_y, hhi.z - half_w)), half_w

    sb = report.pop("_standIn", None)
    if sb:
        slo, shi = box(sb)
        k = ((hhi.x - hlo.x) / max(1e-6, shi.x - slo.x) + (hhi.y - hlo.y) / max(1e-6, shi.y - slo.y)) / 2
        move(meshes, k, Vector((head_cx, (hlo.y + hhi.y) / 2, hhi.z)) - Vector(((slo.x + shi.x) / 2, (slo.y + shi.y) / 2, shi.z)) * k)
        report["fit"] = {"scale": round(k, 4), "how": "stand-in head", "front": ["+X", "-X", "+Y", "-Y"][front]}
        return

    k = rb * 1.04 / max(r, 1e-6)
    cx, cy = centre.x, centre.y
    crown = None
    how = "hollow"
    for _ in range(4):
        start = Vector((cx, cy, centre.z))
        top = tree.ray_cast(start, Vector((0, 0, 1)))[0]
        if top is None:
            break
        level = Vector((cx, cy, top.z - drop / k))
        left = tree.ray_cast(level, Vector((-1, 0, 0)))[0]
        right = tree.ray_cast(level, Vector((1, 0, 0)))[0]
        fr = tree.ray_cast(level, Vector((0, -1, 0)))[0]
        bk = tree.ray_cast(level, Vector((0, 1, 0)))[0]
        if left is None or right is None:
            break
        k = half_w * 1.04 / max(1e-6, (right.x - left.x) / 2)
        cx = (left.x + right.x) / 2
        if fr is not None and bk is not None:
            cy = (fr.y + bk.y) / 2
        crown = top
        how = "inner fit"
    if crown is not None:
        move(meshes, k, Vector((head_cx, mid_y, hhi.z + 0.003)) - Vector((cx, cy, crown.z)) * k)
    else:
        move(meshes, k, skull - centre * k)
    report["fit"] = {"scale": round(k, 4), "how": how, "front": ["+X", "-X", "+Y", "-Y"][front]}


def fit_span(meshes, arm, slot, report):
    lo_b, hi_b, pad = SPAN[slot]
    lo = arm.matrix_world @ arm.data.bones[lo_b].head_local
    hi = arm.matrix_world @ arm.data.bones[hi_b].head_local
    if lo_b == "foot_l":
        lo = Vector((0, lo.y, 0))
    span = (hi.z - lo.z) * (1 + 2 * pad)
    bottom = lo.z - (hi.z - lo.z) * pad
    pts = [v.co for o in meshes for v in o.data.vertices]
    plo, phi = box(pts)
    k = span / max(1e-6, phi.z - plo.z)
    centre = arm.matrix_world @ arm.data.bones["spine_01"].head_local
    move(meshes, k, Vector((centre.x - (plo.x + phi.x) / 2 * k, centre.y - (plo.y + phi.y) / 2 * k, bottom - plo.z * k)))
    report["fit"] = {"scale": round(k, 4)}


def bust_pose(arm, on=True):
    """The pose of tools/art/base-bust.py (upper arms lowered 55 degrees), or back to rest."""
    for side, sgn in (("l", -1), ("r", 1)):
        b = arm.pose.bones.get(f"upperarm_{side}")
        if b:
            b.rotation_mode = "XYZ"
            b.rotation_euler = (0, 0, math.radians(55) * sgn if on else 0)
    bpy.context.view_layer.update()


def bust_frame(arm, span=0.62):
    """Where tools/art/base-bust.py framed the bust: its centre and the width of the square picture."""
    head = arm.matrix_world @ arm.data.bones["head"].head_local
    top = arm.matrix_world @ arm.data.bones["head"].tail_local
    return Vector((0, head.y, (head.z + top.z) / 2 - 0.06 + 0.31 - span / 2)), span


def similarity(src, dst, scale=True):
    """Rotation, translation (and scale) taking points src onto dst (Umeyama), as a 4x4 matrix."""
    import numpy as np

    a = np.array(src)
    b = np.array(dst)
    ma, mb = a.mean(0), b.mean(0)
    ac, bc = a - ma, b - mb
    u, s, vt = np.linalg.svd(bc.T @ ac / len(a))
    d = np.eye(3)
    if np.linalg.det(u @ vt) < 0:
        d[2, 2] = -1
    r = u @ d @ vt
    k = np.trace(np.diag(s) @ d) / max(1e-12, (ac ** 2).sum() / len(a)) if scale else 1.0
    t = mb - k * r @ ma
    m = Matrix.Identity(4)
    for i in range(3):
        for j in range(3):
            m[i][j] = k * r[i, j]
        m[i][3] = t[i]
    return m


def picture_top(path):
    """How far down the picture (0 top, 1 bottom) its first non-white row is: the top of the model."""
    img = bpy.data.images.load(path)
    w, h = img.size
    px = img.pixels[:]
    top = 1.0
    for row in range(h - 1, -1, -1):
        base = row * w * 4
        if any(px[base + i * 4] < 0.85 for i in range(0, w, 2)):
            top = (h - 1 - row) / h
            break
    bpy.data.images.remove(img)
    return top


def align_bust(meshes, arm, body, report, picture=None, named=None, span=0.62):
    """
    The model is a hairstyle Tripo made on our own bust (tools/art/base-bust.py): the bust is placed
    back on the base by its shoulders and then registered to the skin (iterative closest points,
    the hair ignored as outliers); every piece lying on the skin is the bust and goes. What remains is
    the hair, where it sits on this base.
    """
    from mathutils import Matrix  # type: ignore  # noqa: F401

    c, w = bust_frame(arm, span)
    # The base as it stood for the picture: arms lowered (the skin below is the posed skin).
    bust_pose(arm, True)
    dg = bpy.context.evaluated_depsgraph_get()
    posed = body.evaluated_get(dg).to_mesh()
    skin = [body.matrix_world @ v.co for v in posed.vertices]
    polys = [list(p.vertices) for p in posed.polygons]
    tree = BVHTree.FromPolygons(skin, polys)
    # Where hair may lie on the skin: the scalp (the head, above the brow or behind the face).
    gi = body.vertex_groups["head"].index if "head" in body.vertex_groups else -1
    headw = [sum(e.weight for e in v.groups if e.group == gi) for v in body.data.vertices]
    hpts = [p for p, hw in zip(skin, headw) if hw > 0.5]
    hlo, hhi = box(hpts)
    brow = hhi.z - (hhi.z - hlo.z) * 0.35
    mid_y = (hlo.y + hhi.y) / 2
    scalp = [hw > 0.5 and (p.z > brow or p.y > mid_y) for p, hw in zip(skin, headw)]
    body.evaluated_get(dg).to_mesh_clear()
    pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    lo, hi = box(pts)
    # The bottom of the model is the bottom edge of the picture, where the bust is cut.
    cut = [p for p in pts if p.z < lo.z + (hi.z - lo.z) * 0.03]
    clo, chi = box(cut)
    z0 = c.z - w / 2
    band = [p for p in skin if abs(p.z - z0) < 0.01 and abs(p.x) < w / 2]
    blo, bhi = box(band)
    k = (bhi.x - blo.x) / max(1e-6, chi.x - clo.x)
    if picture:
        # Tripo sizes the model to fit its box: its height is the picture from the top of the hair to
        # the bottom edge, which the picture tells exactly.
        k = w * (1 - picture_top(picture)) / max(1e-6, hi.z - lo.z)
    m = Matrix.Translation(Vector(((blo.x + bhi.x) / 2, (blo.y + bhi.y) / 2, z0))) @ Matrix.Scale(k, 4) @ Matrix.Translation(-Vector(((clo.x + chi.x) / 2, (clo.y + chi.y) / 2, lo.z)))
    step = max(1, len(pts) // 4000)
    sample = pts[::step]
    used = 0
    for it in range(25):
        moved = [m @ p for p in sample]
        src, dst = [], []
        lim = 0.03 if it < 8 else 0.012
        for p0, p in zip(sample, moved):
            hit = tree.find_nearest(p)
            if hit[0] is not None and hit[3] < lim:
                src.append(tuple(p0))
                dst.append(tuple(hit[0]))
        if len(src) < 50:
            break
        # Scale is known: only rotation and position are solved (letting scale go shrinks the bust).
        m = similarity([tuple(m @ Vector(p)) for p in src], dst, scale=False) @ m
        used = len(src)
    for o in meshes:
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        o.data.transform(m)
        o.data.update()
    if named is not None:
        # A person named the bust's pieces (tools/art/tripo-pieces.py): exactly those go.
        gone = [o for o in meshes if o.name in set(named)]
        # Small bits of the bust not worth naming (a nose, lips): whole pieces lying on bare skin.
        for o in meshes:
            if o in gone:
                continue
            bare, ds = 0, []
            for v in o.data.vertices:
                hit = tree.find_nearest(v.co)
                if hit[0] is None:
                    continue
                ds.append(hit[3])
                if hit[3] < 0.006 and not scalp[polys[hit[2]][0]]:
                    bare += 1
            ds.sort()
            med = ds[len(ds) // 2] if ds else 1
            if os.environ.get("TRIPO_DEBUG") and bare > 0.3 * len(o.data.vertices):
                print("SKINPIECE", o.name, round(bare / len(o.data.vertices), 2), round(med, 4))
            # Mostly over bare skin (face, ears, neck), hugging it: bust, not hair (bangs hang off it).
            if bare > 0.7 * len(o.data.vertices):
                gone.append(o)
        for o in gone:
            meshes.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
        bust_pose(arm, False)
        report["bust"] = {"scale": round(m.to_scale().x, 4), "matched": used, "bustPieces": len(gone), "named": True}
        return meshes
    # Pieces lying on the skin are the bust. Of the rest, what lies on skin where no hair grows (the
    # face, the neck, the shoulders) is bust fused to hair and goes; on the scalp, hair lies close
    # to the skin and stays.
    gone, faces = [], 0
    for o in list(meshes):
        on, bare = [], []
        for v in o.data.vertices:
            hit = tree.find_nearest(v.co)
            near = hit[0] is not None and hit[3] < 0.005
            on.append(near)
            bare.append(near and not scalp[polys[hit[2]][0]])
        share = sum(bare) / max(1, len(bare))
        if share > 0.5 or sum(on) / max(1, len(on)) > 0.9:
            gone.append(o.name)
            meshes.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
            continue
        bm = bmesh.new()
        bm.from_mesh(o.data)
        doomed = [f for f in bm.faces if all(bare[v.index] for v in f.verts)]
        if doomed:
            faces += len(doomed)
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
            bm.to_mesh(o.data)
            o.data.update()
        bm.free()
        if len(o.data.polygons) < 20:
            meshes.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
    bust_pose(arm, False)
    report["bust"] = {"scale": round(m.to_scale().x, 4), "matched": used, "bustPieces": len(gone), "fusedFaces": faces}
    return meshes


def head_to_head(meshes, arm_a, body_a, arm_b, body_b, report):
    """Carries hair placed on one base's head over to another base's head (same scale idea)."""
    a = region(arm_a, body_a, ["head"])
    b = region(arm_b, body_b, ["head"])
    alo, ahi = box(a)
    blo, bhi = box(b)
    k = ((bhi.x - blo.x) / (ahi.x - alo.x) + (bhi.y - blo.y) / (ahi.y - alo.y) + (bhi.z - blo.z) / (ahi.z - alo.z)) / 3
    ca = Vector(((alo.x + ahi.x) / 2, (alo.y + ahi.y) / 2, ahi.z))
    cb = Vector(((blo.x + bhi.x) / 2, (blo.y + bhi.y) / 2, bhi.z))
    move(meshes, k, cb - ca * k)
    report["headToHead"] = round(k, 4)


def body_target(body):
    """A copy of the body in its rest shape (no armature), for wrapping and nearest-surface lookups."""
    c = body.copy()
    c.data = body.data.copy()
    bpy.context.collection.objects.link(c)
    for m in list(c.modifiers):
        c.modifiers.remove(m)
    if c.data.shape_keys:
        c.shape_key_clear()
    c.name = "FitTarget"
    return c


def inside_share(o, tree):
    """How much of a piece is inside the skin (a stand-in mannequin or head): rays out along +X."""
    vs = o.data.vertices
    step = max(1, len(vs) // 200)
    n = inside = 0
    for i in range(0, len(vs), step):
        p = o.matrix_world @ vs[i].co
        hits = 0
        q = p.copy()
        for _ in range(16):
            loc, _nrm, _i, _d = tree.ray_cast(q, Vector((1, 0, 0)))
            if loc is None:
                break
            hits += 1
            q = loc + Vector((1e-4, 0, 0))
        n += 1
        inside += hits % 2
    return inside / max(1, n)


def drop_standins(meshes, tree, report):
    gone = []
    for o in list(meshes):
        if inside_share(o, tree) > 0.85:
            gone.append(o.name)
            meshes.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
    report["standIns"] = gone
    return meshes


def drop_face_shell(meshes, tree, arm, body, report, pieces=None, anywhere=False):
    """
    What is left of a stand-in face after the fit (Tripo may cut a stand-in into more pieces than
    the rays meet, or fuse bits of it into fringe pieces): every triangle lying on the skin of the
    face (front of the head, below the brow), then pieces with next to nothing left. Bangs hang
    clear of the skin; a shell matched to the head sits on it.
    """
    head = region(arm, body, ["head"])
    hlo, hhi = box(head)
    brow = hhi.z - (hhi.z - hlo.z) * 0.35
    mid_y = (hlo.y + hhi.y) / 2
    removed = 0
    for o in list(pieces if pieces is not None else meshes):
        mw = o.matrix_world
        on = []
        for v in o.data.vertices:
            p = mw @ v.co
            # A known stand-in piece: whatever lies on the head's skin is shell, not only the face.
            near = hlo.z < p.z if anywhere else (hlo.z < p.z < brow and p.y < mid_y)
            hit = tree.find_nearest(p) if near else (None,)
            on.append(hit[0] is not None and hit[3] < (0.008 if anywhere else 0.004))
        bm = bmesh.new()
        bm.from_mesh(o.data)
        doomed = [f for f in bm.faces if all(on[v.index] for v in f.verts)]
        if doomed:
            removed += len(doomed)
            bmesh.ops.delete(bm, geom=doomed, context="FACES")
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
            bm.to_mesh(o.data)
            o.data.update()
        bm.free()
        if len(o.data.polygons) < 30:
            meshes.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
    report["faceShell"] = report.get("faceShell", 0) + removed
    return meshes


def wrap(meshes, target, offset, smooth=False):
    """
    Whatever is inside the skin goes just outside it. With `smooth` (hair), the push spreads over
    each lock, so a lock hanging over the chest moves forward as one instead of its tips being
    pressed flat onto the skin; a second wrap then fixes what is still inside.
    """
    for o in meshes:
        before = [v.co.copy() for v in o.data.vertices] if smooth else None
        m = o.modifiers.new("Wrap", "SHRINKWRAP")
        m.target = target
        m.wrap_method = "NEAREST_SURFACEPOINT"
        m.wrap_mode = "OUTSIDE"
        m.offset = offset
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=m.name)
        if not smooth:
            continue
        push = [v.co - b for v, b in zip(o.data.vertices, before)]
        if max((p.length for p in push), default=0) < 1e-5:
            continue
        nbr = [[] for _ in push]
        for e in o.data.edges:
            a, b = e.vertices
            nbr[a].append(b)
            nbr[b].append(a)
        # Spread the biggest pushes to their neighbours, then soften.
        for _ in range(12):
            push = [max([push[i]] + [push[j] for j in nbr[i]], key=lambda x: x.length) for i in range(len(push))]
        for _ in range(6):
            push = [(push[i] + sum((push[j] for j in nbr[i]), Vector())) / (1 + len(nbr[i])) for i in range(len(push))]
        for v, b, p in zip(o.data.vertices, before, push):
            v.co = b + p
        o.data.update()
        m = o.modifiers.new("Wrap", "SHRINKWRAP")
        m.target = target
        m.wrap_method = "NEAREST_SURFACEPOINT"
        m.wrap_mode = "OUTSIDE"
        m.offset = offset
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=m.name)


# ---------------------------------------------------------------------------------------------
# 3. Weights and swing chains


class Surface:
    """The skin: nearest point, its weights and its shape-key offsets."""

    def __init__(self, target, body):
        mw = target.matrix_world
        self.verts = [mw @ v.co for v in target.data.vertices]
        self.polys = [list(p.vertices) for p in target.data.polygons]
        self.tree = BVHTree.FromPolygons(self.verts, self.polys)
        names = [g.name for g in target.vertex_groups]
        self.weights = [{names[e.group]: e.weight for e in v.groups if e.weight > 0} for v in target.data.vertices]
        self.keys = {}
        kb = body.data.shape_keys.key_blocks if body.data.shape_keys else []
        basis = [k.co.copy() for k in kb[0].data] if len(kb) else []
        rot = body.matrix_world.to_3x3()
        for k in list(kb)[1:]:
            # Body sliders only (capitalised); expressions like eyeBlinkLeft or jawOpen are not.
            if not k.name[:1].isupper():
                continue
            d = [rot @ (k.data[i].co - basis[i]) for i in range(len(basis))]
            if max(x.length for x in d) > 1e-5:
                self.keys[k.name] = d

    def nearest(self, co):
        loc, _n, idx, dist = self.tree.find_nearest(co)
        if idx is None:
            return None, [], 1e9
        corners = self.polys[idx]
        ks = [1.0 / max((self.verts[i] - loc).length, 1e-5) for i in corners]
        t = sum(ks)
        return loc, [(i, k / t) for i, k in zip(corners, ks)], dist


def skin_weights(o, surface):
    groups = {}
    for v in o.data.vertices:
        _loc, corners, _d = surface.nearest(o.matrix_world @ v.co)
        acc = {}
        for i, k in corners:
            for g, w in surface.weights[i].items():
                acc[g] = acc.get(g, 0) + w * k
        for g, w in sorted(acc.items(), key=lambda x: -x[1])[:4]:
            if g not in groups:
                groups[g] = o.vertex_groups.get(g) or o.vertex_groups.new(name=g)
            groups[g].add([v.index], w, "REPLACE")


def add_chain(arm, parent, prefix, pts):
    """Bones from point to point under `parent`; returns their names."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    inv = arm.matrix_world.inverted()
    names = []
    prev = eb[parent]
    for k in range(len(pts) - 1):
        b = eb.new(f"{prefix}_{k}")
        b.head = inv @ pts[k]
        b.tail = inv @ pts[k + 1]
        if (b.tail - b.head).length < 1e-4:
            b.tail = b.head + Vector((0, 0, -0.01))
        b.parent = prev
        b.use_connect = False
        b.use_deform = True
        names.append(b.name)
        prev = b
    bpy.ops.object.mode_set(mode="OBJECT")
    return names


def strand(o, root_tree, skull):
    """
    A piece's root (the end nearest the middle of the skull: a lock lying on the back starts at the
    head, not where it touches the back), tip (farthest from the root), and how far it gets from the
    skin.
    """
    mw = o.matrix_world
    pts = [mw @ v.co for v in o.data.vertices]
    ds = [root_tree.find_nearest(p)[3] or 0 for p in pts]
    near = sorted(range(len(pts)), key=lambda i: (pts[i] - skull).length)[: max(3, len(pts) // 50)]
    root = sum((pts[i] for i in near), Vector()) / len(near)
    tip_i = max(range(len(pts)), key=lambda i: (pts[i] - root).length)
    return pts, root, pts[tip_i], max(ds)


def chain_weights(o, pts, root, tip, bones, anchor_bone, pin=0.12, stick=None):
    """
    Each vertex to the bone along the strand it lies on; the root end, and whatever lies on the scalp
    (`stick`: 0..1 per vertex), pinned to the anchor bone.
    """
    axis = tip - root
    length = max(axis.length, 1e-6)
    axis = axis / length
    n = len(bones)
    gs = [o.vertex_groups.get(b) or o.vertex_groups.new(name=b) for b in bones]
    ga = o.vertex_groups.get(anchor_bone) or o.vertex_groups.new(name=anchor_bone)
    for v, p, st in zip(o.data.vertices, pts, stick or [0.0] * len(pts)):
        t = min(1.0, max(0.0, (p - root).dot(axis) / length))
        s = t * n
        i = min(int(s), n - 1)
        f = s - i
        w = {i: 1.0}
        # Near the next joint, share with the next bone so the bend is smooth.
        if f > 0.6 and i + 1 < n:
            b = (f - 0.6) / 0.4 * 0.5
            w = {i: 1 - b, i + 1: b}
        a = max(max(0.0, 1 - t / pin) if pin > 0 else 0.0, st)
        for j, x in w.items():
            gs[j].add([v.index], x * (1 - a), "REPLACE")
        if a > 0:
            ga.add([v.index], a, "REPLACE")


def chain_points(pts, root, tip, n):
    """Points along the strand: the middle of each slice, so bones follow a curl."""
    axis = tip - root
    length = max(axis.length, 1e-6)
    out = [root]
    for k in range(1, n):
        t0, t1 = (k - 0.25) / n, (k + 0.25) / n
        sl = [p for p in pts if t0 <= (p - root).dot(axis) / (length * length) <= t1]
        out.append(sum(sl, Vector()) / len(sl) if sl else root + axis * (k / n))
    out.append(tip)
    return out


def rig_hair(meshes, arm, target, report):
    """Swing chains for the hair: one per hanging part, the rest rigid on the head."""
    head_tree = BVHTree.FromObject(target, bpy.context.evaluated_depsgraph_get())
    neck_z = (arm.matrix_world @ arm.data.bones["neck_01"].tail_local).z
    hb = arm.data.bones["head"]
    skull = arm.matrix_world @ ((hb.head_local + hb.tail_local) / 2)

    def sticks(pts):
        # On the scalp (within 2 cm, fading out by 4 cm, above the neck): stays with the head.
        out = []
        for p in pts:
            d = head_tree.find_nearest(p)[3] if p.z > neck_z else None
            out.append(0.0 if d is None else min(1.0, max(0.0, (0.04 - d) / 0.02)))
        return out

    info = []
    for o in meshes:
        pts, root, tip, far = strand(o, head_tree, skull)
        hang = (tip - root).length
        info.append((o, pts, root, tip, far, hang))
    # Swing: the piece reaches away from the scalp (bangs, locks, tails); a cap stays on the head.
    # Only what hangs down swings: the tip well below the root. Caps and crown pieces stay put.
    swing = [x for x in info if x[4] > 0.035 and x[5] > 0.05 and x[2].z - x[3].z > max(0.04, x[5] * 0.4)]
    swing.sort(key=lambda x: -x[5])
    chains, rigid = swing[:MAX_CHAINS], [x for x in info if x not in swing[:MAX_CHAINS]]
    names = []
    for n, (o, pts, root, tip, _far, hang) in enumerate(chains):
        count = max(2, min(6, round(hang / 0.04)))
        bones = add_chain(arm, "head", f"hair_{n}", chain_points(pts, root, tip, count))
        chain_weights(o, pts, root, tip, bones, "head", stick=sticks(pts))
        names.append(bones)
    # Pieces with no chain of their own: rigid on the head, or (if they hang) the nearest chain's weights.
    if chains:
        kd = KDTree(sum(len(c[1]) for c in chains))
        owner = []
        for c in chains:
            for i, p in enumerate(c[1]):
                kd.insert(p, len(owner))
                owner.append((c[0], i))
        kd.balance()
    for o, pts, _root, _tip, far, hang in rigid:
        g = o.vertex_groups.get("head") or o.vertex_groups.new(name="head")
        if not chains or far < 0.035:
            g.add([v.index for v in o.data.vertices], 1.0, "REPLACE")
            continue
        for v, p, st in zip(o.data.vertices, pts, sticks(pts)):
            _co, j, _d = kd.find(p)
            src, i = owner[j]
            acc = {}
            for ge in src.data.vertices[i].groups:
                name = src.vertex_groups[ge.group].name
                acc[name] = acc.get(name, 0) + ge.weight * (1 - st)
            acc["head"] = acc.get("head", 0) + st
            for name, wt in acc.items():
                if wt > 0:
                    (o.vertex_groups.get(name) or o.vertex_groups.new(name=name)).add([v.index], wt, "REPLACE")
    report["chains"] = len(names)
    report["chainBones"] = sum(len(b) for b in names)
    report["rigidPieces"] = sum(1 for x in rigid if not chains or x[4] < 0.035)
    return names


def rig_sectors(meshes, arm, target, report):
    """One piece of hair with no parts: sectors around the head, each with a chain down its length."""
    o = meshes[0]
    hl = arm.matrix_world @ arm.data.bones["head"].head_local
    ht = arm.matrix_world @ arm.data.bones["head"].tail_local
    centre = (hl + ht) / 2
    mw = o.matrix_world
    pts = [mw @ v.co for v in o.data.vertices]
    low = min(p.z for p in pts)
    hang = centre.z - low
    if hang < 0.06:
        g = o.vertex_groups.new(name="head")
        g.add([v.index for v in o.data.vertices], 1.0, "REPLACE")
        report["chains"] = 0
        return []
    sectors = 8
    count = max(2, min(5, round(hang / 0.05)))
    chains = []
    for s in range(sectors):
        a = 2 * math.pi * s / sectors
        d = Vector((math.sin(a), -math.cos(a), 0))
        # The hair's outer edge in this direction, at the head's middle, down to the lowest point there.
        near = [p for p in pts if (Vector((p.x - centre.x, p.y - centre.y, 0)).normalized().dot(d) > math.cos(math.pi / sectors))]
        if not near:
            near = pts
        rad = sum(Vector((p.x - centre.x, p.y - centre.y, 0)).length for p in near) / len(near)
        bottom = min(p.z for p in near)
        top = centre + d * rad * 0.8
        tip = Vector((centre.x, centre.y, bottom)) + d * rad
        chains.append((a, add_chain(arm, "head", f"hair_{s}", [top.lerp(tip, k / count) for k in range(count + 1)]), top, tip))
    groups = {}
    for v, p in zip(o.data.vertices, pts):
        ang = math.atan2(p.x - centre.x, -(p.y - centre.y)) % (2 * math.pi)
        f = ang / (2 * math.pi) * sectors
        s0 = int(f) % sectors
        s1 = (s0 + 1) % sectors
        b = f - int(f)
        t = min(1.0, max(0.0, (centre.z - p.z) / max(hang, 1e-6)))
        pin = max(0.0, 1 - t / 0.15)
        acc = {"head": pin}
        for s, share in ((s0, 1 - b), (s1, b)):
            bones = chains[s][1]
            i = min(int(t * len(bones)), len(bones) - 1)
            acc[bones[i]] = acc.get(bones[i], 0) + share * (1 - pin)
        for g, w in acc.items():
            if w <= 0:
                continue
            if g not in groups:
                groups[g] = o.vertex_groups.new(name=g)
            groups[g].add([v.index], w, "REPLACE")
    report["chains"] = sectors
    report["chainBones"] = sectors * count
    return [c[1] for c in chains]


def rig_skirt(o, arm, surface, report):
    """Clothing that hangs free below the hips (a skirt, a coat's tails): chains around the hips."""
    pelvis = arm.matrix_world @ arm.data.bones["pelvis"].head_local
    mw = o.matrix_world
    free = []
    for v in o.data.vertices:
        p = mw @ v.co
        _loc, _c, d = surface.nearest(p)
        if p.z < pelvis.z - 0.05 and d > 0.03:
            free.append(v.index)
    if len(free) < len(o.data.vertices) * 0.1:
        report["skirtChains"] = 0
        return
    pts = {i: mw @ o.data.vertices[i].co for i in free}
    bottom = min(p.z for p in pts.values())
    hang = pelvis.z - bottom
    sectors = 8
    count = max(2, min(5, round(hang / 0.08)))
    rad = sum(Vector((p.x - pelvis.x, p.y - pelvis.y, 0)).length for p in pts.values()) / len(pts)
    chains = []
    for s in range(sectors):
        a = 2 * math.pi * s / sectors
        d = Vector((math.sin(a), -math.cos(a), 0))
        top = Vector((pelvis.x, pelvis.y, pelvis.z - 0.05)) + d * rad * 0.7
        tip = Vector((pelvis.x, pelvis.y, bottom)) + d * rad * 1.1
        chains.append(add_chain(arm, "pelvis", f"skirt_{s}", [top.lerp(tip, k / count) for k in range(count + 1)]))
    groups = {}
    for i, p in pts.items():
        ang = math.atan2(p.x - pelvis.x, -(p.y - pelvis.y)) % (2 * math.pi)
        f = ang / (2 * math.pi) * sectors
        s0 = int(f) % sectors
        b = f - int(f)
        t = min(1.0, max(0.0, (pelvis.z - 0.05 - p.z) / max(hang, 1e-6)))
        for g in list(o.data.vertices[i].groups):
            o.vertex_groups[g.group].remove([i])
        for s, share in ((s0, 1 - b), ((s0 + 1) % sectors, b)):
            bones = chains[s]
            name = bones[min(int(t * len(bones)), len(bones) - 1)]
            if name not in groups:
                groups[name] = o.vertex_groups.new(name=name)
            groups[name].add([i], share, "ADD")
    report["skirtChains"] = sectors


# ---------------------------------------------------------------------------------------------
# 4. Body sliders


def transfer_keys(o, surface, report, reach=0.10):
    if not surface.keys:
        return
    mw = o.matrix_world
    inv = mw.inverted().to_3x3()
    near = [surface.nearest(mw @ v.co) for v in o.data.vertices]
    o.shape_key_add(name="Basis", from_mix=False)
    made = 0
    for name, d in surface.keys.items():
        off = []
        biggest = 0.0
        for _loc, corners, dist in near:
            if not corners:
                off.append(Vector())
                continue
            fade = min(1.0, max(0.0, 1 - (dist - 0.02) / reach))
            x = sum((d[i] * k for i, k in corners), Vector()) * fade
            # Under half a millimetre is nothing to see: left out, so the morph is stored sparse.
            if x.length < 5e-4:
                x = Vector()
            biggest = max(biggest, x.length)
            off.append(inv @ x)
        if biggest < 1e-4:
            continue
        kb = o.shape_key_add(name=name, from_mix=False)
        for v, x in zip(o.data.vertices, off):
            kb.data[v.index].co = v.co + x
        made += 1
    report["morphs"] = made


# ---------------------------------------------------------------------------------------------
# 5. Material


def reference_colour(path):
    """The part's colour in its reference picture: the pixels that differ from the background."""
    try:
        img = bpy.data.images.load(path)
    except Exception:
        return None
    w, h = img.size
    px = list(img.pixels)
    bg = px[0:3]
    acc = [0.0, 0.0, 0.0]
    n = 0
    step = max(1, (w * h) // 40000)
    for i in range(0, w * h, step):
        r, g, b = px[i * 4: i * 4 + 3]
        if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 0.18:
            acc[0] += r
            acc[1] += g
            acc[2] += b
            n += 1
    bpy.data.images.remove(img)
    return [c / n for c in acc] if n else None


def hair_material(meshes, colour, report):
    """One material the app tints: the texture's brightness (strand detail) times the hair colour."""
    tex = None
    for o in meshes:
        for m in o.data.materials:
            if m and m.node_tree:
                tex = tex or next((n.image for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and n.image.size[0] > 0), None)
    base = colour
    if tex is not None:
        w, h = tex.size
        px = list(tex.pixels)
        lum = []
        acc = [0.0, 0.0, 0.0]
        for i in range(w * h):
            r, g, b = px[i * 4: i * 4 + 3]
            lum.append(0.2126 * r + 0.7152 * g + 0.0722 * b)
            acc[0] += r
            acc[1] += g
            acc[2] += b
        mean = [c / (w * h) for c in acc]
        base = base or mean
        med = sorted(lum)[len(lum) // 2] or 1.0
        k = 0.92 / med
        out = []
        for x in lum:
            y = min(1.0, x * k)
            out += [y, y, y, 1.0]
        tex.pixels = out
        tex.pack()
    base = base or [0.75, 0.75, 0.78]
    mat = bpy.data.materials.new("Hair")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*base[:3], 1.0)
    bsdf.inputs["Roughness"].default_value = 0.6
    mat.diffuse_color = (*base[:3], 1.0)
    if tex is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = tex
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs[6].default_value = (*base[:3], 1.0)
        nt.links.new(t.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(mat)
    report["colour"] = "#%02x%02x%02x" % tuple(int(max(0, min(1, c)) ** (1 / 2.2) * 255) for c in base[:3])
    report["textured"] = tex is not None


# ---------------------------------------------------------------------------------------------
# 6. Export, thumbnail


def render(path, focus):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "OBJECT"
    scene.display.shading.show_cavity = True
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.film_transparent = True
    # The body in a skin tone, so the part stands out (the thumbnail only; the body is not exported).
    for o in bpy.data.objects:
        if o.type == "MESH":
            o.color = (0.86, 0.7, 0.62, 1.0) if o not in focus else tuple(o.data.materials[0].diffuse_color) if o.data.materials and o.data.materials[0] else (0.8, 0.8, 0.8, 1.0)
    lo, hi = world_box(focus)
    c = (lo + hi) / 2
    r = max((hi - lo).length * 0.75, 0.25)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    scene.collection.objects.link(cam)
    cam.data.lens = 50
    d = Vector((0.55, -1.0, 0.25)).normalized()
    cam.location = c + d * r * 2.2
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


def export(path, arm, part):
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    part.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_skins=True, export_morph=True, export_animations=False, export_apply=False, export_yup=True, export_try_sparse_sk=True, export_morph_normal=False)


def main():
    a = args()
    for k in ("input", "base", "slot", "name", "out"):
        if k not in a:
            raise SystemExit(f"missing --{k}")
    slot = a["slot"]
    base_name = os.path.splitext(os.path.basename(a["base"]))[0]
    out_dir = os.path.join(os.path.expanduser(a["out"]), a["name"])
    os.makedirs(out_dir, exist_ok=True)
    report = {"name": a["name"], "slot": slot, "base": base_name, "source": os.path.basename(a["input"])}

    arm, body = load_base(a["base"])
    meshes = load_part(os.path.expanduser(a["input"]))
    meshes = clean(meshes, report)
    sidecar = os.path.splitext(os.path.expanduser(a["input"]))[0] + ".json"
    seen = json.load(open(sidecar)) if os.path.exists(sidecar) else None
    placed = False
    if seen and seen.get("bust"):
        # Made on our own bust: registered to it (before decimating, so the bust doesn't use the budget).
        report["seen"] = seen
        pic = os.path.join(os.path.dirname(sidecar), "..", seen["picture"]) if seen.get("picture") else None
        if seen["bust"] == base_name:
            meshes = align_bust(meshes, arm, body, report, pic, seen.get("standIn"), float(seen.get("span", 0.62)))
        else:
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=os.path.join(os.path.dirname(os.path.abspath(a["base"])), seen["bust"] + ".glb"))
            extra = [o for o in bpy.data.objects if o not in before]
            arm_b = next(o for o in extra if o.type == "ARMATURE")
            body_b = max((o for o in extra if o.type == "MESH" and o.data.shape_keys), key=lambda o: len(o.data.vertices))
            meshes = align_bust(meshes, arm_b, body_b, report, pic, seen.get("standIn"), float(seen.get("span", 0.62)))
            head_to_head(meshes, arm_b, body_b, arm, body, report)
            for o in extra:
                bpy.data.objects.remove(o, do_unlink=True)
        placed = True
    decimate(meshes, int(a.get("budget", BUDGET.get(slot, 20000))), report)
    shrink_textures(report)
    if os.environ.get("TRIPO_DEBUG"):
        print("STAGE decimated", len(meshes), sum(len(o.data.polygons) for o in meshes))
    # What a person saw in the model (tools/art/tripo-pieces.py): which pieces are Tripo's stand-in
    # head. "standIn" pieces go after guiding the fit; "standInStrip" pieces also carry hair (a lock
    # fused to a face), so only what lies on the skin after the fit goes.
    strip_pieces = []
    if placed:
        pass
    elif seen is not None:
        report["seen"] = seen
        whole = [o for o in meshes if o.name in set(seen.get("standIn", []))]
        strip_pieces = [o for o in meshes if o.name in set(seen.get("standInStrip", []))]
        guide = whole + strip_pieces
        report["standInHead"] = [o.name for o in guide]
        if guide:
            report["_standIn"] = [o.matrix_world @ v.co for o in guide for v in o.data.vertices]
        for o in whole:
            meshes.remove(o)
            bpy.data.objects.remove(o, do_unlink=True)
        # One piece with the stand-in fused in (no parts): its smooth shell is cut out.
        if seen.get("fused"):
            strip_fused_head(meshes, report)
    elif slot in ("hair", "head"):
        report["warning"] = "no sidecar: the stand-in head was guessed"
        if len(meshes) >= 2:
            drop_enclosing(meshes, report)
        if len(meshes) <= 2:
            strip_fused_head(meshes, report)
    if os.environ.get("TRIPO_DEBUG"):
        print("STAGE standins", len(meshes), sum(len(o.data.polygons) for o in meshes))

    if placed:
        report["fit"] = {"how": "own bust"}
    elif slot == "hair":
        fit_hair(meshes, arm, body, report)
    elif slot in SPAN:
        fit_span(meshes, arm, slot, report)
    target = body_target(body)
    tree = BVHTree.FromObject(target, bpy.context.evaluated_depsgraph_get())
    # Hair: stand-ins went before the fit; a lock dipping into the forehead is wrapped out, not dropped.
    if slot != "hair":
        meshes = drop_standins(meshes, tree, report)
    elif report.get("standInHead"):
        meshes = drop_face_shell(meshes, tree, arm, body, report)
        live = [o for o in strip_pieces if o in meshes]
        if live:
            meshes = drop_face_shell(meshes, tree, arm, body, report, pieces=live, anywhere=True)
    if not meshes:
        raise SystemExit("nothing left after dropping stand-ins")
    if os.environ.get("TRIPO_DEBUG"):
        print("STAGE faceshell", len(meshes), sum(len(o.data.polygons) for o in meshes))
    wrap(meshes, target, 0.004 if slot == "hair" else 0.006, smooth=slot == "hair")
    if os.environ.get("TRIPO_DEBUG"):
        print("STAGE wrapped", len(meshes), sum(len(o.data.polygons) for o in meshes))
    surface = Surface(target, body)

    if slot == "hair":
        hair_material(meshes, reference_colour(a["ref"]) if a.get("ref") else None, report)
        if len(meshes) >= 3:
            rig_hair(meshes, arm, target, report)
        else:
            if len(meshes) > 1:
                bpy.ops.object.select_all(action="DESELECT")
                for o in meshes:
                    o.select_set(True)
                bpy.context.view_layer.objects.active = meshes[0]
                bpy.ops.object.join()
                meshes = [meshes[0]]
            rig_sectors(meshes, arm, target, report)
    else:
        for o in meshes:
            skin_weights(o, surface)

    # One mesh: fewer draw calls; vertex groups carry over.
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    part = bpy.context.view_layer.objects.active
    part.name = {"hair": "Hair"}.get(slot, a["name"].replace("-", "_").title())
    if slot in ("bottom", "full", "outer"):
        rig_skirt(part, arm, surface, report)
    # At most four bones a vertex, weights adding to one.
    bpy.context.view_layer.objects.active = part
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    transfer_keys(part, surface, report)
    part.parent = arm
    m = part.modifiers.new("Armature", "ARMATURE")
    m.object = arm
    report["triangles"] = tris([part])
    report["bones"] = len(arm.data.bones)

    bpy.data.objects.remove(target, do_unlink=True)
    render(os.path.join(out_dir, f"{base_name}.png"), [part])
    for o in [o for o in bpy.data.objects if o.type == "MESH" and o is not part]:
        bpy.data.objects.remove(o, do_unlink=True)
    glb = os.path.join(out_dir, f"{base_name}.glb")
    export(glb, arm, part)
    report["file"] = glb
    report["bytes"] = os.path.getsize(glb)
    with open(os.path.join(out_dir, f"{base_name}.json"), "w") as f:
        json.dump(report, f, indent=1)
    print("TRIPO_PROCESS " + json.dumps(report))


if __name__ == "__main__":
    code = 0
    try:
        main()
    except BaseException:
        import traceback
        traceback.print_exc()
        code = 1
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(code)
