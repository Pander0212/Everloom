"""Studio edits on the pod: each of opts["edits"] (a Qwen Image 2.1 instruction edit, or an Anima / Illustrious
inpaint inside a mask; graphs.py) is saved as <out>/<label>.png at its input's exact size, with a report."""
import json, os, shutil, subprocess, sys, time, traceback, urllib.request, uuid

src, out, opts = sys.argv[1], sys.argv[2], json.loads(sys.argv[3] if len(sys.argv) > 3 else "{}")
os.makedirs(out, exist_ok=True)
# COMFY_DIR / COMFY_URL: an existing ComfyUI (local dry runs against a CPU server before renting a GPU).
C = os.environ.get("COMFY_DIR", "/opt/src/ComfyUI")
URL = os.environ.get("COMFY_URL", "http://127.0.0.1:8188")
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
proc = None if os.environ.get("COMFY_URL") else subprocess.Popen([sys.executable, "-c", launch], cwd=C, stdout=log, stderr=subprocess.STDOUT)


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
for n in ("UNETLoader", "CLIPLoader", "VAELoader", "TextEncodeQwenImage21", "KSampler", "EmptyLatentImage", "VAEDecode", "SaveImage", "LoadImage",
          "CheckpointLoaderSimple", "LoadImageMask", "GrowMask", "SetLatentNoiseMask", "ImageCompositeMasked", "LoraLoaderModelOnly"):
    if n not in info:
        raise SystemExit(f"this ComfyUI has no {n} node")
from PIL import Image  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import graphs  # noqa: E402

files = sorted(n for n in os.listdir(src) if n.lower().endswith((".png", ".jpg", ".jpeg", ".webp")))
report = {"cache": "QwenImage21Cache" in info}
staged = {}


def stage(name):
    """Copies an input picture (or mask) into ComfyUI's input folder as PNG; returns (name, size)."""
    if name not in staged:
        im = Image.open(os.path.join(src, name))
        im = im.convert("L") if name.startswith("mask") else im.convert("RGB")
        dst = "ev-" + os.path.splitext(name)[0] + ".png"
        im.save(f"{C}/input/{dst}")
        staged[name] = (dst, im.size)
    return staged[name]


# Each edit: {label, prompt, input?, kind: "qi2" (default) | "inpaint", mask?, model?, loras?, seed?, denoise?}.
for e in opts.get("edits", []):
    label = e["label"]
    if os.path.exists(f"{out}/{label}.png"):
        continue
    t = time.time()
    try:
        inp, (W, H) = stage(e.get("input") or files[0])
        seed = int(e.get("seed", opts.get("seed", 7)))
        loras = [tuple(x) for x in e.get("loras", [])]
        if e.get("kind", "qi2") == "inpaint":
            mask, _ = stage(e["mask"])
            g = graphs.inpaint(inp, mask, e["prompt"], model=e.get("model", "anima"), seed=seed, denoise=float(e.get("denoise", 0.9)),
                               loras=loras, negative=e.get("negative", graphs.NEGATIVE), grow=int(e.get("grow", 6)), prefix=f"ev-{label}")
        else:
            g = graphs.qi2(inp, e["prompt"], W, H, seed=seed, turbo=e.get("model", opts.get("model", "turbo")) == "turbo", loras=loras,
                           cache=report["cache"], negative=e.get("negative", ""), prefix=f"ev-{label}")
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
    except urllib.error.HTTPError as ex:
        report[label] = {"error": f"rejected: {ex.read()[:600]!r}"}
    except Exception as ex:  # noqa: BLE001
        traceback.print_exc()
        report[label] = {"error": str(ex)[:600]}
    print(label, report[label], flush=True)
json.dump(report, open(f"{out}/report.json", "w"), indent=1)
if proc:
    proc.terminate()
