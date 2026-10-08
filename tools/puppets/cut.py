#!/usr/bin/env python3
"""
Cuts a puppet template into the part schema's slots from its working master and the edits of it
(docs/puppets.md, docs/art/PROMPTING.md › Puppet templates and parts).

    python3 tools/puppets/cut.py f            # .puppets-work/f/  → parts/, parts.json, landmarks.json, preview.png

Each edit is registered to the master (phase correlation) and colour-matched on the pixels that did
not change, the green key is removed with spill suppression, and every part is a region of one image
chosen by the difference between two images, cleaned (open/close, small specks removed, holes
filled) and feathered. Landmarks are measured from the same differences (eyes from eyes-closed, mouth
from mouth-wide, brows from brows-up, the head from the bald edit, the torso from the armless edit).

Needs numpy, Pillow, scipy and opencv-python-headless. Works only on the git-ignored working folder.
"""
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
WORK = os.path.join(ROOT, '.puppets-work')


def load(path):
    return np.asarray(Image.open(path).convert('RGB'), dtype=np.float32)


def latest_edits(t):
    """The newest kept (or not yet judged) edit for each label puppet-<t>-<name>, from the ledger."""
    ledger = json.load(open(os.path.join(ROOT, 'docs/art/ledger.json')))
    out = {}
    for e in ledger['entries']:
        lab = e.get('label') or ''
        pre = f'puppet-{t}-'
        if not lab.startswith(pre) or not e.get('ok') or e.get('kept') is False or not e.get('file'):
            continue
        out[lab[len(pre):]] = os.path.join(WORK, 'raw', e['file'])
    return out


def register(img, ref):
    """Shift img onto ref: a translation fitted (ECC) on the pixels that didn't change."""
    a = cv2.cvtColor(ref.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    b = cv2.cvtColor(img.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    same = (np.abs(cv2.GaussianBlur(a, (0, 0), 3) - cv2.GaussianBlur(b, (0, 0), 3)) < 0.08).astype(np.uint8)
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        _, warp = cv2.findTransformECC(a, b, warp, cv2.MOTION_TRANSLATION, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-5), same, 5)
    except cv2.error:
        return img, (0.0, 0.0)
    dx, dy = float(warp[0, 2]), float(warp[1, 2])
    if abs(dx) > 12 or abs(dy) > 12:
        return img, (0.0, 0.0)
    m = np.float32([[1, 0, -dx], [0, 1, -dy]])
    return cv2.warpAffine(img, m, (img.shape[1], img.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE), (dx, dy)


def color_match(img, ref, region=None):
    """Per-channel linear fit of img to ref on pixels that barely changed (inside `region` if given)."""
    d = np.abs(cv2.GaussianBlur(img, (0, 0), 2) - cv2.GaussianBlur(ref, (0, 0), 2)).max(axis=2)
    same = d < 30
    if region is not None:
        same &= region
    if same.sum() < 500:
        return img
    out = img.copy()
    for c in range(3):
        x, y = img[..., c][same], ref[..., c][same]
        if x.std() < 1:
            continue
        k, b = np.polyfit(x, y, 1)
        if 0.7 < k < 1.4:
            out[..., c] = np.clip(img[..., c] * k + b, 0, 255)
    return out


def key_alpha(img, key):
    """Opacity from the distance to the key colour (soft edge), with green spill removed."""
    dist = np.sqrt(((img - key) ** 2).sum(axis=2))
    a = np.clip((dist - 45) / 55, 0, 1)
    rgb = img.copy()
    rb = np.maximum(rgb[..., 0], rgb[..., 2])
    rgb[..., 1] = np.minimum(rgb[..., 1], rb + 4)  # nothing on a template is green
    return rgb, a


def fill_small_holes(m, max_area=1500):
    holes = ndi.binary_fill_holes(m) & ~m
    lab, n = ndi.label(holes)
    if not n:
        return m
    sizes = ndi.sum(holes, lab, range(1, n + 1))
    return m | np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s <= max_area])


