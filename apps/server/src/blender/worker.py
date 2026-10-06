# Everloom's Blender worker. Run by the server as:
#   blender --background --factory-startup --disable-autoexec --python-exit-code 3 --python worker.py -- job.json
# job.json: {"op": "...", "input": "...", "output": "...", ...}. Writes result.json next to job.json.
# Only reads the input and writes the output in the job's own folder; never touches the network.
import json
import os
import re
import sys
import traceback

import bpy  # type: ignore
import addon_utils  # type: ignore


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    with open(argv[0], "r", encoding="utf-8") as f:
        job = json.load(f)
    job["_dir"] = os.path.dirname(os.path.abspath(argv[0]))
    return job


def inside(job, p):
    full = os.path.abspath(os.path.join(job["_dir"], p))
    if not full.startswith(job["_dir"] + os.sep):
        raise ValueError("path outside the job folder")
    return full


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def enable_mmd():
    """MMD Tools (PMX, PMD, VMD) is a separate add-on; use it if the owner installed it."""
    for mod in addon_utils.modules():
        name = mod.__name__
        if name == "mmd_tools" or name.endswith(".mmd_tools"):
            addon_utils.enable(name, default_set=True)
            return True
    return False


def open_blend(path):
    """
    Opens a .blend as the scene (never running its scripts: Blender starts with auto-run off and the
    file is opened with use_scripts=False, so drivers and startup scripts in it stay inert), then
    keeps what would render: meshes in the view layer that aren't hidden from render (themselves
    or by a collection) and the armatures that move them. Subdivision is dropped (too heavy for
    the stage); other modifiers are applied where a mesh has no shape keys.
    """
    bpy.ops.wm.open_mainfile(filepath=path, load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    layer = bpy.context.view_layer
    in_layer = {o.name for o in layer.objects}

    def renders(o):
        if o.name not in in_layer or o.hide_render:
            return False
        return not any(c.hide_render for c in o.users_collection)

    meshes = [o for o in bpy.data.objects if o.type == "MESH" and renders(o)]
    arms = set()
    for o in meshes:
        for m in o.modifiers:
            if m.type == "ARMATURE" and m.object:
                arms.add(m.object)
        if o.parent and o.parent.type == "ARMATURE":
            arms.add(o.parent)
    keep = set(meshes) | arms
    # Parents of what's kept stay too (an empty holding the rig), so transforms don't change.
    for o in list(keep):
        p = o.parent
        while p:
            keep.add(p)
            p = p.parent
    skipped = 0
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
            skipped += 1
    for sc in list(bpy.data.scenes):
        if sc != scene:
            bpy.data.scenes.remove(sc)
    for o in keep:
        if o.name not in scene.objects:
            scene.collection.objects.link(o)
        o.hide_viewport = False
        try:
            o.hide_set(False)
        except RuntimeError:
            pass
    subdiv = 0
    unapplied = 0
    for o in meshes:
        for m in list(o.modifiers):
            if m.type in ("SUBSURF", "MULTIRES"):
                o.modifiers.remove(m)
                subdiv += 1
        others = [m for m in o.modifiers if m.type != "ARMATURE"]
        if not others:
            continue
        if o.data.shape_keys:
            unapplied += len(others)
            continue
        if o.data.users > 1:
            o.data = o.data.copy()
        for m in others:
            with bpy.context.temp_override(object=o, active_object=o):
                try:
                    bpy.ops.object.modifier_apply(modifier=m.name)
                except RuntimeError:
                    o.modifiers.remove(m)
                    unapplied += 1
    missing = sorted({i.name for i in bpy.data.images if i.source == "FILE" and not i.packed_file and i.filepath and not os.path.exists(bpy.path.abspath(i.filepath))})[:20]
    libs = sum(1 for l in bpy.data.libraries if not os.path.exists(bpy.path.abspath(l.filepath)))
    return {"blend": {"version": ".".join(str(v) for v in bpy.data.version), "meshes": len(meshes), "skipped": skipped, "subdivRemoved": subdiv, "modifiersNotApplied": unapplied, "missingTextures": missing, "missingLibraries": libs}}


def import_any(path, motion=False):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".blend":
        raise RuntimeError("Open .blend files with open_blend")
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path, use_anim=motion, ignore_leaf_bones=False, automatic_bone_orientation=False)
    elif ext in (".glb", ".gltf", ".vrm", ".vrma"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".dae":
        bpy.ops.wm.collada_import(filepath=path)
    elif ext == ".bvh":
        bpy.ops.import_anim.bvh(filepath=path, global_scale=0.01, rotate_mode="NATIVE", axis_forward="-Z", axis_up="Y")
    elif ext in (".pmx", ".pmd"):
        if not enable_mmd():
            raise RuntimeError("MMD_TOOLS_MISSING")
        bpy.ops.mmd_tools.import_model(filepath=path, scale=0.08, types={"MESH", "ARMATURE", "MORPHS"})
    elif ext == ".vmd":
        raise RuntimeError("VMD needs a model to apply to; import it with a PMX model")
    else:
        raise RuntimeError("Unsupported file type " + ext)


def clean():
    """Drop cameras, lights and empties that hold nothing; keep meshes, armatures and their parents."""
    removed = 0
    for ob in list(bpy.data.objects):
        if ob.type in ("CAMERA", "LIGHT", "LIGHT_PROBE", "SPEAKER"):
            bpy.data.objects.remove(ob, do_unlink=True)
            removed += 1
    # MMD Tools adds rigid bodies and joints for its own physics; Everloom has its own.
    for ob in list(bpy.data.objects):
        if ob.type == "EMPTY" and not ob.children and ob.name.lower().startswith(("rigidbody", "joint", "j.", "r.")):
            bpy.data.objects.remove(ob, do_unlink=True)
            removed += 1
        elif ob.type == "MESH" and (ob.rigid_body or ob.get("mmd_type") in ("RIGID_BODY", "JOINT")):
            bpy.data.objects.remove(ob, do_unlink=True)
            removed += 1
    if hasattr(bpy.data, "orphans_purge"):
        bpy.data.orphans_purge(do_recursive=True)
    return removed


def export_glb(path, animations=False, selection=False):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=selection,
        export_animations=animations,
        export_skins=True,
        export_morph=True,
        export_yup=True,
        export_apply=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_extras=False,
        export_cameras=False,
        export_lights=False,
    )


