#!/usr/bin/env python3
"""
Background removal for Puppets v2 pictures (docs/puppets-v2/pipeline.md › 2): rembg with IS-Net on
the CPU (the flat-colour key in tools/puppets/key.py fails on pale skin over a pale gradient).
Pictures already keyed (same name, .png, in the output folder) are skipped.

    python3 tools/puppets2/key.py OUT_DIR picture.jpg [more.jpg …]
"""
import os
import sys

from PIL import Image
from rembg import new_session, remove

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
session = None
for path in sys.argv[2:]:
    dest = os.path.join(out, os.path.splitext(os.path.basename(path))[0] + '.png')
    if os.path.exists(dest):
        continue
    session = session or new_session('isnet-general-use')
    remove(Image.open(path).convert('RGB'), session=session, post_process_mask=True).save(dest)
    print('keyed', dest)
