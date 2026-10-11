"""
Collada and OBJ+MTL test files from Everloom's CC0 models, so the importer is tested against real
exporter output. Needs a Blender with the Collada exporter (4.x; Blender 5 dropped it).

    blender -b --factory-startup -P tools/avatars/format-fixtures.py -- \
        tests/fixtures/models/robot-expressive.glb tests/fixtures/avatars/models/morph-base.glb <out-dir>

- robot.obj + robot.mtl: the RobotExpressive robot as a static OBJ with its materials.
- body.dae: the skinned test body (armature, weights, eyes). The robot isn't used for Collada:
  Blender's exporter mangles its bone-parented parts and scaled armature (and crashes when they're
  rebound), which says more about that exporter than about our importer.
"""
import bpy, os, sys

robot, body, out = sys.argv[sys.argv.index('--') + 1:]
os.makedirs(out, exist_ok=True)


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)


load(robot)
bpy.ops.wm.obj_export(filepath=os.path.join(out, 'robot.obj'), export_materials=True, export_uv=True, export_normals=True)
load(body)
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name.startswith('Icosphere'):
        bpy.data.objects.remove(o, do_unlink=True)
# Without shape keys: with them Collada writes every key as a full mesh (about 96 MB).
bpy.ops.wm.collada_export(filepath=os.path.join(out, 'body.dae'), include_animations=False, include_shapekeys=False)
print('FORMATS_OK', bpy.app.version_string)
