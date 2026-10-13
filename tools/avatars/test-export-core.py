"""Synthetic flat constraint rig regression. No third-party assets.
Run with Blender --background --factory-startup --python this.py -- output.glb
"""
import importlib.util
import json
import os
import struct
import sys
import bpy
from mathutils import Matrix, Quaternion, Vector

root = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
spec = importlib.util.spec_from_file_location('export_core', os.path.join(root, 'tools/blender-addon/everloom/export_core.py'))
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)
output = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
data = bpy.data.armatures.new('Rig')
arm = bpy.data.objects.new('Rig', data)
bpy.context.collection.objects.link(arm)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
root_bone = data.edit_bones.new('root')
root_bone.head, root_bone.tail = (0, 0, 0), (0, 0, .1)
links = {'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck'}
for side in ('.L', '.R'):
    for child, parent in [('shoulder', 'chest'), ('arm', 'shoulder' + side), ('forearm', 'arm' + side), ('hand', 'forearm' + side), ('leg', 'hips'), ('shin', 'leg' + side), ('foot', 'shin' + side)]:
        links[child + side] = parent
for i, (name, parent) in enumerate(links.items()):
    for prefix in ('tgt-', 'def-'):
        bone = data.edit_bones.new(prefix + name)
        bone.head, bone.tail = (.02 * i, 0, .1 + .05 * i), (.02 * i, 0, .15 + .05 * i)
        bone.parent = data.edit_bones['tgt-' + parent] if prefix == 'tgt-' and parent else root_bone
        bone.use_deform = prefix == 'def-'
bpy.ops.object.mode_set(mode='OBJECT')
for name in links:
    c = arm.pose.bones['def-' + name].constraints.new('COPY_TRANSFORMS')
    c.target, c.subtarget = arm, 'tgt-' + name
# Non-unit, rotated object transform catches double transform and inverse-bind mistakes.
arm.scale = (2, 2, 2)
arm.rotation_euler = (.2, -.1, .3)
bpy.ops.mesh.primitive_cube_add(size=.1, location=(0, 0, .2))
mesh = bpy.context.object
mod = mesh.modifiers.new('Skin', 'ARMATURE')
mod.object = arm
mesh.vertex_groups.new(name='def-spine').add(list(range(len(mesh.data.vertices))), 1, 'REPLACE')
rest = {b.name: b.matrix_local.copy() for b in data.bones}
# export_model reshapes the scene it is given (the add-on runs it on a saved copy: export_copy).
report = core.export_model(output)
# Every deform bone but the hips hung from the control root; the hips become the root.
assert report['reparentedDeformBones'] >= len(links) - 1, report
assert report['unweightedVertices'] == 0, report
assert report['check']['ok'], report['check']
# The deform bones (and the root, which deforms by default); the tgt- control bones are gone.
assert report['exportedJoints'] == len(links) + 1, report
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
assert not any(b.name.startswith('tgt-') for b in rig.data.bones)
for bone in rig.data.bones:
    assert max(abs(a - b) for ra, rb in zip(rest[bone.name], bone.matrix_local) for a, b in zip(ra, rb)) < 1e-5, bone.name
with open(output, 'rb') as f:
    raw = f.read()
n = struct.unpack_from('<I', raw, 12)[0]
gltf = json.loads(raw[20:20+n])
binary = raw[28+n:]
nodes = gltf['nodes']
parents = {c: i for i, node in enumerate(nodes) for c in node.get('children', [])}
index = {node.get('name'): i for i, node in enumerate(nodes)}
for child, parent in links.items():
    if parent:
        assert parents[index['def-' + child]] == index['def-' + parent], child
def world(i):
    node = nodes[i]
    if 'matrix' in node:
        m = Matrix([node['matrix'][j:j+4] for j in range(0, 16, 4)]).transposed()
    else:
        q = node.get('rotation', [0, 0, 0, 1])
        m = Matrix.LocRotScale(Vector(node.get('translation', [0, 0, 0])), Quaternion((q[3], *q[:3])), Vector(node.get('scale', [1, 1, 1])))
    return world(parents[i]) @ m if i in parents else m
for skin in gltf['skins']:
    accessor = gltf['accessors'][skin['inverseBindMatrices']]
    view = gltf['bufferViews'][accessor['bufferView']]
    offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    for j, joint in enumerate(skin['joints']):
        values = struct.unpack_from('<16f', binary, offset + 64 * j)
        inverse = Matrix([values[k:k+4] for k in range(0, 16, 4)]).transposed()
        product = world(joint) @ inverse
        assert max(abs(product[r][c] - float(r == c)) for r in range(4) for c in range(4)) < 1e-4, nodes[joint].get('name')
print('EXPORT_CONTRACT_OK', json.dumps(report))
