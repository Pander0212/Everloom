#!/usr/bin/env python3
"""
Expression parts from edits (docs/puppets.md › Making a template or a character, step 4): the eyes
and mouth of each expression edit (Step Image Edit 2 on the picture that was layered, so the same
size and pose), cut around the face landmarks and placed in the puppet's canvas, replacing the
drawn-in placeholders.

    python3 tools/puppets/expressions.py <parts dir> <layered picture> <See-through src_img.png> \
        closed=<edit> smile=<edit> a=<edit> o=<edit> [...]

<parts dir> is a map.py output (parts.json, landmarks.json); the parts are added to it:
closed → eye.l/r.closed; smile → eye.l/r.smile and mouth.smile; a → mouth.wide and mouth.open;
o → mouth.o and mouth.u; e/i → mouth.e/mouth.i. Edits not given keep the placeholders.

The layered picture and the See-through canvas differ by a scale and an offset (See-through pads
to a square and resizes); both are measured by matching the figure's outline.
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image


def alpha_box(a, thr=24):
    ys, xs = np.nonzero(a > thr)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def transform(layered, src):
    """Scale and offset taking the layered picture's pixels to See-through's canvas."""
    la = np.asarray(layered.convert('RGBA'))[..., 3]
    sa = np.asarray(src.convert('RGBA'))[..., 3]
    if la.min() > 250:  # no transparency in the input: compare against the canvas's figure only
        raise SystemExit('give the keyed (transparent) picture that went to See-through')
    l0 = alpha_box(la)
    s0 = alpha_box(sa)
    k = ((s0[2] - s0[0]) / (l0[2] - l0[0]) + (s0[3] - s0[1]) / (l0[3] - l0[1])) / 2
    return k, s0[0] - l0[0] * k, s0[1] - l0[1] * k


def soft_ellipse(W, H, cx, cy, rx, ry, feather=0.25):
    yy, xx = np.mgrid[0:H, 0:W]
    r = np.hypot((xx - cx) / rx, (yy - cy) / ry)
    return np.clip((1 - r) / feather, 0, 1)


def main(parts_dir, layered_path, src_path, edits):
    spec = json.load(open(os.path.join(parts_dir, 'parts.json')))
    L = json.load(open(os.path.join(parts_dir, 'landmarks.json')))
    W, H = L['canvas']
    layered = Image.open(layered_path)
    k, ox, oy = transform(layered, Image.open(src_path))
    M = np.float32([[k, 0, ox], [0, k, oy]])

    def to_canvas(path):
        im = np.asarray(Image.open(path).convert('RGB'))
        if im.shape[:2] != (layered.height, layered.width):
            im = cv2.resize(im, (layered.width, layered.height), interpolation=cv2.INTER_AREA)
        return cv2.warpAffine(im, M, (W, H), flags=cv2.INTER_AREA)

    def part(rgb, mask):
        a = np.dstack([rgb, (mask * 255).astype(np.uint8)])
        a[mask <= 0.004] = 0
        return a

    R = L['head']['r']
    eyes = {'l': L['eyeL'], 'r': L['eyeR']}
    m = L['mouth']
    mw = m['w'] / 2.2  # map.py stores the mouth's warp width; the mouth itself is about this wide

    def eye_mask(e):
        return soft_ellipse(W, H, e['cx'], e['cy'], e['w'] * 0.72, e['h'] * 0.85)

    def mouth_mask(scale=1.0):
        return soft_ellipse(W, H, m['cx'], m['cy'] + mw * 0.25, max(mw * 1.5, R * 0.22) * scale, max(mw * 1.1, R * 0.16) * scale)

    out = {}
    for name, path in edits.items():
        rgb = to_canvas(path)
        if name in ('closed', 'smile'):
            for s, e in eyes.items():
                out[f'eye.{s}.{"closed" if name == "closed" else "smile"}'] = part(rgb, eye_mask(e))
        if name == 'smile':
            out['mouth.smile'] = part(rgb, mouth_mask())
        if name == 'a':
            out['mouth.wide'] = part(rgb, mouth_mask(1.1))
            out['mouth.open'] = part(rgb, mouth_mask(1.1))
        if name == 'o':
            out['mouth.o'] = part(rgb, mouth_mask())
            out['mouth.u'] = part(rgb, mouth_mask())
        if name in ('e', 'i'):
            out[f'mouth.{name}'] = part(rgb, mouth_mask())

    # Replace the placeholders for the slots we have drawings for.
    keep = [p for p in spec['parts'] if p['slot'] not in out]
    for slot, a in out.items():
        pid = 'x-' + slot.replace('.', '-')
        f = f'{pid}.png'
        Image.fromarray(a, 'RGBA').save(os.path.join(parts_dir, f))
        keep.append({'id': pid, 'slot': slot, 'file': f})
    spec['parts'] = keep
    json.dump(spec, open(os.path.join(parts_dir, 'parts.json'), 'w'), indent=1)
    print(f'{parts_dir}: {len(out)} expression parts ({", ".join(sorted(out))}); scale {k:.4f}, offset ({ox:.1f}, {oy:.1f})')


if __name__ == '__main__':
    if len(sys.argv) < 5:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3], dict(a.split('=', 1) for a in sys.argv[4:]))