def summary():
    arm = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    keys = sum(len(m.data.shape_keys.key_blocks) if m.data.shape_keys else 0 for m in meshes)
    return {"armatures": len(arm), "bones": sum(len(a.data.bones) for a in arm), "meshes": len(meshes), "shapeKeys": keys, "actions": [a.name for a in bpy.data.actions]}


def op_convert(job):
    clear_scene()
    path = inside(job, job["input"])
    extra = {}
    if path.lower().endswith(".blend"):
        extra = open_blend(path)
    else:
        import_any(path)
    removed = clean()
    out = inside(job, job["output"])
    export_glb(out, animations=False)
    return {"removed": removed, **extra, **summary()}


def op_motion(job):
    """An animation file (FBX, BVH, glTF, VMD, .blend) to a GLB with its skeleton and actions, for retargeting."""
    clear_scene()
    path = inside(job, job["input"])
    if path.lower().endswith(".vmd"):
        model = job.get("model")
        if not model:
            raise RuntimeError("VMD needs a PMX model")
        import_any(inside(job, model))
        if not enable_mmd():
            raise RuntimeError("MMD_TOOLS_MISSING")
        arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
        bpy.context.view_layer.objects.active = arm
        bpy.ops.mmd_tools.import_vmd(filepath=path, scale=0.08)
    elif path.lower().endswith(".blend"):
        # Actions live in the file whether or not they're on the rig: put the first one on it.
        bpy.ops.wm.open_mainfile(filepath=path, load_ui=False, use_scripts=False)
        arm = next((o for o in bpy.context.view_layer.objects if o.type == "ARMATURE"), None) or next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
        if not arm:
            raise RuntimeError("The .blend has no armature to take a motion from")
        for ob in list(bpy.data.objects):
            if ob is not arm and ob.type != "MESH":
                bpy.data.objects.remove(ob, do_unlink=True)
        if bpy.context.scene and arm.name not in bpy.context.scene.objects:
            bpy.context.scene.collection.objects.link(arm)
        arm.animation_data_create()
        if not arm.animation_data.action:
            names = {b.name for b in arm.data.bones}
            act = next((a for a in bpy.data.actions if any(fc.data_path.split('"')[1:2] and fc.data_path.split('"')[1] in names for fc in a.fcurves)), None)
            if not act:
                raise RuntimeError("The .blend has no animation for its armature")
            arm.animation_data.action = act
    else:
        import_any(path, motion=True)
    for ob in list(bpy.data.objects):
        if ob.type == "MESH":
            bpy.data.objects.remove(ob, do_unlink=True)
    out = inside(job, job["output"])
    export_glb(out, animations=True)
    return summary()


