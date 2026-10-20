"""Crop-and-stitch for inpainting (the "detailer" approach): the masked region is cut out with some
context, enlarged so the model paints it at full resolution, and the result is shrunk back and
blended into the untouched original through the soft mask. Small features (nipples, genitals,
faces, piercings) get many more pixels than when the whole picture is inpainted at once."""
from PIL import Image, ImageFilter


def crop_box(mask, pad=0.35, min_pad=48, size=1024, multiple=8):
    """The region to repaint (mask bbox + context) and the size to paint it at (long side = size)."""
    W, H = mask.size
    bb = mask.point(lambda v: 255 if v > 16 else 0).getbbox()
    if not bb:
        return None, None
    x0, y0, x1, y1 = bb
    px, py = max(min_pad, (x1 - x0) * pad), max(min_pad, (y1 - y0) * pad)
    box = (max(0, int(x0 - px)), max(0, int(y0 - py)), min(W, int(x1 + px)), min(H, int(y1 + py)))
    bw, bh = box[2] - box[0], box[3] - box[1]
    k = max(1.0, size / max(bw, bh))  # enlarge small regions; never paint a region smaller than it is
    tw, th = max(multiple, round(bw * k / multiple) * multiple), max(multiple, round(bh * k / multiple) * multiple)
    return box, (tw, th)


def crop(image, mask, box, target):
    """The picture and mask cut to the box and enlarged to the paint size."""
    return image.crop(box).resize(target, Image.LANCZOS), mask.crop(box).resize(target, Image.BILINEAR)


def blackout(image, mask, level=128):
    """The control picture for an inpainting ControlNet: the area to repaint filled with black."""
    black = Image.new("RGB", image.size, (0, 0, 0))
    return Image.composite(black, image, mask.point(lambda v: 255 if v >= level else 0))


def color_match(painted, reference, mask, ring=(8, 96)):
    """Shifts the painted crop's colours (mean and spread per channel, in Lab) to match the original
    just outside the repainted area, so a region never comes back with a colour cast."""
    import numpy as np
    from PIL import ImageCms
    srgb, lab = ImageCms.createProfile("sRGB"), ImageCms.createProfile("LAB")
    to_lab = ImageCms.buildTransform(srgb, lab, "RGB", "LAB")
    to_rgb = ImageCms.buildTransform(lab, srgb, "LAB", "RGB")
    m = np.asarray(mask.resize(painted.size), dtype=np.float32)
    zone = (m > ring[0]) & (m < 255 - ring[0]) if (m > ring[0]).any() else m >= 0
    if zone.sum() < 64:
        zone = m < ring[1]
    p = np.asarray(ImageCms.applyTransform(painted, to_lab), dtype=np.float32)
    q = np.asarray(ImageCms.applyTransform(reference.resize(painted.size), to_lab), dtype=np.float32)
    # Only the average colour moves: stretching the spread turns slight noise on flat background into
    # speckles. The shift is capped, so a region that should look different (a new colour) keeps it.
    out = p.copy()
    for c, cap in zip(range(3), (8.0, 4.0, 4.0)):
        shift = float(np.clip(q[..., c][zone].mean() - p[..., c][zone].mean(), -cap, cap))
        out[..., c] = p[..., c] + shift
    return ImageCms.applyTransform(Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "LAB"), to_rgb)


def keep_skin(original, result, region, threshold=14.0, skin=None):
    """Where the result is still bare skin (close to the original's skin colour) and the original was
    skin too, the original pixel stays: gear (ropes, straps) changes, the skin around it doesn't.
    `region` is the area that was repainted; returns the corrected result."""
    import numpy as np
    import cv2
    o = np.asarray(original.convert("RGB"), dtype=np.float32) / 255
    r = np.asarray(result.convert("RGB"), dtype=np.float32) / 255
    lo, lr = cv2.cvtColor(o, cv2.COLOR_RGB2LAB), cv2.cvtColor(r, cv2.COLOR_RGB2LAB)
    m = np.asarray(region.convert("L")) > 16
    if skin is None:
        # The skin colour: the median of the region's original pixels in the bright, warm half.
        px = lo[m]
        px = px[(px[:, 0] > np.median(px[:, 0])) & (px[:, 1] > 2)]
        skin = np.median(px, axis=0) if len(px) else np.median(lo[m], axis=0)
    d_o = np.linalg.norm(lo - skin, axis=2)
    d_r = np.linalg.norm(lr - skin, axis=2)
    # Shading on skin varies, so "skin" is judged on colour (a, b) with a looser lightness tolerance.
    chroma = lambda lab: np.linalg.norm(lab[..., 1:] - skin[1:], axis=2)
    keep = m & (chroma(lo) < threshold) & (chroma(lr) < threshold * 1.4) & (d_o < threshold * 3) & (d_r < threshold * 4)
    keep = cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 1.2)[..., None]
    out = r * (1 - keep) + o * keep
    return Image.fromarray((out * 255).clip(0, 255).astype(np.uint8))


def keep_background(original, result, region, threshold=10.0):
    """Where the original was plain backdrop and the result is still backdrop-coloured (no new
    picture content there), the original backdrop stays: no tint or shimmer in the gaps between limbs."""
    import numpy as np
    import cv2
    o = np.asarray(original.convert("RGB"), dtype=np.float32) / 255
    r = np.asarray(result.convert("RGB"), dtype=np.float32) / 255
    lo, lr = cv2.cvtColor(o, cv2.COLOR_RGB2LAB), cv2.cvtColor(r, cv2.COLOR_RGB2LAB)
    h, w = lo.shape[:2]
    corners = np.concatenate([lo[:16, :16].reshape(-1, 3), lo[:16, -16:].reshape(-1, 3), lo[-16:, :16].reshape(-1, 3), lo[-16:, -16:].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    m = np.asarray(region.convert("L")) > 8
    was_bg = np.linalg.norm(lo - bg, axis=2) < threshold
    still_bg = np.linalg.norm(lr[..., 1:] - bg[1:], axis=2) < threshold * 1.5
    # Backdrop is flat: a pixel close in colour to it that was backdrop before is backdrop now.
    keep = m & was_bg & still_bg & (np.abs(lr[..., 0] - bg[0]) < threshold * 2.5)
    keep = cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 1.0)[..., None]
    out = r * (1 - keep) + o * keep
    return Image.fromarray((out * 255).clip(0, 255).astype(np.uint8))


def paste(original, painted, mask, box, feather=2.0):
    """Shrinks the painted crop back into place, blended through the (slightly softened) mask."""
    out = original.copy()
    region = painted.resize((box[2] - box[0], box[3] - box[1]), Image.LANCZOS)
    m = mask.crop(box).filter(ImageFilter.GaussianBlur(feather)) if feather else mask.crop(box)
    out.paste(Image.composite(region, original.crop(box), m), box[:2])
    return out
