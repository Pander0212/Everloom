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
from mathutils import Vector  # type: ignore
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


def strip_fused_head(meshes, report):
    """
    A stand-in head fused to the hair (one piece; Tripo's parts mode keeps it separate): a ray up
    through the middle from below meets a solid chin instead of the hollow under the crown. The smooth
    surface it hits is grown out to the creases where strands start and removed.
    """
    report["fusedHead"] = 0
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
            if area > total * 0.4:
                break
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in seen and f.normal.angle(g.normal, 0) < math.radians(25):
                        seen.add(g.index)
                        todo.append(g)
        if area > total * 0.4 or area < total * 0.02:
            report["fusedHeadSkipped"] = round(area / total, 3)
            bm.free()
            continue
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in seen], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bm.to_mesh(o.data)
        bm.free()
        o.data.update()
        report["fusedHead"] += len(seen)


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


def fit_hair(meshes, arm, body, report):
    """
    Sets the hair on the skull by its inside: rays from within the hair find the inner crown and the
    inner width at temple height, which are matched to the head's top and widest point (repeated, as
    the temple height inside the hair depends on the scale). The outer width is only the first guess:
    a rounded crown or wide flares mislead it.
    """
    head = region(arm, body, ["head"])
    hlo, hhi = box(head)
    # The skull's widest slice (the temples), its half width and centre.
    best = None
    for k in range(20):
        z0 = hlo.z + (hhi.z - hlo.z) * (0.35 + k * 0.03)
        sl = [p for p in head if abs(p.z - z0) < 0.006]
        if len(sl) < 8:
            continue
        w = (max(p.x for p in sl) - min(p.x for p in sl)) / 2
        if not best or w > best[1]:
            best = (z0, w, sum(p.y for p in sl) / len(sl), (max(p.y for p in sl) + min(p.y for p in sl)) / 2)
    temple_z, half_w, _mean_y, mid_y = best
    head_cx = (hlo.x + hhi.x) / 2
    drop = hhi.z - temple_z

    verts, polys = [], []
    for o in meshes:
        base = len(verts)
        verts += [v.co.copy() for v in o.data.vertices]
        polys += [[base + i for i in p.vertices] for p in o.data.polygons]
    tree = BVHTree.FromPolygons(verts, polys)
    lo, hi = box(verts)
    band = [p for p in verts if p.z > hi.z - (hi.z - lo.z) * 0.3]
    blo, bhi = box(band)
    k = half_w * 2 * 1.28 / max(1e-6, bhi.x - blo.x)
    cx, cy = (blo.x + bhi.x) / 2, (blo.y + bhi.y) / 2
    crown = Vector((cx, cy, hi.z - 0.012 / k))
    how = "outer width"

    def ray(o, d):
        loc, _n, _i, dist = tree.ray_cast(o, d)
        return loc, dist

    for _ in range(4):
        # The inner crown: straight up from well inside.
        start = Vector((cx, cy, hi.z - (drop * 1.2) / k))
        top, _d = ray(start, Vector((0, 0, 1)))
        if top is None:
            break
        level = Vector((cx, cy, top.z - drop / k))
        left, dl = ray(level, Vector((-1, 0, 0)))
        right, dr = ray(level, Vector((1, 0, 0)))
        front, df = ray(level, Vector((0, -1, 0)))
        back, db = ray(level, Vector((0, 1, 0)))
        if left is None or right is None:
            crown = top
            break
        inner = (right.x - left.x) / 2
        k = half_w * 1.04 / max(1e-6, inner)
        cx = (left.x + right.x) / 2
        if front is not None and back is not None:
            cy = (front.y + back.y) / 2
        crown = top
        how = "inner fit"
    target = Vector((head_cx, mid_y, hhi.z + 0.003))
    move(meshes, k, target - Vector((cx, cy, crown.z)) * k)
    report["fit"] = {"scale": round(k, 4), "headWidth": round(half_w * 2, 4), "how": how}


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


def wrap(meshes, target, offset):
    for o in meshes:
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


def strand(o, root_tree, anchor):
    """A piece's root (nearest the anchor surface), tip (farthest from the root) and its run."""
    mw = o.matrix_world
    pts = [mw @ v.co for v in o.data.vertices]
    ds = [root_tree.find_nearest(p)[3] or 0 for p in pts]
    near = sorted(range(len(pts)), key=lambda i: ds[i])[: max(3, len(pts) // 50)]
    root = sum((pts[i] for i in near), Vector()) / len(near)
    tip_i = max(range(len(pts)), key=lambda i: (pts[i] - root).length)
    return pts, root, pts[tip_i], max(ds)


def chain_weights(o, pts, root, tip, bones, anchor_bone, pin=0.12):
    """Each vertex to the bone along the strand it lies on, the root end pinned to the anchor bone."""
    axis = tip - root
    length = max(axis.length, 1e-6)
    axis = axis / length
    n = len(bones)
    gs = [o.vertex_groups.get(b) or o.vertex_groups.new(name=b) for b in bones]
    ga = o.vertex_groups.get(anchor_bone) or o.vertex_groups.new(name=anchor_bone)
    for v, p in zip(o.data.vertices, pts):
        t = min(1.0, max(0.0, (p - root).dot(axis) / length))
        s = t * n
        i = min(int(s), n - 1)
        f = s - i
        w = {i: 1.0}
        # Near the next joint, share with the next bone so the bend is smooth.
        if f > 0.6 and i + 1 < n:
            b = (f - 0.6) / 0.4 * 0.5
            w = {i: 1 - b, i + 1: b}
        a = max(0.0, 1 - t / pin) if pin > 0 else 0.0
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
    info = []
    for o in meshes:
        pts, root, tip, far = strand(o, head_tree, "head")
        hang = (tip - root).length
        info.append((o, pts, root, tip, far, hang))
    # Swing: the piece reaches away from the scalp (bangs, locks, tails); a cap stays on the head.
    swing = [x for x in info if x[4] > 0.035 and x[5] > 0.05]
    swing.sort(key=lambda x: -x[5])
    chains, rigid = swing[:MAX_CHAINS], [x for x in info if x not in swing[:MAX_CHAINS]]
    names = []
    for n, (o, pts, root, tip, _far, hang) in enumerate(chains):
        count = max(2, min(6, round(hang / 0.04)))
        bones = add_chain(arm, "head", f"hair_{n}", chain_points(pts, root, tip, count))
        chain_weights(o, pts, root, tip, bones, "head")
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
        for v, p in zip(o.data.vertices, pts):
            _co, j, _d = kd.find(p)
            src, i = owner[j]
            for ge in src.data.vertices[i].groups:
                name = src.vertex_groups[ge.group].name
                (o.vertex_groups.get(name) or o.vertex_groups.new(name=name)).add([v.index], ge.weight, "REPLACE")
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
    decimate(meshes, int(a.get("budget", BUDGET.get(slot, 20000))), report)
    shrink_textures(report)
    if slot in ("hair", "head") and len(meshes) <= 2:
        strip_fused_head(meshes, report)

    if slot == "hair":
        fit_hair(meshes, arm, body, report)
    elif slot in SPAN:
        fit_span(meshes, arm, slot, report)
    target = body_target(body)
    tree = BVHTree.FromObject(target, bpy.context.evaluated_depsgraph_get())
    meshes = drop_standins(meshes, tree, report)
    if not meshes:
        raise SystemExit("nothing left after dropping stand-ins")
    wrap(meshes, target, 0.004 if slot == "hair" else 0.006)
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
