#!/usr/bin/env python3
"""
Removes a flat background from a character picture (docs/puppets.md › Making a template or a
character) before it goes to See-through: the background colour is read from the corners, then
everything connected to the border within a colour distance of it (and the floor shadow, which is
a little darker) becomes transparent. Only connected pixels go, so a garment the colour of the
background survives as long as its outline separates it.

    python3 tools/puppets/key.py in.jpg out.png [--tol 16] [--shadow 22]

When that keeps more than half the picture (a gradient background), it falls back to a fill that
follows the background from neighbour to neighbour instead.
"""
import argparse

import cv2
import numpy as np
from PIL import Image


def key_gradient(img, step=3):
    """
    For backgrounds that change across the picture (gradients, vignettes): a flood fill from every
    border pixel that compares each pixel with its neighbour, not with one colour, so it follows a
    smooth gradient and stops at the figure's outline.
    """
    rgb = np.ascontiguousarray(np.asarray(img.convert('RGB')))
    h, w, _ = rgb.shape
    mask = np.zeros((h + 2, w + 2), np.uint8)
    flags = 4 | cv2.FLOODFILL_MASK_ONLY | (255 << 8)
    work = rgb.copy()
    seeds = [(x, 0) for x in range(0, w, 8)] + [(x, h - 1) for x in range(0, w, 8)] + [(0, y) for y in range(0, h, 8)] + [(w - 1, y) for y in range(0, h, 8)]
    for sx, sy in seeds:
        if mask[sy + 1, sx + 1]:
            continue
        cv2.floodFill(work, mask, (sx, sy), (0, 0, 0), (step,) * 3, (step,) * 3, flags)
    bg = mask[1:-1, 1:-1] > 0
    fg = (~bg).astype(np.uint8) * 255
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    alpha = cv2.GaussianBlur(fg, (3, 3), 0.7)
    return Image.fromarray(np.dstack([rgb, alpha]), 'RGBA')


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
    src = Image.open(a.src)
    im, bg = key(src, a.tol, a.shadow)
    # A figure rarely covers more than half the frame: if more is kept, the background wasn't flat.
    if (np.asarray(im)[..., 3] > 0).mean() > 0.5:
        im = key_gradient(src)
        print('background not flat: keyed by neighbouring colours instead')
    im.save(a.dst)
    print(f'{a.dst}: background {bg.astype(int).tolist()}, {int((np.asarray(im)[..., 3] > 0).mean() * 100)}% kept')
