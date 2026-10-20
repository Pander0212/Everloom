#!/usr/bin/env python3
"""
Upgrades a first-generation puppet (docs/puppets.md: puppet.json + pages) to a full-body Puppets v2
character pack. The v1 puppet itself is left as it is (it keeps working on its own runtime); this
makes a new full-body character from the same art:

  1. renders the v1 puppet's rest pose from its meshes and pages, without clothes (the body) and
     with them (its outfit), and once per face variant it has (closed eyes, smile, mouth shapes,
     blush), all on the same canvas;
  2. runs the decomposition on them (tools/puppets2/decompose.py: keypoints, limb split, caps,
     gates, contact sheet), which writes the pack.

    python3 tools/puppets2/from_v1.py path/to/puppet.json --out samples/gen/puppets2/<name> [--keypoints kp.json] [--zip]

The v1 picture's arms are its "relaxed" arms; other arm poses are not needed (v2 bends the arms).
"""
import argparse
import json
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
CLOTHES = ('top', 'bottom', 'sleeve.')
EYES_OPEN = ('eye.l.white', 'eye.r.white', 'eye.l.iris', 'eye.r.iris', 'eye.l.lash', 'eye.r.lash')
VARIANT_SLOTS = ('eye.l.half', 'eye.r.half', 'eye.l.closed', 'eye.r.closed', 'eye.l.smile', 'eye.r.smile', 'mouth.', 'blush')
# v2 variant → (slots shown instead of the open eyes / with the base)
VARIANTS = {
    'eyes_closed': (('eye.l.closed', 'eye.r.closed'), True),
    'smile': (('eye.l.smile', 'eye.r.smile', 'mouth.smile'), True),
    'mouth_a': (('mouth.open',), False), 'mouth_i': (('mouth.i',), False), 'mouth_u': (('mouth.u',), False),
    'mouth_e': (('mouth.e',), False), 'mouth_o': (('mouth.o',), False),
    'blush': (('blush',), False),
}


def base_slot(slot):
    """Parts of the rest picture: relaxed arms, open eyes, no variant faces."""
    if ':' in slot and not slot.endswith(':relaxed'):
        return False
    return not any(slot.startswith(v) for v in VARIANT_SLOTS)


def render(model, pages, select):
    W, H = model['canvas']['width'], model['canvas']['height']
    out = np.zeros((H, W, 4), np.float32)
    for part in sorted(model['parts'], key=lambda p: p.get('z', 0)):
        if not select(part['slot']) or part.get('opacity', 1) <= 0:
            continue
        page = pages[part['texture']]
        ph, pw = page.shape[:2]
        pos = np.array(part['mesh']['positions'], np.float32).reshape(-1, 2)
        uv = np.array(part['mesh']['uvs'], np.float32).reshape(-1, 2) * [pw, ph]
        idx = np.array(part['mesh']['indices']).reshape(-1, 3)
        layer = np.zeros((H, W, 4), np.float32)
        for tri in idx:
            dst, src = pos[tri], uv[tri]
            x0, y0 = np.floor(dst.min(axis=0)).astype(int)
            x1, y1 = np.ceil(dst.max(axis=0)).astype(int) + 1
            x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
            if x1 <= x0 or y1 <= y0:
                continue
            M = cv2.getAffineTransform(src.astype(np.float32), (dst - [x0, y0]).astype(np.float32))
            patch = cv2.warpAffine(page, M, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            mask = np.zeros((y1 - y0, x1 - x0), np.uint8)
            cv2.fillConvexPoly(mask, np.round((dst - [x0, y0]) * 16).astype(np.int32), 1, lineType=cv2.LINE_8, shift=4)
            # Triangles share edges: grow each by a pixel so the mesh has no cracks.
            mask = cv2.dilate(mask, np.ones((2, 2), np.uint8))
            sel = mask > 0
            layer[y0:y1, x0:x1][sel] = patch[sel]
        a = layer[:, :, 3:4] / 255.0
        out[:, :, :3] = layer[:, :, :3] * a + out[:, :, :3] * (1 - a)
        out[:, :, 3:4] = 255 * (a + out[:, :, 3:4] / 255.0 * (1 - a))
    return out.clip(0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('puppet')
    ap.add_argument('--out', required=True)
    ap.add_argument('--keypoints')
    ap.add_argument('--zip', action='store_true')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--stylized', action='store_true', help='all-ages, big-headed art (see decompose.py)')
    a = ap.parse_args()
    model = json.load(open(a.puppet))
    folder = os.path.dirname(os.path.abspath(a.puppet))
    pages = [np.array(Image.open(os.path.join(folder, t)).convert('RGBA')) for t in model['textures']]
    src = os.path.join(a.out, 'v1-render')
    os.makedirs(src, exist_ok=True)
    slots = {p['slot'] for p in model['parts']}
    body = render(model, pages, lambda s: base_slot(s) and not s.startswith(CLOTHES))
    dressed = render(model, pages, base_slot)
    Image.fromarray(body).save(os.path.join(src, 'body.png'))
    Image.fromarray(dressed).save(os.path.join(src, 'dressed.png'))
    args = [sys.executable, os.path.join(HERE, 'decompose.py'), '--image', os.path.join(src, 'body.png'), '--out', a.out,
            '--name', model.get('name', 'Puppet'), '--rating', model.get('rating', 'all-ages')]
    if not np.array_equal(body, dressed):
        args += ['--outfit-image', f"default={os.path.join(src, 'dressed.png')}"]
    for name, (show, replaces_eyes) in VARIANTS.items():
        if not all(s in slots for s in show):
            continue
        pic = render(model, pages, lambda s, show=show, rep=replaces_eyes: (base_slot(s) and not s.startswith(CLOTHES) and not (rep and s in EYES_OPEN)) or s in show)
        Image.fromarray(pic).save(os.path.join(src, f'{name}.png'))
        args += ['--variant', f"{name}={os.path.join(src, f'{name}.png')}"]
    if a.keypoints:
        args += ['--keypoints', a.keypoints]
    if a.zip:
        args.append('--zip')
    if a.force:
        args.append('--force')
    if a.stylized:
        args.append('--stylized')
    print('rendered', len([x for x in args if x.startswith('--variant')]), 'variants; decomposing…')
    sys.exit(subprocess.call(args))


if __name__ == '__main__':
    main()
