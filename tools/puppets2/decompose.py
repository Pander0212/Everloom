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


def default_cut_lines(alpha, kp, crotch_width=0.02):
    """
    The owner's cut lines (reviewed with cutmap.py), as polylines in picture pixels: each arm ends at
    a line from the top of the shoulder down to the armpit; each leg at the groin crease, from the
    outer hip down to the crotch and then down the inner thigh, the genitals staying on the torso.
    """
    a = alpha > 128
    h, w = a.shape
    H = float(max(kp['ankle_L'][1], kp['ankle_R'][1]) - kp['headTop'][1])
    lines = {}
    cx = (kp['hip_L'][0] + kp['hip_R'][0]) / 2
    for s in SIDES:
        sx, sy = kp[f'shoulder_{s}']
        ex = kp[f'elbow_{s}'][0]
        out = 1 if ex > sx else -1
        # The armpit: walking out from the shoulder, the first column where the figure's run below
        # the shoulder becomes arm-thin (the torso side no longer continues down).
        x_pit, y_pit = sx, sy + 0.05 * H
        for x in range(int(sx), int(sx + out * 0.12 * H), out):
            if not (0 <= x < w):
                break
            col = a[int(sy):, x]
            run = int(np.argmin(col)) if not col.all() else len(col)
            if run < 0.12 * H:
                x_pit, y_pit = x, sy + run
                break
        top = np.nonzero(a[:, int(np.clip(x_pit, 0, w - 1))])[0]
        y_top = float(top[0]) if len(top) else sy - 0.03 * H
        # From the top of the shoulder diagonally out and down to where the arm's lower edge begins,
        # past the armpit fold (the fold stays on the torso).
        x2 = int(np.clip(x_pit + out * 0.035 * H, 0, w - 1))
        col = a[int(sy):, x2]
        y_bot = sy + (int(np.argmin(col)) if not col.all() else 0.05 * H)
        mid = [(x_pit + x2) / 2 - out * 0.006 * H, (y_top + y_bot) / 2]
        lines[f'arm_{s}'] = [[x_pit, y_top - 2], mid, [x2, y_bot + 3]]
        # The torso keeps a round shoulder under the arm, out to a line about here (drawn behind
        # the arm, it shows when the arm moves).
        xs = x_pit + out * 0.026 * H
        cs = a[:, int(np.clip(xs, 0, w - 1))]
        ys_top = float(np.nonzero(cs)[0][0]) if cs.any() else y_top
        lines[f'shoulder_{s}'] = [[xs - out * 0.004 * H, ys_top + 1], [xs, (ys_top + y_bot) / 2], [xs - out * 0.008 * H, y_bot - 2]]
        # The leg: outer hip edge a little above the hip joint, diagonally to the crotch, then down.
        hx, hy = kp[f'hip_{s}']
        side = 1 if hx > cx else -1
        y0 = hy - 0.045 * H
        row = np.nonzero(a[int(y0)])[0]
        x0 = float(row.max() if side > 0 else row.min()) if len(row) else hx + side * 0.06 * H
        # The gap between the legs starts where the centre column turns empty below the hips (on a
        # man that's below the hanging genitals, which stay on the torso).
        colc = a[int(hy):, int(cx)]
        gap = hy + (int(np.argmin(colc)) if not colc.all() else 0.15 * H)
        gx = cx + side * crotch_width * H
        # Diagonally from the outer hip to the side of the genitals, then round under them into the gap.
        # (It meets the gap right at its top: lower, it would take the inner outlines of the thighs.)
        lines[f'leg_{s}'] = [[x0 + side * 6, y0], [gx, gap - 0.025 * H], [cx + side * 0.002 * H, gap + 0.002 * H], [cx, gap + 0.03 * H]]
    return lines


