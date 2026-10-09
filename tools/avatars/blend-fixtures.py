"""
Real .blend test files (CC0, from Everloom's own morph-base.glb): an armature, shape keys and several
materials; one also with modifiers and an animation. Saved by whichever Blender runs this.

    blender -b --factory-startup -P tools/avatars/blend-fixtures.py -- <morph-base.glb> <out.blend> [--compress] [--extras]
"""
import bpy, sys

args = sys.argv[sys.argv.index('--') + 1:]
src, out = args[0], args[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name.startswith('Icosphere'):
        bpy.data.objects.remove(o, do_unlink=True)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = bpy.data.objects['Body']
# Several materials on the body: split by height into two material slots.
m2 = bpy.data.materials.new('Body_Lower')
body.data.materials.append(m2)
for p in body.data.polygons:
    if (body.matrix_world @ p.center).z < 0.0:
        p.material_index = len(body.data.materials) - 1
if '--extras' in args:
    # Modifiers (applied on export) and a short action.
    bpy.ops.mesh.primitive_cube_add(size=0.1, location=(0.2, 0, 1.6))
    cube = bpy.context.active_object
    cube.name = 'Badge'
    cube.modifiers.new('Bevel', 'BEVEL').width = 0.01
    m = cube.modifiers.new('Mirror', 'MIRROR')
    m.use_axis[0] = True
    cube.parent = arm
    cube.parent_type = 'BONE'
    cube.parent_bone = 'head'
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    pb = arm.pose.bones['upperarm_l']
    for f, z in ((1, 0), (12, 0.6), (24, 0)):
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (0, 0, z)
        pb.keyframe_insert('rotation_euler', frame=f)
    arm.animation_data.action.name = 'Wave'
    bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.wm.save_as_mainfile(filepath=out, compress='--compress' in args)
print('BLEND_OK', bpy.app.version_string)
