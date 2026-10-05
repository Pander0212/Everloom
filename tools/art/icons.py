#!/usr/bin/env python3
"""Cuts generated icon sheets into single pixel-art icons with one grid, one palette, one outline.

    python3 tools/art/icons.py tools/art/icon-sheets.json

Each sheet in the JSON is {"file": raw image, "rows": 4, "cols": 4, "names": [16 keys]}.
For every cell: find the icon on the flat background (flood fill from the cell's edges), crop,
shrink onto a 32x32 grid, harden the alpha, then map every icon to one shared palette
(octree over all icons, which keeps small saturated hues) and give it a 1-pixel dark outline where the edge is missing.
Output: apps/web/public/art/items/<key>.png (32x32, drawn at 2x/3x with pixelated scaling) and
a contact sheet for review.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RAW = os.environ.get('ART_RAW_DIR', os.path.join(ROOT, '.art-raw'))
OUT = os.path.join(ROOT, 'apps', 'web', 'public', 'art', 'items')
GRID = 32
PALETTE_SIZE = 64
OUTLINE = (43, 29, 24)  # the dark brown outline every icon shares
KEY = (255, 0, 255)


def cut_cell(cell):
    """Returns the icon on a transparent background, cropped to its bounds (full resolution).

    The background is what can be reached from the cell's edge without crossing the icon, where
    the icon is every pixel clearly different from the background colour, grown by 3 px first so
    a light highlight or a small gap in the outline doesn't let the background flood inside.
    """
    w, h = cell.size
    rgb = cell.convert('RGB')
    edge = [rgb.getpixel((x, y)) for x in range(0, w, 4) for y in (0, h - 1)] + [rgb.getpixel((x, y)) for y in range(0, h, 4) for x in (0, w - 1)]
    bg = tuple(sorted(c[i] for c in edge)[len(edge) // 2] for i in range(3))
    diff = Image.new('L', (w, h), 0)
    dp, px = diff.load(), rgb.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            dp[x, y] = 255 if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 36 else 0
    barrier = diff.filter(ImageFilter.MaxFilter(7))
    for s in [(x, 0) for x in range(0, w, 8)] + [(x, h - 1) for x in range(0, w, 8)] + [(0, y) for y in range(0, h, 8)] + [(w - 1, y) for y in range(0, h, 8)]:
        if barrier.getpixel(s) == 0:
            ImageDraw.floodfill(barrier, s, 128)
    reach = barrier.point(lambda v: 255 if v == 128 else 0).filter(ImageFilter.MaxFilter(7))
    alpha = reach.point(lambda v: 0 if v else 255)
    rgba = cell.convert('RGBA')
    rgba.putalpha(alpha)
    box = alpha.getbbox()
    if not box:
        return None
    return rgba.crop(box)


def to_grid(icon):
    """Shrinks onto the 32x32 grid (30 px max, centred) with a hard alpha edge."""
    w, h = icon.size
    scale = (GRID - 2) / max(w, h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    # Premultiply so edge colours don't pick up the removed background.
    small = icon.resize((nw, nh), Image.BOX)
    a = small.getchannel('A').point(lambda v: 255 if v >= 110 else 0)
    small.putalpha(a)
    canvas = Image.new('RGBA', (GRID, GRID), (0, 0, 0, 0))
    canvas.paste(small, ((GRID - nw) // 2, (GRID - nh) // 2), small)
    return canvas


def drop_specks(icon, share=0.12):
    """Removes islands of opaque pixels much smaller than the icon's main body (stray specks the
    cut picked up from a neighbouring cell or the background)."""
    alpha = icon.getchannel('A')
    a = alpha.load()
    seen = set()
    comps = []
    for y in range(GRID):
        for x in range(GRID):
            if a[x, y] and (x, y) not in seen:
                stack, comp = [(x, y)], []
                seen.add((x, y))
                while stack:
                    cx, cy = stack.pop()
                    comp.append((cx, cy))
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < GRID and 0 <= ny < GRID and a[nx, ny] and (nx, ny) not in seen:
                            seen.add((nx, ny))
                            stack.append((nx, ny))
                comps.append(comp)
    biggest = max((len(c) for c in comps), default=0)
    for comp in comps:
        if len(comp) < max(4, biggest * share):
            for cx, cy in comp:
                a[cx, cy] = 0
    icon.putalpha(alpha)
    return icon


def add_outline(icon):
    """Any opaque pixel touching transparency (4-neighbour) that is light becomes outline; and
    transparent pixels outside a light edge get none (keeps the silhouette size)."""
    px = icon.load()
    out = icon.copy()
    op = out.load()
    for y in range(GRID):
        for x in range(GRID):
            r, g, b, a = px[x, y]
            if not a:
                continue
            edge = any(not (0 <= x + dx < GRID and 0 <= y + dy < GRID) or px[x + dx, y + dy][3] == 0 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if edge and (r * 0.3 + g * 0.59 + b * 0.11) > 70:
                op[x, y] = OUTLINE + (255,)
    return out


def main(spec_path):
    spec = json.load(open(spec_path))
    os.makedirs(OUT, exist_ok=True)
    icons = {}
    for sheet in spec['sheets']:
        img = Image.open(os.path.join(RAW, sheet['file'])).convert('RGB')
        W, H = img.size
        rows, cols = sheet['rows'], sheet['cols']
        for i, name in enumerate(sheet['names']):
            if not name:
                continue
            r, c = divmod(i, cols)
            x0, y0 = round(c * W / cols), round(r * H / rows)
            x1, y1 = round((c + 1) * W / cols), round((r + 1) * H / rows)
            cut = cut_cell(img.crop((x0, y0, x1, y1)))
            if cut is None:
                print('empty cell', sheet['file'], name)
                continue
            icons[name] = drop_specks(to_grid(cut))
    # One palette for every icon: octree over all of them side by side.
    names = sorted(icons)
    strip = Image.new('RGB', (GRID * len(names), GRID), OUTLINE)
    for i, n in enumerate(names):
        strip.paste(icons[n].convert('RGB'), (i * GRID, 0), icons[n])
    pal = strip.quantize(PALETTE_SIZE - 1, method=Image.Quantize.FASTOCTREE)
    palette = pal.getpalette()[: (PALETTE_SIZE - 1) * 3] + list(OUTLINE)
    pimg = Image.new('P', (1, 1))
    pimg.putpalette(palette + [0] * (768 - len(palette)))
    for n in names:
        ic = icons[n]
        q = ic.convert('RGB').quantize(palette=pimg, dither=Image.Dither.NONE).convert('RGBA')
        q.putalpha(ic.getchannel('A'))
        q = add_outline(q)
        q.save(os.path.join(OUT, f'{n}.png'), optimize=True)
        icons[n] = q
    # Contact sheet for review (3x).
    cols = 16
    rows = (len(names) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * GRID * 3, rows * GRID * 3), (238, 236, 232, 255))
    for i, n in enumerate(names):
        r, c = divmod(i, cols)
        big = icons[n].resize((GRID * 3, GRID * 3), Image.NEAREST)
        sheet.paste(big, (c * GRID * 3, r * GRID * 3), big)
    sheet.save(os.path.join(RAW, 'icons-contact.png'))
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump(names, f)
    print(len(names), 'icons ->', OUT)


if __name__ == '__main__':
    main(sys.argv[1])
