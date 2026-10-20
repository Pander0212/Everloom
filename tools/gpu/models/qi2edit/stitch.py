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


def paste(original, painted, mask, box, feather=2.0):
    """Shrinks the painted crop back into place, blended through the (slightly softened) mask."""
    out = original.copy()
    region = painted.resize((box[2] - box[0], box[3] - box[1]), Image.LANCZOS)
    m = mask.crop(box).filter(ImageFilter.GaussianBlur(feather)) if feather else mask.crop(box)
    out.paste(Image.composite(region, original.crop(box), m), box[:2])
    return out
