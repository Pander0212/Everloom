#!/usr/bin/env python3
"""
Maps See-through's layers onto the puppet part schema (docs/puppets.md › Making a template or a
character, step 3) and measures the template landmarks, writing a folder `build-puppet.ts` rigs:

    python3 tools/puppets/map.py <See-through PSD> <keyed source PNG> <out dir>

What it does:
- reads every layer of the PSD (named by See-through's tags, possibly split into `-l`/`-r`);
- left and right are decided by the face's centre, not by the layer names;
- tags go to slots as in puppets.md; the long front strands below the cheeks go to `hair.side`
  so the fringe and the side locks swing separately;
- the mouth layer is drawn into the face (the closed mouth), the ears too;
- the face gets the closed eye drawn in from the lash layer (squashed onto the lid line) so a
  blink never shows bare skin; open mouths are simple shapes in the lip colour until edits exist;
- landmarks come from the parts: eyes, brows and mouth from their layers, the head from the face,
  the neck and shoulders from the neck layer, chest/waist/hips from the torso's silhouette.

Everything it writes is art: keep it in .puppets-work/.
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from psd_tools import PSDImage


def layers(psd_path):
    psd = PSDImage.open(psd_path)
    W, H = psd.width, psd.height
    out = []
    for i, layer in enumerate(psd):  # bottom (back) first
        im = layer.topil()
        if im is None:
            continue
        full = np.zeros((H, W, 4), np.uint8)
        x, y = layer.left, layer.top
        a = np.asarray(im.convert('RGBA'))
        h, w = a.shape[:2]
        x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
        full[y0:y1, x0:x1] = a[y0 - y:y1 - y, x0 - x:x1 - x]
        out.append((layer.name, full))
    return (W, H), out


def bbox(a, thr=24):
    ys, xs = np.nonzero(a[..., 3] > thr)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def over(dst, src):
    """Alpha-composites src over dst (straight alpha, uint8)."""
    sa = src[..., 3:4] / 255.0
    da = dst[..., 3:4] / 255.0
    oa = sa + da * (1 - sa)
    rgb = (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
    return np.dstack([rgb, oa * 255]).clip(0, 255).astype(np.uint8)


def split_lr(a, cx):
    l, r = a.copy(), a.copy()
    # The character's left is the picture's right.
    l[:, :int(cx), 3] = 0
    r[:, int(cx):, 3] = 0
    return l, r


def base_tag(name):
    n = name.lower().strip()
    for suf in ('-l', '-r'):
        if n.endswith(suf):
            n = n[:-2]
    return {'hairf': 'front hair', 'hairb': 'back hair', 'eyel': 'eyes', 'eyer': 'eyes', 'browl': 'eyebrow', 'browr': 'eyebrow', 'earl': 'ears', 'earr': 'ears'}.get(n, n)


SLOT = {
    'back hair': 'hair.back', 'neck': 'body', 'topwear': 'top', 'bottomwear': 'bottom', 'legwear': 'legwear',
    'footwear': 'shoes', 'neckwear': 'acc.body', 'objects': 'acc.body', 'headwear': 'acc.head', 'earwear': 'acc.head',
    'eyewear': 'acc.head', 'tail': 'acc.back', 'wings': 'acc.back', 'nose': 'nose', 'handwear': 'body',
}
COLOR = {'hair.back': 'hair', 'hair.front': 'hair', 'hair.side': 'hair', 'brow': 'hair', 'body': 'skin', 'face': 'skin', 'top': 'cloth1', 'bottom': 'cloth2', 'legwear': 'cloth3', 'iris': 'eyes'}


def main(psd_path, src_path, out):
    (W, H), ls = layers(psd_path)
    os.makedirs(out, exist_ok=True)
    by = {}
    for name, a in ls:
        by.setdefault(base_tag(name), []).append(a)
    merged = {}
    for t, arr in by.items():
        acc = np.zeros((H, W, 4), np.uint8)
        for a in arr:
            acc = over(acc, a)
        merged[t] = acc
    print('tags:', sorted(merged))
    face = merged.get('face')
    if face is None:
        raise SystemExit('no face layer: is this a character picture?')
    fx0, fy0, fx1, fy1 = bbox(face)
    cx = (fx0 + fx1) / 2
    R = (fx1 - fx0) / 2
    parts, files = [], {}

    def put(pid, slot, a, color=None):
        if bbox(a, 8) is None:
            return
        f = f'{pid}.png'
        Image.fromarray(a, 'RGBA').save(os.path.join(out, f))
        parts.append({'id': pid, 'slot': slot, 'file': f, **({'color': color} if color else {})})
        files[pid] = a

    # ---- eyes, brows: split by the face's centre
    eye = {}
    for tag, slot in (('eyewhite', 'white'), ('irides', 'iris'), ('eyelash', 'lash')):
        if tag in merged:
            l, r = split_lr(merged[tag], cx)
            eye[('l', slot)], eye[('r', slot)] = l, r
    lm_eye = {}
    for s in ('l', 'r'):
        parts_s = [eye[(s, k)] for k in ('white', 'iris', 'lash') if (s, k) in eye]
        if not parts_s:
            continue
        u = np.zeros((H, W, 4), np.uint8)
        for a in parts_s:
            u = over(u, a)
        x0, y0, x1, y1 = bbox(u)
        lm_eye[s] = {'cx': (x0 + x1) / 2, 'cy': (y0 + y1) / 2, 'w': (x1 - x0) / 2, 'h': (y1 - y0) / 2}
        for k in ('white', 'iris', 'lash'):
            if (s, k) in eye:
                put(f'eye-{s}-{k}', f'eye.{s}.{k}', eye[(s, k)], 'eyes' if k == 'iris' else None)
    # The closed eye: the lash's upper line squashed onto the lid line.
    closed = {}
    for s in ('l', 'r'):
        if (s, 'lash') not in eye or s not in lm_eye:
            continue
        lash = eye[(s, 'lash')]
        x0, y0, x1, y1 = bbox(lash)
        e = lm_eye[s]
        crop = lash[y0:y1, x0:x1]
        hh = max(3, int((y1 - y0) * 0.22))
        sq = cv2.resize(crop, (x1 - x0, hh), interpolation=cv2.INTER_AREA)
        # Flip so the line bows downward like a shut lid.
        sq = sq[::-1]
        c = np.zeros((H, W, 4), np.uint8)
        ly = int(e['cy'] + e['h'] * 0.35)
        c[ly:ly + hh, x0:x1] = sq
        a = c[..., 3].astype(np.float32)
        c[..., 3] = np.clip(a * 1.6, 0, 255).astype(np.uint8)
        closed[s] = c
        put(f'eye-{s}-closed', f'eye.{s}.closed', c)
    lm_brow = {}
    if 'eyebrow' in merged:
        l, r = split_lr(merged['eyebrow'], cx)
        for s, a in (('l', l), ('r', r)):
            b = bbox(a)
            if b:
                lm_brow[s] = {'cx': (b[0] + b[2]) / 2, 'cy': (b[1] + b[3]) / 2, 'w': (b[2] - b[0]) / 2}
                put(f'brow-{s}', f'brow.{s}', a, 'hair')

    # ---- the face: face + ears + the closed mouth drawn in
    f = face.copy()
    for t in ('ears',):
        if t in merged:
            f = over(merged[t], f)
    mouth_box = None
    if 'mouth' in merged:
        mouth_box = bbox(merged['mouth'])
        f = over(f, merged['mouth'])
    put('face', 'face', f, 'skin')

    # Open mouths: a dark lip-coloured shape centred on the mouth, sized from it.
    if mouth_box:
        mx0, my0, mx1, my1 = mouth_box
        mcx, mcy, mw = (mx0 + mx1) / 2, (my0 + my1) / 2, max(8, (mx1 - mx0) / 2)
    else:
        e = lm_eye.get('l') or {'cy': fy0 + R}
        mcx, mcy, mw = cx, fy0 + (fy1 - fy0) * 0.8, R * 0.18
    lip = np.array([120, 40, 50])
    for pid, rx, ry, dy in (('open', 0.55, 0.45, 0.25), ('wide', 0.8, 0.85, 0.5), ('o', 0.42, 0.7, 0.4), ('u', 0.3, 0.32, 0.15), ('e', 0.85, 0.35, 0.2), ('i', 0.95, 0.28, 0.12)):
        m = np.zeros((H, W, 4), np.uint8)
        c = (int(mcx), int(mcy + mw * dy))
        cv2.ellipse(m, c, (int(mw * rx), int(mw * ry)), 0, 0, 360, (*lip.tolist(), 255), -1, cv2.LINE_AA)
        # A lighter tongue and a dark outline.
        cv2.ellipse(m, (c[0], c[1] + int(mw * ry * 0.45)), (int(mw * rx * 0.55), max(1, int(mw * ry * 0.35))), 0, 0, 360, (200, 100, 105, 255), -1, cv2.LINE_AA)
        cv2.ellipse(m, c, (int(mw * rx), int(mw * ry)), 0, 0, 360, (60, 25, 30, 255), max(1, int(mw * 0.06)), cv2.LINE_AA)
        put(f'mouth-{pid}', f'mouth.{pid}', m)

    if 'nose' in merged:
        put('nose', 'nose', merged['nose'])

    # ---- hair: the fringe above the cheeks, side locks below
    if 'front hair' in merged:
        fh = merged['front hair']
        ey = np.mean([e['cy'] for e in lm_eye.values()]) if lm_eye else fy0 + R
        cut = int(ey + R * 0.35)
        front, sidel = fh.copy(), fh.copy()
        ramp = np.clip((np.arange(H) - cut) / (R * 0.25), 0, 1)[:, None]
        front[..., 3] = (front[..., 3] * (1 - ramp)).astype(np.uint8)
        sidel[..., 3] = (sidel[..., 3] * ramp).astype(np.uint8)
        put('hair-front', 'hair.front', front, 'hair')
        put('hair-side', 'hair.side', sidel, 'hair')

    # ---- everything else by tag
    body = np.zeros((H, W, 4), np.uint8)
    for t in ('neck', 'handwear'):
        if t in merged:
            body = over(body, merged[t])
    if bbox(body, 8):
        put('body', 'body', body, 'skin')
    for t, a in merged.items():
        if t in ('face', 'ears', 'mouth', 'nose', 'eyewhite', 'irides', 'eyelash', 'eyebrow', 'front hair', 'neck', 'handwear', 'eyes'):
            continue
        slot = SLOT.get(t)
        if not slot:
            print(f'unmapped tag {t!r}, skipped')
            continue
        put(t.replace(' ', '-'), slot, a, COLOR.get(slot))

    # ---- landmarks
    src = np.asarray(Image.open(src_path).convert('RGBA'))
    neck = merged.get('neck')
    nb = bbox(neck) if neck is not None else None
    neck_c = {'cx': cx, 'cy': (nb[1] + nb[3]) / 2 if nb else fy1 + R * 0.2}
    torso = np.zeros((H, W), np.uint8)
    for t in ('neck', 'topwear', 'bottomwear', 'handwear', 'legwear'):
        if t in merged:
            torso |= (merged[t][..., 3] > 64).astype(np.uint8)
    rows = np.nonzero(torso.any(axis=1))[0]
    bottom = int(bbox(src)[3]) if src.shape[:2] == (H, W) else int(rows.max()) if len(rows) else H

    def width_at(y):
        y = int(np.clip(y, 0, H - 1))
        xs = np.nonzero(torso[y])[0]
        # Only the run around the centre (not the arms held out).
        if not len(xs):
            return R * 2
        c = int(cx)
        l = c
        while l > 0 and torso[y, l - 1]:
            l -= 1
        r = c
        while r < W - 1 and torso[y, r + 1]:
            r += 1
        return float(max(r - l, R))

    chin = fy1
    sh_y = chin + R * 0.75
    chest_y = chin + R * 1.35
    waist_y = chin + R * 2.5
    hips_y = chin + R * 3.3
    e_l = lm_eye.get('l') or {'cx': cx + R * 0.4, 'cy': fy0 + R, 'w': R * 0.2, 'h': R * 0.15}
    e_r = lm_eye.get('r') or {'cx': cx - R * 0.4, 'cy': fy0 + R, 'w': R * 0.2, 'h': R * 0.15}
    hair_top = min([bbox(merged[t])[1] for t in ('front hair', 'back hair') if t in merged] or [fy0])
    sh_half = width_at(sh_y) / 2
    L = {
        'canvas': [W, H],
        'head': {'cx': cx, 'cy': (fy0 + fy1) / 2, 'r': R, 'top': float(hair_top), 'chin': float(chin)},
        'eyeL': e_l, 'eyeR': e_r,
        'browL': lm_brow.get('l', {'cx': e_l['cx'], 'cy': e_l['cy'] - e_l['h'] * 2, 'w': e_l['w']}),
        'browR': lm_brow.get('r', {'cx': e_r['cx'], 'cy': e_r['cy'] - e_r['h'] * 2, 'w': e_r['w']}),
        'mouth': {'cx': float(mcx), 'cy': float(mcy), 'w': float(mw)},
        'neck': neck_c,
        'shoulderR': [cx - sh_half * 0.85, sh_y], 'shoulderL': [cx + sh_half * 0.85, sh_y],
        'chest': {'cy': chest_y, 'w': width_at(chest_y)},
        'waist': {'cy': waist_y, 'w': width_at(waist_y)},
        'hips': {'cy': hips_y, 'w': width_at(hips_y)},
        'bottom': float(bottom),
    }
    L = json.loads(json.dumps(L, default=float))
    colors = {}
    for slot, grp in (('hair-back', 'hair'), ('face', 'skin'), ('topwear', 'cloth1'), ('bottomwear', 'cloth2'), ('eye-l-iris', 'eyes')):
        a = files.get(slot)
        if a is not None:
            m = a[..., 3] > 200
            if m.any():
                colors[grp] = '#%02x%02x%02x' % tuple(int(v) for v in np.median(a[m][:, :3], axis=0))
    json.dump({'parts': parts, 'colors': colors}, open(os.path.join(out, 'parts.json'), 'w'), indent=1)
    json.dump(L, open(os.path.join(out, 'landmarks.json'), 'w'), indent=1)
    print(f'{out}: {len(parts)} parts; head r {R:.0f} at ({cx:.0f}, {L["head"]["cy"]:.0f})')


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    main(*sys.argv[1:])
