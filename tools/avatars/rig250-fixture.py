"""
A VRChat-style test avatar with about 250 bones (CC0, from Everloom's own morph-base.glb): a
five-bone spine, breast and butt bones, twist helpers, 30 hair strands, 14 skirt panels and a
tail, each with simple meshes skinned to them, plus a few accessories and end bones.

    blender -b --factory-startup -P tools/avatars/rig250-fixture.py -- tests/fixtures/avatars/models/morph-base.glb tests/fixtures/avatars/models/rig250.glb
"""
import bpy, bmesh, math, sys
from mathutils import Vector

src, out = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name.startswith('Icosphere'):
        bpy.data.objects.remove(o, do_unlink=True)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = bpy.data.objects['Body']
arm.name = 'Armature'

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones

def W(name):
    """World-space head of an edit bone (the armature has no transform after import)."""
    return arm.matrix_world @ eb[name].head

def bone(name, parent, head, tail, connect=False):
    b = eb.new(name)
    inv = arm.matrix_world.inverted()
    b.head = inv @ Vector(head)
    b.tail = inv @ Vector(tail)
    b.parent = eb[parent] if parent else None
    b.use_connect = connect
    return b

# VRChat-style names for the core.
ren = {'pelvis': 'Hips', 'spine_01': 'Spine', 'spine_02': 'Chest', 'spine_03': 'Upper_Chest', 'neck_01': 'Neck', 'head': 'Head',
       'clavicle_l': 'Shoulder.L', 'upperarm_l': 'Upper_arm.L', 'lowerarm_l': 'Lower_arm.L', 'hand_l': 'Hand.L',
       'clavicle_r': 'Shoulder.R', 'upperarm_r': 'Upper_arm.R', 'lowerarm_r': 'Lower_arm.R', 'hand_r': 'Hand.R',
       'thigh_l': 'Upper_leg.L', 'calf_l': 'Lower_leg.L', 'foot_l': 'Foot.L', 'ball_l': 'Toes.L',
       'thigh_r': 'Upper_leg.R', 'calf_r': 'Lower_leg.R', 'foot_r': 'Foot.R', 'ball_r': 'Toes.R',
       'breast_l': 'Breast_root.L', 'breast_r': 'Breast_root.R', 'Root': 'Armature_root'}
for a, b in ren.items():
    if a in eb:
        eb[a].name = b

# Two more spine bones between Spine and Chest (five in all).
sp, ch = eb['Spine'], eb['Chest']
mid1 = sp.tail.lerp(ch.tail, 0.33)
mid2 = sp.tail.lerp(ch.tail, 0.66)
s1 = eb.new('Spine1'); s1.head = sp.tail.copy(); s1.tail = mid1; s1.parent = sp
s2 = eb.new('Spine2'); s2.head = mid1; s2.tail = mid2; s2.parent = s1
ch.head = mid2
ch.parent = s2

# Breast chains: two more bones forward of each root.
for s in ('L', 'R'):
    root = eb[f'Breast_root.{s}']
    p = root
    for i in (1, 2):
        b = eb.new(f'Breast_{i}.{s}')
        b.head = p.tail.copy()
        b.tail = b.head + (p.tail - p.head).normalized() * 0.03
        b.parent = p
        p = b

# Butt bones behind the hips (after glTF import the character faces -Y: behind is +Y).
hips = W('Hips')
for s, x in (('L', 1), ('R', -1)):
    bone(f'Butt.{s}', 'Hips', (hips.x + 0.07 * x, hips.y + 0.03, hips.z - 0.02), (hips.x + 0.07 * x, hips.y + 0.08, hips.z - 0.04))
    bone(f'Butt_end.{s}', f'Butt.{s}', (hips.x + 0.07 * x, hips.y + 0.08, hips.z - 0.04), (hips.x + 0.07 * x, hips.y + 0.10, hips.z - 0.04), True)

# Twist helpers.
for s in ('L', 'R'):
    ua = eb[f'Upper_arm.{s}']
    t = eb.new(f'UpperArm_Twist.{s}'); t.head = ua.head.lerp(ua.tail, 0.5); t.tail = ua.tail.copy(); t.parent = ua
    la = eb[f'Lower_arm.{s}']
    t = eb.new(f'LowerArm_Twist.{s}'); t.head = la.head.lerp(la.tail, 0.5); t.tail = la.tail.copy(); t.parent = la
    th = eb[f'Upper_leg.{s}']
    t = eb.new(f'Thigh_Twist.{s}'); t.head = th.head.lerp(th.tail, 0.5); t.tail = th.tail.copy(); t.parent = th

