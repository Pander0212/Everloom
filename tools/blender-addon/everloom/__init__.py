# SPDX-License-Identifier: GPL-3.0-or-later
# Everloom exporter for Blender: checks a model against the Everloom avatar spec (docs/avatars.md)
# and exports it as a GLB, saved to a file or sent to your own Everloom server with a device token.
# (Blender add-ons are GPL because they use Blender's Python API; the rest of Everloom is MIT.)

bl_info = {
    "name": "Everloom exporter",
    "author": "Everloom",
    "version": (1, 0, 0),
    "blender": (4, 2, 0),
    "location": "3D View › Sidebar › Everloom",
    "description": "Check and export avatars, garments and animations for Everloom",
    "category": "Import-Export",
}

import json
import os
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request

import bpy  # type: ignore
from bpy.props import EnumProperty, StringProperty  # type: ignore

# The bones Everloom needs (VRM 1.0 names), and name patterns that usually mean them. Everloom maps
# almost any naming on import; this check only catches skeletons that clearly lack a part.
REQUIRED = {
    "hips": r"hips?|pelvis|root_?hips|^b?hip",
    "spine": r"spine|torso|abdomen",
    "head": r"head",
    "leftUpperArm": r"(upper_?arm|arm|uparm).*(\bl\b|left|\.l$|_l$)|(left|l_|\.l).*(upper_?arm|arm)",
    "rightUpperArm": r"(upper_?arm|arm|uparm).*(\br\b|right|\.r$|_r$)|(right|r_|\.r).*(upper_?arm|arm)",
    "leftUpperLeg": r"(thigh|up_?leg|upper_?leg|leg).*(\bl\b|left|\.l$|_l$)|(left|l_|\.l).*(thigh|up_?leg|upper_?leg|leg)",
    "rightUpperLeg": r"(thigh|up_?leg|upper_?leg|leg).*(\br\b|right|\.r$|_r$)|(right|r_|\.r).*(thigh|up_?leg|upper_?leg|leg)",
}
SLOTS = [(s, s.capitalize(), "") for s in ("hair", "head", "top", "bottom", "full", "outer", "hands", "feet", "socks", "underwear")]
TRIANGLE_BUDGET = 60000


def prefs(context):
    return context.preferences.addons[__package__].preferences


class EverloomPrefs(bpy.types.AddonPreferences):
    bl_idname = __package__
    server: StringProperty(name="Everloom address", description="Where your Everloom runs, e.g. https://rp.example.com", default="")  # type: ignore
    token: StringProperty(name="Device token", description="Settings › Character sources › Browser bridge › Add a device, in Everloom", default="", subtype="PASSWORD")  # type: ignore

    def draw(self, context):
        self.layout.prop(self, "server")
        self.layout.prop(self, "token")


def armature_of(objs):
    for o in objs:
        if o.type == "ARMATURE":
            return o
        if o.parent and o.parent.type == "ARMATURE":
            return o.parent
        for m in getattr(o, "modifiers", []):
            if m.type == "ARMATURE" and m.object:
                return m.object
    return None


def triangles(objs):
    deps = bpy.context.evaluated_depsgraph_get()
    n = 0
    for o in objs:
        if o.type != "MESH":
            continue
        me = o.evaluated_get(deps).to_mesh()
        n += sum(len(p.vertices) - 2 for p in me.polygons)
        o.evaluated_get(deps).to_mesh_clear()
    return n


