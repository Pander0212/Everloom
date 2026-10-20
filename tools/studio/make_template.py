#!/usr/bin/env python3
"""
Character Studio template maker (docs/character-studio/making-templates.md): turns one base picture
and its single-trait edit variants into a template pack (docs/character-studio/FORMAT.md) with
numeric quality gates and a contact sheet.

    python3 tools/studio/make_template.py SPEC.json OUT_DIR

The spec (paths relative to the spec file):

    {"id": "stand-neutral", "name": "Standing", "category": "standing", "rating": "all-ages",
     "tags": ["neutral"], "sex": ["female"],
     "base": "raw/base.jpg",            the character with the pose's default look
     "bald": "raw/bald.jpg",            the same picture with no hair (the body layer)
     "baseHair": "bun",                 the base picture's own hairstyle (its hair becomes that option)
     "hair": {"bob": "raw/bob.jpg", …}, one edit per hairstyle (hair.back)
     "wardrobe": {"top": {"blouse": "raw/blouse.jpg"}, …},
     "expressions": {"smile": "raw/smile.jpg", …},
     "eyes": "raw/eyes-green.jpg",      the base with only the iris colour changed (gives the eye mask)
     "keypoints": {…}, "background": "#rrggbb"}   optional: landmarks instead of RTMPose, and a flat
                                        backdrop keyed by colour instead of rembg (tests, drawn art)

Steps: key the bald body (rembg) → align every variant to its reference (phase correlation; over
MAX_SHIFT px is rejected) → diff layers (ΔE threshold, islands removed, feathered, clipped to the
variant's own silhouette) → hair split into back (outside the body) and front (over it) → eye
mask and skin mask → cages and rig from RTMPose keypoints → gates → template.json, a zip and a
contact sheet. The TypeScript checks (schema, z conflicts, slider distortion) run afterwards:
`npx tsx tools/studio/check-template.ts OUT_DIR/template.json`.
"""
import json
import os
import sys
import zipfile

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'puppets2'))

MAX_SHIFT = 1.5        # px: variants further off than this are rejected
DIFF_DE = 14.0         # ΔE76 that counts as "this pixel changed"
MIN_ISLAND = 120       # px: smaller changed islands are edit noise
GATES = {
    'alignment_px': 1.5,     # max residual shift of any variant
    'reconstruction_de': 4.0,  # mean ΔE of (reference + layer) vs the variant inside the layer: seams/halos
    'halo_px': 400,          # edge pixels of a layer much brighter/darker than the variant
    'swap_holes_px': 60,     # transparent pixels inside the body silhouette
    'drift_de': 3.5,         # mean ΔE of a variant vs its reference outside the edit (global drift)
}
Z = {'hairBack': 5, 'body': 10, 'underwear': 14, 'legwear': 15, 'shoes': 16, 'bottom': 18, 'bra': 19, 'top': 20, 'expression': 31, 'hairFront': 40, 'accessory': 45}


def lab(rgb):
    return cv2.cvtColor(rgb.astype(np.float32) / 255.0, cv2.COLOR_RGB2LAB)


def delta_e(a, b):
    return np.linalg.norm(lab(a) - lab(b), axis=2)


def load_rgb(path, size=None):
    im = Image.open(path).convert('RGB')
    if size and im.size != size:
        im = im.resize(size, Image.LANCZOS)
    return np.array(im)


FLAT_KEY = None  # a spec's "background": "#rrggbb" keys a flat backdrop instead of running rembg


def key_alpha(rgb, cache):
    """rembg (IS-Net) alpha of a picture, cached next to the outputs."""
    if FLAT_KEY is not None:
        d = np.linalg.norm(lab(rgb) - lab(np.array([[FLAT_KEY]], np.uint8))[0, 0], axis=2)
        return np.clip((d - 4) * 40, 0, 255).astype(np.uint8)
    if os.path.exists(cache):
        return np.array(Image.open(cache).convert('L'))
    from rembg import new_session, remove
    out = remove(Image.fromarray(rgb), session=new_session('isnet-general-use'), post_process_mask=True)
    a = np.array(out)[:, :, 3]
    Image.fromarray(a).save(cache)
    return a


