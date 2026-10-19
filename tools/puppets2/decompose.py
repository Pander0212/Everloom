#!/usr/bin/env python3
"""
Puppets v2 decomposition (docs/puppets-v2/pipeline.md › Decomposition): one full-body picture of one
view, optionally with its See-through layers, becomes a view of a character pack that Everloom
auto-rigs on import (apps/server/src/services/puppets2/store.ts).

    python3 tools/puppets2/decompose.py --image base.png --view front --out samples/gen/puppets2/ines \
        [--layers seethrough/ines] [--keypoints kp.json] [--adult-image nude.png] \
        [--outfit casual --outfit-image dressed.png] [--name Ines] [--rating 18+] [--zip]

Steps
  1. keypoints: RTMPose (Halpe-26: head top, neck, mid-hip, feet; rtmlib, Apache-2.0, CPU) unless
     --keypoints gives them; converted to Everloom's standard landmarks (skeleton.ts).
  2. layers: See-through layers mapped to roles by name (hair, face, clothes…); without them the
     picture is one body layer.
  3. limb split: the body (and clothes that run down the limbs) is cut into torso, head, arms and
     legs by the nearest bone, each limb keeping a round cap over its root joint (shoulder, hip) so
     a bent joint never shows a gap. Elbows and knees stay inside one skinned mesh.
  4. occlusion fill: holes left in the torso where an arm was drawn over it are inpainted.
  5. gates (numbers, all written to gates.json; any failure stops the pack): keypoint confidence,
     limb symmetry, adult proportions (at least 5.5 heads tall: a body drawn with child proportions
     is refused), silhouette coverage, joint-cap overlap, A-pose arm angles, layer sizes.
  6. contact sheet: picture, skeleton, region map and every layer, for review.

Outputs go to --out (git-ignored samples/gen/…): character.json, <view>/<layer>.png, gates-<view>.json,
contact-<view>.png, and with --zip a pack.zip ready for Settings › Puppets › Import a character pack.
"""
import argparse
import json
import math
import os
import sys
import zipfile

import cv2
import numpy as np
from PIL import Image, ImageDraw

SIDES = ('L', 'R')
# See-through layer names → roles (anything unknown goes to "other", on the chest).
NAME_ROLES = [
    ('hair_back', ('back hair', 'hair back', 'hairback', '後ろ髪')),
    ('hair_front', ('front hair', 'hair front', 'bangs', '前髪', 'hair')),
    ('headwear', ('headwear', 'hat', 'cap')),
    ('face', ('face', 'eye', 'iris', 'brow', 'mouth', 'nose', 'lash', '顔', '目', '口')),
    ('neck', ('neck',)),
    ('topwear', ('topwear', 'top', 'shirt', 'jacket', 'coat', 'dress')),
    ('bottomwear', ('bottomwear', 'bottom', 'skirt', 'shorts', 'pants', 'trousers')),
    ('legwear', ('legwear', 'socks', 'stockings', 'tights')),
    ('footwear', ('footwear', 'shoe', 'boot')),
    ('handwear', ('handwear', 'glove')),
    ('body', ('body', 'skin', 'arm', 'leg', 'hand', 'torso')),
]


def role_for(name):
    n = name.lower()
    for role, words in NAME_ROLES:
        if any(w in n for w in words):
            return role
    return 'other'


# ---------------------------------------------------------------------------------- keypoints

def detect_keypoints(rgb):
    """RTMPose body-with-feet (Halpe-26) on the picture; returns {name: (x, y, score)}."""
    from rtmlib import BodyWithFeet
    model = BodyWithFeet(mode='balanced', backend='onnxruntime', device='cpu')
    kps, scores = model(rgb[:, :, ::-1].copy())
    if len(kps) == 0:
        raise SystemExit('No person found in the picture.')
    i = int(np.argmax(scores.mean(axis=1)))
    names = ['nose', 'eye_L', 'eye_R', 'ear_L', 'ear_R', 'shoulder_L', 'shoulder_R', 'elbow_L', 'elbow_R', 'wrist_L', 'wrist_R',
             'hip_L', 'hip_R', 'knee_L', 'knee_R', 'ankle_L', 'ankle_R', 'headTop', 'neck', 'pelvis',
             'bigToe_L', 'bigToe_R', 'smallToe_L', 'smallToe_R', 'heel_L', 'heel_R']
    return {n: (float(kps[i][k][0]), float(kps[i][k][1]), float(scores[i][k])) for k, n in enumerate(names)}


