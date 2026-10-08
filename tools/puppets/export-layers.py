#!/usr/bin/env python3
"""
Writes <out>/layers.json and <out>/layers/NN.png from a See-through PSD, as the worker does for new
results (tools/see-through-worker/server.py › export_layers), for results made before it did.

    python3 tools/puppets/export-layers.py <name>.psd <result dir>/<name>
"""
import json
import os
import sys

from psd_tools import PSDImage

psd_path, out = sys.argv[1], sys.argv[2]
os.makedirs(f'{out}/layers', exist_ok=True)
psd = PSDImage.open(psd_path)
rows = []
for i, layer in enumerate(psd):
    im = layer.topil()
    if im is None:
        continue
    fn = f'{i:02d}.png'
    im.convert('RGBA').save(f'{out}/layers/{fn}')
    rows.append({'name': layer.name, 'file': f'layers/{fn}', 'left': layer.left, 'top': layer.top, 'width': im.width, 'height': im.height})
json.dump({'width': psd.width, 'height': psd.height, 'layers': rows}, open(f'{out}/layers.json', 'w'))
print(f'{out}: {len(rows)} layers')
