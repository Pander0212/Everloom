#!/usr/bin/env python3
"""
A review sheet for a rig's cut: which pixels of the picture went to which body part. Each part is
tinted in its own colour with its outline drawn, the critical places (shoulders, armpits, hips,
crotch) are shown enlarged, and every part is shown alone on a checkerboard, so an owner can say
"move the shoulder line up", "the thigh takes too much of the hip"…

    python3 tools/puppets2/cutmap.py PICTURE RIG_DIR OUT.jpg [--view front]

RIG_DIR is decompose.py's --out (its <view>/<part>.png layers and gates file are read).
"""
import argparse
import json
import os

import cv2
import numpy as np
from PIL import Image, ImageDraw

PARTS = [  # (layer, colour, label), in drawing order: what's later covers what's earlier, so each
    # pixel shows the part that is visible there (the hidden joint fillers under the torso don't)
    ('leg_L', (190, 110, 240), 'leg L'), ('leg_R', (240, 110, 190), 'leg R'),
    ('torso', (240, 120, 70), 'torso'), ('head', (255, 214, 64), 'head'),
    ('arm_L', (70, 150, 255), 'arm L'), ('arm_R', (70, 210, 150), 'arm R'),
    ('hand_L', (40, 80, 220), 'hand L'), ('hand_R', (30, 140, 90), 'hand R'),
    ('breast_L', (255, 255, 255), 'breast L'), ('breast_R', (255, 255, 255), 'breast R'),
]


def checker(size, n=12):
    w, h = size
    y, x = np.mgrid[0:h, 0:w]
    c = (((x // n) + (y // n)) % 2) * 40 + 200
    return Image.fromarray(np.dstack([c, c, c]).astype(np.uint8))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('picture')
    ap.add_argument('rig')
    ap.add_argument('out')
    ap.add_argument('--view', default='front')
    a = ap.parse_args()
    pic = Image.open(a.picture).convert('RGBA')
    w, h = pic.size
    base = Image.alpha_composite(checker((w, h)).convert('RGBA'), pic)
    tint = np.asarray(base.convert('RGB')).astype(np.float32)
    lines = np.zeros((h, w, 3), np.uint8)
    c = json.load(open(os.path.join(a.rig, 'character.json')))
    rects = {l['id']: l['rect'] for l in c['views'][a.view]['layers']}

    def placed(name):
        """A part's layer (saved cropped to its rect) on the full picture canvas."""
        im = Image.open(os.path.join(a.rig, a.view, f'{name}.png')).convert('RGBA')
        out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        x, y = rects[name][:2]
        out.paste(im, (int(x), int(y)), im)
        return np.asarray(out)

    found = []
    for name, col, label in PARTS:
        if name not in rects or not os.path.exists(os.path.join(a.rig, a.view, f'{name}.png')):
            continue
        m = placed(name)[..., 3] > 128
        if not name.startswith('breast'):  # (breasts: soft copies over the torso, outline only)
            # Tint from the untinted picture, so a part drawn over another replaces its colour.
            tint[m] = np.asarray(base.convert('RGB')).astype(np.float32)[m] * 0.55 + np.array(col) * 0.45
            lines[m] = 0
        cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        cv2.drawContours(lines, cs, -1, col, 1)
        found.append((name, col, label, m))
    over = tint.astype(np.uint8)
    edge = lines.any(axis=2)
    over[edge] = lines[edge]
    full = Image.fromarray(over)
    # The cut lines (the owner's review handles), drawn in bright blue with their points.
    lp = os.path.join(a.rig, f'cut-lines-{a.view}.json')
    if os.path.exists(lp):
        dl = ImageDraw.Draw(full)
        for name, pts in json.load(open(lp)).items():
            dl.line([tuple(p) for p in pts], fill=(0, 90, 255), width=2)
            for p in pts:
                dl.ellipse((p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3), fill=(0, 90, 255))
    # Keypoints (from the gates file) for the close-ups.
    kp = c['views'][a.view]['keypoints']
    zooms = []
    def zoom(cx, cy, r, label):
        box = (int(max(0, cx - r)), int(max(0, cy - r)), int(min(w, cx + r)), int(min(h, cy + r)))
        z = full.crop(box).resize((300, 300), Image.NEAREST)
        ImageDraw.Draw(z).rectangle((0, 0, 299, 18), fill=(0, 0, 0))
        ImageDraw.Draw(z).text((4, 3), label, fill=(255, 255, 255))
        zooms.append(z)
    hgt = h * 0.8
    def pt(n):
        v = kp.get(n)
        return (v[0], v[1]) if v else None
    for n, label in (('shoulder_L', 'shoulder / armpit L'), ('shoulder_R', 'shoulder / armpit R'), ('hip_L', 'hip L'), ('hip_R', 'hip R'), ('pelvis', 'crotch'), ('neck', 'neck')):
        p = pt(n)
        if p:
            zoom(p[0], p[1], 0.07 * hgt, label)
    # Parts alone.
    alone = []
    for name, col, label, m in found:
        arr = placed(name)
        bb = Image.fromarray(m.astype(np.uint8) * 255).getbbox()
        if not bb:
            continue
        piece = Image.alpha_composite(checker((w, h)).convert('RGBA'), Image.fromarray(arr)).crop(bb)
        piece.thumbnail((180, 260))
        tile = Image.new('RGB', (180, 280), 'white')
        tile.paste(piece.convert('RGB'), (0, 20))
        ImageDraw.Draw(tile).text((4, 4), label, fill=col if name[:6] != 'breast' else (0, 0, 0))
        alone.append(tile)
    # Sheet: full map left, close-ups right, parts below.
    fw = 600
    fh = int(h * fw / w)
    full_s = full.resize((fw, fh), Image.LANCZOS)
    zcols = 2
    zw = zcols * 300
    rows_alone = (len(alone) + 5) // 6
    W = fw + zw
    H = max(fh, ((len(zooms) + 1) // 2) * 300) + rows_alone * 280 + 30
    sheet = Image.new('RGB', (W, H), 'white')
    sheet.paste(full_s, (0, 30))
    d = ImageDraw.Draw(sheet)
    x = 4
    for name, col, label, m in found:
        if name.startswith('breast'):
            continue
        d.rectangle((x, 8, x + 12, 20), fill=col)
        d.text((x + 16, 8), label, fill=(0, 0, 0))
        x += 16 + 7 * len(label) + 10
    for i, z in enumerate(zooms):
        sheet.paste(z, (fw + (i % zcols) * 300, 30 + (i // zcols) * 300))
    y0 = max(fh, ((len(zooms) + 1) // 2) * 300) + 30
    for i, t in enumerate(alone):
        sheet.paste(t, ((i % 6) * 180, y0 + (i // 6) * 280))
    sheet.save(a.out, quality=90)


if __name__ == '__main__':
    main()