def standard_keypoints(raw, alpha, view):
    """Halpe-26 (or already-standard) points → Everloom landmarks, with the head top from the silhouette."""
    P = lambda n: np.array(raw[n][:2], dtype=float)
    neck = P('neck') if 'neck' in raw else (P('shoulder_L') + P('shoulder_R')) / 2
    pelvis = P('pelvis') if 'pelvis' in raw else (P('hip_L') + P('hip_R')) / 2
    # The head top: the highest opaque pixel above the head (more reliable than the model's point).
    hx = int(round(P('headTop')[0] if 'headTop' in raw else neck[0]))
    cols = alpha[:, max(0, hx - 3):hx + 4].max(axis=1)
    ys = np.nonzero(cols > 128)[0]
    head_top = np.array([hx, float(ys[0])]) if len(ys) else P('headTop')
    kp = {'view': view, 'headTop': head_top, 'neck': neck, 'pelvis': pelvis, 'chest': neck + (pelvis - neck) * 0.38}
    for s in SIDES:
        for j in ('shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'):
            kp[f'{j}_{s}'] = P(f'{j}_{s}')
        if f'bigToe_{s}' in raw:
            kp[f'toe_{s}'] = (P(f'bigToe_{s}') + P(f'smallToe_{s}')) / 2
        # Breasts and buttocks: from the torso landmarks (the auto-rig only needs a pivot).
        sh, hp = kp[f'shoulder_{s}'], kp[f'hip_{s}']
        kp[f'breast_{s}'] = sh + (hp - sh) * 0.22 + (neck - sh) * 0.35 * np.array([1, 0])
        kp[f'butt_{s}'] = hp + (pelvis - hp) * 0.4 + np.array([0, (hp[1] - neck[1]) * 0.05])
    return {k: (v if isinstance(v, str) else [round(float(v[0]), 1), round(float(v[1]), 1)]) for k, v in kp.items()}


# ---------------------------------------------------------------------------------- regions

def seg_dist(px, py, a, b):
    """Distance from every pixel to the segment a→b."""
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy or 1e-9
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1)
    return np.hypot(px - (ax + t * dx), py - (ay + t * dy))


def chain_dist(px, py, pts):
    return np.min([seg_dist(px, py, pts[i], pts[i + 1]) for i in range(len(pts) - 1)], axis=0)


def regions(shape, kp):
    """Nearest-bone region of every pixel: 0 torso, 1 head, 2 arm L, 3 arm R, 4 leg L, 5 leg R."""
    h, w = shape
    py, px = np.mgrid[0:h, 0:w].astype(np.float32)
    g = lambda n: np.array(kp[n], dtype=np.float32)
    hand = lambda s: g(f'wrist_{s}') + (g(f'wrist_{s}') - g(f'elbow_{s}')) * 0.45
    foot = lambda s: np.array(kp[f'toe_{s}'], dtype=np.float32) if kp.get(f'toe_{s}') else g(f'ankle_{s}') + np.array([0, 0.04 * (g(f'ankle_{s}')[1] - g('headTop')[1])], dtype=np.float32)
    # The torso is a thick line: its distance is reduced by the body's half-width so that pixels
    # between the shoulders and hips belong to it rather than to the limbs that start at its edges.
    half = 0.5 * np.linalg.norm(g('shoulder_L') - g('shoulder_R'))
    below_neck = py > g('neck')[1] - 0.15 * half
    torso = chain_dist(px, py, [g('pelvis'), g('chest'), g('neck')])
    d = [
        np.where(below_neck, np.maximum(torso - half * 0.75, 0), torso),
        chain_dist(px, py, [g('neck'), g('headTop')]) * 0.8,
        chain_dist(px, py, [g('shoulder_L'), g('elbow_L'), g('wrist_L'), hand('L')]),
        chain_dist(px, py, [g('shoulder_R'), g('elbow_R'), g('wrist_R'), hand('R')]),
        chain_dist(px, py, [g('hip_L'), g('knee_L'), g('ankle_L'), foot('L')]),
        chain_dist(px, py, [g('hip_R'), g('knee_R'), g('ankle_R'), foot('R')]),
    ]
    return np.argmin(np.stack(d), axis=0).astype(np.uint8)


