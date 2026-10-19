"""TRELLIS.2 runner: every image in <in> becomes <out>/<name>.glb (PBR, textured), with timings."""
import json, os, sys, time, traceback

os.environ.setdefault("ATTN_BACKEND", "xformers")
os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
sys.path.insert(0, "/opt/src/TRELLIS.2")
from PIL import Image  # noqa: E402
import torch  # noqa: E402
from trellis2.pipelines import Trellis2ImageTo3DPipeline  # noqa: E402
import o_voxel  # noqa: E402

src, out, opts = sys.argv[1], sys.argv[2], json.loads(sys.argv[3] if len(sys.argv) > 3 else "{}")
os.makedirs(out, exist_ok=True)
t = time.time()
pipe = Trellis2ImageTo3DPipeline.from_pretrained("/opt/weights/TRELLIS.2-4B")
pipe.cuda()
print(f"loaded in {time.time() - t:.0f}s", flush=True)
report = {}
names = opts.get("only") or sorted(n for n in os.listdir(src) if n.lower().endswith((".png", ".jpg", ".jpeg", ".webp")))
for name in names:
    stem = os.path.splitext(name)[0]
    if os.path.exists(f"{out}/{stem}.glb"):
        continue
    t = time.time()
    torch.cuda.reset_peak_memory_stats()
    try:
        mesh = pipe.run(Image.open(os.path.join(src, name)), seed=int(opts.get("seed", 1)))[0]
        mesh.simplify(16777216)
        glb = o_voxel.postprocess.to_glb(
            vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs, coords=mesh.coords,
            attr_layout=mesh.layout, voxel_size=mesh.voxel_size, aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            decimation_target=int(opts.get("faces", 200000)), texture_size=int(opts.get("texture", 2048)),
            remesh=True, remesh_band=1, remesh_project=0, verbose=False)
        glb.export(f"{out}/{stem}.glb", extension_webp=False)
        report[stem] = {"seconds": round(time.time() - t, 1), "peakVramGb": round(torch.cuda.max_memory_allocated() / 1e9, 1)}
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        report[stem] = {"error": str(e)[:300]}
    print(stem, report[stem], flush=True)
    torch.cuda.empty_cache()
json.dump(report, open(f"{out}/report.json", "w"), indent=1)
