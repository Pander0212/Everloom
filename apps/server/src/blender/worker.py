# Everloom's Blender worker. Run by the server as:
#   blender --background --factory-startup --disable-autoexec --python-exit-code 3 --python worker.py -- job.json
# job.json: {"op": "...", "input": "...", "output": "...", ...}. Writes result.json next to job.json.
# Only reads the input and writes the output in the job's own folder; never touches the network.
import json
import os
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


def import_any(path, motion=False):
    ext = os.path.splitext(path)[1].lower()
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


def export_glb(path, animations=False):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
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
    import_any(inside(job, job["input"]))
    removed = clean()
    out = inside(job, job["output"])
    export_glb(out, animations=False)
    return {"removed": removed, **summary()}


def op_motion(job):
    """An animation file (FBX, BVH, glTF) to a GLB with its skeleton and actions, for retargeting."""
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


OPS = {"convert": op_convert, "motion": op_motion, "info": op_info}


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
