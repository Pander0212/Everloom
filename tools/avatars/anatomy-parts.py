"""
Builds the anatomy pack's mesh parts for one creator base, from code (no scans, no images):
  - anime-m: penis and testicles (shape keys: Erect, Length, Girth, Small, Testicles_Big);
  - anime-f: a vulva patch on the crotch surface (shape keys: Labia_Large, Puffy, Open).
Each part is skinned to the base's skeleton (bone names), and its UVs are the body's own UVs at the
nearest body point, so it samples the creator's painted skin and the join doesn't show; vertex
colours tint the inner parts. Only for the 18+ anatomy pack: written outside the repository.

    blender -b --factory-startup -P tools/avatars/anatomy-parts.py -- <base.glb (uncompressed)> <out dir> <f|m>
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index("--") + 1:]
base_path, out_dir, sex = args[0], args[1], args[2]
os.makedirs(out_dir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=base_path)
for o in list(bpy.context.scene.objects):
    if o.type == "MESH" and (o.name.startswith("Icosphere") or o.name in ("Eyes", "Iris")):
        bpy.data.objects.remove(o, do_unlink=True)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
body = bpy.data.objects["Body"]
for k in (body.data.shape_keys.key_blocks if body.data.shape_keys else []):
    k.value = 0.0
bm_body = bmesh.new()
bm_body.from_mesh(body.data)
bm_body.transform(body.matrix_world)
bm_body.faces.ensure_lookup_table()
uv_layer = bm_body.loops.layers.uv.active
tree = BVHTree.FromBMesh(bm_body)
verts = [body.matrix_world @ v.co for v in body.data.vertices]

# Landmarks: the crotch (lowest point of the torso on the midline) and the front of the pubis.
H = max(p.z for p in verts) - min(p.z for p in verts)
floor = min(p.z for p in verts)
mid = [p for p in verts if abs(p.x) < 0.004 and p.z > floor + 0.3 * H]
crotch = min(mid, key=lambda p: p.z)
print("crotch", tuple(round(c, 3) for c in crotch))


def hit(origin, direction):
    loc, nrm, idx, d = tree.ray_cast(origin, direction.normalized())
    return (loc, nrm, idx) if loc is not None else (None, None, None)


def body_uv(p):
    """The body's UV at the point of its surface nearest to p (barycentric on the nearest face)."""
    loc, nrm, idx, d = tree.find_nearest(p)
    f = bm_body.faces[idx]
    vs = [l.vert.co for l in f.loops]
    uvs = [l[uv_layer].uv for l in f.loops]
    # Triangulate the face around its first corner and pick the triangle holding loc.
    best = None
    for i in range(1, len(vs) - 1):
        a, b, c = vs[0], vs[i], vs[i + 1]
        v0, v1, v2 = b - a, c - a, loc - a
        d00, d01, d11, d20, d21 = v0.dot(v0), v0.dot(v1), v1.dot(v1), v2.dot(v0), v2.dot(v1)
        den = d00 * d11 - d01 * d01 or 1e-12
        w1 = (d11 * d20 - d01 * d21) / den
        w2 = (d00 * d21 - d01 * d20) / den
        w0 = 1 - w1 - w2
        score = min(w0, w1, w2)
        if best is None or score > best[0]:
            best = (score, w0, w1, w2, i)
    _, w0, w1, w2, i = best
    return uvs[0] * w0 + uvs[i] * w1 + uvs[i + 1] * w2


def finish(obj, colors, keys, name):
    """UVs from the body, vertex colours, shape keys, skinning to the pelvis; then export."""
    me = obj.data
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = body_uv(obj.matrix_world @ me.vertices[me.loops[li].vertex_index].co)
    col = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, c in enumerate(colors):
        col.data[i].color = (*c, 1.0)
    obj.shape_key_add(name="Basis")
    for kname, positions in keys.items():
        k = obj.shape_key_add(name=kname)
        for i, p in enumerate(positions):
            k.data[i].co = p
    g = obj.vertex_groups.new(name="pelvis")
    g.add(list(range(len(me.vertices))), 1.0, "REPLACE")
    obj.parent = arm
    m = obj.modifiers.new("Armature", "ARMATURE")
    m.object = arm
    for p in me.polygons:
        p.use_smooth = True
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = obj
    path = os.path.join(out_dir, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_skins=True, export_morph=True, export_morph_normal=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True, export_animations=False, export_apply=False)
    print("PART_OK", path, len(me.vertices))