def apply_cut_lines(reg, alpha, kp, lines):
    """Moves the limb/torso boundary to the cut lines, near each limb's root joint only."""
    a = alpha > 8
    h, w = reg.shape
    H = float(max(kp['ankle_L'][1], kp['ankle_R'][1]) - kp['headTop'][1])
    py, px = np.mgrid[0:h, 0:w]
    out = reg.copy()
    for name, pts in lines.items():
        if name not in ('arm_L', 'arm_R', 'leg_L', 'leg_R'):
            continue  # (shoulder_*: the torso's extent under the arm, applied with the torso layer)
        limb = {'arm_L': 2, 'arm_R': 3, 'leg_L': 4, 'leg_R': 5}[name]
        side = name[-1]
        root = kp[f'shoulder_{side}'] if name.startswith('arm') else kp[f'hip_{side}']
        seed = kp[f'elbow_{side}'] if name.startswith('arm') else kp[f'knee_{side}']
        barrier = np.zeros((h, w), np.uint8)
        cv2.polylines(barrier, [np.array(pts, np.int32)], False, 1, 2)
        near = np.hypot(px - root[0], py - root[1]) < 0.16 * H
        free = (a & (barrier == 0)).astype(np.uint8)
        n, lab = cv2.connectedComponents(free, connectivity=4)
        sl = lab[int(np.clip(seed[1], 0, h - 1)), int(np.clip(seed[0], 0, w - 1))]
        if sl == 0:
            continue
        limb_side = (lab == sl) & near
        torso_side = near & a & ~limb_side & ((out == limb) | (out == 0))
        out[limb_side & ((out == 0) | (out == limb))] = limb
        out[torso_side] = 0
    return out


def torso_shoulders(alpha, reg, lines, rgb=None):
    """
    The torso's shoulder under each arm, bounded by the owner's curve: from the top of the shoulder
    out to the shoulder line and back in, down into the armpit fold (a tall half-ellipse). Returns
    (shape, paint, arc, trim): the whole shape (the torso keeps it); the part to paint with the
    torso's skin (the upper half, where the T-posed arm lay: its flat top and outline must not show
    when the arm hangs); the outer arc of that upper half, drawn in the line colour; and what the
    torso had outside the curve below the shoulder (the fold's tip), which goes.
    """
    h, w = reg.shape
    shape = np.zeros((h, w), bool)
    paint = np.zeros((h, w), bool)
    arc = np.zeros((h, w), bool)
    trim = np.zeros((h, w), bool)
    yy, xx = np.mgrid[0:h, 0:w]
    for s in SIDES:
        if f'shoulder_{s}' not in lines or f'arm_{s}' not in lines:
            continue
        (xt, yt), (xb, yb) = lines[f'arm_{s}'][0], lines[f'arm_{s}'][-1]
        xs = lines[f'shoulder_{s}'][1][0]
        out = 1 if xs > xt else -1
        t = yb - yt  # about the arm's thickness
        ytop, ybot = yt + 2, yb + 0.3 * t
        cy = (ytop + ybot) / 2
        ctr = (int(round(xt)), int(round(cy)))
        ax = (int(round(max(4.0, abs(xs - xt)))), int(round(max(4.0, (ybot - ytop) / 2))))
        a0, a1 = (-90, 90) if out > 0 else (90, 270)
        e = np.zeros((h, w), np.uint8)
        cv2.ellipse(e, ctr, ax, 0, a0, a1, 1, -1)
        ring = np.zeros((h, w), np.uint8)
        cv2.ellipse(ring, ctr, ax, 0, a0, a1, 1, 2)
        inside = e > 0
        upper = yy < yt + 0.55 * t
        shape |= inside
        paint |= inside & upper
        arc |= (ring > 0) & upper
        trim |= (out * (xx - xt) > 0) & (yy > yt + 0.3 * t) & (yy < yb + 1.5 * t) & ~inside
    return shape, paint, arc, trim


