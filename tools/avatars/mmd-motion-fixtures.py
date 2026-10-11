"""
Small MMD motion test files (our own, CC0): a VMD wave and a VPD pose, with the standard Japanese
bone names in Shift-JIS as MikuMikuDance writes them.

    python3 tools/avatars/mmd-motion-fixtures.py tests/fixtures/avatars/motions
"""
import math, os, struct, sys

out = sys.argv[1]
os.makedirs(out, exist_ok=True)


def q_axis(axis, deg):
    s, c = math.sin(math.radians(deg) / 2), math.cos(math.radians(deg) / 2)
    return tuple(a * s for a in axis) + (c,)


def sjis(text, size):
    b = text.encode('shift_jis')
    return b[:size].ljust(size, b'\0')


# Linear interpolation curves (MMD stores Bezier control points per channel).
LINEAR = bytes([20, 20, 0, 0, 20, 20, 20, 20, 107, 107, 107, 107, 107, 107, 107, 107] * 4)

Z = (0, 0, 1)
X = (1, 0, 0)
keys = []  # (bone, frame, position, quaternion)
for f in (0, 60):
    keys.append(('センター', f, (0, 0, 0), (0, 0, 0, 1)))
keys.append(('センター', 30, (0, -0.3, 0), (0, 0, 0, 1)))
# Left arm up, forearm waving (30 fps: two seconds).
keys += [('左腕', 0, (0, 0, 0), (0, 0, 0, 1)), ('左腕', 12, (0, 0, 0), q_axis(Z, 70)), ('左腕', 48, (0, 0, 0), q_axis(Z, 70)), ('左腕', 60, (0, 0, 0), (0, 0, 0, 1))]
for i, f in enumerate(range(12, 49, 6)):
    keys.append(('左ひじ', f, (0, 0, 0), q_axis(Z, 35 if i % 2 else 70)))
keys += [('左ひじ', 0, (0, 0, 0), (0, 0, 0, 1)), ('左ひじ', 60, (0, 0, 0), (0, 0, 0, 1))]
keys += [('首', 0, (0, 0, 0), (0, 0, 0, 1)), ('首', 30, (0, 0, 0), q_axis(X, 10)), ('首', 60, (0, 0, 0), (0, 0, 0, 1))]

vmd = bytearray(sjis('Vocaloid Motion Data 0002', 30) + sjis('Everloom test', 20))
vmd += struct.pack('<I', len(keys))
for bone, frame, pos, rot in keys:
    vmd += sjis(bone, 15) + struct.pack('<I3f4f', frame, *pos, *rot) + LINEAR
vmd += struct.pack('<4I', 0, 0, 0, 0)  # morphs, cameras, lights, self-shadow
open(os.path.join(out, 'wave.vmd'), 'wb').write(vmd)

pose = [('左腕', q_axis(Z, 80)), ('右腕', q_axis(Z, -80)), ('左ひじ', q_axis(Z, 60)), ('右ひじ', q_axis(Z, -60)), ('首', q_axis(X, -8))]
lines = ['Vocaloid Pose Data file', '', 'everloom.osm;\t\t// 親ファイル名', f'{len(pose)};\t\t\t\t// 総ポーズボーン数', '']
for i, (bone, q) in enumerate(pose):
    lines += [f'Bone{i}{{{bone}', '  0.000000,0.000000,0.000000;\t\t\t\t// trans x,y,z', '  ' + ','.join(f'{v:.6f}' for v in q) + ';\t\t// Quaternion x,y,z,w', '}', '']
open(os.path.join(out, 'hands-up.vpd'), 'wb').write('\r\n'.join(lines).encode('shift_jis'))
print('MMD_OK')
