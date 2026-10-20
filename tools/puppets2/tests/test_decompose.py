"""
Decomposition gates on synthetic figures (simple shapes, no third-party art):

    python3 -m unittest discover tools/puppets2/tests
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

import cv2
import numpy as np
from PIL import Image

TOOL = os.path.join(os.path.dirname(__file__), '..', 'decompose.py')
SKIN = (240, 198, 173, 255)


def figure(head_scale=1.0):
    """A capsule figure in A-pose on a 400×800 canvas, with its landmarks."""
    kp = {
        'view': 'front', 'headTop': [200, 90], 'neck': [200, 210], 'chest': [200, 300], 'pelvis': [200, 430],
        'shoulder_L': [258, 268], 'elbow_L': [297, 376], 'wrist_L': [333, 475], 'hip_L': [234, 440], 'knee_L': [240, 605], 'ankle_L': [244, 765],
        'shoulder_R': [142, 268], 'elbow_R': [103, 376], 'wrist_R': [67, 475], 'hip_R': [166, 440], 'knee_R': [160, 605], 'ankle_R': [156, 765],
        'breast_L': [226, 300], 'breast_R': [174, 300], 'butt_L': [222, 452], 'butt_R': [178, 452],
    }
    if head_scale != 1.0:
        # A big head: the head top moves up, everything below the neck shrinks toward the feet.
        kp['headTop'] = [200, 210 - 120 * head_scale]
    img = np.zeros((800, 400, 4), np.uint8)
    line = lambda a, b, w: cv2.line(img, tuple(map(int, kp[a])), tuple(map(int, kp[b])), SKIN, w, cv2.LINE_AA)
    cv2.ellipse(img, (200, int((kp['headTop'][1] + 210) / 2)), (int(46 * head_scale), int((210 - kp['headTop'][1]) / 2)), 0, 0, 360, SKIN, -1)
    line('neck', 'pelvis', 100)
    for s in 'LR':
        line(f'shoulder_{s}', f'elbow_{s}', 30); line(f'elbow_{s}', f'wrist_{s}', 24)
        line(f'hip_{s}', f'knee_{s}', 50); line(f'knee_{s}', f'ankle_{s}', 34)
        cv2.circle(img, tuple(map(int, kp[f'wrist_{s}'])), 14, SKIN, -1)
    return img, kp


class DecomposeGates(unittest.TestCase):
    def run_tool(self, img, kp, *extra):
        d = tempfile.mkdtemp()
        Image.fromarray(img, 'RGBA').save(os.path.join(d, 'pic.png'))
        json.dump(kp, open(os.path.join(d, 'kp.json'), 'w'))
        out = os.path.join(d, 'out')
        r = subprocess.run([sys.executable, TOOL, '--image', os.path.join(d, 'pic.png'), '--keypoints', os.path.join(d, 'kp.json'), '--out', out, *extra], capture_output=True, text=True)
        return r, out

    def test_adult_figure_packs_with_all_gates(self):
        r, out = self.run_tool(*figure(), '--zip')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        gates = json.load(open(os.path.join(out, 'gates-front.json')))
        self.assertTrue(all(g['pass'] for g in gates), [g for g in gates if not g['pass']])
        pack = json.load(open(os.path.join(out, 'character.json')))
        roles = {l['role'] for l in pack['views']['front']['layers']}
        for role in ('torso', 'head', 'arm_L', 'arm_R', 'hand_L', 'hand_R', 'leg_L', 'leg_R', 'breast_L'):
            self.assertIn(role, roles)
        self.assertTrue(os.path.exists(os.path.join(out, 'pack.zip')))
        self.assertTrue(os.path.exists(os.path.join(out, 'contact-front.png')))

    def test_child_proportions_never_pack(self):
        r, out = self.run_tool(*figure(head_scale=2.2), '--force')
        self.assertNotEqual(r.returncode, 0)
        self.assertIn('Child proportions', r.stdout + r.stderr)
        self.assertFalse(os.path.exists(os.path.join(out, 'character.json')))

    def test_stylized_is_all_ages_only(self):
        r, _ = self.run_tool(*figure(head_scale=2.2), '--stylized', '--rating', '18+')
        self.assertNotEqual(r.returncode, 0)
        r, out = self.run_tool(*figure(head_scale=2.2), '--stylized')
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        pack = json.load(open(os.path.join(out, 'character.json')))
        self.assertEqual(pack['physics']['bust'], 0)
        self.assertFalse(any(l['role'].startswith('breast') for l in pack['views']['front']['layers']))


if __name__ == '__main__':
    unittest.main()
