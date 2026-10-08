#!/usr/bin/env python3
"""
Removes a flat background from a character picture (docs/puppets.md › Making a template or a
character) before it goes to See-through: the background colour is read from the corners, then
everything connected to the border within a colour distance of it (and the floor shadow, which is
a little darker) becomes transparent. Only connected pixels go, so a garment the colour of the
background survives as long as its outline separates it.

    python3 tools/puppets/key.py in.jpg out.png [--tol 16] [--shadow 22]
"""
import argparse

import cv2
import numpy as np
from PIL import Image


def key(img, tol=16, shadow=22):
    rgb = np.asarray(img.convert('RGB')).astype(np.int16)
    h, w, _ = rgb.shape
    corners = np.concatenate([rgb[:8, :8].reshape(-1, 3), rgb[:8, -8:].reshape(-1, 3), rgb[-8:, :8].reshape(-1, 3), rgb[-8:, -8:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    d = np.abs(rgb - bg).max(axis=2)
    # Background-like: near the colour, or darker than it by up to `shadow` and grey (the shadow).
    grey = (rgb.max(axis=2) - rgb.min(axis=2)) < 10
    darker = (rgb.mean(axis=2) <= bg.mean()) & (bg.mean() - rgb.mean(axis=2) < shadow) & grey
    cand = ((d <= tol) | darker).astype(np.uint8)
    # Keep only what touches the border.
    n, lab = cv2.connectedComponents(cand, connectivity=4)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bgmask = np.isin(lab, list(edge))
    # Soft edge: one pixel of feather where the figure meets the background.
    fg = (~bgmask).astype(np.uint8) * 255
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    alpha = cv2.GaussianBlur(fg, (3, 3), 0.7)
    out = np.dstack([np.asarray(img.convert('RGB')), alpha])
    return Image.fromarray(out, 'RGBA'), bg


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('src')
    p.add_argument('dst')
    p.add_argument('--tol', type=int, default=16)
    p.add_argument('--shadow', type=int, default=22)
    a = p.parse_args()
    im, bg = key(Image.open(a.src), a.tol, a.shadow)
    im.save(a.dst)
    print(f'{a.dst}: background {bg.astype(int).tolist()}, {int((np.asarray(im)[..., 3] > 0).mean() * 100)}% kept')
