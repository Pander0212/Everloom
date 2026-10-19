"""
Looks at generated 3D models: renders each one (front and three-quarter, Cycles on the CPU) and
measures how clean the mesh is. A Hunyuan3D result (a zip with a textured OBJ) is turned into a GLB
first, with the textures connected.

    blender -b --factory-startup -P tools/gpu/evaluate.py -- <out.json> <render dir> <model file>...

For each model: triangles, vertices, loose pieces (and how much of the area the largest one has),
open boundary edges (holes), non-manifold edges, texture sizes, and the two pictures.
"""
import bpy, bmesh, json, math, os, sys, tempfile, zipfile
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
out_json, render_dir, files = args[0], args[1], args[2:]
os.makedirs(render_dir, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    s.cycles.device = "CPU"
    s.cycles.samples = 24
    s.cycles.use_denoising = True
    s.render.resolution_x = s.render.resolution_y = 512
    s.render.film_transparent = False
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.82, 0.83, 0.86, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    s.world = w
    s.view_settings.view_transform = "Standard"


def load(path):
    if path.endswith(".zip"):
        d = tempfile.mkdtemp()
        zipfile.ZipFile(path).extractall(d)
        objs = sorted(n for n in os.listdir(d) if n.endswith(".obj"))
        obj = os.path.join(d, "textured.obj" if "textured.obj" in objs else objs[0])
        bpy.ops.wm.obj_import(filepath=obj)
        # Hunyuan3D writes PBR maps next to the OBJ: connect metallic/roughness if the MTL left them out.
        for m in bpy.data.materials:
            if not m.use_nodes:
                continue
            bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            for n in os.listdir(d):
                p = os.path.join(d, n)
                if bsdf and n.endswith("_metallic.jpg") and not bsdf.inputs["Metallic"].is_linked:
                    t = m.node_tree.nodes.new("ShaderNodeTexImage"); t.image = bpy.data.images.load(p); t.image.colorspace_settings.name = "Non-Color"
                    m.node_tree.links.new(t.outputs[0], bsdf.inputs["Metallic"])
                if bsdf and n.endswith("_roughness.jpg") and not bsdf.inputs["Roughness"].is_linked:
                    t = m.node_tree.nodes.new("ShaderNodeTexImage"); t.image = bpy.data.images.load(p); t.image.colorspace_settings.name = "Non-Color"
                    m.node_tree.links.new(t.outputs[0], bsdf.inputs["Roughness"])
        glb = path[:-4] + ".glb"
        bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=False)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    # The glTF importer adds a hidden icosphere as the bones' display shape: not part of the model.
    for o in list(bpy.context.scene.objects):
        if o.type == "MESH" and (o.name.startswith("Icosphere") or not o.visible_get()):
            bpy.data.objects.remove(o, do_unlink=True)
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def stats(meshes):
    tri = verts = loose = boundary = nonmanifold = 0
    areas = []
    for o in meshes:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
        bm.faces.ensure_lookup_table()
        tri += sum(len(f.verts) - 2 for f in bm.faces)
        verts += len(bm.verts)
        boundary += sum(1 for e in bm.edges if e.is_boundary)
        nonmanifold += sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
        seen = set()
        for f in bm.faces:
            if f.index in seen:
                continue
            stack, area = [f], 0.0
            seen.add(f.index)
            while stack:
                g = stack.pop()
                area += g.calc_area()
                for e in g.edges:
                    for h in e.link_faces:
                        if h.index not in seen:
                            seen.add(h.index)
                            stack.append(h)
            areas.append(area)
        bm.free()
    total = sum(areas) or 1
    big = max(areas) if areas else 0
    pieces = len(areas)
    small = sum(1 for a in areas if a < 0.002 * total)
    tex = sorted({f"{i.size[0]}x{i.size[1]}" for i in bpy.data.images if i.size[0]})
    return {"triangles": tri, "vertices": verts, "pieces": pieces, "tinyPieces": small, "largestPieceShare": round(big / total, 3), "boundaryEdges": boundary, "nonManifoldEdges": nonmanifold, "textures": tex}


def frame_and_render(meshes, name):
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    dg = bpy.context.evaluated_depsgraph_get()
    for o in meshes:
        e = o.evaluated_get(dg)
        m = e.to_mesh()
        for v in m.vertices:
            w = e.matrix_world @ v.co
            lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
        e.to_mesh_clear()
    center, size = (lo + hi) / 2, max(hi - lo)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    bpy.context.scene.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = size * 1.15
    bpy.context.scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    bpy.context.scene.collection.objects.link(sun)
    shots = []
    # glTF import: the model faces -Y in Blender (glTF +Z forward).
    for tag, ang in (("front", 0), ("34", 40)):
        a = math.radians(ang)
        d = size * 3
        cam.location = center + Vector((d * math.sin(a), -d * math.cos(a), 0))
        cam.rotation_euler = (math.radians(90), 0, a)
        p = os.path.join(render_dir, f"{name}-{tag}.png")
        bpy.context.scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        shots.append(p)
    return shots


report = json.load(open(out_json)) if os.path.exists(out_json) else {}
for f in files:
    key = os.path.relpath(f)
    reset()
    try:
        meshes = load(f)
        r = stats(meshes)
        name = key.replace(os.sep, "__").rsplit(".", 1)[0]
        r["renders"] = frame_and_render(meshes, name)
        report[key] = r
    except Exception as e:  # noqa: BLE001
        report[key] = {"error": str(e)[:300]}
    print(key, report[key], flush=True)
    json.dump(report, open(out_json, "w"), indent=1)
