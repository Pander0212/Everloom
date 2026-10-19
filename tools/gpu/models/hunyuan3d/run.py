"""
Hunyuan3D 2.1 runner, as the repo's gradio_app does it: background removal, shape (50 steps,
guidance 7.5, octree 256), face reduction, then PBR paint (8 views at 768). Every image in <in>
becomes <out>/<name>.zip holding the textured OBJ, its MTL and textures (turned into a GLB locally).
"""
import json, os, shutil, sys, time, traceback, types

sys.modules.setdefault("bpy", types.ModuleType("bpy"))  # only the OBJ→GLB helper needs Blender; unused here
ROOT = "/opt/src/Hunyuan3D-2.1"
os.chdir(ROOT)
sys.path.insert(0, f"{ROOT}/hy3dshape")
sys.path.insert(0, f"{ROOT}/hy3dpaint")
sys.path.insert(0, ROOT)
from PIL import Image  # noqa: E402
import torch  # noqa: E402
from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline  # noqa: E402
from hy3dshape import FaceReducer  # noqa: E402
from hy3dshape.rembg import BackgroundRemover  # noqa: E402
from textureGenPipeline import Hunyuan3DPaintPipeline, Hunyuan3DPaintConfig  # noqa: E402

src, out, opts = sys.argv[1], sys.argv[2], json.loads(sys.argv[3] if len(sys.argv) > 3 else "{}")
os.makedirs(out, exist_ok=True)
t = time.time()
shape = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained("tencent/Hunyuan3D-2.1")
conf = Hunyuan3DPaintConfig(max_num_view=int(opts.get("views", 8)), resolution=int(opts.get("resolution", 768)))
conf.realesrgan_ckpt_path = "hy3dpaint/ckpt/RealESRGAN_x4plus.pth"
conf.multiview_cfg_path = "hy3dpaint/cfgs/hunyuan-paint-pbr.yaml"
conf.custom_pipeline = "hy3dpaint/hunyuanpaintpbr"
paint = Hunyuan3DPaintPipeline(conf)
rmbg, reducer = BackgroundRemover(), FaceReducer()
print(f"loaded in {time.time() - t:.0f}s", flush=True)
report = {}
names = opts.get("only") or sorted(n for n in os.listdir(src) if n.lower().endswith((".png", ".jpg", ".jpeg", ".webp")))
for name in names:
    stem = os.path.splitext(name)[0]
    if os.path.exists(f"{out}/{stem}.zip"):
        continue
    t = time.time()
    torch.cuda.reset_peak_memory_stats()
    work = f"/tmp/hy/{stem}"
    os.makedirs(work, exist_ok=True)
    try:
        image = Image.open(os.path.join(src, name))
        if image.mode == "RGB":
            image = rmbg(image.convert("RGB"))
        image.save(f"{work}/input.png")
        g = torch.Generator().manual_seed(int(opts.get("seed", 1)))
        mesh = shape(image=image, num_inference_steps=50, guidance_scale=7.5, generator=g, octree_resolution=256, num_chunks=200000, output_type="trimesh")[0]
        mesh = reducer(mesh)
        mesh.export(f"{work}/white.obj")
        t_shape = time.time() - t
        paint(mesh_path=f"{work}/white.obj", image_path=f"{work}/input.png", output_mesh_path=f"{work}/textured.obj", save_glb=False)
        os.remove(f"{work}/white.obj")
        shutil.make_archive(f"{out}/{stem}", "zip", work)
        report[stem] = {"seconds": round(time.time() - t, 1), "shapeSeconds": round(t_shape, 1), "peakVramGb": round(torch.cuda.max_memory_allocated() / 1e9, 1)}
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        report[stem] = {"error": str(e)[:300]}
    print(stem, report[stem], flush=True)
    torch.cuda.empty_cache()
json.dump(report, open(f"{out}/report.json", "w"), indent=1)