def check(context, kind):
    """Problems (block export) and notes (worth a look), in plain words."""
    s = context.scene.everloom
    objs = list(context.selected_objects) or list(context.scene.objects)
    problems, notes = [], []
    arm = armature_of(objs)
    meshes = [o for o in objs if o.type == "MESH"]
    if kind in ("avatar", "garment") and not meshes:
        problems.append("Nothing to export: select the meshes (and their armature).")
    if not arm:
        problems.append("No armature: Everloom moves models with a skeleton.")
    else:
        names = [b.name.lower() for b in arm.data.bones]
        if kind == "avatar":
            for bone, pat in REQUIRED.items():
                if not any(re.search(pat, n) for n in names):
                    problems.append(f"No bone looks like the {bone} (Everloom maps most names; check the skeleton).")
        if kind == "animation" and not (arm.animation_data and arm.animation_data.action):
            problems.append("The armature has no action to export.")
    if kind == "garment":
        for o in meshes:
            if not any(m.type == "ARMATURE" for m in o.modifiers) or not o.vertex_groups:
                problems.append(f"{o.name} isn't weighted to the skeleton (add an Armature modifier and weights).")
        if not s.avatar:
            problems.append("Choose the avatar this garment is for (Refresh lists your avatars).")
    if meshes:
        tris = triangles(meshes)
        if tris > TRIANGLE_BUDGET * 2.5:
            problems.append(f"{tris:,} triangles: too many for phones (budget {TRIANGLE_BUDGET:,}).")
        elif tris > TRIANGLE_BUDGET:
            notes.append(f"{tris:,} triangles: over the {TRIANGLE_BUDGET:,} budget; phones will use a lighter copy.")
        # Height in metres (Everloom fits odd units, but the real height should be right).
        zs = [(o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices]
        if zs and kind == "avatar":
            h = max(zs) - min(zs)
            if h < 0.4 or h > 3:
                notes.append(f"It is {h:.2f} m tall: apply the scale so it's in metres (Everloom will guess otherwise).")
    if arm and kind == "avatar":
        fam = arm.get("everloom_family")
        if fam:
            notes.append(f"Body family: {fam} (garments made for it fit every avatar of that family).")
        else:
            notes.append("No body family set: set one to share garments between avatars of the same body.")
    return problems, notes, objs, arm


def export_glb(path, objs, kind):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_animations=(kind == "animation"),
        export_skins=True,
        export_morph=True,
        export_yup=True,
        export_apply=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )


def request(context, path, body=None, query=None):
    p = prefs(context)
    if not p.server or not p.token:
        raise RuntimeError("Set your Everloom address and device token in the add-on preferences.")
    url = p.server.rstrip("/") + path + ("?" + urllib.parse.urlencode(query) if query else "")
    req = urllib.request.Request(url, data=body if body is not None else b"", method="POST", headers={"authorization": "Bearer " + p.token.strip(), "content-type": "application/octet-stream"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode("utf-8")).get("error")
        except Exception:  # noqa: BLE001
            msg = None
        raise RuntimeError(msg or f"Everloom answered {e.code}") from None


_avatars = [("", "(refresh to list)", "")]


def avatar_items(self, context):
    return _avatars


class EverloomSettings(bpy.types.PropertyGroup):
    kind: EnumProperty(name="What", items=[("avatar", "Avatar", "A character model"), ("garment", "Garment", "Clothing for one of your avatars"), ("animation", "Animation", "A motion for the emote library")])  # type: ignore
    name: StringProperty(name="Name", default="")  # type: ignore
    avatar: EnumProperty(name="For avatar", items=avatar_items)  # type: ignore
    slot: EnumProperty(name="Slot", items=SLOTS, default="top")  # type: ignore
    report: StringProperty(default="")  # type: ignore


class EVERLOOM_OT_check(bpy.types.Operator):
    bl_idname = "everloom.check"
    bl_label = "Check"
    bl_description = "Check the selection against the Everloom spec"

    def execute(self, context):
        s = context.scene.everloom
        problems, notes, _o, _a = check(context, s.kind)
        s.report = json.dumps({"problems": problems, "notes": notes})
        self.report({"WARNING" if problems else "INFO"}, problems[0] if problems else "Ready for Everloom")
        return {"FINISHED"}


class EVERLOOM_OT_save(bpy.types.Operator):
    bl_idname = "everloom.save"
    bl_label = "Save GLB"
    bl_description = "Export the selection as a GLB file"
    filepath: StringProperty(subtype="FILE_PATH")  # type: ignore

    def invoke(self, context, event):
        self.filepath = (context.scene.everloom.name or "everloom") + ".glb"
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}

    def execute(self, context):
        s = context.scene.everloom
        problems, _n, objs, arm = check(context, s.kind)
        if problems:
            self.report({"ERROR"}, problems[0])
            return {"CANCELLED"}
        export_glb(self.filepath, objs + ([arm] if arm and arm not in objs else []), s.kind)
        self.report({"INFO"}, "Saved " + os.path.basename(self.filepath))
        return {"FINISHED"}