def op_info(job):
    return {"version": bpy.app.version_string, "mmd": enable_mmd()}


def tris(meshes=None):
    meshes = meshes if meshes is not None else [o for o in bpy.data.objects if o.type == "MESH"]
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)


def op_optimize(job):
    """Clean up a model: merge duplicate vertices, decimate to a triangle budget, shrink textures."""
    import bmesh  # type: ignore

    clear_scene()
    import_any(inside(job, job["input"]))
    removed = clean()
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    before = tris(meshes)
    merged = 0
    for o in meshes:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        n = len(bm.verts)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=float(job.get("mergeDistance", 0.0001)))
        merged += n - len(bm.verts)
        bm.to_mesh(o.data)
        bm.free()
    budget = int(job.get("maxTriangles", 60000))
    current = tris(meshes)
    if current > budget:
        ratio = max(0.05, budget / current)
        for o in meshes:
            # Shape keys block decimation; those meshes (faces) are left as they are.
            if o.data.shape_keys:
                continue
            m = o.modifiers.new("Decimate", "DECIMATE")
            m.ratio = ratio
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=m.name)
    max_tex = int(job.get("maxTexture", 2048))
    resized = 0
    for img in bpy.data.images:
        w, h = img.size[0], img.size[1]
        if max(w, h) > max_tex:
            k = max_tex / max(w, h)
            img.scale(max(1, int(w * k)), max(1, int(h * k)))
            img.pack()
            resized += 1
    export_glb(inside(job, job["output"]))
    return {"removed": removed, "merged": merged, "trianglesBefore": before, "trianglesAfter": tris(meshes), "texturesResized": resized}


SLOT_SPAN = {
    # (lower bone, upper bone, padding as a fraction of the span): where a garment of a slot sits.
    "top": ("hips", "neck", 0.08),
    "outer": ("hips", "neck", 0.12),
    "full": ("leftFoot", "neck", 0.04),
    "bottom": ("leftFoot", "hips", 0.06),
    "head": ("head", None, 0.0),
    "hair": ("head", None, 0.0),
    "feet": ("leftFoot", None, 0.0),
    "hands": ("leftHand", None, 0.0),
}