REGION_ROLES = {0: 'torso', 1: 'head', 2: 'arm_L', 3: 'arm_R', 4: 'leg_L', 5: 'leg_R'}
CLOTH_SPLIT = {  # clothing role → {region: role} when it runs down the limbs
    'topwear': {0: 'topwear', 2: 'sleeve_upper_L', 3: 'sleeve_upper_R'},
    'bottomwear': {0: 'bottomwear', 4: 'legwear_L', 5: 'legwear_R'},
    'legwear': {4: 'legwear_L', 5: 'legwear_R', 0: 'bottomwear'},
    'footwear': {4: 'footwear_L', 5: 'footwear_R'},
    'handwear': {2: 'handwear_L', 3: 'handwear_R'},
}


def caps(kp, height):
    """
    Joint caps: (region that keeps the extra pixels, joint centre, radius). The cap goes to the layer
    drawn behind at that joint: the torso under the shoulders (arms are drawn in front of the body),
    the legs under the hips (legs are drawn behind it). When the joint bends, the cap fills the gap.
    """
    out = []
    for s, leg in (('L', 4), ('R', 5)):
        out.append((0, kp[f'shoulder_{s}'], 0.035 * height))
        out.append((leg, kp[f'hip_{s}'], 0.06 * height))
    # The crotch: the torso (in front of the legs) keeps the tops of both thighs, so a swinging or
    # swaying leg never opens a gap between them.
    hy = (kp['hip_L'][1] + kp['hip_R'][1]) / 2
    out.append((0, [(kp['hip_L'][0] + kp['hip_R'][0]) / 2, hy + 0.035 * height], 0.045 * height))
    return out


