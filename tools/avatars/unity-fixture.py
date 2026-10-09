"""
Builds the FBX files of Everloom's own Unity test package (CC0, from Everloom's test models):
an avatar like a VRChat one (Japanese bone names in places, hair bones, VRChat viseme shape keys,
a hat to toggle) and a jacket made for it whose bones carry a prefix (as Modular Avatar outfits
often do).

    blender -b --factory-startup -P tools/avatars/unity-fixture.py -- <models dir> <out dir>
"""
import bpy, sys, os
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
models, out = args[0], args[1]
os.makedirs(out, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def drop_helpers():
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.name.startswith('Icosphere'):
            bpy.data.objects.remove(o, do_unlink=True)


def export(path):
    bpy.ops.export_scene.fbx(filepath=path, use_selection=False, add_leaf_bones=False, bake_anim=False, apply_scale_options='FBX_SCALE_UNITS', mesh_smooth_type='FACE', use_mesh_modifiers=False, axis_forward='-Z', axis_up='Y')


# ---------------------------------------------------------------- the avatar
reset()
bpy.ops.import_scene.gltf(filepath=os.path.join(models, 'morph-base.glb'))
drop_helpers()
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = bpy.data.objects['Body']
arm.name = 'Armature'

# Hair: a three-bone chain at the back of the head, and a skirt-like ribbon at the hips.
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
head = eb['head']
top = head.tail.copy()
prev = head
for i in range(3):
    b = eb.new(f'Hair_Back_{i + 1}')
    b.head = top + Vector((0, 0.06, -0.05 * i)) if i == 0 else prev.tail.copy()
    b.tail = b.head + Vector((0, 0.02, -0.07))
    b.parent = prev
    b.use_connect = i > 0
    prev = b
# Some bones under Japanese names, as on many VRChat bases.
eb['spine_01'].name = '上半身'
eb['neck_01'].name = '首'
bpy.ops.object.mode_set(mode='OBJECT')

# VRChat viseme shape keys (small jaw and lip moves), next to the body's own.
basis = body.data.shape_keys.key_blocks['Basis']
jaw = body.data.shape_keys.key_blocks['jawOpen']
for name, w in [('vrc.v_aa', 1.0), ('vrc.v_ih', 0.4), ('vrc.v_ou', 0.5), ('vrc.v_e', 0.6), ('vrc.v_oh', 0.8)]:
    k = body.shape_key_add(name=name, from_mix=False)
    for i, p in enumerate(jaw.data):
        k.data[i].co = basis.data[i].co.lerp(p.co, w)

# A hat on the head bone (switched off in the prefab, a toggle turns it on).
bpy.ops.mesh.primitive_cylinder_add(radius=0.11, depth=0.08, location=(0, 0, 0))
hat = bpy.context.active_object
hat.name = 'Hat'
hat.parent = arm
hat.parent_type = 'BONE'
hat.parent_bone = 'head'
hat.location = (0, 0.12, 0)
mat = bpy.data.materials.new('Hat')
hat.data.materials.append(mat)
export(os.path.join(out, 'Ava.fbx'))

# ---------------------------------------------------------------- a shirt made for that avatar
# Like a BOOTH outfit, it's modelled on the avatar's own body: the torso and arms, a little bigger,
# on a copy of the avatar's armature whose bones carry a prefix (as Modular Avatar outfits often do).
# It keeps the body's shape keys, so it follows the avatar's body shape (Blendshape Sync).
import bmesh
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name != 'Body':
        bpy.data.objects.remove(o, do_unlink=True)
body = bpy.data.objects['Body']
body.name = 'Shirt'
body.data.name = 'Shirt'
keep = ('上半身', 'spine_02', 'spine_03', 'clavicle', 'upperarm', 'breast', 'pelvis')
groups = {g.index: g.name for g in body.vertex_groups}
bm = bmesh.new()
bm.from_mesh(body.data)
deform = bm.verts.layers.deform.active
drop = []
for v in bm.verts:
    w = v[deform] if deform else {}
    best = max(w.items(), key=lambda kv: kv[1])[0] if w else None
    name = groups.get(best, '')
    if not any(name.startswith(k) for k in keep) or (name == 'pelvis' and v.co.z < 0.92):
        drop.append(v)
bmesh.ops.delete(bm, geom=drop, context='VERTS')
for v in bm.verts:
    v.co += v.normal * 0.012
bm.to_mesh(body.data)
bm.free()
body.data.materials.clear()
body.data.materials.append(bpy.data.materials.new('Shirt'))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for b in arm.data.bones:
    b.name = 'Outfit_' + b.name
export(os.path.join(out, 'Shirt.fbx'))
print('UNITY_FIXTURE_OK')