def align(ref, var):
    """Phase-correlation shift of var against ref; returns (aligned var, shift px)."""
    g = lambda x: cv2.cvtColor(x, cv2.COLOR_RGB2GRAY).astype(np.float32)
    win = cv2.createHanningWindow(ref.shape[1::-1], cv2.CV_32F)
    (dx, dy), _ = cv2.phaseCorrelate(g(ref), g(var), win)
    shift = float(np.hypot(dx, dy))
    if shift > 0.25:
        m = np.float32([[1, 0, -dx], [0, 1, -dy]])
        var = cv2.warpAffine(var, m, ref.shape[1::-1], flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return var, shift


def change_mask(ref, var, region=None, threshold=DIFF_DE, min_island=MIN_ISLAND):
    """Pixels the edit changed: ΔE over the threshold, opened, small islands dropped, holes filled."""
    d = delta_e(ref, var)
    m = (d > threshold).astype(np.uint8)
    if region is not None:
        m &= region.astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    n, lab_, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= min_island:
            keep[lab_ == i] = 1
    # Fill enclosed holes (a pattern on a shirt that happens to match the reference).
    filled = keep.copy()
    h, w = keep.shape
    flood = np.zeros((h + 2, w + 2), np.uint8)
    inv = (1 - keep).astype(np.uint8)
    cv2.floodFill(inv, flood, (0, 0), 0)
    filled[inv == 1] = 1
    return filled, d


def feather(mask, grow=2, blur=1.5):
    m = cv2.dilate(mask.astype(np.uint8), np.ones((2 * grow + 1, 2 * grow + 1), np.uint8)) if grow else mask.astype(np.uint8)
    return np.clip(cv2.GaussianBlur(m.astype(np.float32), (0, 0), blur) * 255, 0, 255).astype(np.uint8)


def rgba(rgb, alpha):
    return np.dstack([rgb, alpha]).astype(np.uint8)


def over(dst, layer):
    a = layer[:, :, 3:4].astype(np.float32) / 255
    return (layer[:, :, :3] * a + dst * (1 - a)).astype(np.uint8)


def median_color(rgb, mask):
    px = rgb[mask > 127]
    if not len(px):
        return '#808080'
    # The median of the brighter half: base colours are painted mid-tones, shadows pull it down.
    luma = px @ np.array([0.299, 0.587, 0.114])
    px = px[luma >= np.median(luma)]
    return '#%02x%02x%02x' % tuple(int(v) for v in np.median(px, axis=0))


def crop(layer):
    """Crops a layer to its opaque box; returns (pixels, [x, y, w, h])."""
    ys, xs = np.nonzero(layer[:, :, 3] > 2)
    if not len(xs):
        return None, None
    x0, y0, x1, y1 = max(0, xs.min() - 2), max(0, ys.min() - 2), min(layer.shape[1], xs.max() + 3), min(layer.shape[0], ys.max() + 3)
    return layer[y0:y1, x0:x1], [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]


def halo_count(layer, var, ref):
    """Edge pixels (partly transparent) whose colour is far from both the variant and the reference."""
    a = layer[:, :, 3]
    edge = (a > 25) & (a < 230)
    comp = over(ref, layer)
    d_var = delta_e(comp, var)
    return int(((d_var > 25) & edge).sum())


# ------------------------------------------------------------------------------- body geometry

def keypoints(rgb, alpha):
    from decompose import detect_keypoints, standard_keypoints
    raw = detect_keypoints(rgb)
    return standard_keypoints(raw, alpha, 'front')


def silhouette_width(alpha, y, x_mid, half):
    """Left and right body edges at row y, searching outwards from the centre line (arms excluded
    by stopping at the first gap)."""
    row = alpha[int(y)] > 127
    xl = xr = int(x_mid)
    while xl > max(0, x_mid - half) and row[xl - 1]:
        xl -= 1
    while xr < min(len(row) - 1, x_mid + half) and row[xr + 1]:
        xr += 1
    return xl, xr


def cages_from(kp, alpha):
    """Body cages (rest / min / max quads) from the landmarks: each slider widens or narrows its
    band around the body's centre line; breasts also grow forward-down (a front view shows that as
    rounder and slightly lower)."""
    P = lambda n: np.array(kp[n], dtype=float)
    neck, pelvis = P('neck'), P('pelvis')
    sl, sr, hl, hr = P('shoulder_L'), P('shoulder_R'), P('hip_L'), P('hip_R')
    kl, kr = P('knee_L'), P('knee_R')
    cx = (pelvis[0] + neck[0]) / 2
    torso = pelvis[1] - neck[1]
    half = abs(sl[0] - sr[0]) * 0.75
    cages = []

    def band(cid, slider, y0, y1, amount, margin, xpad=0.0):
        el, er = silhouette_width(alpha, y0, cx, half)
        fl, fr = silhouette_width(alpha, y1, cx, half)
        rest = [[el - xpad, y0], [er + xpad, y0], [fr + xpad, y1], [fl - xpad, y1]]
        def at(k):
            return [[cx + (x - cx) * (1 + k), y] for x, y in rest]
        cages.append({'id': cid, 'slider': slider, 'rest': rnd(rest), 'min': rnd(at(-amount)), 'max': rnd(at(amount)), 'margin': round(margin, 1)})

    ys = lambda f: neck[1] + torso * f
    band('shoulders', 'shoulders', neck[1] + torso * 0.08, ys(0.3), 0.12, torso * 0.3)
    band('waist', 'waist', ys(0.55), ys(0.78), 0.14, torso * 0.3)
    band('hips', 'hips', ys(0.85), pelvis[1] + torso * 0.25, 0.14, torso * 0.3)
    # Thighs: one band across both legs, hip line to just above the knees.
    ky = (kl[1] + kr[1]) / 2
    band('thighs', 'thighs', pelvis[1] + torso * 0.28, ky - torso * 0.1, 0.12, torso * 0.3)
    # Breasts: a box over each breast, scaled about its centre (bigger and a little lower).
    for s, sh, hp in (('L', sl, hl), ('R', sr, hr)):
        c = sh + (hp - sh) * 0.3
        c[0] = cx + (c[0] - cx) * 0.62
        # Half the gap to the centre line at most: the two cages must not overlap (their
        # displacements would add up and fold the picture between them).
        rx = min(torso * 0.17, abs(c[0] - cx) * 0.8)
        ry = rx * 0.85
        rest = [[c[0] - rx, c[1] - ry], [c[0] + rx, c[1] - ry], [c[0] + rx, c[1] + ry], [c[0] - rx, c[1] + ry]]
        # Grow outwards and down about the inner edge, so the cleavage between the cages stays put.
        inner = c[0] - rx if c[0] > cx else c[0] + rx
        def sc(k, dy):
            return [[inner + (x - inner) * (1 + k), c[1] + (y - c[1]) * (1 + k) + dy] for x, y in rest]
        cages.append({'id': f'breast-{s.lower()}', 'slider': 'breast', 'rest': rnd(rest), 'min': rnd(sc(-0.15, -ry * 0.04)), 'max': rnd(sc(0.15, ry * 0.08)), 'margin': round(rx * 1.2, 1)})
    return cages


def rig_from(kp, cages):
    P = lambda n: np.array(kp[n], dtype=float)
    neck, pelvis = P('neck'), P('pelvis')
    torso = pelvis[1] - neck[1]
    sl, sr = P('shoulder_L'), P('shoulder_R')
    x0, x1 = min(sl[0], sr[0]), max(sl[0], sr[0])
    breathe = [x0, neck[1] + torso * 0.05, x1 - x0, torso * 0.5]
    bounce = []
    for c in cages:
        if c['slider'] == 'breast':
            xs, ys = [p[0] for p in c['rest']], [p[1] for p in c['rest']]
            bounce.append([min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)])
    return {'breathe': rnd(breathe), 'pivot': rnd(list(pelvis)), 'bounce': [rnd(b) for b in bounce]}