def split_layer(rgba, reg, kp, mapping, height, cap=True):
    """Cuts one layer by region; each limb piece also takes the pixels in its root joint's cap."""
    h, w = reg.shape
    alpha = rgba[:, :, 3] > 8
    py, px = np.mgrid[0:h, 0:w]
    pieces = {}
    for region, role in mapping.items():
        m = (reg == region) & alpha
        if cap:
            for creg, c, r in caps(kp, height):
                if creg == region:
                    m |= (np.hypot(px - c[0], py - c[1]) < r) & alpha
        if m.sum() < 40:
            continue
        # Every cut overlaps its neighbour by a few pixels: filtered edges never let the background through.
        m = cv2.dilate(m.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0
        m &= alpha
        pieces.setdefault(role, np.zeros((h, w), bool))
        pieces[role] |= m
    return pieces


def inpaint_holes(rgba, mask, covered):
    """
    Fills the torso where an arm was drawn over it: pixels opaque in the picture, given to an arm
    (`covered`), and inside the torso's span on their row. The background is never filled.
    """
    h, w = mask.shape
    span = np.zeros_like(mask)
    rows = np.nonzero(mask.any(axis=1))[0]
    for y in rows:
        xs = np.nonzero(mask[y])[0]
        span[y, xs[0]:xs[-1] + 1] = True
    holes = span & covered & ~mask & (rgba[:, :, 3] > 128)
    if holes.sum() == 0:
        return rgba, holes
    rgb = np.ascontiguousarray(rgba[:, :, :3])
    # Inpaint from the torso's own pixels only: everything else is masked out as unknown too.
    unknown = (~mask).astype(np.uint8) * 255
    out = cv2.inpaint(rgb, unknown, 7, cv2.INPAINT_TELEA)
    res = rgba.copy()
    res[holes, :3] = out[holes]
    res[holes, 3] = 255
    return res, holes


# ---------------------------------------------------------------------------------- gates

def gates(kp, raw, alpha, layers, view, height, min_heads=5.5):
    g = lambda n: np.array(kp[n], dtype=float)
    L = lambda a, b: float(np.linalg.norm(g(a) - g(b)))
    res = []
    add = lambda name, value, ok, need: res.append({'gate': name, 'value': round(value, 3) if isinstance(value, float) else value, 'need': need, 'pass': bool(ok)})
    if raw:
        core = [k for k in ('shoulder_L', 'shoulder_R', 'elbow_L', 'elbow_R', 'wrist_L', 'wrist_R', 'hip_L', 'hip_R', 'knee_L', 'knee_R', 'ankle_L', 'ankle_R') if k in raw]
        conf = min(raw[k][2] for k in core) if core else 1.0
        add('keypoint confidence (min, core joints)', conf, conf >= 0.3, '>= 0.3')
    if view in ('front', 'back'):
        for a, b, c in (('upper arms', ('shoulder_L', 'elbow_L'), ('shoulder_R', 'elbow_R')), ('forearms', ('elbow_L', 'wrist_L'), ('elbow_R', 'wrist_R')), ('thighs', ('hip_L', 'knee_L'), ('hip_R', 'knee_R')), ('shins', ('knee_L', 'ankle_L'), ('knee_R', 'ankle_R'))):
            l1, l2 = L(*b), L(*c)
            asym = abs(l1 - l2) / max(1e-6, (l1 + l2) / 2)
            add(f'symmetry: {a}', asym, asym <= 0.2, '<= 0.20')
        for s in SIDES:
            # A-pose: the upper arm 15–65° away from the torso line.
            down = g('pelvis') - g('neck')
            arm = g(f'elbow_{s}') - g(f'shoulder_{s}')
            ang = math.degrees(math.acos(max(-1, min(1, float(np.dot(down, arm) / (np.linalg.norm(down) * np.linalg.norm(arm) + 1e-9))))))
            add(f'A-pose: arm {s} away from the body (deg)', ang, 15 <= ang <= 65, '15–65')
    # Head top → neck base is about 1.1–1.25 heads (the neck point sits between the shoulders).
    head = L('headTop', 'neck') * 0.9
    heads = height / max(head, 1e-6)
    add('adult proportions: height in heads', heads, heads >= min_heads, f'>= {min_heads} (child proportions are refused)')
    union = np.zeros(alpha.shape, bool)
    for l in layers:
        union |= l['mask']
    src = alpha > 128
    cov = float((union & src).sum() / max(1, src.sum()))
    add('silhouette coverage by the layers', cov, cov >= 0.995, '>= 0.995')
    for s in (SIDES if view != 'side' else ('L',)):
        for part, joint in (('arm', 'shoulder'), ('leg', 'hip')):
            role = f'{part}_{s}'
            limb = next((l for l in layers if l['role'] == role), None)
            torso = next((l for l in layers if l['role'] == 'torso'), None)
            if limb is None or torso is None:
                add(f'joint cap {joint} {s}', 0, False, 'limb and torso layers')
                continue
            c = kp[f'{joint}_{s}']
            h, w = alpha.shape
            py, px = np.mgrid[0:h, 0:w]
            near = np.hypot(px - c[0], py - c[1]) < 0.03 * height
            ov = float((limb['mask'] & torso['mask'] & near).sum())
            add(f'joint cap {joint} {s}: overlap px', ov, ov >= 20, '>= 20')
    small = [l['id'] for l in layers if l['mask'].sum() < 60]
    add('no empty layers', len(small), not small, '0')
    return res


# ---------------------------------------------------------------------------------- sheet

COLORS = [(230, 120, 80), (250, 210, 80), (90, 160, 240), (70, 200, 160), (180, 110, 230), (240, 100, 170)]
BONES = [('headTop', 'neck'), ('neck', 'chest'), ('chest', 'pelvis')] + [(a + s, b + s) for s in ('_L', '_R') for a, b in (('shoulder', 'elbow'), ('elbow', 'wrist'), ('hip', 'knee'), ('knee', 'ankle'))] + [('neck', 'shoulder_L'), ('neck', 'shoulder_R'), ('pelvis', 'hip_L'), ('pelvis', 'hip_R')]


def contact_sheet(rgba, kp, reg, layers, report, path):
    h, w = rgba.shape[:2]
    s = 360 / h
    tw, th = int(w * s), 360
    def thumb(arr):
        im = Image.fromarray(arr, 'RGBA').resize((tw, th))
        bg = Image.new('RGBA', (tw, th), (236, 240, 244, 255))
        bg.alpha_composite(im)
        return bg
    a = thumb(rgba)
    b = thumb(rgba)
    d = ImageDraw.Draw(b)
    for p, q in BONES:
        if p in kp and q in kp:
            d.line([(kp[p][0] * s, kp[p][1] * s), (kp[q][0] * s, kp[q][1] * s)], fill=(220, 40, 60), width=3)
    for k, v in kp.items():
        if isinstance(v, list):
            d.ellipse([v[0] * s - 3, v[1] * s - 3, v[0] * s + 3, v[1] * s + 3], fill=(30, 30, 30))
    cm = np.zeros((h, w, 4), np.uint8)
    for i, c in enumerate(COLORS):
        cm[reg == i, :3] = c
    cm[:, :, 3] = (rgba[:, :, 3] > 8) * 255
    c_im = thumb(cm)
    cells = [a, b, c_im]
    for l in layers:
        cell = Image.new('RGBA', (tw, th), (236, 240, 244, 255))
        arr = np.zeros((h, w, 4), np.uint8)
        arr[l['mask']] = l['rgba'][l['mask']]
        cell.alpha_composite(Image.fromarray(arr, 'RGBA').resize((tw, th)))
        ImageDraw.Draw(cell).text((4, 4), f"{l['id']} ({l['role']})", fill=(20, 20, 20))
        cells.append(cell)
    cols = 6
    rows = math.ceil(len(cells) / cols)
    fails = [r for r in report if not r['pass']]
    sheet = Image.new('RGBA', (cols * tw, rows * th + 22 + 14 * len(report)), (255, 255, 255, 255))
    for i, c in enumerate(cells):
        sheet.paste(c, ((i % cols) * tw, (i // cols) * th))
    dd = ImageDraw.Draw(sheet)
    y = rows * th + 4
    dd.text((4, y), f"gates: {len(report) - len(fails)}/{len(report)} pass", fill=(20, 20, 20) if not fails else (200, 30, 30))
    for r in report:
        y += 14
        dd.text((4, y), f"{'ok  ' if r['pass'] else 'FAIL'} {r['gate']}: {r['value']} (need {r['need']})", fill=(20, 120, 40) if r['pass'] else (200, 30, 30))
    sheet.convert('RGB').save(path)


# ---------------------------------------------------------------------------------- main

def load_rgba(path, size=None):
    im = Image.open(path).convert('RGBA')
    if size and im.size != size:
        raise SystemExit(f'{path} is {im.size}, expected {size} (all pictures of a view share one canvas)')
    return np.array(im)


def run(args):
    rgba = load_rgba(args.image)
    h, w = rgba.shape[:2]
    alpha = rgba[:, :, 3]
    if alpha.min() == 255:
        raise SystemExit('The picture has no transparency: remove the background first (Everloom keys plain backgrounds on import of v1 puppets; for v2 give a transparent PNG).')
    raw = None
    if args.keypoints:
        kp = json.load(open(args.keypoints))
        if 'shoulder_L' in kp and isinstance(kp['shoulder_L'], list) and len(kp['shoulder_L']) == 3:
            raw = {k: tuple(v) for k, v in kp.items() if isinstance(v, list)}
            kp = standard_keypoints(raw, alpha, args.view)
        else:
            kp.setdefault('view', args.view)
    else:
        raw = detect_keypoints(rgba[:, :, :3])
        kp = standard_keypoints(raw, alpha, args.view)
    ys = np.nonzero(alpha.max(axis=1) > 128)[0]
    height = float(ys[-1] - ys[0]) if len(ys) else float(h)
    reg = regions((h, w), kp)

    # Source layers: See-through's, or the picture as one body layer.
    sources = []
    if args.layers:
        idx = json.load(open(os.path.join(args.layers, 'layers.json')))
        for l in idx['layers']:
            arr = load_rgba(os.path.join(args.layers, l['file']), (w, h)) if 'file' in l else None
            if arr is None:
                continue
            sources.append({'name': l['name'], 'role': role_for(l['name']), 'rgba': arr})
    else:
        sources.append({'name': 'body', 'role': 'body', 'rgba': rgba})

    out_layers = []
    filled_share = 0.0
    def add(role, mask, arr, outfit=None, adult=False, suffix=''):
        lid = (role + suffix).replace('/', '_')
        n = 2
        while any(l['id'] == lid for l in out_layers):
            lid = f'{role}{suffix}_{n}'
            n += 1
        out_layers.append({'id': lid, 'role': role, 'mask': mask, 'rgba': arr, 'outfit': outfit, 'adult': adult})

    for src in sources:
        arr = src['rgba']
        if src['role'] == 'body':
            pieces = split_layer(arr, reg, kp, REGION_ROLES, height)
            for role, m in pieces.items():
                if role == 'torso':
                    arr2, holes = inpaint_holes(arr, m, (reg == 2) | (reg == 3))
                    filled_share = float(holes.sum()) / max(1, float((m | holes).sum()))
                    add(role, m | holes, arr2)
                else:
                    add(role, m, arr)
        elif src['role'] in CLOTH_SPLIT:
            for role, m in split_layer(arr, reg, kp, CLOTH_SPLIT[src['role']], height, cap=src['role'] in ('topwear',)).items():
                add(role, m, arr, outfit=args.outfit_name)
        else:
            add(src['role'], arr[:, :, 3] > 8, arr, outfit=args.outfit_name if src['role'] in ('headwear', 'other') else None)

    # Profile: the far limbs are hidden behind the near ones in the picture. They become darker
    # copies of the near limbs, drawn behind the body, so a walk shows both legs.
    if args.view == 'side':
        for near, far, z in (('arm_L', 'arm_R', 3), ('leg_L', 'leg_R', 4)):
            n = next((l for l in out_layers if l['role'] == near), None)
            f = next((l for l in out_layers if l['role'] == far), None)
            if n is not None and (f is None or f['mask'].sum() < 0.3 * n['mask'].sum()):
                if f is not None:
                    out_layers.remove(f)
                arr = n['rgba'].copy()
                arr[:, :, :3] = (arr[:, :, :3] * 0.82).astype(np.uint8)
                add(far, n['mask'].copy(), arr)
                out_layers[-1]['z'] = z

    # Breasts (front and three-quarter views): a soft-edged copy over the torso, on the breast bones,
    # so the bounce moves them without opening a seam (the torso underneath stays whole).
    if args.view in ('front', 'threeQuarter') and not args.no_bust:
        base = next((l for l in out_layers if l['role'] == 'torso' and not l['adult']), None)
        if base is not None:
            py_, px_ = np.mgrid[0:h, 0:w]
            r = 0.05 * height
            for side in SIDES:
                c = kp[f'breast_{side}']
                d = np.hypot((px_ - c[0]) / (r * 1.1), (py_ - c[1] - 0.25 * r) / r)
                soft = np.clip((1.0 - d) / 0.35, 0, 1)
                m = (soft > 0) & base['mask']
                arr = base['rgba'].copy()
                arr[:, :, 3] = (arr[:, :, 3] * soft).astype(np.uint8)
                add(f'breast_{side}', m, arr)

    # Extra pictures of the same view: outfits (clothes = what differs from the base) and the adult layer.
    for spec, is_adult in [(o, False) for o in args.outfit_image] + ([(f'adult={args.adult_image}', True)] if args.adult_image else []):
        name, path = spec.split('=', 1)
        other = load_rgba(path, (w, h))
        if is_adult:
            # The nude body over the underwear base: only torso, breasts and hips (where the underwear is).
            pieces = split_layer(other, reg, kp, {0: 'torso'}, height, cap=False)
            for role, m in pieces.items():
                add(role, m, other, adult=True, suffix='_adult')
        else:
            diff = (np.abs(other.astype(int) - rgba.astype(int)).sum(axis=2) > 40) & (other[:, :, 3] > 8)
            diff = cv2.morphologyEx(diff.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
            masked = other.copy()
            masked[~diff, 3] = 0
            for role, m in split_layer(masked, reg, kp, {0: 'topwear', 2: 'sleeve_upper_L', 3: 'sleeve_upper_R', 4: 'legwear_L', 5: 'legwear_R'}, height, cap=True).items():
                add(role, m, other, outfit=name, suffix=f'_{name}')

    report = gates(kp, raw, alpha, [l for l in out_layers if not l['outfit'] and not l['adult']], args.view, height, args.min_heads)
    # An arm drawn across the body hides torso that has to be invented: a little is fine, a lot shows.
    report.append({'gate': 'torso hidden by the arms (filled in)', 'value': round(filled_share, 3), 'need': '<= 0.12 (draw the arms a little away from the body)', 'pass': filled_share <= 0.12})
    os.makedirs(os.path.join(args.out, args.view), exist_ok=True)
    json.dump(report, open(os.path.join(args.out, f'gates-{args.view}.json'), 'w'), indent=1)
    contact_sheet(rgba, kp, reg, out_layers, report, os.path.join(args.out, f'contact-{args.view}.png'))
    fails = [r for r in report if not r['pass']]
    for r in report:
        print(('ok   ' if r['pass'] else 'FAIL ') + f"{r['gate']}: {r['value']} (need {r['need']})")
    if fails and not args.force:
        raise SystemExit(f'{len(fails)} gate(s) failed: no pack written (see contact-{args.view}.png).')
    if any(r['gate'].startswith('adult proportions') and not r['pass'] for r in report):
        raise SystemExit('Child proportions: never packed, whatever --force says.')

    # Write the layers (cropped) and the view's entry in character.json.
    entries = []
    for l in out_layers:
        ys, xs = np.nonzero(l['mask'])
        if not len(xs):
            continue
        x0, y0, x1, y1 = max(0, xs.min() - 2), max(0, ys.min() - 2), min(w, xs.max() + 3), min(h, ys.max() + 3)
        crop = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
        sub = l['mask'][y0:y1, x0:x1]
        crop[sub] = l['rgba'][y0:y1, x0:x1][sub]
        Image.fromarray(crop, 'RGBA').save(os.path.join(args.out, args.view, f"{l['id']}.png"), optimize=True)
        e = {'id': l['id'], 'role': l['role'], 'rect': [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]}
        if l['outfit']:
            e['outfit'] = l['outfit']
        if l['adult']:
            e['adult'] = True
        if l.get('z') is not None:
            e['z'] = l['z']
        entries.append(e)
    cj = os.path.join(args.out, 'character.json')
    pack = json.load(open(cj)) if os.path.exists(cj) else {'name': args.name, 'rating': args.rating, 'views': {}}
    if args.adult_image:
        pack['rating'] = '18+'
    pack['views'][args.view] = {'keypoints': kp, 'layers': entries}
    json.dump(pack, open(cj, 'w'), indent=1)
    print(f'{args.view}: {len(entries)} layers → {args.out}')
    if args.zip:
        with zipfile.ZipFile(os.path.join(args.out, 'pack.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
            z.write(cj, 'character.json')
            for v in pack['views']:
                for e in pack['views'][v]['layers']:
                    z.write(os.path.join(args.out, v, f"{e['id']}.png"), f"{v}/{e['id']}.png")
        print('pack:', os.path.join(args.out, 'pack.zip'))


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--image', required=True)
    ap.add_argument('--view', default='front', choices=['front', 'threeQuarter', 'side', 'back'])
    ap.add_argument('--out', required=True)
    ap.add_argument('--layers', help='a See-through result folder (layers.json + PNGs)')
    ap.add_argument('--keypoints', help='JSON: Everloom landmarks, or Halpe-26 names with [x, y, score]')
    ap.add_argument('--outfit-image', action='append', default=[], metavar='NAME=PATH', help='the same pose wearing an outfit (repeatable)')
    ap.add_argument('--outfit-name', default=None, help='outfit set for clothes found in --layers')
    ap.add_argument('--adult-image', help='the same pose nude (18+ pack): its torso becomes the adult layer')
    ap.add_argument('--name', default='Character')
    ap.add_argument('--rating', default='all-ages', choices=['all-ages', '18+'])
    ap.add_argument('--min-heads', type=float, default=5.5)
    ap.add_argument('--no-bust', action='store_true', help='no breast layers (flat chest, or bounce not wanted)')
    ap.add_argument('--force', action='store_true', help='write the pack despite failed gates (never for child proportions)')
    ap.add_argument('--zip', action='store_true')
    a = ap.parse_args()
    if a.out.startswith(('docs', 'apps', 'packages')):
        sys.exit('Generated art never goes in the repository: write to samples/gen/ (git-ignored).')
    run(a)
