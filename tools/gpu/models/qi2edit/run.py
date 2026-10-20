"""Qwen Image 2.1 edits: <in>/<input> edited by each prompt in opts["edits"] ([{label, prompt, seed?}]),
saved as <out>/<label>.png at the input's exact size, with a report (seconds, errors)."""
import json, os, shutil, subprocess, sys, time, traceback, urllib.request, uuid

src, out, opts = sys.argv[1], sys.argv[2], json.loads(sys.argv[3] if len(sys.argv) > 3 else "{}")
os.makedirs(out, exist_ok=True)
C = "/opt/src/ComfyUI"
URL = "http://127.0.0.1:8188"
log = open(f"{out}/comfy.log", "w")
import re  # noqa: E402


def driver_cuda():
    """The CUDA version the host driver supports (nvidia-smi's header), e.g. (12, 4); None if unknown."""
    try:
        m = re.search(r"CUDA Version:\s*(\d+)\.(\d+)", subprocess.run(["nvidia-smi"], capture_output=True, text=True, timeout=30).stdout)
        return (int(m.group(1)), int(m.group(2))) if m else None
    except Exception:  # noqa: BLE001
        return None


# comfy_kitchen's prebuilt kernels need a CUDA 13 driver (580+): jobs ask for such hosts (job "cudaVersions"). On
# older hosts its backends are disabled, but the int8 ConvRot path still calls a CUDA kernel, so expect failures there.
cuda = driver_cuda()
old_driver = cuda is None or cuda < (13, 0)
launch = ("import sys, runpy\n"
          + ("import comfy_kitchen as ck\nck.disable_backend('cuda')\nck.disable_backend('triton')\n" if old_driver or opts.get("eager") else "")
          # Importing comfy_kitchen first loads torch before ComfyUI picks its allocator: keep the native one.
          + "sys.argv = ['main.py', '--listen', '127.0.0.1', '--port', '8188', '--disable-auto-launch'"
          + (", '--disable-cuda-malloc'" if old_driver or opts.get("eager") else "") + "]\n"
          + "runpy.run_path('main.py', run_name='__main__')\n")
print("driver CUDA", cuda, "-> plain-torch kernels" if old_driver else "-> cuda kernels", flush=True)
proc = subprocess.Popen([sys.executable, "-c", launch], cwd=C, stdout=log, stderr=subprocess.STDOUT)


def call(path, body=None):
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode() if body is not None else None, headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"{}")


for _ in range(180):
    try:
        call("/system_stats"); break
    except Exception:  # noqa: BLE001
        time.sleep(2)
info = call("/object_info")
for n in ("UNETLoader", "CLIPLoader", "VAELoader", "TextEncodeQwenImage21", "KSampler", "EmptyLatentImage", "VAEDecode", "SaveImage", "LoadImage"):
    if n not in info:
        raise SystemExit(f"this ComfyUI has no {n} node")
enc = info["TextEncodeQwenImage21"]["input"]
print("TextEncodeQwenImage21 inputs:", json.dumps(enc)[:1500], flush=True)
# The reference image input: an image group (images.image_1) or a plain input.
all_inputs = {**enc.get("required", {}), **enc.get("optional", {})}
img_key = next((k for k in ("images.image_1", "image_1", "image1", "image") if k in all_inputs), "images.image_1")
has_cache = "QwenImage21Cache" in info

from PIL import Image  # noqa: E402

names = opts.get("only") or sorted(n for n in os.listdir(src) if n.lower().endswith((".png", ".jpg", ".jpeg", ".webp")))
report = {"imageKey": img_key, "cache": has_cache}
# The turbo model (8 steps, CFG 1) or the standard one (25 steps, CFG 3), as VNCCS sets them.
turbo = opts.get("model") == "turbo"
unet = "qwen_image_2.1_turbo_int8_convrot.safetensors" if turbo else "qwen_image_2.1_int8_convrot.safetensors"
steps, cfg = int(opts.get("steps", 8 if turbo else 25)), float(opts.get("cfg", 1.0 if turbo else 3.0))
for name in names:
    im = Image.open(os.path.join(src, name)).convert("RGB")
    W, H = im.size
    W16, H16 = W - W % 16, H - H % 16
    im.save(f"{C}/input/everloom-in.png")
    for e in opts.get("edits", []):
        label = e["label"]
        if os.path.exists(f"{out}/{label}.png"):
            continue
        t = time.time()
        g = {
            "1": {"class_type": "LoadImage", "inputs": {"image": "everloom-in.png"}},
            "2": {"class_type": "UNETLoader", "inputs": {"unet_name": unet, "weight_dtype": "default"}},
            "3": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_8b_int8_convrot.safetensors", "type": "qwen_image", "device": "default"}},
            "4": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_2.1_vae_bf16.safetensors"}},
            "5": {"class_type": "TextEncodeQwenImage21", "inputs": {"clip": ["3", 0], "vae": ["4", 0], "prompt": e["prompt"], "negative_prompt": e.get("negative", ""), "resolution": 1024, img_key: ["1", 0]}},
            "6": {"class_type": "EmptyLatentImage", "inputs": {"width": W16, "height": H16, "batch_size": 1}},
            "7": {"class_type": "KSampler", "inputs": {"model": ["9", 0] if has_cache else ["2", 0], "positive": ["5", 0], "negative": ["5", 1], "latent_image": ["6", 0], "seed": int(e.get("seed", opts.get("seed", 7))), "steps": steps, "cfg": cfg, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
            "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["4", 0]}},
            "10": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": f"ev-{label}"}},
        }
        if has_cache:
            g["9"] = {"class_type": "QwenImage21Cache", "inputs": {"model": ["2", 0], "device": "gpu", "dtype": "int8"}}
        try:
            pid = call("/prompt", {"prompt": g, "client_id": str(uuid.uuid4())})["prompt_id"]
            while True:
                time.sleep(2)
                h = call(f"/history/{pid}")
                if pid in h:
                    st = h[pid].get("status", {})
                    if st.get("status_str") == "error":
                        raise RuntimeError(json.dumps(st.get("messages", []))[-800:])
                    imgs = [i for o in h[pid]["outputs"].values() for i in o.get("images", [])]
                    if imgs:
                        p = os.path.join(C, "output", imgs[0].get("subfolder", ""), imgs[0]["filename"])
                        r = Image.open(p).convert("RGB")
                        if r.size != (W, H):
                            r = r.resize((W, H), Image.LANCZOS)
                        r.save(f"{out}/{label}.png")
                        break
                    if st.get("completed"):
                        raise RuntimeError("no image")
            report[label] = {"seconds": round(time.time() - t, 1)}
        except Exception as ex:  # noqa: BLE001
            traceback.print_exc()
            report[label] = {"error": str(ex)[:600]}
        print(label, report[label], flush=True)
json.dump(report, open(f"{out}/report.json", "w"), indent=1)
proc.terminate()
