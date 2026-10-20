"""The template maker on a drawn figure (shapes, no art): layers, masks, cages, gates.

    python3 -m unittest discover tools/studio/tests
"""
import json
import os
import subprocess
import sys

import cv2
import numpy as np
import tempfile
import unittest
from pathlib import Path
from PIL import Image

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, '..'))
import make_template  # noqa: E402

BG = (200, 220, 240)
SKIN, HAIR, EYE = (243, 207, 182), (59, 42, 34), (60, 40, 30)
W, H = 400, 800
KP = {'headTop': [200, 92], 'neck': [200, 210], 'pelvis': [200, 440], 'shoulder_L': [258, 255], 'shoulder_R': [142, 255],
      'elbow_L': [297, 376], 'elbow_R': [103, 376], 'wrist_L': [333, 475], 'wrist_R': [67, 475], 'hip_L': [235, 440], 'hip_R': [165, 440],
      'knee_L': [238, 605], 'knee_R': [162, 605], 'ankle_L': [242, 760], 'ankle_R': [158, 760]}


def figure(hair=None, top=False, smile=False, eyes=EYE, shift=(0, 0)):
    im = np.full((H, W, 3), BG, np.uint8)
    if hair == 'long':
        cv2.rectangle(im, (140, 110), (260, 330), HAIR, -1)
    cv2.ellipse(im, (200, 150), (46, 58), 0, 0, 360, SKIN, -1)
    cv2.rectangle(im, (185, 200), (215, 240), SKIN, -1)
    cv2.fillPoly(im, [np.int32([[148, 250], [252, 250], [262, 440], [138, 440]])], SKIN)
    for a, b in (((142, 268), (67, 475)), ((258, 268), (333, 475)), ((166, 440), (156, 765)), ((234, 440), (244, 765))):
        cv2.line(im, a, b, SKIN, 30)
    for x in (183, 217):
        cv2.ellipse(im, (x, 150), (6, 8), 0, 0, 360, eyes, -1)
    cv2.line(im, (190, 182), (210, 182), (180, 100, 90), 3)
    if smile:
        cv2.ellipse(im, (200, 178), (12, 8), 0, 0, 180, (180, 100, 90), 3)
    if hair in ('long', 'bob'):
        cv2.ellipse(im, (200, 112), (50, 30), 0, 180, 360, HAIR, -1)
    if top:
        cv2.fillPoly(im, [np.int32([[146, 250], [254, 250], [262, 330], [256, 400], [144, 400], [138, 330]])], (250, 250, 250))
    if shift != (0, 0):
        im = cv2.warpAffine(im, np.float32([[1, 0, shift[0]], [0, 1, shift[1]]]), (W, H), borderMode=cv2.BORDER_REPLICATE)
    return im


def write_spec(tmp, **over):
    pics = {'base.png': figure('long'), 'bald.png': figure(), 'bob.png': figure('bob'), 'tee.png': figure('long', top=True),
            'smile.png': figure('long', smile=True), 'eyes.png': figure('long', eyes=(40, 160, 60))}
    pics.update(over.pop('pics', {}))
    for n, p in pics.items():
        Image.fromarray(p).save(tmp / n)
    spec = {'id': 'stand-test', 'name': 'Test', 'category': 'standing', 'rating': 'all-ages', 'sex': ['female'], 'background': '#%02x%02x%02x' % BG,
            'keypoints': KP, 'base': 'base.png', 'bald': 'bald.png', 'baseHair': 'long_straight', 'hair': {'bob': 'bob.png'},
            'wardrobe': {'top': {'tee': 'tee.png'}}, 'expressions': {'smile': 'smile.png'}, 'eyes': 'eyes.png', **over}
    (tmp / 'spec.json').write_text(json.dumps(spec))
    return tmp / 'spec.json'


class MakeTemplateTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_makes_a_pack_that_passes_its_gates(self):
        tmp_path = self.tmp
        r = make_template.run(str(write_spec(tmp_path)), str(tmp_path / 'out'))
        self.assertTrue(r['ok'], r['failed'])
        t = json.load(open(tmp_path / 'out' / 'stand-test' / 'template.json'))
        ids = {l['id']: l for l in t['slots'][0]['layers']}
        assert {'body', 'hair-long_straight-back', 'hair-long_straight-front', 'hair-bob-front', 'top-tee', 'expr-smile'} <= set(ids)
        assert ids['top-tee']['when'] == {'wardrobe.top': 'tee'} and ids['top-tee']['z'] > ids['body']['z']
        assert ids['hair-long_straight-back']['z'] < ids['body']['z'] < ids['hair-long_straight-front']['z']
        # Hair recolours from its own colour; the body has skin and eye masks.
        assert ids['hair-bob-front']['recolor'][0]['kind'] == 'hair'
        kinds = {r['kind']: r for r in ids['body']['recolor']}
        assert set(kinds) == {'skin', 'eyes'}
        eye = np.array(Image.open(tmp_path / 'out' / 'stand-test' / 'body-eyes-mask.png'))[:, :, 0]
        assert 100 < (eye > 127).sum() < 600
        assert t['supports']['hairBack'] == ['long_straight', 'bob'] and t['supports']['expressions'] == ['neutral', 'smile']
        assert {c['slider'] for c in t['slots'][0]['cages']} == {'shoulders', 'waist', 'hips', 'butt', 'thighs', 'breast'}
        assert r['gates']['alignment_px'] < 0.5 and r['gates']['reconstruction_de'] < 4
        assert (tmp_path / 'out' / 'stand-test.zip').exists() and (tmp_path / 'out' / 'stand-test-sheet.png').exists()


    def test_a_small_shift_is_corrected_and_a_large_one_rejected(self):
        tmp_path = self.tmp
        r = make_template.run(str(write_spec(tmp_path, pics={'bob.png': figure('bob', shift=(1, 0))})), str(tmp_path / 'a'))
        self.assertTrue(r['ok'], r['failed'])
        assert 0.7 < r['variants']['hair:bob']['shift_px'] < 1.3
        r = make_template.run(str(write_spec(tmp_path, pics={'tee.png': figure('long', top=True, shift=(6, 3))})), str(tmp_path / 'b'))
        assert not r['ok'] and any('misaligned' in f for f in r['failed'])


    def test_a_drifting_edit_fails_its_gate(self):
        tmp_path = self.tmp
        drift = np.clip(figure('long', smile=True).astype(int) + 12, 0, 255).astype(np.uint8)
        r = make_template.run(str(write_spec(tmp_path, pics={'smile.png': drift})), str(tmp_path / 'c'))
        assert any('drift' in f for f in r['failed'])


    @unittest.skipUnless(os.path.exists(os.path.join(HERE, '..', '..', '..', 'node_modules', '.bin', 'tsx')), 'needs node deps')
    def test_the_pack_passes_the_typescript_checks(self):
        tmp_path = self.tmp
        make_template.run(str(write_spec(tmp_path)), str(tmp_path / 'out'))
        root = os.path.join(HERE, '..', '..', '..')
        p = subprocess.run([os.path.join(root, 'node_modules', '.bin', 'tsx'), os.path.join(root, 'tools', 'studio', 'check-template.ts'), str(tmp_path / 'out' / 'stand-test' / 'template.json')], capture_output=True, text=True, cwd=root)
        assert p.returncode == 0, p.stdout + p.stderr


if __name__ == '__main__':
    unittest.main()