def op_fit(job):
    """
    Fits a garment mesh to a body: aligns it to where its slot sits on the body, wraps it just
    outside the skin (only the parts that are inside), copies the skin weights from the body so it
    moves with the skeleton, and exports the armature and the garment as one GLB.
    """
    import mathutils  # type: ignore
    from mathutils.bvhtree import BVHTree  # type: ignore

    clear_scene()
    import_any(inside(job, job["body"]))
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if not arm:
        raise RuntimeError("The body has no skeleton")
    # Only meshes skinned to the skeleton are the body (files carry helpers: spheres, planes).
    body_meshes = [o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers) and len(o.vertex_groups)]
    if not body_meshes:
        raise RuntimeError("The body has no skinned mesh")
    for o in [o for o in bpy.data.objects if o.type == "MESH" and o not in body_meshes]:
        bpy.data.objects.remove(o, do_unlink=True)
    existing = set(bpy.data.objects)
    import_any(inside(job, job["input"]))
    new = [o for o in bpy.data.objects if o not in existing]
    for o in new:
        if o.type == "ARMATURE":
            # The garment's own skeleton (if any) is replaced by the body's.
            for c in o.children:
                c.parent = None
            bpy.data.objects.remove(o, do_unlink=True)
    garment_parts = [o for o in bpy.data.objects if o not in existing and o.type == "MESH"]
    if not garment_parts:
        raise RuntimeError("The garment file has no mesh")
    bpy.ops.object.select_all(action="DESELECT")
    for o in garment_parts:
        o.select_set(True)
        for m in list(o.modifiers):
            o.modifiers.remove(m)
    bpy.context.view_layer.objects.active = garment_parts[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(garment_parts) > 1:
        bpy.ops.object.join()
    garment = bpy.context.view_layer.objects.active
    garment.name = job.get("name", "Garment")[:60]
    for v in garment.vertex_groups:
        garment.vertex_groups.remove(v)

    # One mesh of the body to wrap to and take weights from (a copy, deleted at the end).
    bpy.ops.object.select_all(action="DESELECT")
    copies = []
    for o in body_meshes:
        c = o.copy()
        c.data = o.data.copy()
        bpy.context.collection.objects.link(c)
        for m in list(c.modifiers):
            if m.type != "ARMATURE":
                c.modifiers.remove(m)
        copies.append(c)
    for c in copies:
        c.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    if len(copies) > 1:
        bpy.ops.object.join()
    target = bpy.context.view_layer.objects.active
    target.name = "FitTarget"

    # Where the slot sits, from the body's bones (names in job["bones"]: canonical -> file name).
    bones = job.get("bones", {})
    def bone_head(name):
        b = arm.data.bones.get(bones.get(name, name)) if name else None
        return (arm.matrix_world @ b.head_local) if b else None

    lo_name, hi_name, pad = SLOT_SPAN.get(job.get("slot", "top"), SLOT_SPAN["top"])
    corners = [garment.matrix_world @ mathutils.Vector(c) for c in garment.bound_box]
    gmin = mathutils.Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    gmax = mathutils.Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    tcorners = [target.matrix_world @ mathutils.Vector(c) for c in target.bound_box]
    body_h = max(c.z for c in tcorners) - min(c.z for c in tcorners)
    if job.get("align", True):
        lo = bone_head(lo_name)
        hi = bone_head(hi_name) if hi_name else None
        if lo is not None:
            if hi is not None:
                span = (hi.z - lo.z) * (1 + 2 * pad)
                bottom = lo.z - (hi.z - lo.z) * pad
            else:
                # Head, hands and feet: about the size of that part of the body.
                span = body_h * {"head": 0.17, "hair": 0.2, "feet": 0.08, "hands": 0.07}.get(job.get("slot"), 0.15)
                bottom = lo.z - span * (0.1 if job.get("slot") in ("head", "hair") else 0.5)
            k = span / max(1e-6, gmax.z - gmin.z)
            garment.scale = (k, k, k)
            bpy.context.view_layer.objects.active = garment
            bpy.ops.object.transform_apply(scale=True)
            corners = [garment.matrix_world @ mathutils.Vector(c) for c in garment.bound_box]
            cx = (min(c.x for c in corners) + max(c.x for c in corners)) / 2
            cy = (min(c.y for c in corners) + max(c.y for c in corners)) / 2
            centre = bone_head("spine") or lo
            garment.location = (garment.location.x + (centre.x if lo_name not in ("leftFoot", "leftHand") else lo.x) - cx, garment.location.y + centre.y - cy, garment.location.z + bottom - min(c.z for c in corners))
            bpy.ops.object.transform_apply(location=True)

    # Wrap only what is inside the skin to just outside it.
    offset = float(job.get("offset", 0.006))
    m = garment.modifiers.new("Wrap", "SHRINKWRAP")
    m.target = target
    m.wrap_method = "NEAREST_SURFACEPOINT"
    m.wrap_mode = "OUTSIDE"
    m.offset = offset
    bpy.context.view_layer.objects.active = garment
    bpy.ops.object.modifier_apply(modifier=m.name)

    # Skin weights from the nearest body surface: the closest face's corners, blended by distance.
    tm = target.matrix_world
    tverts = [tm @ v.co for v in target.data.vertices]
    tpolys = [list(p.vertices) for p in target.data.polygons]
    tree_t = BVHTree.FromPolygons(tverts, tpolys)
    names = [g.name for g in target.vertex_groups]
    vw = [{names[ge.group]: ge.weight for ge in v.groups if ge.weight > 0} for v in target.data.vertices]
    groups = {}
    gm = garment.matrix_world
    for v in garment.data.vertices:
        co = gm @ v.co
        loc, _n, idx, _d = tree_t.find_nearest(co)
        if idx is None:
            continue
        acc = {}
        total = 0.0
        for vi in tpolys[idx]:
            k = 1.0 / (max((tverts[vi] - loc).length, 1e-5))
            total += k
            for name, w in vw[vi].items():
                acc[name] = acc.get(name, 0.0) + w * k
        top = sorted(acc.items(), key=lambda x: -x[1])[:4]
        norm = sum(w for _, w in top) or 1.0
        for name, w in top:
            if name not in groups:
                groups[name] = garment.vertex_groups.new(name=name)
            groups[name].add([v.index], w / norm, "REPLACE")

    # Which bones' skin it covers (for hiding body regions): body vertices close to the garment.
    gverts = [garment.matrix_world @ v.co for v in garment.data.vertices]
    tree = BVHTree.FromPolygons(gverts, [list(p.vertices) for p in garment.data.polygons])
    covered = {}
    totals = {}
    for v in target.data.vertices:
        if not v.groups:
            continue
        g = max(v.groups, key=lambda x: x.weight)
        name = target.vertex_groups[g.group].name
        totals[name] = totals.get(name, 0) + 1
        co = target.matrix_world @ v.co
        nrm = (target.matrix_world.to_3x3() @ v.normal).normalized()
        # Covered when the garment is right there, or straight out from the skin (loose cloth).
        near = tree.find_nearest(co, offset * 3 + 0.01)
        if (near and near[0] is not None) or tree.ray_cast(co + nrm * 0.001, nrm, 0.25)[0] is not None:
            covered[name] = covered.get(name, 0) + 1
    coverage = {k: round(covered.get(k, 0) / n, 3) for k, n in totals.items() if covered.get(k)}

    # Bind to the skeleton, keeping it where it is.
    am = garment.modifiers.new("Armature", "ARMATURE")
    am.object = arm
    mw = garment.matrix_world.copy()
    garment.parent = arm
    garment.matrix_world = mw

    for o in body_meshes + [target]:
        bpy.data.objects.remove(o, do_unlink=True)
    export_glb(inside(job, job["output"]))
    gc = [garment.matrix_world @ mathutils.Vector(c) for c in garment.bound_box]
    box = [[round(min(c[i] for c in gc), 3) for i in range(3)], [round(max(c[i] for c in gc), 3) for i in range(3)]]
    return {"triangles": tris([garment]), "coverage": coverage, "groups": len(garment.vertex_groups), "box": box, "bodyBox": [[round(min(c[i] for c in tcorners), 3) for i in range(3)], [round(max(c[i] for c in tcorners), 3) for i in range(3)]]}


def op_render(job):
    """Renders the model from the front (a thumbnail), or from several angles into a zip (a turntable)."""
    import math
    import zipfile
    import mathutils  # type: ignore

    clear_scene()
    import_any(inside(job, job["input"]))
    clean()
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = int(job.get("samples", 16))
    scene.render.film_transparent = True
    size = int(job.get("size", 384))
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = world
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    pts = [o.matrix_world @ mathutils.Vector(c) for o in meshes for c in o.bound_box]
    lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre = (lo + hi) / 2
    radius = max((hi - lo).length / 2, 0.01)
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    dist = radius / math.tan(cam_data.angle / 2) * 1.1
    angles = [0] if job.get("frames", 1) <= 1 else [i * 360 / int(job["frames"]) for i in range(int(job["frames"]))]
    paths = []
    for i, a in enumerate(angles):
        # glTF models face +Y in Blender after import (glTF +Z); the camera starts in front.
        r = math.radians(a)
        cam.location = (centre.x + dist * math.sin(r), centre.y - dist * math.cos(r), centre.z)
        direction = centre - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        p = inside(job, "frame_%02d.png" % i)
        scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    out = inside(job, job["output"])
    if out.endswith(".zip"):
        with zipfile.ZipFile(out, "w") as z:
            for p in paths:
                z.write(p, os.path.basename(p))
    else:
        os.replace(paths[0], out)
    return {"frames": len(paths)}


def op_mpfb(job):
    """
    A realistic human with MPFB (the MakeHuman add-on, installed by the owner): macro sliders
    (gender, age, weight, muscle, height, proportions), skin, eyes, brows, lashes, hair and clothes
    from MakeHuman's CC0 system assets, the game-engine skeleton, exported as GLB.
    """
    import addon_utils  # noqa: F811

    clear_scene()
    mod = next((m.__name__ for m in addon_utils.modules() if m.__name__.endswith(".mpfb")), None)
    if not mod:
        raise RuntimeError("MPFB_MISSING")
    addon_utils.enable(mod, default_set=True)
    import importlib

    hs = importlib.import_module(mod + ".services.humanservice").HumanService
    ls = importlib.import_module(mod + ".services.locationservice").LocationService
    data = ls.get_user_data()
    def asset(kind, name):
        if not name:
            return None
        if not re.match(r"^[A-Za-z0-9_\-]+$", name):
            raise RuntimeError("Bad asset name")
        ext = "mhmat" if kind == "skins" else "mhclo"
        path = os.path.join(data, kind, name, name + "." + ext)
        if not os.path.exists(path):
            raise RuntimeError("Asset not installed: %s/%s" % (kind, name))
        return path
    macro = {"gender": 0.5, "age": 0.5, "muscle": 0.5, "weight": 0.5, "proportions": 0.5, "height": 0.5, "cupsize": 0.5, "firmness": 0.5, "race": {"asian": 0.33, "caucasian": 0.33, "african": 0.33}}
    for k, v in (job.get("macro") or {}).items():
        if k == "race" and isinstance(v, dict):
            macro["race"].update({r: float(x) for r, x in v.items() if r in macro["race"]})
        elif k in macro and k != "race":
            macro[k] = max(0.0, min(1.0, float(v)))
    basemesh = hs.create_human(macro_detail_dict=macro, scale=0.1)
    hs.add_builtin_rig(basemesh, job.get("rig", "game_engine"))
    if job.get("skin"):
        hs.set_character_skin(asset("skins", job["skin"]), basemesh, skin_type="GAMEENGINE")
    for kind, key in (("eyes", "eyes"), ("eyebrows", "eyebrows"), ("eyelashes", "eyelashes"), ("hair", "hair")):
        p = asset(kind, job.get(key))
        if p:
            hs.add_mhclo_asset(p, basemesh, asset_type={"eyes": "Eyes", "eyebrows": "Eyebrows", "eyelashes": "Eyelashes", "hair": "Hair"}[kind], subdiv_levels=0, material_type="GAMEENGINE")
    for c in job.get("clothes") or []:
        hs.add_mhclo_asset(asset("clothes", c), basemesh, asset_type="Clothes", subdiv_levels=0, material_type="GAMEENGINE")
    clothes = {}
    for c in job.get("clothes") or []:
        o = next((o for o in bpy.data.objects if o.type == "MESH" and o.name.endswith("." + c)), None)
        if o:
            clothes[c] = o
    separate = bool(job.get("separate")) and clothes
    body = basemesh
    coverage = {}
    recessed = 0
    if separate:
        # What each garment covers: per bone, the share of the body's skin (by the bone that moves
        # it most) in MPFB's "Delete.<garment>" group, the skin it would remove under that garment.
        bone_of = {}
        rig = next((a for a in bpy.data.objects if a.type == "ARMATURE"), None)
        bones = {b.name for b in rig.data.bones} if rig else set()
        groups = {g.index: g.name for g in body.vertex_groups if g.name in bones}
        for v in body.data.vertices:
            best = max(((groups[g.group], g.weight) for g in v.groups if g.group in groups), key=lambda t: t[1], default=(None, 0))
            bone_of[v.index] = best[0]
        for c in clothes:
            dg = body.vertex_groups.get("Delete." + c)
            if not dg:
                continue
            totals, hits = {}, {}
            for v in body.data.vertices:
                b = bone_of.get(v.index)
                if not b:
                    continue
                totals[b] = totals.get(b, 0) + 1
                if any(g.group == dg.index and g.weight > 0.5 for g in v.groups):
                    hits[b] = hits.get(b, 0) + 1
            coverage[c] = {b: round(hits.get(b, 0) / n, 3) for b, n in totals.items() if n >= 10}
        # The body stays whole (clothes come off in the wardrobe): drop the delete masks.
        for m in list(body.modifiers):
            if m.type == "MASK" and m.name.startswith("Delete."):
                body.modifiers.remove(m)
    # The body's shape keys are its sliders: bake the current mix into the mesh first (modifiers
    # can't be applied to a mesh with shape keys), then apply the masks that remove helper geometry
    # (and, unless clothes are separate, the skin under clothes).
    for o in [o for o in bpy.data.objects if o.type == "MESH"]:
        if o.data.shape_keys:
            o.shape_key_add(name="__mix", from_mix=True)
            for k in list(o.data.shape_keys.key_blocks):
                if k.name != "__mix":
                    o.shape_key_remove(k)
            o.shape_key_remove(o.data.shape_keys.key_blocks["__mix"])
        for m in list(o.modifiers):
            if m.type in ("MASK", "SUBSURF"):
                with bpy.context.temp_override(object=o, active_object=o):
                    try:
                        bpy.ops.object.modifier_apply(modifier=m.name)
                    except RuntimeError:
                        o.modifiers.remove(m)
    if separate:
        # Skin under a garment is pulled in so there's always a gap of a few millimetres between
        # them: the wardrobe hides whole regions only, and MPFB's delete groups don't cover the
        # edges (shoulders under sleeves, ankles). Rays along the skin's normal find the garment
        # above it (or just below it, where skin pokes through).
        from mathutils.bvhtree import BVHTree  # type: ignore

        gap = float(job.get("recess", 0.006))
        deps = bpy.context.evaluated_depsgraph_get()
        body.data.update()
        to_world = body.matrix_world
        moves = {}
        for o in clothes.values():
            tree = BVHTree.FromObject(o, deps)
            to_local = o.matrix_world.inverted() @ to_world
            for v in body.data.vertices:
                co = to_local @ v.co
                n = (to_local.to_3x3() @ v.normal).normalized()
                hit = tree.ray_cast(co, n, 0.03)
                if hit[0] is not None:
                    d = hit[3]
                    need = gap - d
                else:
                    back = tree.ray_cast(co, -n, 0.02)
                    if back[0] is None:
                        continue
                    need = gap + back[3]
                if need > 0:
                    moves[v.index] = max(moves.get(v.index, 0), need)
        for i, d in moves.items():
            v = body.data.vertices[i]
            v.co -= v.normal * d
        recessed = len(moves)
        # The browser skins with four bones per vertex, so the body and a garment that Blender bends
        # together can part in motion. Keep the body's four strongest bones, then give every garment
        # vertex near the skin the weights of the skin under it: they bend as one.
        rig = next((a for a in bpy.data.objects if a.type == "ARMATURE"), None)
        bones = {b.name for b in rig.data.bones} if rig else set()
        bgroups = {g.index: g for g in body.vertex_groups if g.name in bones}
        vw = []
        for v in body.data.vertices:
            ws = sorted(((bgroups[g.group].name, g.weight) for g in v.groups if g.group in bgroups and g.weight > 0), key=lambda t: -t[1])
            top = ws[:4]
            norm = sum(w for _, w in top) or 1.0
            for name, _w in ws[4:]:
                body.vertex_groups[name].remove([v.index])
            for name, w in top:
                body.vertex_groups[name].add([v.index], w / norm, "REPLACE")
            vw.append({name: w / norm for name, w in top})
        bm = body.matrix_world
        bverts = [bm @ v.co for v in body.data.vertices]
        bpolys = [list(p.vertices) for p in body.data.polygons]
        btree = BVHTree.FromPolygons(bverts, bpolys)
        reach = float(job.get("weightReach", 0.05))
        for o in clothes.values():
            gm = o.matrix_world
            for v in o.data.vertices:
                loc, _n, idx, dist = btree.find_nearest(gm @ v.co)
                if idx is None or dist > reach:
                    continue
                acc = {}
                for vi in bpolys[idx]:
                    k = 1.0 / max((bverts[vi] - loc).length, 1e-5)
                    for name, w in vw[vi].items():
                        acc[name] = acc.get(name, 0.0) + w * k
                top = sorted(acc.items(), key=lambda t: -t[1])[:4]
                norm = sum(w for _, w in top) or 1.0
                for g in list(v.groups):
                    grp = o.vertex_groups[g.group]
                    if grp.name in bones:
                        grp.remove([v.index])
                for name, w in top:
                    grp = o.vertex_groups.get(name) or o.vertex_groups.new(name=name)
                    grp.add([v.index], w / norm, "REPLACE")
    # glTF alpha: the exporter makes every material with a linked Alpha "BLEND", which sorts badly
    # (skin shows through clothes). Hair, brows and lashes are cards: cut them out (a ROUND node
    # before Alpha exports as MASK at 0.5); everything else is opaque.
    cards = [n for n in (job.get("hair"), job.get("eyebrows"), job.get("eyelashes")) if n]
    for mat in bpy.data.materials:
        nt = mat.node_tree
        if not nt:
            continue
        for bsdf in [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"]:
            alpha = bsdf.inputs["Alpha"]
            src = alpha.links[0].from_socket if alpha.links else None
            for l in list(alpha.links):
                nt.links.remove(l)
            if src is not None and any(c in mat.name for c in cards):
                rnd = nt.nodes.new("ShaderNodeMath")
                rnd.operation = "ROUND"
                nt.links.new(src, rnd.inputs[0])
                nt.links.new(rnd.outputs[0], alpha)
            else:
                alpha.default_value = 1.0
    out = inside(job, job["output"])
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    arm = next((a for a in bpy.data.objects if a.type == "ARMATURE"), None)
    info = {"meshes": [o.name for o in meshes], "bones": len(arm.data.bones) if arm else 0}
    if not separate:
        export_glb(out)
        return {"triangles": tris(meshes), **info}
    # A zip: the body (with hair, eyes, brows and lashes) and each garment on the same skeleton.
    import zipfile

    def export_only(objs, path):
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs + ([arm] if arm else []):
            o.select_set(True)
        export_glb(path, selection=True)

    worn = set(clothes.values())
    files = []
    body_path = inside(job, "body.glb")
    export_only([o for o in meshes if o not in worn], body_path)
    files.append(("body.glb", body_path))
    garments = []
    for c, o in clothes.items():
        p = inside(job, "garment-%s.glb" % c)
        export_only([o], p)
        files.append((os.path.basename(p), p))
        tags = []
        try:
            with open(os.path.join(data, "clothes", c, c + ".mhclo"), encoding="utf-8", errors="replace") as f:
                tags = [l.split(None, 1)[1].strip().lower() for l in f if l.startswith("tag ") and len(l.split(None, 1)) > 1][:20]
        except OSError:
            pass
        garments.append({"name": c, "file": os.path.basename(p), "tags": tags, "coverage": coverage.get(c, {}), "triangles": tris([o])})
    with zipfile.ZipFile(out, "w") as z:
        for name, p in files:
            z.write(p, name)
    return {"triangles": tris([o for o in meshes if o not in worn]), "garments": garments, "body": body.name, "recessed": recessed, **info}


def op_mpfb_assets(job):
    """What MPFB and its asset packs offer here (names only)."""
    import addon_utils  # noqa: F811

    mod = next((m.__name__ for m in addon_utils.modules() if m.__name__.endswith(".mpfb")), None)
    if not mod:
        return {"installed": False}
    addon_utils.enable(mod, default_set=True)
    import importlib

    data = importlib.import_module(mod + ".services.locationservice").LocationService.get_user_data()
    out = {"installed": True}
    for kind in ("skins", "eyes", "eyebrows", "eyelashes", "hair", "clothes"):
        d = os.path.join(data, kind)
        out[kind] = sorted(n for n in os.listdir(d) if os.path.isdir(os.path.join(d, n))) if os.path.isdir(d) else []
    return out


OPS = {"convert": op_convert, "motion": op_motion, "info": op_info, "optimize": op_optimize, "fit": op_fit, "render": op_render, "mpfb": op_mpfb, "mpfb_assets": op_mpfb_assets}


def main():
    job = args()
    result = {"ok": False}
    try:
        result = {"ok": True, **OPS[job["op"]](job)}
    except Exception as e:  # noqa: BLE001
        result = {"ok": False, "error": str(e)[:500], "trace": traceback.format_exc()[-2000:]}
    with open(os.path.join(job["_dir"], "result.json"), "w", encoding="utf-8") as f:
        json.dump(result, f)
    if not result["ok"]:
        sys.exit(3)


main()
