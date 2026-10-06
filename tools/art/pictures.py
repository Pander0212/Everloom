#!/usr/bin/env python3
"""Processes generated pictures into what the app ships.

    python3 tools/art/pictures.py tools/art/pictures.json

Each item: {"raw": file in .art-raw, "out": path under apps/web/public/art without extension,
"w": width, "h": height (cover-crop to this size; 0 keeps the aspect), "cutout": true to make the
flat background transparent, "tile": true to first crop a light tile off a dark backdrop, "avif": true to also write an AVIF, "manifest": {...} to list it in
art/starter/manifest.json (for the asset library and the demo character)}.
WebP is always written (quality 80; lossless-ish alpha for cut-outs).
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageOps

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
RAW = os.environ.get('ART_RAW_DIR', os.path.join(ROOT, '.art-raw'))
ART = os.path.join(ROOT, 'apps', 'web', 'public', 'art')


def cutout(img):
    """Transparent background: whatever is reachable from the edge through background-coloured
    pixels, with the subject grown by a few pixels first so light edges don't leak; soft edge."""
    rgb = img.convert('RGB')
    w, h = rgb.size
    small = rgb.resize((w // 2, h // 2), Image.BILINEAR)
    sw, sh = small.size
    edge = [small.getpixel((x, y)) for x in range(0, sw, 3) for y in (0, sh - 1)] + [small.getpixel((x, y)) for y in range(0, sh, 3) for x in (0, sw - 1)]
    bg = tuple(sorted(c[i] for c in edge)[len(edge) // 2] for i in range(3))
    diff = Image.new('L', (sw, sh), 0)
    dp, px = diff.load(), small.load()
    for y in range(sh):
        for x in range(sw):
            r, g, b = px[x, y]
            dp[x, y] = 255 if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 40 else 0
    barrier = diff.filter(ImageFilter.MaxFilter(5))
    for s in [(x, 0) for x in range(0, sw, 6)] + [(0, y) for y in range(0, sh, 6)] + [(sw - 1, y) for y in range(0, sh, 6)]:
        if barrier.getpixel(s) == 0:
            ImageDraw.floodfill(barrier, s, 128)
    reach = barrier.point(lambda v: 255 if v == 128 else 0).filter(ImageFilter.MaxFilter(5))
    alpha = reach.point(lambda v: 0 if v else 255).resize((w, h), Image.BILINEAR).filter(ImageFilter.GaussianBlur(1.2))
    out = img.convert('RGBA')
    out.putalpha(alpha)
    return out


def main(spec_path):
    spec = json.load(open(spec_path))
    manifest = []
    total = 0
    for it in spec['items']:
        img = Image.open(os.path.join(RAW, it['raw']))
        img = ImageOps.exif_transpose(img).convert('RGB')
        if it.get('tile'):
            # Drawn as an app tile on a dark backdrop: keep the light tile, minus its rounded corners.
            box = img.convert('L').point(lambda v: 255 if v > 200 else 0).getbbox()
            if box:
                x0, y0, x1, y1 = box
                m = round(min(x1 - x0, y1 - y0) * 0.07)
                img = img.crop((x0 + m, y0 + m, x1 - m, y1 - m))
        w, h = it.get('w', 0), it.get('h', 0)
        if w and h:
            img = ImageOps.fit(img, (w, h), Image.LANCZOS, centering=(0.5, 0.5))
        elif w:
            img = img.resize((w, round(img.height * w / img.width)), Image.LANCZOS)
        if it.get('cutout'):
            img = cutout(img)
            bbox = img.getchannel('A').getbbox()
            if bbox:
                img = img.crop(bbox)
        base = os.path.join(ART, it['out'])
        os.makedirs(os.path.dirname(base), exist_ok=True)
        img.save(base + '.webp', 'WEBP', quality=80, method=6, alpha_quality=90)
        size = os.path.getsize(base + '.webp')
        if it.get('avif'):
            img.save(base + '.avif', 'AVIF', quality=50, speed=4)
            size += os.path.getsize(base + '.avif')
        total += size
        if it.get('manifest'):
            m = dict(it['manifest'])
            m['file'] = os.path.relpath(base + '.webp', os.path.join(ART, 'starter'))
            manifest.append(m)
        print(f"{it['out']}: {img.size[0]}x{img.size[1]} {size // 1024} KB")
    if manifest:
        os.makedirs(os.path.join(ART, 'starter'), exist_ok=True)
        with open(os.path.join(ART, 'starter', 'manifest.json'), 'w') as f:
            json.dump(manifest, f, indent=1)
    print(f'total {total // 1024} KB')


if __name__ == '__main__':
    main(sys.argv[1])
