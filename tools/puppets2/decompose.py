#!/usr/bin/env python3
"""
Puppets v2 decomposition (docs/puppets-v2/pipeline.md › Decomposition): one full-body picture of one
view, optionally with its See-through layers, becomes a view of a character pack that Everloom
auto-rigs on import (apps/server/src/services/puppets2/store.ts).

    python3 tools/puppets2/decompose.py --image base.png --view front --out samples/gen/puppets2/ines \
        [--layers seethrough/ines] [--keypoints kp.json] [--adult-image nude.png] \
        [--outfit-image casual=dressed.png] [--variant smile=smile.png --variant wave_L=wave.png] \
        [--name Ines] [--rating 18+] [--zip]

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
    if view == 'side':
        # In profile (facing left) only the near side, the character's left, is really visible; the
        # detector's left/right labels split that one limb. Keep the more confident point of each
        # pair as the near limb (the far limbs become darker copies of it).
        raw = dict(raw)
        for j in ('shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'bigToe', 'smallToe', 'heel'):
            if f'{j}_L' in raw and f'{j}_R' in raw:
                best = raw[f'{j}_L'] if raw[f'{j}_L'][2] >= raw[f'{j}_R'][2] else raw[f'{j}_R']
                raw[f'{j}_L'] = raw[f'{j}_R'] = best
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
    # Hands start a little before the wrist (the wrist crease belongs to the hand sprite).
    wrist_in = lambda s: g(f'wrist_{s}') + (g(f'elbow_{s}') - g(f'wrist_{s}')) * 0.08
    d = [
        np.where(below_neck, np.maximum(torso - half * 0.75, 0), torso),
        chain_dist(px, py, [g('neck'), g('headTop')]) * 0.8,
        chain_dist(px, py, [g('shoulder_L'), g('elbow_L'), wrist_in('L')]),
        chain_dist(px, py, [g('shoulder_R'), g('elbow_R'), wrist_in('R')]),
        chain_dist(px, py, [g('hip_L'), g('knee_L'), g('ankle_L'), foot('L')]),
        chain_dist(px, py, [g('hip_R'), g('knee_R'), g('ankle_R'), foot('R')]),
        chain_dist(px, py, [wrist_in('L'), hand('L')]) * 0.95,
        chain_dist(px, py, [wrist_in('R'), hand('R')]) * 0.95,
    ]
    # A limb is only as thick as a limb: pixels farther from its bones than that belong to the body
    # (in profile the arm lies over the torso; in front views this keeps the armpits on the torso).
    H = float(max(kp['ankle_L'][1], kp['ankle_R'][1]) - kp['headTop'][1])
    side = kp.get('view') == 'side'
    radius = {2: (0.03 if side else 0.045) * H, 3: (0.03 if side else 0.045) * H, 6: 0.05 * H, 7: 0.05 * H, 4: 0.1 * H, 5: 0.1 * H}
    for i, r in radius.items():
        d[i] = np.where(d[i] > r, np.inf, d[i])
    return np.argmin(np.stack(d), axis=0).astype(np.uint8)


REGION_ROLES = {0: 'torso', 1: 'head', 2: 'arm_L', 3: 'arm_R', 4: 'leg_L', 5: 'leg_R', 6: 'hand_L', 7: 'hand_R'}
FACE_VARIANTS = {'eyes_closed', 'mouth_a', 'mouth_i', 'mouth_u', 'mouth_e', 'mouth_o', 'smile', 'angry', 'sad', 'surprised', 'blush', 'cry'}
HAND_VARIANTS = {'open', 'wave', 'fist', 'point'}
CLOTH_SPLIT = {  # clothing role → {region: role} when it runs down the limbs
    'topwear': {0: 'topwear', 2: 'sleeve_upper_L', 3: 'sleeve_upper_R'},
    'bottomwear': {0: 'bottomwear', 4: 'legwear_L', 5: 'legwear_R'},
    'legwear': {4: 'legwear_L', 5: 'legwear_R', 0: 'bottomwear'},
    'footwear': {4: 'footwear_L', 5: 'footwear_R'},
    'handwear': {6: 'handwear_L', 7: 'handwear_R', 2: 'handwear_L', 3: 'handwear_R'},
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
    """
    Cuts one layer by region; returns {role: (mask, alpha multiplier)}. Each piece also takes the
    pixels in its joint caps; a cap given to the torso fades out from the joint (it shows only when
    the limb in front moves away, and then a soft edge reads as skin, a hard one as a flap).
    """
    h, w = reg.shape
    alpha = rgba[:, :, 3] > 8
    py, px = np.mgrid[0:h, 0:w]
    pieces = {}
    for region, role in mapping.items():
        own = (reg == region) & alpha
        m = own.copy()
        mult = np.ones((h, w), np.float32)
        if cap:
            soft = np.zeros((h, w), np.float32)
            for creg, c, r in caps(kp, height):
                if creg != region:
                    continue
                d = np.hypot(px - c[0], py - c[1])
                m |= (d < r) & alpha
                if region == 0:
                    soft = np.maximum(soft, np.clip((r - d) / (0.6 * r), 0, 1))
            if region == 0:
                mult = np.where(own, 1.0, soft).astype(np.float32)
        if m.sum() < 40:
            continue
        # Every cut overlaps its neighbour by a few pixels: filtered edges never let the background through.
        grown = (cv2.dilate(own.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0) & alpha
        mult = np.where(grown & ~own, 1.0, mult).astype(np.float32)
        m |= grown
        if role in pieces:
            pm, pmult = pieces[role]
            pieces[role] = (pm | m, np.maximum(pmult, mult))
        else:
            pieces[role] = (m, mult)
    return pieces


def with_mult(rgba, mult):
    out = rgba.copy()
    out[:, :, 3] = (out[:, :, 3].astype(np.float32) * mult).astype(np.uint8)
    return out


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

COLORS = [(230, 120, 80), (250, 210, 80), (90, 160, 240), (70, 200, 160), (180, 110, 230), (240, 100, 170), (40, 90, 200), (30, 150, 110)]
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
    if args.stylized:
        args.no_bust = True  # no bust layers or bounce on a big-headed body
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
    islands = [0]
    filled_share = 0.0
    def add(role, mask, arr, outfit=None, adult=False, suffix=''):
        lid = (role + suffix).replace('/', '_')
        n = 2
        while any(l['id'] == lid for l in out_layers):
            lid = f'{role}{suffix}_{n}'
            n += 1
        # Noise islands: detached specks (a few pixels an edit or a key left behind) are dropped;
        # how many is reported by the gates.
        n_lab, lab, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
        if n_lab > 2:
            areas = stats[1:, cv2.CC_STAT_AREA]
            small = [i + 1 for i, a in enumerate(areas) if a < max(30, 0.02 * areas.max())]
            if small:
                islands[0] += len(small)
                mask = mask & ~np.isin(lab, small)
        out_layers.append({'id': lid, 'role': role, 'mask': mask, 'rgba': arr, 'outfit': outfit, 'adult': adult})

    for src in sources:
        arr = src['rgba']
        if src['role'] == 'body':
            pieces = split_layer(arr, reg, kp, REGION_ROLES, height)
            for role, (m, mult) in pieces.items():
                if role == 'torso':
                    arr2, holes = inpaint_holes(arr, m, (reg == 2) | (reg == 3) | (reg == 6) | (reg == 7))
                    filled_share = float(holes.sum()) / max(1, float((m | holes).sum()))
                    add(role, m | holes, with_mult(arr2, np.where(holes, 1.0, mult)))
                else:
                    add(role, m, with_mult(arr, mult))
        elif src['role'] in CLOTH_SPLIT:
            for role, (m, mult) in split_layer(arr, reg, kp, CLOTH_SPLIT[src['role']], height, cap=src['role'] in ('topwear',)).items():
                add(role, m, with_mult(arr, mult), outfit=args.outfit_name)
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

    # Extra pictures of the same view (made with the edit model from the base picture, so aligned):
    # outfits (the clothes = what differs from the base), the adult layer, and sprite variants.
    py_, px_ = np.mgrid[0:h, 0:w]
    hip_y = (kp['hip_L'][1] + kp['hip_R'][1]) / 2
    waist_y = hip_y - 0.1 * (hip_y - kp['neck'][1])
    knee_y = (kp['knee_L'][1] + kp['knee_R'][1]) / 2

    def changed(other, zone=None, thresh=40):
        d = (np.abs(other[:, :, :3].astype(int) - rgba[:, :, :3].astype(int)).sum(axis=2) > thresh) | ((other[:, :, 3] > 8) != (rgba[:, :, 3] > 8))
        d &= other[:, :, 3] > 8
        if zone is not None:
            d &= zone
        d = cv2.morphologyEx(d.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        d = cv2.morphologyEx(d, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8)) > 0
        n, lab, stats, _ = cv2.connectedComponentsWithStats(d.astype(np.uint8))
        keep = np.zeros_like(d)
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] >= 30:
                keep |= lab == i
        return keep

    def feathered(other, mask, grow=5, soft=2.5):
        m = cv2.dilate(mask.astype(np.uint8), np.ones((grow * 2 + 1, grow * 2 + 1), np.uint8)).astype(np.float32)
        m = cv2.GaussianBlur(m, (0, 0), soft)
        out = other.copy()
        out[:, :, 3] = (out[:, :, 3].astype(np.float32) * np.clip(m, 0, 1)).astype(np.uint8)
        return out, (m > 0.02) & (other[:, :, 3] > 8)

    for spec in args.outfit_image:
        name, path = spec.split('=', 1)
        other = load_rgba(path, (w, h))
        diff = changed(other)
        if not diff.any():
            print(f'outfit {name}: no change found')
            continue
        masked = other.copy()
        masked[~diff, 3] = 0
        # A skirt joins the legs: clothing across the gap between the thighs, halfway to the knees.
        # (Sampled a little below the crotch, where the legs of an A-pose are apart: a short skirt
        # still covers it, trousers leave it empty.)
        cx = int(round(kp['pelvis'][0]))
        skirt = False
        for f in (0.15, 0.25, 0.35):
            gy = int(hip_y + f * (knee_y - hip_y))
            if rgba[gy, cx, 3] < 128:
                skirt = bool(other[gy, cx, 3] > 128 and diff[max(0, gy - 3):gy + 4, max(0, cx - 3):cx + 4].mean() > 0.5)
                break
        # A garment is the same in every view: an outfit already found to be a skirt stays one.
        cj = os.path.join(args.out, 'character.json')
        if not skirt and os.path.exists(cj):
            prev = json.load(open(cj))
            skirt = any(l.get('outfit') == name and l['role'] == 'skirt' for v, vv in prev['views'].items() if v != args.view for l in vv['layers'])
        lower = {0: 'skirt' if skirt else 'bottomwear'}
        if skirt:
            lower.update({4: 'skirt', 5: 'skirt'})
        pieces = split_layer(masked, reg, kp, {0: 'topwear', 2: 'sleeve_upper_L', 3: 'sleeve_upper_R', 4: 'legwear_L', 5: 'legwear_R', 6: 'handwear_L', 7: 'handwear_R'}, height, cap=True)
        top = pieces.pop('topwear', None)
        if top is not None:
            tm, tmult = top
            pieces['topwear'] = (tm & (py_ < waist_y), tmult)
            below = tm & (py_ >= waist_y)
            if below.sum() > 40:
                pieces[lower[0]] = (below | (pieces[lower[0]][0] if lower[0] in pieces else np.zeros_like(below)), tmult)
        if skirt:
            sk = pieces.get('skirt', (np.zeros((h, w), bool), np.ones((h, w), np.float32)))[0]
            for side in ('legwear_L', 'legwear_R'):
                if side in pieces:
                    lm, _ = pieces.pop(side)
                    sk |= lm & (py_ < knee_y)
                    rest = lm & (py_ >= knee_y)
                    if rest.sum() > 40:
                        pieces['footwear_' + side[-1]] = (rest, np.ones((h, w), np.float32))
            pieces['skirt'] = (sk, np.ones((h, w), np.float32))
        for role, (m, mult) in pieces.items():
            if role.startswith('handwear_'):
                # Gloves cover most of the hand; a few changed pixels are the edit drifting.
                hand = (reg == (6 if role.endswith('L') else 7)) & (rgba[:, :, 3] > 8)
                if m.sum() < 0.35 * max(1, hand.sum()):
                    continue
            if m.sum() >= 40:
                add(role, m, with_mult(masked, mult), outfit=name, suffix=f'_{name}')
        # The top over the bust moves with it.
        if args.view in ('front', 'threeQuarter') and not args.no_bust and 'topwear' in pieces:
            r = 0.05 * height
            for side in SIDES:
                c = kp[f'breast_{side}']
                dd = np.hypot((px_ - c[0]) / (r * 1.1), (py_ - c[1] - 0.25 * r) / r)
                soft = np.clip((1.0 - dd) / 0.35, 0, 1)
                m = (soft > 0) & pieces['topwear'][0]
                if m.sum() > 40:
                    add(f'chestwear_{side}', m, with_mult(masked, soft.astype(np.float32)), outfit=name, suffix=f'_{name}')
        print(f'outfit {name}: {"skirt" if skirt else "trousers/none"}; ' + ', '.join(sorted(pieces)))

    if args.adult_image:
        other = load_rgba(args.adult_image, (w, h))
        pieces = split_layer(other, reg, kp, {0: 'torso'}, height, cap=False)
        for role, (m, mult) in pieces.items():
            add(role, m, with_mult(other, mult), adult=True, suffix='_adult')

    head_zone = cv2.dilate(((reg == 1) & (rgba[:, :, 3] > 8)).astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
    for spec in args.variant:
        name, path = spec.split('=', 1)
        other = load_rgba(path, (w, h))
        if name in FACE_VARIANTS:
            diff = changed(other, head_zone, thresh=30)
            if diff.sum() < 30:
                print(f'variant {name}: no change found in the face')
                continue
            arr, m = feathered(other, diff)
            add('face', m, arr, suffix=f'_{name}')
            out_layers[-1]['variant'] = name
        elif name.rsplit('_', 1)[0] in HAND_VARIANTS and name[-2:] in ('_L', '_R'):
            pose, side = name.rsplit('_', 1)
            hreg = 6 if side == 'L' else 7
            wr = np.array(kp[f'wrist_{side}'], float)
            el = np.array(kp[f'elbow_{side}'], float)
            # Where is that hand in the variant picture? An edit often moves the whole arm (a raised
            # waving arm); then the hand is found by pose detection and carried back to the rest hand
            # along the forearm, so the sprite sits in the hand bone's frame.
            vwr, vel = wr, el
            if not args.keypoints_only:
                try:
                    vraw = detect_keypoints(other[:, :, :3])
                    if vraw[f'wrist_{side}'][2] > 0.3 and vraw[f'elbow_{side}'][2] > 0.3:
                        vwr = np.array(vraw[f'wrist_{side}'][:2], float)
                        vel = np.array(vraw[f'elbow_{side}'][:2], float)
                except SystemExit:
                    pass
            vtip = vwr + (vwr - vel) / max(1e-6, np.linalg.norm(vwr - vel)) * 0.12 * height
            vzone = (chain_dist(px_.astype(np.float32), py_.astype(np.float32), [vtip.astype(np.float32), vwr.astype(np.float32)]) < 0.045 * height) & (other[:, :, 3] > 8)
            # Not the forearm: only what lies beyond the wrist.
            fd = (vwr - vel) / max(1e-6, np.linalg.norm(vwr - vel))
            vzone &= ((px_ - vwr[0]) * fd[0] + (py_ - vwr[1]) * fd[1]) > -0.01 * height
            if vzone.sum() < 50:
                print(f'variant {name}: no hand found')
                continue
            # Similarity transform: variant wrist → rest wrist, variant forearm direction → rest forearm direction.
            a_v = math.atan2(fd[1], fd[0])
            rd = (wr - el) / max(1e-6, np.linalg.norm(wr - el))
            a_r = math.atan2(rd[1], rd[0])
            rot = math.degrees(a_r - a_v)
            M = cv2.getRotationMatrix2D((float(vwr[0]), float(vwr[1])), -rot, 1.0)
            M[:, 2] += wr - vwr
            src = other.copy()
            src[~vzone, 3] = 0
            warped = cv2.warpAffine(src, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            m = warped[:, :, 3] > 8
            arr, m2 = feathered(warped, m, grow=0, soft=0.8)
            add(f'hand_{side}', m2, arr, suffix=f'_{pose}')
            out_layers[-1]['variant'] = pose
        else:
            print(f'variant {name}: unknown (face: {sorted(FACE_VARIANTS)}; hands: <open|wave|fist|point>_<L|R>)')

    report = gates(kp, raw, alpha, [l for l in out_layers if not l['outfit'] and not l['adult'] and not l.get('variant')], args.view, height, args.min_heads)
    report.append({'gate': 'noise islands removed (specks detached from their layer)', 'value': islands[0], 'need': 'reported; specks never reach the pack', 'pass': True})
    # An arm drawn across the body hides torso that has to be invented: a little is fine, a lot shows.
    report.append({'gate': 'torso hidden by the arms (filled in)', 'value': round(filled_share, 3), 'need': '<= 0.12 (draw the arms a little away from the body)', 'pass': filled_share <= 0.12})
    os.makedirs(os.path.join(args.out, args.view), exist_ok=True)
    json.dump(report, open(os.path.join(args.out, f'gates-{args.view}.json'), 'w'), indent=1)
    contact_sheet(rgba, kp, reg, out_layers, report, os.path.join(args.out, f'contact-{args.view}.png'))
    # Stylized proportions (a big-headed mascot) are allowed for all-ages packs only, when asked for.
    if args.stylized:
        if args.adult_image or args.rating == '18+':
            raise SystemExit('--stylized is for all-ages packs only: 18+ packs and adult layers need adult proportions.')
        for r in report:
            if r['gate'].startswith('adult proportions') and not r['pass']:
                r['pass'] = True
                r['need'] += '; stylized all-ages pack: allowed, and the server keeps adult content off it'
    fails = [r for r in report if not r['pass']]
    for r in report:
        print(('ok   ' if r['pass'] else 'FAIL ') + f"{r['gate']}: {r['value']} (need {r['need']})")
    if fails and not args.force:
        raise SystemExit(f'{len(fails)} gate(s) failed: no pack written (see contact-{args.view}.png).')
    if any(r['gate'].startswith('adult proportions') and not r['pass'] for r in report):
        raise SystemExit('Child proportions: never packed, whatever --force says (an all-ages mascot can use --stylized).')

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
        if l.get('variant'):
            e['variant'] = l['variant']
        entries.append(e)
    cj = os.path.join(args.out, 'character.json')
    pack = json.load(open(cj)) if os.path.exists(cj) else {'name': args.name, 'rating': args.rating, 'views': {}}
    if args.adult_image:
        pack['rating'] = '18+'
    pack['views'][args.view] = {'keypoints': kp, 'layers': entries}
    if args.stylized:
        pack['physics'] = {**pack.get('physics', {}), 'bust': 0, 'butt': 0}
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
    ap.add_argument('--variant', action='append', default=[], metavar='NAME=PATH', help='the same picture with a face or hand change: eyes_closed, mouth_a…mouth_o, smile, angry, sad, surprised, blush, cry; wave_L, open_R, fist_L, point_R… (repeatable)')
    ap.add_argument('--name', default='Character')
    ap.add_argument('--rating', default='all-ages', choices=['all-ages', '18+'])
    ap.add_argument('--min-heads', type=float, default=5.5)
    ap.add_argument('--no-bust', action='store_true', help='no breast layers (flat chest, or bounce not wanted)')
    ap.add_argument('--force', action='store_true', help='write the pack despite failed gates (never for child proportions)')
    ap.add_argument('--stylized', action='store_true', help='all-ages only: allow big-headed (stylized) proportions')
    ap.add_argument('--keypoints-only', action='store_true', help='never run pose detection (variants assume the rest pose)')
    ap.add_argument('--zip', action='store_true')
    a = ap.parse_args()
    if a.out.startswith(('docs', 'apps', 'packages')):
        sys.exit('Generated art never goes in the repository: write to samples/gen/ (git-ignored).')
    run(a)