def tolerant_diff(a, b, reach=2):
    """Per pixel, the smallest colour difference to b within `reach` px: lines that moved by a pixel
    or two between edits don't count as changes."""
    a = cv2.GaussianBlur(a, (0, 0), 1.0)
    b = cv2.GaussianBlur(b, (0, 0), 1.0)
    best = None
    for dy in range(-reach, reach + 1):
        for dx in range(-reach, reach + 1):
            shifted = np.roll(np.roll(b, dy, axis=0), dx, axis=1)
            d = np.abs(a - shifted).max(axis=2)
            best = d if best is None else np.minimum(best, d)
    return best


def diff_mask(a, b, thr=24, region=None, min_size=40, close=3, holes=1500):
    m = tolerant_diff(a, b) > thr
    if region is not None:
        m &= region
    m = ndi.binary_opening(m, iterations=1)
    m = ndi.binary_closing(m, iterations=close)
    m = fill_small_holes(m, holes)
    lab, n = ndi.label(m)
    if n:
        sizes = ndi.sum(m, lab, range(1, n + 1))
        m = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= min_size])
    return m


def soft(mask, grow=2, blur=1.2):
    m = ndi.binary_dilation(mask, iterations=grow) if grow else mask
    return np.clip(cv2.GaussianBlur(m.astype(np.float32), (0, 0), blur) * 1.15, 0, 1)


def rect_mask(shape, x0, y0, x1, y1):
    m = np.zeros(shape[:2], bool)
    m[max(0, int(y0)):max(0, int(y1)), max(0, int(x0)):max(0, int(x1))] = True
    return m


def ellipse_mask(shape, cx, cy, rx, ry):
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    return ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1


