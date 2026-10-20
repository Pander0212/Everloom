#!/usr/bin/env python3
"""
Cuts a studio edit into a paper-doll layer: the pixels that differ from the base picture, as a
transparent PNG at the base's size. A hairstyle, an expression or an outfit generated once on the
base can then be stacked on every body variant of that base (same head, same pose).

    python3 tools/studio/layers.py BASE EDIT OUT.png [--region MASK] [--threshold 9] [--backdrop]
    python3 tools/studio/layers.py --compose BODY LAYER [LAYER ...] OUT.png
    python3 tools/studio/layers.py --key PICTURE OUT.png    (backdrop made transparent)

--region limits the layer to a mask (white = may belong to the layer), e.g. the face mask for an
expression. Pixels the edit turned into plain backdrop are left out (they would paint grey over the
body), unless --backdrop is given.
"""
import argparse

import cv2
import numpy as np
from PIL import Image


def lab(im):
    return cv2.cvtColor(np.asarray(im.convert('RGB'), dtype=np.float32) / 255, cv2.COLOR_RGB2LAB)


def backdrop_color(lb):
    corners = np.concatenate([lb[:16, :16], lb[:16, -16:], lb[-16:, :16], lb[-16:, -16:]]).reshape(-1, 3)
    return np.median(corners, axis=0)


def layer(base, edit, region=None, threshold=9.0, keep_backdrop=False):
    """RGBA layer of what `edit` changed on `base` (both the same size)."""
    if edit.size != base.size:
        edit = edit.resize(base.size, Image.LANCZOS)
    lb, le = lab(base), lab(edit)
    diff = np.linalg.norm(le - lb, axis=2)
    changed = (diff > threshold).astype(np.uint8)
    # Upscaled and re-encoded pictures differ a little everywhere: drop specks, close small gaps.
    changed = cv2.morphologyEx(changed, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    changed = cv2.morphologyEx(changed, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    # Keep only sizeable pieces (a hairstyle or a garment is a few large parts, noise is many tiny ones).
    n, lab_ids, stats, _ = cv2.connectedComponentsWithStats(changed, 8)
    keep = np.zeros_like(changed)
    min_area = max(60, changed.size // 4000)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            keep[lab_ids == i] = 1
    if not keep_backdrop:
        bg = backdrop_color(lb)
        keep[np.linalg.norm(le - bg, axis=2) < 6] = 0
    if region is not None:
        keep &= (np.asarray(region.convert('L').resize(base.size)) > 127).astype(np.uint8)
    # Soft edge, so the layer blends into whatever body it sits on.
    a = cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 1.0)
    a = np.clip(a * 1.6, 0, 1)
    rgba = np.dstack([np.asarray(edit.convert('RGB')), (a * 255).astype(np.uint8)])
    return Image.fromarray(rgba, 'RGBA')


def key_backdrop(im, tolerance=7.0):
    """The picture with its plain backdrop made transparent (backdrop-coloured pixels connected to
    the border), for tools that expect a cut-out figure (the Puppets v2 decomposition)."""
    l = lab(im)
    near = (np.linalg.norm(l - backdrop_color(l), axis=2) < tolerance).astype(np.uint8)
    n, ids = cv2.connectedComponents(near, connectivity=4)
    border = set(np.unique(np.concatenate([ids[0], ids[-1], ids[:, 0], ids[:, -1]]))) - {0}
    bg = np.isin(ids, list(border))
    a = cv2.GaussianBlur((~bg).astype(np.float32), (0, 0), 0.8)
    return Image.fromarray(np.dstack([np.asarray(im.convert('RGB')), (np.clip(a * 1.5, 0, 1) * 255).astype(np.uint8)]), 'RGBA')


def compose(body, layers):
    out = body.convert('RGBA')
    for l in layers:
        out = Image.alpha_composite(out, l.convert('RGBA').resize(out.size, Image.LANCZOS))
    return out.convert('RGB')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('paths', nargs='+')
    ap.add_argument('--region')
    ap.add_argument('--threshold', type=float, default=9.0)
    ap.add_argument('--backdrop', action='store_true')
    ap.add_argument('--compose', action='store_true')
    ap.add_argument('--key', action='store_true', help='IN OUT.png: make the plain backdrop transparent')
    a = ap.parse_args()
    if a.key:
        key_backdrop(Image.open(a.paths[0])).save(a.paths[1])
    elif a.compose:
        *ins, out = a.paths
        compose(Image.open(ins[0]), [Image.open(p) for p in ins[1:]]).save(out)
    else:
        base, edit, out = a.paths
        region = Image.open(a.region) if a.region else None
        layer(Image.open(base), Image.open(edit), region, a.threshold, a.backdrop).save(out)


if __name__ == '__main__':
    main()
