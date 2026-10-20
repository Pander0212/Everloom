#!/usr/bin/env python3
"""
Inpaint masks for a studio base picture, from its RTMPose keypoints (white = repaint): head (hair
and face), face, crotch, chest, each breast/nipple area, hands, feet. Masks are soft-edged ellipses
and boxes sized from the body's own proportions, so they fit every base.

    python3 tools/studio/masks.py base.png OUT_DIR [--keypoints kp.json]

Writes OUT_DIR/mask-<region>.png and OUT_DIR/keypoints.json, plus OUT_DIR/masks-preview.png.
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'puppets2'))


def masks_for(kp, w, h):
    P = lambda n: np.array(kp[n], dtype=float)
    neck, pelvis, top = P('neck'), P('pelvis'), P('headTop')
    torso = pelvis[1] - neck[1]
    head_h = neck[1] - top[1]
    out = {}

    def blank():
        return np.zeros((h, w), np.uint8)

    def ellipse(c, rx, ry):
        m = blank()
        cv2.ellipse(m, (int(c[0]), int(c[1])), (int(rx), int(ry)), 0, 0, 360, 255, -1)
        return m

    head_c = (top + neck) / 2
    out['head'] = ellipse(head_c - [0, head_h * 0.05], head_h * 0.95, head_h * 0.75)
    out['face'] = ellipse(head_c + [0, head_h * 0.12], head_h * 0.36, head_h * 0.42)
    hips = (P('hip_L') + P('hip_R')) / 2
    hip_w = abs(P('hip_L')[0] - P('hip_R')[0])
    out['crotch'] = ellipse(hips + [0, torso * 0.1], hip_w * 0.45, torso * 0.3)
    # Room for bigger options: hanging down (large penis, testicles) or pointing up (erect).
    out['crotch-long'] = np.maximum(out['crotch'], ellipse(hips + [0, torso * 0.35], hip_w * 0.45, torso * 0.4))
    out['crotch-up'] = np.maximum(out['crotch'], ellipse(hips - [0, torso * 0.15], hip_w * 0.45, torso * 0.4))
    for s in ('L', 'R'):
        sh, hp = P(f'shoulder_{s}'), P(f'hip_{s}')
        c = sh + (hp - sh) * 0.3
        c[0] = neck[0] + (c[0] - neck[0]) * 0.62
        out[f'breast-{s.lower()}'] = ellipse(c, torso * 0.17, torso * 0.15)
        out[f'nipple-{s.lower()}'] = ellipse(c - [0, torso * 0.04], torso * 0.06, torso * 0.06)
        out[f'hand-{s.lower()}'] = ellipse(P(f'wrist_{s}') + (P(f'wrist_{s}') - P(f'elbow_{s}')) * 0.45, torso * 0.16, torso * 0.2)
        out[f'foot-{s.lower()}'] = ellipse(P(f'ankle_{s}') + [0, torso * 0.08], torso * 0.16, torso * 0.12)
    out['belly'] = ellipse(neck + (pelvis - neck) * 0.85, hip_w * 0.5, torso * 0.22)
    sl, sr = P('shoulder_L'), P('shoulder_R')
    torso_poly = np.int32([sl + [0, -torso * 0.05], sr + [0, -torso * 0.05], P('hip_R') + [0, torso * 0.2], P('hip_L') + [0, torso * 0.2]])
    out['torso'] = blank()
    cv2.fillPoly(out['torso'], [torso_poly], 255)
    out['full'] = np.full((h, w), 255, np.uint8)
    out['chest'] = np.maximum(out['breast-l'], out['breast-r'])
    out['nipples'] = np.maximum(out['nipple-l'], out['nipple-r'])
    # Soft edges: the inpaint blends in, and the composite back over the original has no seam.
    return {k: cv2.GaussianBlur(v, (0, 0), 3) for k, v in out.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('image')
    ap.add_argument('out')
    ap.add_argument('--keypoints')
    a = ap.parse_args()
    rgb = np.array(Image.open(a.image).convert('RGB'))
    h, w = rgb.shape[:2]
    if a.keypoints:
        kp = json.load(open(a.keypoints))
    else:
        from decompose import detect_keypoints, standard_keypoints
        from rembg import new_session, remove
        alpha = np.array(remove(Image.fromarray(rgb), session=new_session('isnet-general-use')))[:, :, 3]
        kp = {k: v for k, v in standard_keypoints(detect_keypoints(rgb), alpha, 'front').items() if k != 'view'}
    os.makedirs(a.out, exist_ok=True)
    json.dump(kp, open(os.path.join(a.out, 'keypoints.json'), 'w'), indent=1)
    ms = masks_for(kp, w, h)
    for k, m in ms.items():
        Image.fromarray(m).save(os.path.join(a.out, f'mask-{k}.png'))
    prev = rgb.copy()
    colors = {'head': (255, 0, 0), 'face': (255, 160, 0), 'crotch': (0, 200, 0), 'chest': (0, 120, 255), 'nipples': (255, 0, 255)}
    for k, c in colors.items():
        a_ = ms[k][:, :, None] / 255 * 0.45
        prev = (prev * (1 - a_) + np.array(c) * a_).astype(np.uint8)
    for k in ('hand-l', 'hand-r', 'foot-l', 'foot-r'):
        cnts, _ = cv2.findContours((ms[k] > 127).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(prev, cnts, -1, (255, 255, 0), 2)
    Image.fromarray(prev).save(os.path.join(a.out, 'masks-preview.png'))
    print('wrote', len(ms), 'masks to', a.out)


if __name__ == '__main__':
    main()