def bbox(m):
    ys, xs = np.nonzero(m)
    if not len(xs):
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def main(t):
    base = os.path.join(WORK, t)
    edits = latest_edits(t)
    W = load(os.path.join(base, 'working.png'))
    H, Wd = W.shape[:2]
    border = np.concatenate([W[:8].reshape(-1, 3), W[-8:].reshape(-1, 3), W[:, :8].reshape(-1, 3), W[:, -8:].reshape(-1, 3)])
    key = np.median(border, axis=0)
    need = ['bald', 'eyes-closed', 'eyes-blank', 'mouth-wide', 'brows-up', 'underwear', 'armless']
    missing = [n for n in need if n not in edits]
    if missing:
        sys.exit(f'missing edits for {t}: {", ".join(missing)}')
    E = {}
    report = {}
    for name, path in edits.items():
        if name in ('master-cmp', 'master', 'working-master', 'crisp-2x'):
            continue
        img, shift = register(load(path), W)
        img = color_match(img, W)
        E[name] = img
        report[name] = {'shift': [round(shift[0], 2), round(shift[1], 2)]}
    Wrgb, Wa = key_alpha(W, key)
    alpha = {n: key_alpha(img, key)[1] for n, img in E.items()}
    keyed = {n: key_alpha(img, key)[0] for n, img in E.items()}
    fg = Wa > 0.5

    # ---- landmarks
    bald_a = alpha['bald'] > 0.5
    rows = bald_a.sum(axis=1)
    top = int(np.argmax(rows > 0))
    # Eyes: the blank-eyed edit changes only the irises; each eye is the white region around one.
    upper = rect_mask(W.shape, 0, top, Wd, top + H * 0.3)
    irises = diff_mask(E['eyes-blank'], W, region=upper, thr=30, min_size=30)
    lab, n = ndi.label(irises)
    sizes = ndi.sum(irises, lab, range(1, n + 1))
    two = [i + 1 for i in np.argsort(sizes)[::-1][:2]]
    blank = E['eyes-blank']
    bright = (blank.mean(axis=2) > 205) & ((blank.max(axis=2) - blank.min(axis=2)) < 30)
    eyes = {}
    found = []
    for i in two:
        m = lab == i
        b = bbox(ndi.binary_dilation(m, iterations=2) | (ndi.binary_dilation(m, iterations=12) & bright))
        found.append({'cx': float((b[0] + b[2]) / 2), 'cy': float((b[1] + b[3]) / 2), 'w': float((b[2] - b[0]) / 2), 'h': float((b[3] - b[1]) / 2)})
    found.sort(key=lambda e: e['cx'])
    eyes['R'], eyes['L'] = found[0], found[1]
    eye_y = (eyes['R']['cy'] + eyes['L']['cy']) / 2
    head_cx = (eyes['R']['cx'] + eyes['L']['cx']) / 2
    xs = np.nonzero(bald_a[int(eye_y)])[0]
    head_r = (xs.max() - xs.min()) / 2 * 0.86
    eye_h = max(eyes['L']['h'], eyes['R']['h'])
    mouth_m = diff_mask(E['mouth-wide'], W, region=rect_mask(W.shape, head_cx - head_r * 0.6, eye_y + head_r * 0.45, head_cx + head_r * 0.6, eye_y + head_r * 1.4))
    mb = bbox(mouth_m)
    # The closed mouth sits at the top of the opened one.
    mouth = {'cx': float((mb[0] + mb[2]) / 2), 'cy': float(mb[1] + (mb[3] - mb[1]) * 0.3), 'w': float((mb[2] - mb[0]) * 0.75)}
    chin = float(mb[3] + head_r * 0.35)
    # Chin from the face outline: the lowest skin row of the bald head above the neck's narrowing.
    widths = bald_a[: int(chin + head_r * 1.2)].sum(axis=1)
    below = np.arange(len(widths)) > mb[3]
    neck_rows = np.where(below & (widths > 0))[0]
    neck_y = int(neck_rows[np.argmin(widths[neck_rows])]) if len(neck_rows) else int(chin + head_r * 0.3)
    lum0 = W.mean(axis=2)
    brows = {}
    for side in ('R', 'L'):
        e = eyes[side]
        band = rect_mask(W.shape, e['cx'] - e['w'] * 1.4, e['cy'] - e['h'] * 4.5, e['cx'] + e['w'] * 1.4, e['cy'] - e['h'] * 1.4)
        skin = np.median(lum0[band])
        strokes = ndi.binary_opening(band & (lum0 < skin - 40), iterations=1)
        lab2, n2 = ndi.label(strokes)
        if n2:
            sizes2 = ndi.sum(strokes, lab2, range(1, n2 + 1))
            strokes = lab2 == (int(np.argmax(sizes2)) + 1)
        b = bbox(strokes)
        brows[side] = {'cx': float((b[0] + b[2]) / 2), 'cy': float((b[1] + b[3]) / 2), 'w': float((b[2] - b[0]) / 2)} if b else {'cx': e['cx'], 'cy': e['cy'] - e['h'] * 2.5, 'w': e['w']}
    torso_a = alpha['armless'] > 0.5
    under_a = alpha['underwear'] > 0.5
    tw = torso_a.sum(axis=1).astype(float)
    # Shoulders: where the torso (no arms) first gets much wider than the neck.
    neck_w = max(tw[neck_y], 1)
    sh_y = int(next((y for y in range(neck_y, H) if tw[y] > neck_w * 2.6), neck_y + head_r))
    xs = np.nonzero(torso_a[sh_y + int(head_r * 0.25)])[0]
    shoulderR = [float(xs.min() + head_r * 0.25), float(sh_y + head_r * 0.15)]
    shoulderL = [float(xs.max() - head_r * 0.25), float(sh_y + head_r * 0.15)]
    span = [y for y in range(sh_y + int(head_r * 0.5), H - 2)]
    span_w = tw[span]
    waist_y = int(span[int(np.argmin(span_w[: len(span) * 2 // 3]))]) if len(span) > 10 else sh_y + int(head_r * 2.5)
    chest_rows = [y for y in span if y < waist_y]
    chest_y = int(chest_rows[int(np.argmax(tw[chest_rows]))]) if chest_rows else sh_y + int(head_r)
    hip_rows = [y for y in span if y > waist_y]
    hips_y = int(hip_rows[int(np.argmax(tw[hip_rows][: max(1, len(hip_rows) // 2)]))]) if hip_rows else waist_y + int(head_r)
    bottom = int(np.nonzero(fg.any(axis=1))[0].max())
    L = {
        'canvas': [Wd, H],
        'head': {'cx': float(head_cx), 'cy': float(eye_y - head_r * 0.05), 'r': float(head_r), 'top': float(top), 'chin': float(min(chin, neck_y - head_r * 0.05))},
        'eyeL': eyes['L'], 'eyeR': eyes['R'], 'browL': brows['L'], 'browR': brows['R'], 'mouth': mouth,
        'neck': {'cx': float(head_cx), 'cy': float(neck_y)},
        'shoulderL': shoulderL, 'shoulderR': shoulderR,
        'chest': {'cy': float(chest_y), 'w': float(tw[chest_y])},
        'waist': {'cy': float(waist_y), 'w': float(tw[waist_y])},
        'hips': {'cy': float(hips_y), 'w': float(tw[hips_y])},
        'bottom': float(bottom),
    }

    # ---- parts (full-canvas RGBA; the pack builder trims and meshes them)
    out_dir = os.path.join(base, 'parts')
    os.makedirs(out_dir, exist_ok=True)
    parts = []

    def save(pid, slot, rgb, a, color=None):
        a = np.clip(a, 0, 1)
        if a.max() < 0.05:
            print(f'  {pid}: empty, skipped')
            return
        rgba = np.dstack([np.clip(rgb, 0, 255), a * 255]).astype(np.uint8)
        Image.fromarray(rgba, 'RGBA').save(os.path.join(out_dir, f'{pid}.png'))
        parts.append({'id': pid, 'slot': slot, 'file': f'parts/{pid}.png', **({'color': color} if color else {})})

    head_ell = ellipse_mask(W.shape, head_cx, eye_y, head_r * 1.5, head_r * 1.6)
    # Hair: what the bald edit took away, split by where it sits.
    hair = diff_mask(W, E['bald'], thr=28, min_size=200) & fg
    face_zone = ellipse_mask(W.shape, head_cx, eye_y, head_r * 1.02, head_r * 1.35)
    yy, xx = np.mgrid[0:H, 0:Wd]
    front = hair & face_zone & (yy < eye_y - eye_h * 1.2)
    side = hair & ~front & (yy < L['head']['chin'] + head_r * 0.2) & (np.abs(xx - head_cx) > head_r * 0.55)
    back = hair & ~front & ~side
    save('hair-back', 'hair.back', Wrgb, soft(back, 1) * Wa, 'hair')
    save('hair-side', 'hair.side', Wrgb, soft(side, 1) * Wa, 'hair')
    save('hair-front', 'hair.front', Wrgb, soft(front, 1) * Wa, 'hair')

    # Arms: what the armless edit took away, outside the torso.
    arms = diff_mask(W, E['armless'], thr=26, min_size=300) & fg & (yy > sh_y - head_r * 0.2)
    armsR, armsL = arms & (xx < head_cx), arms & (xx >= head_cx)
    clothes = diff_mask(W, E['underwear'], thr=26, min_size=300) & fg & (yy > L['head']['chin'] - head_r * 0.1)
    # Body: the underwear edit below the chin, without the arms (they are their own parts).
    body_a = alpha['underwear'] * (yy > L['head']['chin'] - head_r * 0.35) * (1 - soft(armsR | armsL, 1, 1.0) * ((yy > sh_y + head_r * 0.3)))
    save('body', 'body', keyed['underwear'], body_a, 'skin')
    torso_clothes = clothes & ~ndi.binary_dilation(arms, iterations=2)
    # Top and bottom: two colour groups of the clothes, the upper one is the top.
    ys, xs_ = np.nonzero(torso_clothes)
    if len(xs_) > 100:
        cols = Wrgb[ys, xs_]
        crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)
        _, lab, centers = cv2.kmeans(cols.astype(np.float32), 2, None, crit, 3, cv2.KMEANS_PP_CENTERS)
        lab = lab.ravel()
        upper = int(np.argmin([ys[lab == k].mean() for k in range(2)]))
        topm = np.zeros(fg.shape, bool); topm[ys[lab == upper], xs_[lab == upper]] = True
        botm = np.zeros(fg.shape, bool); botm[ys[lab != upper], xs_[lab != upper]] = True
        topm = ndi.binary_fill_holes(ndi.binary_closing(topm, iterations=2))
        botm = ndi.binary_fill_holes(ndi.binary_closing(botm, iterations=2)) & ~topm
        save('top', 'top', Wrgb, soft(topm, 1) * Wa, 'cloth1')
        save('bottom', 'bottom', Wrgb, soft(botm, 1) * Wa, 'cloth2')
    # Relaxed arms are bare (from the underwear edit); the shirt's sleeves go on top of them.
    for sid, m in (('r', armsR), ('l', armsL)):
        region = ndi.binary_dilation(m, iterations=6)
        save(f'arm-{sid}', f'arm.{sid}:relaxed', keyed['underwear'], soft(region & under_a, 1) * alpha['underwear'], 'skin')
        sleeve = region & clothes
        save(f'sleeve-{sid}', f'sleeve.{sid}:relaxed', Wrgb, soft(sleeve, 1) * Wa, 'cloth1')
    # Arm poses: the posed arm where the pose edit differs from the armless one, on that side.
    for name, sid, sel in (('hip', 'l', xx >= head_cx + head_r * 0.2), ('raise', 'r', xx < head_cx - head_r * 0.2)):
        if name not in E:
            continue
        img = color_match(E[name], W, region=sel)
        rgb, a = key_alpha(img, key)
        posed = diff_mask(img, E['armless'], thr=30, min_size=300) & (a > 0.5) & sel & (yy > top + head_r * 0.2)
        posed &= ~face_zone
        save(f'arm-{sid}-{name}', f'arm.{sid}:{"hip" if name == "hip" else "raised"}', rgb, soft(posed, 1) * a, 'skin')

    # Face: the master's face, with the hair's hidden skin from the bald edit, the brows painted out
    # and the eyes shut (the open eyes are their own parts on top).
    face_m = ellipse_mask(W.shape, head_cx, eye_y + head_r * 0.15, head_r * 1.3, head_r * 1.45) & (yy < neck_y + head_r * 0.15)
    face = Wrgb.copy()
    bald_rgb = keyed['bald']
    hm = soft(hair, 2, 1.5)[..., None]
    face = face * (1 - hm) + bald_rgb * hm
    face_alpha = np.maximum(Wa * (1 - hm[..., 0]), alpha['bald'] * hm[..., 0]) * face_m
    for s in ('L', 'R'):
        e = eyes[s]
        em = ellipse_mask(W.shape, e['cx'], e['cy'], e['w'] * 1.35, e['h'] * 1.6)
        k = soft(em, 2, 3)[..., None]
        face = face * (1 - k) + keyed['eyes-closed'] * k
    brow_strokes = np.zeros(fg.shape, bool)
    lum = Wrgb.mean(axis=2)
    for s in ('L', 'R'):
        b = brows[s]
        r = rect_mask(W.shape, b['cx'] - b['w'] * 1.3, b['cy'] - eye_h * 1.0, b['cx'] + b['w'] * 1.3, b['cy'] + eye_h * 1.0)
        skin = np.median(lum[r & fg & ~hair]) if (r & fg & ~hair).sum() > 20 else 200
        brow_strokes |= r & (lum < skin - 35) & ~hair
    brow_strokes = ndi.binary_opening(brow_strokes, iterations=1)
    inpaint = ndi.binary_dilation(brow_strokes, iterations=3)
    face = cv2.inpaint(np.clip(face, 0, 255).astype(np.uint8), inpaint.astype(np.uint8), 5, cv2.INPAINT_TELEA).astype(np.float32)
    save('face', 'face', face, face_alpha, 'skin')
    for s, sid in (('R', 'r'), ('L', 'l')):
        b = brows[s]
        r = rect_mask(W.shape, b['cx'] - b['w'] * 1.4, b['cy'] - eye_h * 1.3, b['cx'] + b['w'] * 1.4, b['cy'] + eye_h)
        save(f'brow-{sid}', f'brow.{sid}', Wrgb, soft(brow_strokes & r, 1, 0.8) * Wa, 'hair')

    # Eyes, per side: white (from the blank-eyed edit), iris (master minus blank), lids and lashes
    # (blank minus shut), half shut and smiling (each minus shut).
    for s, sid in (('R', 'r'), ('L', 'l')):
        e = eyes[s]
        zone = rect_mask(W.shape, e['cx'] - e['w'] * 1.6, e['cy'] - e['h'] * 2.2, e['cx'] + e['w'] * 1.6, e['cy'] + e['h'] * 1.8)
        blank = keyed['eyes-blank']
        bl = blank.mean(axis=2)
        sat = blank.max(axis=2) - blank.min(axis=2)
        white = zone & (bl > 205) & (sat < 30) & diff_mask(E['eyes-blank'], E['eyes-closed'], region=zone, thr=20, min_size=10)
        white = ndi.binary_fill_holes(ndi.binary_closing(white, iterations=2))
        save(f'eye-{sid}-white', f'eye.{sid}.white', blank, soft(white, 1, 0.8))
        iris = diff_mask(W, E['eyes-blank'], region=zone & ndi.binary_dilation(white, iterations=2), thr=26, min_size=10)
        save(f'eye-{sid}-iris', f'eye.{sid}.iris', Wrgb, soft(iris, 1, 0.8), 'eyes')
        lash = diff_mask(E['eyes-blank'], E['eyes-closed'], region=zone, thr=24, min_size=10) & ~white
        save(f'eye-{sid}-lash', f'eye.{sid}.lash', blank, soft(lash, 1, 0.8))
        for name, slot in (('eyes-half', 'half'), ('eyes-smile', 'smile')):
            if name in E:
                m = diff_mask(E[name], E['eyes-closed'], region=zone, thr=24, min_size=10)
                save(f'eye-{sid}-{slot}', f'eye.{sid}.{slot}', keyed[name], soft(m, 2, 1.2))

    # Mouths: each edit where it differs from the master, around the mouth.
    mz = rect_mask(W.shape, mouth['cx'] - mouth['w'] * 1.3, mouth['cy'] - mouth['w'] * 0.5, mouth['cx'] + mouth['w'] * 1.3, mouth['cy'] + mouth['w'] * 1.0)
    for name, slot in (('mouth-a', 'mouth.open'), ('mouth-wide', 'mouth.wide'), ('mouth-smile', 'mouth.smile'), ('mouth-i', 'mouth.i'), ('mouth-u', 'mouth.u'), ('mouth-e', 'mouth.e'), ('mouth-o', 'mouth.o')):
        if name in E:
            m = diff_mask(E[name], W, region=mz, thr=22, min_size=20, close=4)
            save(name, slot, keyed[name], soft(m, 3, 1.5))
    if 'blush' in E:
        cheeks = rect_mask(W.shape, head_cx - head_r * 0.95, eye_y + eye_h, head_cx + head_r * 0.95, mouth['cy'])
        d = np.clip((np.abs(cv2.GaussianBlur(E['blush'], (0, 0), 3) - cv2.GaussianBlur(W, (0, 0), 3)).max(axis=2) - 6) / 30, 0, 1) * cheeks
        save('blush', 'blush', keyed['blush'], cv2.GaussianBlur(d.astype(np.float32), (0, 0), 3))

    json.dump(L, open(os.path.join(base, 'landmarks.json'), 'w'), indent=1)
    json.dump({'template': t, 'canvas': [Wd, H], 'parts': parts, 'registration': report}, open(os.path.join(base, 'parts.json'), 'w'), indent=1)
    print(f'{t}: {len(parts)} parts; landmarks written')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'f')