class EVERLOOM_OT_send(bpy.types.Operator):
    bl_idname = "everloom.send"
    bl_label = "Send to my Everloom"
    bl_description = "Export and upload to your Everloom server"

    def execute(self, context):
        s = context.scene.everloom
        problems, _n, objs, arm = check(context, s.kind)
        if problems:
            self.report({"ERROR"}, problems[0])
            return {"CANCELLED"}
        path = os.path.join(tempfile.mkdtemp(prefix="everloom-"), "export.glb")
        try:
            export_glb(path, objs + ([arm] if arm and arm not in objs else []), s.kind)
            with open(path, "rb") as f:
                data = f.read()
            q = {"kind": s.kind, "name": s.name or (arm.name if arm else "Untitled")}
            if s.kind == "garment":
                q.update({"avatar": s.avatar, "slot": s.slot})
            r = request(context, "/api/addon/upload", data, q)
            self.report({"INFO"}, f"Sent. Open {prefs(context).server.rstrip('/')}{r.get('open', '')}")
        except Exception as e:  # noqa: BLE001
            self.report({"ERROR"}, str(e))
            return {"CANCELLED"}
        finally:
            try:
                os.remove(path)
                os.rmdir(os.path.dirname(path))
            except OSError:
                pass
        return {"FINISHED"}


class EVERLOOM_OT_refresh(bpy.types.Operator):
    bl_idname = "everloom.refresh"
    bl_label = "Refresh avatars"
    bl_description = "List your avatars from Everloom (for garments)"

    def execute(self, context):
        global _avatars
        try:
            items = request(context, "/api/addon/avatars")
            _avatars = [(a["id"], a["name"], "") for a in items] or [("", "(no avatars yet)", "")]
            self.report({"INFO"}, f"{len(items)} avatars")
        except Exception as e:  # noqa: BLE001
            self.report({"ERROR"}, str(e))
            return {"CANCELLED"}
        return {"FINISHED"}


class EVERLOOM_PT_panel(bpy.types.Panel):
    bl_label = "Everloom"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Everloom"

    def draw(self, context):
        s = context.scene.everloom
        col = self.layout.column()
        col.prop(s, "kind")
        col.prop(s, "name")
        if s.kind == "garment":
            row = col.row(align=True)
            row.prop(s, "avatar")
            row.operator("everloom.refresh", text="", icon="FILE_REFRESH")
            col.prop(s, "slot")
        col.operator("everloom.check", icon="CHECKMARK")
        if s.report:
            r = json.loads(s.report)
            for p in r.get("problems", []):
                col.label(text=p, icon="ERROR")
            for n in r.get("notes", []):
                col.label(text=n, icon="INFO")
        col.separator()
        col.operator("everloom.save", icon="EXPORT")
        col.operator("everloom.send", icon="URL")


CLASSES = (EverloomPrefs, EverloomSettings, EVERLOOM_OT_check, EVERLOOM_OT_save, EVERLOOM_OT_send, EVERLOOM_OT_refresh, EVERLOOM_PT_panel)


def register():
    for c in CLASSES:
        bpy.utils.register_class(c)
    bpy.types.Scene.everloom = bpy.props.PointerProperty(type=EverloomSettings)


def unregister():
    del bpy.types.Scene.everloom
    for c in reversed(CLASSES):
        bpy.utils.unregister_class(c)
