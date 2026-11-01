"""Create an uncompressed 1 GiB Unity transport fixture outside Git.
Usage: python tools/avatars/large-unity-fixture.py samples/3d/large/large-unity.zip
Padding is opaque archive data; the small CC0 avatar exercises actual conversion.
This tests archive/upload memory, not a billion-byte mesh's rendering cost.
"""
import pathlib
import sys
import zipfile
out = pathlib.Path(sys.argv[1])
out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as z:
    with z.open('Assets/large-padding.bin', 'w', force_zip64=True) as f:
        block = b'\0' * (4 * 1024 ** 2)
        for _ in range(256):
            f.write(block)
    z.write(pathlib.Path(__file__).resolve().parents[2] / 'tests/fixtures/unity/Ava.unitypackage', 'Ava.unitypackage')