def mesh_from(verts_list, faces, name):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts_list], [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


SKIN, PINK, DARK = (1.0, 1.0, 1.0), (0.93, 0.62, 0.64), (0.82, 0.68, 0.64)

if sex == "m":
    # ------------------------------------------------------------------ penis and testicles
    # Root: the front surface of the pubis, above the crotch.
    root_z = crotch.z + 0.055
    root, rn, _ = hit(Vector((0, crotch.y - 0.4, root_z)), Vector((0, 1, 0)))
    root = root + Vector((0, 0.012, 0))  # a little inside, so the join is hidden in the body
    RINGS, SEG = 40, 28

    def shaft(length, radius, curve_down, lift):
        """Ring centres and frames along the shaft, from the root (t=0) to the tip (t=1)."""
        pts = [root.copy()]
        for i in range(1, RINGS + 1):
            t = (i - 0.5) / RINGS
            # Walk along the shaft: a flaccid one leaves forward and bends down to hang; an erect one rises.
            a = lift + curve_down * min(1.0, t * 1.6)
            pts.append(pts[-1] + Vector((0, -math.cos(a), math.sin(a))) * (length / RINGS))
        return pts

    def profile(t, radius):
        """Radius along the shaft: a flared root, the shaft, the corona, the glans, the tip."""
        r = radius
        if t < 0.06:
            r *= 1.12 - 1.2 * t
        if 0.74 < t < 0.8:
            r *= 1.0 - 0.06 * math.sin((t - 0.74) / 0.06 * math.pi)  # just behind the corona
        if t >= 0.8:
            g = (t - 0.8) / 0.2
            r *= (1.12 - 0.1 * g) * math.sqrt(max(0.0, 1 - g ** 2.4))  # the glans, rounded
        return max(r, 0.0004)

    def tube(length, radius, curve_down, lift):
        c = shaft(length, radius, curve_down, lift)
        vs, cols = [], []
        for i in range(RINGS + 1):
            t = i / RINGS
            fwd = (c[min(i + 1, RINGS)] - c[max(i - 1, 0)]).normalized()
            side = Vector((1, 0, 0))
            up = side.cross(fwd).normalized()
            r = profile(t, radius)
            for j in range(SEG):
                a = 2 * math.pi * j / SEG
                # Slightly flattened underneath (the urethral side).
                ry = r * (0.92 if math.sin(a) < 0 else 1.0)
                vs.append(c[i] + side * (math.cos(a) * r) + up * (math.sin(a) * ry))
                cols.append(PINK if t > 0.8 else SKIN)
        tip = c[-1] + (c[-1] - c[-2]).normalized() * 0.0005
        vs.append(tip)
        cols.append((0.75, 0.42, 0.45))
        return vs, cols

    L, R = 0.095, 0.0175
    base_v, cols = tube(L, R, -0.45, -1.05)
    faces = []
    for i in range(RINGS):
        for j in range(SEG):
            a, b = i * SEG + j, i * SEG + (j + 1) % SEG
            faces.append((a, b, b + SEG, a + SEG))
    tip_i = (RINGS + 1) * SEG
    for j in range(SEG):
        faces.append((RINGS * SEG + j, RINGS * SEG + (j + 1) % SEG, tip_i))
    keys = {
        "Erect": tube(L * 1.55, R * 1.22, 0.12, 0.42)[0],
        "Length": tube(L * 1.35, R, -0.45, -1.05)[0],
        "Girth": tube(L, R * 1.3, -0.45, -1.05)[0],
        "Small": tube(L * 0.7, R * 0.85, -0.45, -1.05)[0],
    }
    penis = mesh_from(base_v, faces, "Penis")
    finish(penis, cols, keys, "penis")

    # Testicles: a scrotum of two lobes under the root of the shaft.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, radius=1.0)
    sc = bpy.context.active_object
    sc.name = "Testicles"
    centre = root + Vector((0, 0.008, -0.04))
    pts, cols = [], []
    for v in sc.data.vertices:
        x, y, z = v.co
        lobe = 0.022 + 0.004 * math.cos(x * math.pi)  # two lobes, a soft seam between them
        w = 1 - 0.18 * math.exp(-(x * 3.5) ** 2) * (1 if z < 0.3 else 0)
        p = Vector((x * 0.03 * w, y * lobe * 0.95, z * 0.028 - (0.006 if z < 0 else 0) * (1 - z * z)))
        pts.append(centre + p)
        cols.append(DARK)
    for v, p in zip(sc.data.vertices, pts):
        v.co = p
    sc.matrix_world = Matrix.Identity(4)
    big = [centre + (p - centre) * 1.25 for p in pts]
    finish(sc, cols, {"Testicles_Big": big}, "testicles")
else:
    # ------------------------------------------------------------------ vulva
    # A patch over the crotch: v runs from the mons (front) under to the perineum, u across.
    C = Vector((0, crotch.y, crotch.z + 0.055))
    NV, NU = 56, 30
    W = 0.026  # half width (wider and the side rays reach the inner thighs)
    a0, a1 = math.radians(28), math.radians(150)  # from front-and-down, through straight down, to back-and-down
    grid, normals = [], []
    for i in range(NV + 1):
        v = i / NV
        a = a0 + (a1 - a0) * v
        d = Vector((0, -math.cos(a), -math.sin(a)))  # out of the body (the body faces -Y)
        row, nrow = [], []
        for j in range(NU + 1):
            u = (j / NU) * 2 - 1
            o = C + d * 0.3 + Vector((u * W, 0, 0))
            p, n, _ = hit(o, -d)
            if p is not None and (p - (C + Vector((u * W, 0, 0)))).length > 0.09:
                p = None  # hit a thigh, not the crotch
            row.append(p)
            nrow.append(n)
        grid.append(row)
        normals.append(nrow)

    def height(u, v, labia=1.0, puffy=1.0, open_=1.0):
        g = lambda x, s: math.exp(-(x / s) ** 2)
        band = lambda a, b, s=0.08: max(0.0, min(1.0, (v - a) / s, (b - v) / s))
        # An oval outline: the forms ease to nothing at its edge, so the patch melts into the skin.
        r2 = u * u + ((v - 0.52) / 0.48) ** 2
        edge = max(0.0, 1 - r2)
        border = edge * edge * (3 - 2 * edge)
        mons = 0.005 * puffy * g(u, 0.55) * g(v - 0.12, 0.14)
        majora = 0.0075 * puffy * labia * (g(abs(u) - 0.38, 0.22)) * band(0.12, 0.92)
        slit = -0.0085 * g(u, 0.09 * open_) * band(0.28, 0.84, 0.06)
        minora = 0.003 * labia * g(abs(u) - 0.08 * open_, 0.06) * band(0.4, 0.74, 0.08)
        hood = 0.0032 * g(u, 0.12) * g(v - 0.25, 0.05)
        h = (mons + majora + slit + minora + hood) * border
        return max(h, 0.0) + 0.0004 * border  # never below the skin, which stays hidden under it

    def colour(u, v, open_=1.0):
        inner = math.exp(-(u / (0.13 * open_)) ** 2) * (1 if 0.22 < v < 0.9 else 0)
        return tuple(SKIN[k] * (1 - inner) + PINK[k] * inner for k in range(3))

    def build(**kw):
        out = []
        for i in range(NV + 1):
            for j in range(NU + 1):
                u, v = (j / NU) * 2 - 1, i / NV
                p = grid[i][j]
                out.append(p + normals[i][j] * height(u, v, **kw) if p is not None else Vector())
        return out

    base_v = build()
    cols = [colour((j / NU) * 2 - 1, i / NV) for i in range(NV + 1) for j in range(NU + 1)]
    inside = lambda i, j: grid[i][j] is not None and (((j / NU) * 2 - 1) ** 2 + ((i / NV - 0.52) / 0.48) ** 2) <= 1.0
    faces = [(i * (NU + 1) + j, i * (NU + 1) + j + 1, (i + 1) * (NU + 1) + j + 1, (i + 1) * (NU + 1) + j) for i in range(NV) for j in range(NU)
             if inside(i, j) and inside(i, j + 1) and inside(i + 1, j + 1) and inside(i + 1, j)]
    keys = {"Labia_Large": build(labia=1.6), "Puffy": build(puffy=1.6), "Open": build(open_=1.8)}
    vulva = mesh_from(base_v, faces, "Vulva")
    # Drop the grid points outside the oval (they belong to no face).
    bm = bmesh.new(); bm.from_mesh(vulva.data)
    loose = [v for v in bm.verts if not v.link_faces]
    keep_idx = [v.index for v in bm.verts if v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS"); bm.to_mesh(vulva.data); bm.free()
    cols = [cols[i] for i in keep_idx]
    keys = {k: [ps[i] for i in keep_idx] for k, ps in keys.items()}
    base_v = [base_v[i] for i in keep_idx]
    # Faces wind outward (towards the camera from outside the body).
    me = vulva.data
    me.calc_normals_split() if hasattr(me, "calc_normals_split") else None
    centre = sum(base_v, Vector()) / len(base_v)
    out_dir_vec = (centre - C).normalized()
    if me.polygons[len(me.polygons) // 2].normal.dot(out_dir_vec) < 0:
        for p in me.polygons:
            p.flip()
    finish(vulva, cols, keys, "vulva")