def rnd(v):
    if isinstance(v, (list, tuple, np.ndarray)):
        return [rnd(x) for x in v]
    return round(float(v), 1)


# ------------------------------------------------------------------------------- the maker

def run(spec_path, out):
    global FLAT_KEY
    with open(spec_path) as f:
        spec = json.load(f)
    FLAT_KEY = [int(spec['background'][i:i + 2], 16) for i in (1, 3, 5)] if spec.get('background') else None
    root = os.path.dirname(os.path.abspath(spec_path))
    path = lambda p: os.path.join(root, p)
    os.makedirs(out, exist_ok=True)
    work = os.path.join(out, '_work')
    os.makedirs(work, exist_ok=True)

    base = load_rgb(path(spec['base']))
    H, W = base.shape[:2]
    size = (W, H)
    report = {'id': spec['id'], 'variants': {}, 'gates': {}, 'failed': []}

    def variant(p, ref, name):
        v = load_rgb(path(p), size)
        v, shift = align(ref, v)
        report['variants'][name] = {'shift_px': round(shift, 2)}
        if shift > MAX_SHIFT:
            report['failed'].append(f'{name}: misaligned by {shift:.1f} px (over {MAX_SHIFT})')
        return v, shift

    bald, _ = variant(spec['bald'], base, 'bald')
    body_alpha = key_alpha(bald, os.path.join(work, 'bald-alpha.png'))
    # Fill pinholes in the body's alpha (rembg leaves a few inside light areas).
    solid = (body_alpha > 127).astype(np.uint8)
    holes_before = solid.copy()
    inv = (1 - solid).astype(np.uint8)
    flood = np.zeros((H + 2, W + 2), np.uint8)
    cv2.floodFill(inv, flood, (0, 0), 0)
    swap_holes = int(inv.sum())
    body_alpha = np.maximum(body_alpha, (inv * 255).astype(np.uint8))
    kp = {k: v for k, v in spec['keypoints'].items()} if spec.get('keypoints') else keypoints(bald, body_alpha)
    P = lambda n: np.array(kp[n], dtype=float)
    torso = P('pelvis')[1] - P('neck')[1]
    head_c = (P('neck') + P('headTop')) / 2
    head_r = max(abs(P('neck')[1] - P('headTop')[1]) * 0.75, 10)
    yy, xx = np.mgrid[0:H, 0:W]
    head = ((xx - head_c[0]) ** 2 + (yy - head_c[1]) ** 2) < head_r ** 2
    face = head & (yy > P('headTop')[1] + (P('neck')[1] - P('headTop')[1]) * 0.25)

    layers, files, drift, recon, halos = [], {}, {}, {}, {}

    def emit(lid, part, pix, z, when=None, recolor=None, check=None):
        px, rect = crop(pix)
        if px is None:
            report['failed'].append(f'{lid}: empty layer')
            return
        files[f'{lid}.png'] = px
        l = {'id': lid, 'part': part, 'file': f'{lid}.png', 'rect': rect, 'z': z}
        if when:
            l['when'] = when
        if recolor:
            l['recolor'] = recolor
        layers.append(l)
        if check:
            measure(lid, pix, *check)

    def measure(name, pix, ref, var, mask):
        """Seams and halos: the reference with the layer drawn over it should be the variant."""
        de = delta_e(over(ref, pix), var)
        recon[name] = round(float(de[mask > 0].mean()) if mask.any() else 0.0, 2)
        halos[name] = halo_count(pix, var, ref)

    # Body: the bald picture, keyed. Skin recolour mask: body pixels near the skin colour.
    skin_probe = np.zeros((H, W), np.uint8)
    for a, b in (('shoulder_L', 'elbow_L'), ('shoulder_R', 'elbow_R'), ('knee_L', 'ankle_L'), ('knee_R', 'ankle_R')):
        p, q = P(a), P(b)
        for t in np.linspace(0.3, 0.7, 5):
            x, y = (p + (q - p) * t).astype(int)
            cv2.circle(skin_probe, (int(x), int(y)), 4, 255, -1)
    skin_probe &= (body_alpha > 200).astype(np.uint8) * 255
    skin_hex = median_color(bald, skin_probe)
    skin_lab = lab(np.array([[[int(skin_hex[i:i + 2], 16) for i in (1, 3, 5)]]], np.uint8))[0, 0]
    skin_d = np.linalg.norm(lab(bald) - skin_lab, axis=2)
    skin_mask = ((skin_d < 22) & (body_alpha > 127)).astype(np.uint8)
    skin_mask = cv2.morphologyEx(skin_mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    skin_soft = feather(skin_mask, 0, 1.0)

    eye_mask = None
    if spec.get('eyes'):
        ev, _ = variant(spec['eyes'], base, 'eyes')
        m, _ = change_mask(base, ev, face, threshold=10, min_island=8)
        eye_mask = feather(m, 1, 0.8)
        report['variants']['eyes']['mask_px'] = int(m.sum())
        skin_soft = np.minimum(skin_soft, 255 - eye_mask)
    eye_hex = median_color(base, eye_mask) if eye_mask is not None else None

    body = rgba(bald, body_alpha)
    recol = [{'kind': 'skin', 'base': skin_hex, 'mask': 'body-skin-mask.png'}]
    if eye_mask is not None:
        recol.append({'kind': 'eyes', 'base': eye_hex, 'mask': 'body-eyes-mask.png'})
    emit('body', 'body', body, Z['body'], recolor=recol)
    body_rect = layers[-1]['rect']
    bx, by, bw, bh = body_rect
    files['body-skin-mask.png'] = np.dstack([skin_soft] * 3 + [np.full_like(skin_soft, 255)])[by:by + bh, bx:bx + bw]
    if eye_mask is not None:
        files['body-eyes-mask.png'] = np.dstack([eye_mask] * 3 + [np.full_like(eye_mask, 255)])[by:by + bh, bx:bx + bw]

    # Hair: each style's pixels vs the bald body; outside the body → back, over it → front.
    hair_sources = dict(spec.get('hair', {}))
    hair_pics = {}
    if spec.get('baseHair'):
        hair_pics[spec['baseHair']] = base
    for style, p in hair_sources.items():
        hair_pics[style], _ = variant(p, base, f'hair:{style}')
    hair_hexes = []
    for style, pic in hair_pics.items():
        valpha = key_alpha(pic, os.path.join(work, f'hair-{style}-alpha.png'))
        m, d = change_mask(bald, pic, (yy < P('pelvis')[1] + torso * 0.6))
        # Hair over the background is "changed" against the bald picture's background only where the
        # variant's own silhouette has it: clip to that silhouette.
        m &= (valpha > 127).astype(np.uint8)
        # Outside the edit, the variant should equal the bald picture: global drift.
        outside = (cv2.dilate(m, np.ones((25, 25), np.uint8)) == 0) & ~head
        drift[f'hair:{style}'] = round(float(d[outside].mean()), 2)
        a = np.minimum(feather(m), valpha)
        over_body = (body_alpha > 127)
        back_a = np.where(over_body, 0, a).astype(np.uint8)
        # Hair over the skull is front hair (it covers the bald head); over the rest of the body too.
        front_a = np.where(over_body, a, 0).astype(np.uint8)
        front_a = cv2.GaussianBlur(front_a, (0, 0), 0.6)
        hex_ = median_color(pic, m * 255)
        hair_hexes.append(hex_)
        rc = [{'kind': 'hair', 'base': hex_}]
        when = {'hair.back': style}
        emit(f'hair-{style}-back', 'hairBack', rgba(pic, back_a), Z['hairBack'], when, rc)
        emit(f'hair-{style}-front', 'hairFront', rgba(pic, front_a), Z['hairFront'], when, rc)
        # The two halves together, over the bald picture, must give the variant back.
        measure(f'hair-{style}', rgba(pic, np.maximum(back_a, front_a)), bald, pic, m)

    # Outfit items and expressions: vs the base picture.
    supports_w = {}
    for slot, items in spec.get('wardrobe', {}).items():
        for item, p in items.items():
            v, _ = variant(p, base, f'{slot}:{item}')
            valpha = key_alpha(v, os.path.join(work, f'{slot}-{item}-alpha.png'))
            m, d = change_mask(base, v, ~head)
            m &= (valpha > 127).astype(np.uint8)
            outside = (cv2.dilate(m, np.ones((25, 25), np.uint8)) == 0)
            drift[f'{slot}:{item}'] = round(float(d[outside].mean()), 2)
            a = np.minimum(feather(m), valpha)
            emit(f'{slot}-{item}', 'clothing', rgba(v, a), Z.get(slot, 20), {f'wardrobe.{slot}': item}, check=(base, v, m))
            supports_w.setdefault(slot, []).append(item)
    expr = ['neutral']
    for e, p in spec.get('expressions', {}).items():
        v, _ = variant(p, base, f'expression:{e}')
        m, d = change_mask(base, v, face, threshold=10, min_island=30)
        drift[f'expression:{e}'] = round(float(d[~head].mean()), 2)
        a = feather(m, 3, 2.5)
        emit(f'expr-{e}', 'expression', rgba(v, a), Z['expression'], {'expression': e}, check=(base, v, m))
        expr.append(e)

    cages = cages_from(kp, body_alpha)
    template = {
        'format': 'everloom-studio-template', 'version': 1, 'id': spec['id'], 'name': spec['name'], 'category': spec.get('category', 'standing'),
        'rating': spec.get('rating', 'all-ages'), 'width': W, 'height': H, 'tags': spec.get('tags', []),
        'supports': {'hairBack': list(hair_pics), 'expressions': expr, 'wardrobe': supports_w},
        'slots': [{
            'id': 'a', 'sex': spec.get('sex', ['female']), 'layers': layers, 'cages': cages, 'rig': rig_from(kp, cages),
            'keypoints': {k: rnd(v) for k, v in kp.items() if k != 'view'},
        }],
    }

    # Gates.
    g = report['gates']
    g['alignment_px'] = max(v['shift_px'] for v in report['variants'].values())
    g['reconstruction_de'] = max(recon.values()) if recon else 0
    g['halo_px'] = max(halos.values()) if halos else 0
    g['swap_holes_px'] = swap_holes
    g['drift_de'] = max(drift.values()) if drift else 0
    report['per_layer'] = {'reconstruction_de': recon, 'halo_px': halos, 'drift_de': drift}
    for k, limit in GATES.items():
        if g[k] > limit:
            worst = {'reconstruction_de': recon, 'halo_px': halos, 'drift_de': drift}.get(k)
            who = max(worst, key=worst.get) if worst else ''
            report['failed'].append(f'gate {k}: {g[k]} over {limit} {who}'.strip())
    report['ok'] = not report['failed']

    # Write the pack.
    pack_dir = os.path.join(out, spec['id'])
    os.makedirs(pack_dir, exist_ok=True)
    for name, px in files.items():
        Image.fromarray(px, 'RGBA').save(os.path.join(pack_dir, name), optimize=True)
    with open(os.path.join(pack_dir, 'template.json'), 'w') as f:
        json.dump(template, f, indent=1)
    zpath = os.path.join(out, f"{spec['id']}.zip")
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
        for name in sorted(os.listdir(pack_dir)):
            z.write(os.path.join(pack_dir, name), f"{spec['id']}/{name}")
    with open(os.path.join(out, f"{spec['id']}-report.json"), 'w') as f:
        json.dump(report, f, indent=1)
    contact_sheet(base, bald, body_alpha, hair_pics, files, layers, kp, cages, os.path.join(out, f"{spec['id']}-sheet.png"))
    print(json.dumps({'ok': report['ok'], 'gates': g, 'failed': report['failed'], 'zip': zpath}))
    return report


def contact_sheet(base, bald, alpha, hair_pics, files, layers, kp, cages, path):
    """Tiles: the base, the keyed body with cages and keypoints, then one tile per layer drawn over
    the body (what the compositor will do), small."""
    H, W = base.shape[:2]
    s = 256 / H
    tw = int(W * s)
    tiles = [base]
    dbg = over(np.full_like(base, 235), rgba(bald, alpha)).copy()
    for c in cages:
        cv2.polylines(dbg, [np.int32(c['rest'])], True, (40, 120, 220), 2)
        cv2.polylines(dbg, [np.int32(c['max'])], True, (220, 80, 40), 1)
    for k, v in kp.items():
        if k != 'view':
            cv2.circle(dbg, (int(v[0]), int(v[1])), 5, (0, 160, 0), -1)
    tiles.append(dbg)
    body = over(np.full_like(base, 235), rgba(bald, alpha))
    for l in layers:
        if l['part'] == 'body':
            continue
        full = np.zeros((H, W, 4), np.uint8)
        x, y, w, h = l['rect']
        full[y:y + h, x:x + w] = files[l['file']]
        t = body.copy()
        # Hair styles show back + front together.
        if l['part'] == 'hairFront':
            back = next((b for b in layers if b['id'] == l['id'].replace('-front', '-back')), None)
            if back:
                bf = np.zeros((H, W, 4), np.uint8)
                bx, by, bw, bh = back['rect']
                bf[by:by + bh, bx:bx + bw] = files[back['file']]
                t = over(np.full_like(base, 235), bf)
                t = over(t, rgba(bald, alpha))
        elif l['part'] == 'hairBack':
            continue
        tiles.append(over(t, full))
    small = [cv2.resize(t, (tw, 256), interpolation=cv2.INTER_AREA) for t in tiles]
    cols = 6
    rows = (len(small) + cols - 1) // cols
    sheet = np.full((rows * 256, cols * tw, 3), 255, np.uint8)
    for i, t in enumerate(small):
        r, c = divmod(i, cols)
        sheet[r * 256:(r + 1) * 256, c * tw:(c + 1) * tw] = t
    Image.fromarray(sheet).save(path)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    r = run(sys.argv[1], sys.argv[2])
    sys.exit(0 if r['ok'] else 1)