# Hair: 30 strands of 4 bones around the back and sides of the head.
headtop = W('Head') + Vector((0, 0, 0.17))
strands = []
for i in range(30):
    a = (i / 29) * math.pi * 1.5 - math.pi * 0.75
    start = headtop + Vector((math.sin(a) * 0.09, math.cos(a) * 0.06, -0.04))
    names = []
    p = 'Head'
    at = start
    for j in range(4):
        n = f'Hair_{i:02d}_{j + 1}'
        nxt = at + Vector((math.sin(a) * 0.015, math.cos(a) * 0.02, -0.08))
        bone(n, p, at, nxt, j > 0)
        names.append(n)
        p, at = n, nxt
    strands.append((names, start, a))

# Skirt: 14 panels of 3 bones around the hips.
skirt = []
bone('Skirt_root', 'Hips', (hips.x, hips.y, hips.z - 0.02), (hips.x, hips.y, hips.z - 0.05))
for i in range(14):
    a = (i / 14) * math.pi * 2
    start = Vector((hips.x + math.sin(a) * 0.15, hips.y - math.cos(a) * 0.13, hips.z - 0.06))
    names = []
    p = 'Skirt_root'
    at = start
    for j in range(3):
        n = f'Skirt_{i:02d}_{j + 1}'
        nxt = at + Vector((math.sin(a) * 0.02, -math.cos(a) * 0.02, -0.1))
        bone(n, p, at, nxt, j > 0)
        names.append(n)
        p, at = n, nxt
    skirt.append((names, start, a))

# Tail: 6 bones behind the hips.
tail = []
p = 'Hips'
at = Vector((hips.x, hips.y + 0.11, hips.z - 0.05))
for j in range(6):
    n = f'Tail_{j + 1}'
    nxt = at + Vector((0, 0.07, -0.04 + j * 0.005))
    bone(n, p, at, nxt, j > 0)
    tail.append(n)
    p, at = n, nxt

# Accessories and end bones.
bone('Hat_Ribbon', 'Head', headtop, headtop + Vector((0, 0, 0.04)))
bone('Head_end', 'Head', headtop, headtop + Vector((0, 0, 0.02)))
for s in ('L', 'R'):
    h = W(f'Hand.{s}')
    bone(f'Bracelet.{s}', f'Lower_arm.{s}', h, h + Vector((0, 0, 0.02)))
bpy.ops.object.mode_set(mode='OBJECT')

def strip(name, names, start, step, width, color):
    """A thin mesh along a chain, each ring weighted to its bone."""
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    rings = []
    for j in range(len(names) + 1):
        c = start + step * j
        rings.append([bm.verts.new(c + Vector((dx, dy, 0))) for dx, dy in ((-width, -width * 0.3), (width, -width * 0.3), (width, width * 0.3), (-width, width * 0.3))])
    for j in range(len(rings) - 1):
        for k in range(4):
            bm.faces.new((rings[j][k], rings[j][(k + 1) % 4], rings[j + 1][(k + 1) % 4], rings[j + 1][k]))
    bm.to_mesh(me)
    bm.free()
    for n in names:
        ob.vertex_groups.new(name=n)
    for v in me.vertices:
        j = min(len(names) - 1, v.index // 4 - (1 if v.index // 4 == len(names) else 0))
        ob.vertex_groups[names[max(0, j)]].add([v.index], 1.0, 'REPLACE')
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    ob.parent = arm
    mat = bpy.data.materials.get(color) or bpy.data.materials.new(color)
    me.materials.append(mat)
    return ob

for names, start, a in strands:
    strip(f'HairMesh_{names[0][5:7]}', names, start, Vector((math.sin(a) * 0.015, math.cos(a) * 0.02, -0.08)), 0.012, 'Hair')
for names, start, a in skirt:
    strip(f'SkirtMesh_{names[0][6:8]}', names, start, Vector((math.sin(a) * 0.02, -math.cos(a) * 0.02, -0.1)), 0.035, 'Skirt')
strip('TailMesh', tail, Vector((hips.x, hips.y + 0.11, hips.z - 0.05)), Vector((0, 0.07, -0.03)), 0.02, 'Hair')

# The body around the butt follows the butt bones.
for s, x in (('L', 1), ('R', -1)):
    g = body.vertex_groups.new(name=f'Butt.{s}')
    c = Vector((hips.x + 0.07 * x, hips.y + 0.08, hips.z - 0.06))
    for v in body.data.vertices:
        d = (body.matrix_world @ v.co - c).length
        if d < 0.09:
            g.add([v.index], 0.6 * (1 - d / 0.09), 'ADD')

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_skins=True, export_morph=True, export_animations=False, export_yup=True)
print('RIG250_OK', len(arm.data.bones))