def line_colour(rgba):
    """The figure's outline colour: the darkest tenth of its edge pixels."""
    a = rgba[:, :, 3] > 128
    edge = a & ~(cv2.erode(a.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0)
    px = rgba[edge][:, :3].astype(np.float32)
    if not len(px):
        return np.array([60, 40, 35], np.uint8)
    lum = px.mean(axis=1)
    return np.median(px[lum <= np.percentile(lum, 10)], axis=0).astype(np.uint8)


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


def caps(kp, height, shoulders=True):
    """
    Joint caps: (region that keeps the extra pixels, joint centre, radius). The cap goes to the layer
    drawn behind at that joint: the torso under the shoulders (arms are drawn in front of the body),
    the legs under the hips (legs are drawn behind it). When the joint bends, the cap fills the gap.
    """
    out = []
    for s, leg in (('L', 4), ('R', 5)):
        if shoulders:
            out.append((0, kp[f'shoulder_{s}'], 0.035 * height))
        out.append((leg, kp[f'hip_{s}'], 0.06 * height))
    # The crotch: the torso (in front of the legs) keeps the tops of both thighs, so a swinging or
    # swaying leg never opens a gap between them.
    hy = (kp['hip_L'][1] + kp['hip_R'][1]) / 2
    out.append((0, [(kp['hip_L'][0] + kp['hip_R'][0]) / 2, hy + 0.035 * height], 0.045 * height))
    return out


def split_layer(rgba, reg, kp, mapping, height, cap=True, shoulder_caps=True):
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
            for creg, c, r in caps(kp, height, shoulder_caps):
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


def place_cropped(path, layer, index, size):
    """A See-through layer saved as a crop (`left`, `top` on its square working canvas of
    index width × height, which is the picture padded to a square, centred, and resized) placed back
    on the picture's own canvas."""
    w, h = size
    side = max(w, h)
    k = side / float(index['width'])
    ox, oy = (side - w) / 2.0, (side - h) / 2.0
    crop = Image.open(path).convert('RGBA')
    cw, ch = max(1, round(crop.width * k)), max(1, round(crop.height * k))
    if (cw, ch) != crop.size:
        crop = crop.resize((cw, ch), Image.LANCZOS)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    out.alpha_composite(crop, (round(layer['left'] * k - ox), round(layer['top'] * k - oy))) if layer['left'] * k - ox >= 0 and layer['top'] * k - oy >= 0 else out.paste(crop, (round(layer['left'] * k - ox), round(layer['top'] * k - oy)), crop)
    return np.array(out)


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
    cut_lines = None
    if args.cut_lines:
        cut_lines = json.load(open(args.cut_lines)) if args.cut_lines != 'auto' else default_cut_lines(alpha, kp)
        reg = apply_cut_lines(reg, alpha, kp, cut_lines)
        os.makedirs(args.out, exist_ok=True)
        json.dump(cut_lines, open(os.path.join(args.out, f'cut-lines-{args.view}.json'), 'w'), indent=1)

    # Profile with the arms held forward: the arm's underside lies in front of the chest and the bones
    # can give it to the torso, where it would stay sticking out once the arm hangs down. Everything
    # in front of the chest at the arm's height goes to the (near) arm.
    yy_r, xx_r = np.mgrid[0:h, 0:w]
    side_leg_line = None
    if args.view == 'side':
        # Profile: the buttock and the groin belong to the torso, the thigh starts below a diagonal
        # from the front of the hip down to the fold under the buttock (a thigh swinging from a level
        # cut drags the buttock along and pokes a corner out in front of the belly).
        hy = (kp['hip_L'][1] + kp['hip_R'][1]) / 2
        row = np.nonzero(alpha[int(hy)] > 128)[0]
        wr_, sh_ = np.array(kp['wrist_L'], float), np.array(kp['shoulder_L'], float)
        facing = 1 if wr_[0] >= sh_[0] else -1
        if len(row):
            fx_, bx_ = (row.max(), row.min()) if facing > 0 else (row.min(), row.max())
            fy_, by_ = hy - 0.01 * height, hy + 0.085 * height
            line_y = fy_ + (by_ - fy_) * (xx_r - fx_) / (bx_ - fx_ if bx_ != fx_ else 1)
            legs = (reg == 4) | (reg == 5)
            reg[legs & (yy_r < line_y)] = 0
            near_leg = 4 if (reg == 4).sum() >= (reg == 5).sum() else 5
            reg[(reg == 0) & (yy_r >= line_y) & (yy_r < hy + 0.12 * height)] = near_leg
            side_leg_line = line_y
    if args.view == 'threeQuarter':
        # Three-quarter: the flank and the side of the breast under a T-posed arm are closer to the arm
        # bone than to the spine; everything below the arm's underside stays torso.
        for s_, rg in (('L', 2), ('R', 3)):
            sh_, el_ = np.array(kp[f'shoulder_{s_}'], float), np.array(kp[f'elbow_{s_}'], float)
            col = alpha[:, int(el_[0])] > 128
            ys_ = np.nonzero(col[int(el_[1] - 0.08 * height):int(el_[1] + 0.08 * height)])[0]
            if not len(ys_):
                continue
            bottom = el_[1] - 0.08 * height + ys_.max()  # the arm's underside at the elbow
            under = bottom - el_[1]
            axis_y = sh_[1] + (el_[1] - sh_[1]) * (xx_r - sh_[0]) / (el_[0] - sh_[0])
            t_ = (xx_r - sh_[0]) / (el_[0] - sh_[0])  # 0 at the shoulder, 1 at the elbow
            between = (t_ >= -0.02 * height / abs(el_[0] - sh_[0])) & (t_ <= 1)
            # The underside, column by column where the arm stands free (background below it); where it
            # merges into the flank (near the armpit) the last measured height carries on.
            sgn = np.sign(el_[0] - sh_[0])
            ux, uy = [], []
            for x in range(int(min(sh_[0], el_[0])), int(max(sh_[0], el_[0])) + 1):
                ya = int(sh_[1] + (el_[1] - sh_[1]) * (x - sh_[0]) / (el_[0] - sh_[0]))
                c_ = alpha[ya:ya + int(0.12 * height), x] > 128
                if c_.size and c_[0] and not c_.all():
                    ux.append(x); uy.append(ya + int(np.argmin(c_)))
            if len(ux) >= 8:
                # (held level past the last measured column, and never deeper than 1.6 arm half-widths)
                und = np.interp(np.arange(w), ux, uy)
                under_line = np.minimum(und[None, :], axis_y + 1.6 * under)
            else:
                under_line = axis_y + under
            reg[(reg == rg) & between & (yy_r > under_line + 2)] = 0
            # Above the underside, out past the shoulder, it is arm: the torso keeps a round shoulder
            # (the joint's own radius) and no stub of the upper arm.
            out = (xx_r - sh_[0]) * np.sign(el_[0] - sh_[0]) > 0
            r_ = 0.9 * under
            stub = (reg == 0) & out & (yy_r <= under_line + 2) & (np.hypot(xx_r - sh_[0], yy_r - sh_[1]) > r_)
            reg[stub] = rg
            zone = out & (yy_r < axis_y + under + 0.04 * height) & (yy_r > axis_y)
            tor = ((reg == 0) & (alpha > 128)).astype(np.uint8)
            thick = cv2.morphologyEx(tor, cv2.MORPH_OPEN, np.ones((13, 1), np.uint8)) > 0
            reg[zone & (tor > 0) & ~thick] = rg
    side_chest = None
    if args.view == 'side':
        near = 2 if (reg == 2).sum() >= (reg == 3).sum() else 3
        side = 'L' if near == 2 else 'R'
        sh, wr = np.array(kp[f'shoulder_{side}'], float), np.array(kp[f'wrist_{side}'], float)
        fwd = 1 if wr[0] > sh[0] else -1
        if abs(wr[0] - sh[0]) > 0.15 * height:  # the arm reaches out in front
            # The arm's lower edge, measured where the arm stands free of the body (background below
            # it), then carried back over the chest as a straight line to the shoulder.
            pts = []
            for x in range(int(min(sh[0], wr[0])), int(max(sh[0], wr[0]))):
                yc = int(sh[1] + (wr[1] - sh[1]) * (x - sh[0]) / (wr[0] - sh[0]))
                col = alpha[yc:yc + int(0.12 * height), x] > 128
                if col.size and col[0] and not col.all():
                    pts.append((x, yc + int(np.argmin(col))))
            free = [(x, y) for x, y in pts if (x - sh[0]) * fwd > 0.12 * height]
            if len(free) >= 10:
                a, b = np.polyfit([p[0] for p in free], [p[1] for p in free], 1)
                yy, xx = np.mgrid[0:h, 0:w]
                band = ((xx - sh[0]) * fwd > 0.03 * height) & (yy > sh[1] - 0.05 * height) & (yy <= a * xx + b + 2)
                reg[band & ((reg == 0) | (reg == 1))] = near
                side_chest = (sh, fwd)

    # Source layers: See-through's, or the picture as one body layer.
    sources = []
    torso_full = None
    if args.layers and args.nude_layers:
        # A nude figure: See-through files the skin under clothing names (topwear = the torso, handwear
        # = the arms, legwear = the legs…). The picture stays the body layer (split by bones as usual);
        # See-through's torso, completed where the arms covered it, replaces the torso's hidden parts.
        idx = json.load(open(os.path.join(args.layers, 'layers.json')))
        sources.append({'name': 'body', 'role': 'body', 'rgba': rgba})
        torso = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        for l in idx['layers']:
            role = role_for(l['name'])
            if 'file' not in l:
                continue
            arr = place_cropped(os.path.join(args.layers, l['file']), l, idx, (w, h)) if 'left' in l else load_rgba(os.path.join(args.layers, l['file']), (w, h))
            if role in ('topwear', 'bottomwear', 'neck'):
                torso.alpha_composite(Image.fromarray(arr))
            elif role in ('hair_back', 'hair_front', 'headwear'):
                # (The face stays the picture's: See-through's face parts come in an order that can
                # put the eye whites over the irises.)
                sources.append({'name': l['name'], 'role': role, 'rgba': arr})
        torso_full = np.array(torso)
    elif args.layers:
        idx = json.load(open(os.path.join(args.layers, 'layers.json')))
        for l in idx['layers']:
            if 'file' in l and 'left' in l:
                arr = place_cropped(os.path.join(args.layers, l['file']), l, idx, (w, h))
            else:
                arr = load_rgba(os.path.join(args.layers, l['file']), (w, h)) if 'file' in l else None
            if arr is None:
                continue
            sources.append({'name': l['name'], 'role': role_for(l['name']), 'rgba': arr})
    else:
        sources.append({'name': 'body', 'role': 'body', 'rgba': rgba})
    # Separate layer pictures aligned with the picture (a hairstyle's back and front hair cut against a
    # bald base, wings, a tail): each becomes one layer of its role, optionally drawn at its own depth
    # and on its own bones (wings behind the torso on the chest, a tail on the pelvis).
    for spec in args.extra:
        head, path = spec.split('=', 1)
        name, role, *rest = head.split(':')
        sources.append({'name': name, 'role': role, 'rgba': load_rgba(path, (w, h)), 'id': name,
                        'z': float(rest[0]) if rest and rest[0] else None, 'skin': rest[1].split(',') if len(rest) > 1 and rest[1] else None,
                        'outfit': rest[2] if len(rest) > 2 and rest[2] else None})

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

    yy_all = np.mgrid[0:h, 0:w][0]
    for src in sources:
        arr = src['rgba']
        if src['role'] == 'body':
            pieces = split_layer(arr, reg, kp, REGION_ROLES, height, shoulder_caps=cut_lines is None)
            for role, (m, mult) in pieces.items():
                if role == 'torso' and torso_full is not None:
                    # Where See-through's torso has skin the bones gave to an arm (behind the shoulder,
                    # the armpit), the torso takes it, so a raised or lowered arm never opens a notch.
                    # Hidden skin the torso takes over: behind the arms, and with --st-hips behind the tops of
                    # the legs too (a walking thigh then never shows a gap at the hip).
                    limbs = (reg == 2) | (reg == 3) | (reg == 6) | (reg == 7)
                    if not args.st_shoulders:
                        limbs[:] = False
                    if args.st_hips:
                        limbs |= ((reg == 4) | (reg == 5)) & (yy_all < (kp['hip_L'][1] + kp['hip_R'][1]) / 2 + 0.06 * height)
                    extra = (torso_full[:, :, 3] > 128) & ~m & limbs
                    arr2 = arr.copy()
                    arr2[extra] = torso_full[extra]
                    # Around the shoulders the torso is See-through's own: its contour is drawn without
                    # the arm, so the arm's outline stub doesn't stay behind on the chest.
                    yy, xx = np.mgrid[0:h, 0:w]
                    near = np.zeros((h, w), bool)
                    for sd in SIDES if args.st_shoulders else ():
                        c = kp[f'shoulder_{sd}']
                        near |= np.hypot(xx - c[0], yy - c[1]) < 0.07 * height
                    st = torso_full[:, :, 3] > 128
                    arr2[near & st] = torso_full[near & st]
                    m = (m & ~near) | (near & st & (m | extra))
                    filled_share = float(extra.sum()) / max(1, float((m | extra).sum()))
                    add(role, m | extra, with_mult(arr2, np.where(extra, 1.0, mult)))
                elif role == 'torso':
                    sh = arc = None
                    if cut_lines is not None and args.view in ('front', 'back'):
                        # (Front and back only: in three-quarter the near flank lies outside this
                        # shoulder curve and would be trimmed off with it.)
                        sh, paint, arc, trim = torso_shoulders(arr[:, :, 3] > 128, reg, cut_lines)
                        m = m & ~trim
                    arr2, holes = inpaint_holes(arr, m, (reg == 2) | (reg == 3) | (reg == 6) | (reg == 7))
                    filled_share = float(holes.sum()) / max(1, float((m | holes).sum()))
                    if sh is not None and sh.any():
                        # The shoulders: the torso's skin where the T-posed arm lay (or nothing),
                        # outlined like the rest of the figure; the armpit fold below stays as drawn.
                        own = m & (arr[:, :, 3] > 128)
                        px_ = arr[own][:, :3].astype(np.float32)
                        lum = px_.mean(axis=1)
                        skin = np.median(px_[lum >= np.percentile(lum, 60)], axis=0).astype(np.uint8)
                        arr2 = arr2.copy()
                        pnt = paint & ~m
                        arr2[pnt, :3] = skin
                        arr2[pnt, 3] = 255
                        edge = arc & ~m
                        arr2[edge, :3] = line_colour(arr)
                        arr2[edge, 3] = 255
                        keep = sh & ~paint & (arr[:, :, 3] > 128)
                        m = m | (sh & paint) | keep
                        holes = holes & ~trim
                    if side_chest is not None:
                        # Profile, arm held forward: the chest's front outline between the shoulder and
                        # the breast lay behind the arm. Rebuilt as skin up to a straight outline from the
                        # base of the neck to the top of the breast (hidden while the arm is in front).
                        csh, cf = side_chest
                        yy_ = np.mgrid[0:h, 0:w][0]
                        own = m & (arr[:, :, 3] > 128)
                        rows = (yy_ >= csh[1] - 0.06 * height) & (yy_ <= csh[1] + 0.2 * height)
                        upper = own & rows
                        xx_ = np.mgrid[0:h, 0:w][1]
                        front = lambda row: (np.nonzero(row)[0].max() if cf > 0 else np.nonzero(row)[0].min()) if row.any() else None
                        rws = [y for y in range(h) if upper[y].any()]
                        fill = np.zeros((h, w), bool)
                        if rws:
                            # A: the front of the torso at its top (the base of the neck); B: the top of the
                            # breast, the first row below the arm whose front reaches well past A.
                            ya = rws[0] + int(0.015 * height)
                            ax = front(upper[ya])
                            bpt = None
                            for y in rws:
                                fx_ = front(upper[y])
                                if y > csh[1] and fx_ is not None and (fx_ - ax) * cf > 0.05 * height:
                                    bpt = (fx_, y)
                                    break
                            if ax is not None and bpt is not None:
                                # The chest outline: a straight line from A to the top of the breast; every
                                # pixel behind it (back towards the spine) in those rows is chest.
                                bx, by = bpt
                                t = np.clip((yy_ - ya) / max(1, by - ya), 0, 1)
                                line_x = ax + (bx - ax) * t
                                inside = ((line_x - xx_) * cf >= 0) & (yy_ >= ya) & (yy_ <= by)
                                body_rows = np.zeros((h, w), bool)
                                for y in range(ya, by + 1):
                                    xs_ = np.nonzero(own[y])[0]
                                    if len(xs_):
                                        body_rows[y, xs_.min():xs_.max() + 1] = True
                                back_x = np.where(own.any(axis=1), np.where(own, xx_, w).min(axis=1) if cf > 0 else np.where(own, xx_, -1).max(axis=1), 0)
                                behind = ((xx_ - back_x[:, None]) * cf >= 0)
                                chest = inside & behind & (yy_ >= ya) & (yy_ <= by)
                                fill = chest & ~(own & (arr[:, :, 3] > 250))
                                if fill.any():
                                    px_ = arr[own][:, :3].astype(np.float32)
                                    lum = px_.mean(axis=1)
                                    skin = np.median(px_[lum >= np.percentile(lum, 60)], axis=0).astype(np.uint8)
                                    arr2 = arr2.copy()
                                    keep_px = own & chest
                                    arr2[fill & ~keep_px, :3] = skin
                                    arr2[fill, 3] = 255
                                    edge = chest & ((np.abs(line_x - xx_) < 1.6))
                                    arr2[edge, :3] = line_colour(arr)
                                    arr2[edge, 3] = 255
                                    m = m | chest
                                    mult = np.where(chest, 1.0, mult)  # (the joint-cap fade would hide it)
                            print(f'side chest: {int(fill.sum())} px rebuilt')
                    add(role, m | holes, with_mult(arr2, np.where(holes, 1.0, mult)))
                elif side_leg_line is not None and role.startswith('leg_'):
                    # Profile: the thigh carries hidden skin above its diagonal cut (behind the
                    # torso), so swinging it never opens a gap at the hip or under the buttock.
                    band = (yy_all >= side_leg_line - 0.07 * height) & (yy_all < side_leg_line) & (arr[:, :, 3] > 128)
                    cols = np.nonzero(m.any(axis=0))[0]
                    if len(cols):
                        band[:, :cols.min()] = False
                        band[:, cols.max() + 1:] = False
                    add(role, m | band, with_mult(arr, np.where(band, 1.0, mult)))
                elif cut_lines is not None and role.startswith('leg_'):
                    # The leg's hidden filler under the torso (past the cut line) is plain skin painted
                    # from the leg, not a copy of what the torso shows there (pubic hair, genitals).
                    limb = 4 if role == 'leg_L' else 5
                    filler = m & (reg != limb)
                    arr2 = arr.copy()
                    if filler.any():
                        # The leg's skin tone (the brighter half of its own pixels, so no outline or shadow).
                        own = (reg == limb) & (arr[:, :, 3] > 128)
                        px_ = arr[own][:, :3].astype(np.float32)
                        lum = px_.mean(axis=1)
                        skin = np.median(px_[lum >= np.median(lum)], axis=0) if len(px_) else np.array([230, 200, 180])
                        arr2[filler, :3] = skin.astype(np.uint8)
                    add(role, m, with_mult(arr2, mult))
                else:
                    add(role, m, with_mult(arr, mult))
        elif src['role'] in CLOTH_SPLIT:
            for role, (m, mult) in split_layer(arr, reg, kp, CLOTH_SPLIT[src['role']], height, cap=src['role'] in ('topwear',)).items():
                add(role, m, with_mult(arr, mult), outfit=args.outfit_name)
        elif 'id' in src:  # an --extra layer
            add(src['id'], arr[:, :, 3] > 8, arr, outfit=src['outfit'])
            out_layers[-1].update(role=src['role'], z=src['z'], skin=src['skin'])
        else:
            add(src['role'], arr[:, :, 3] > 8, arr, outfit=args.outfit_name if src['role'] in ('headwear', 'other') else None)

    # Profile: the far limbs are hidden behind the near ones in the picture. They become darker
    # copies of the near limbs, drawn behind the body, so a walk shows both legs.
    if args.view == 'side':
        for near, far, z in (('arm_L', 'arm_R', 3), ('hand_L', 'hand_R', 3), ('leg_L', 'leg_R', 4)):
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
        if l.get('skin'):
            e['skin'] = l['skin']
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
    ap.add_argument('--no-st-shoulders', dest='st_shoulders', action='store_false', help='with --nude-layers: keep the picture\'s own shoulders (no See-through fill around them)')
    ap.add_argument('--st-hips', action='store_true', help='with --nude-layers: See-through\'s torso also fills behind the tops of the thighs')
    ap.add_argument('--cut-lines', help="'auto' (shoulder-to-armpit and groin-crease lines) or a JSON of polylines per limb (arm_L, arm_R, leg_L, leg_R); the lines used are saved as cut-lines-<view>.json")
    ap.add_argument('--nude-layers', action='store_true', help='with --layers on a nude figure: the clothing layers are skin; use See-through for the hidden torso and the head parts')
    ap.add_argument('--keypoints', help='JSON: Everloom landmarks, or Halpe-26 names with [x, y, score]')
    ap.add_argument('--outfit-image', action='append', default=[], metavar='NAME=PATH', help='the same pose wearing an outfit (repeatable)')
    ap.add_argument('--outfit-name', default=None, help='outfit set for clothes found in --layers')
    ap.add_argument('--adult-image', help='the same pose nude (18+ pack): its torso becomes the adult layer')
    ap.add_argument('--variant', action='append', default=[], metavar='NAME=PATH', help='the same picture with a face or hand change: eyes_closed, mouth_a…mouth_o, smile, angry, sad, surprised, blush, cry; wave_L, open_R, fist_L, point_R… (repeatable)')
    ap.add_argument('--extra', action='append', default=[], metavar='ID:ROLE[:Z[:BONES[:OUTFIT]]]=PATH', help='a separate layer picture aligned with the image (hair_back, hair_front, wings…), e.g. wings:other:5:chest=wings.png; OUTFIT puts it in a wardrobe set (repeatable)')
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
