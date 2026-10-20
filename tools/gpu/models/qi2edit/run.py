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
    """Copies an input picture (or mask) into ComfyUI's input folder as PNG; returns (name, size).
    "@label" is the result of an earlier edit in this job (a chain: body variant → detail repaint)."""
    if name not in staged:
        im = Image.open(f"{out}/{name[1:]}.png" if name.startswith("@") else os.path.join(src, name))
        im = im.convert("L") if name.startswith("mask") else im.convert("RGB")
        dst = "ev-" + os.path.splitext(name.lstrip("@"))[0] + ".png"
        im.save(f"{C}/input/{dst}")
        staged[name] = (dst, im.size)
    return staged[name]


import stitch  # noqa: E402


def put(im, name):
    """Saves a picture made here (a crop, a mask) into ComfyUI's input folder."""
    im.save(f"{C}/input/{name}")
    return name


def run_graph(g):
    """Queues a graph and returns its first saved image."""
    pid = call("/prompt", {"prompt": g, "client_id": str(uuid.uuid4())})["prompt_id"]
    while True:
        time.sleep(1.5)
        h = call(f"/history/{pid}")
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("status_str") == "error":
                raise RuntimeError(json.dumps(st.get("messages", []))[-800:])
            imgs = [i for o in h[pid]["outputs"].values() for i in o.get("images", [])]
            if imgs:
                return Image.open(os.path.join(C, "output", imgs[0].get("subfolder", ""), imgs[0]["filename"])).convert("RGB")
            if st.get("completed"):
                raise RuntimeError("no image")


# Each edit: {label, prompt, input?, kind: "qi2" (default) | "inpaint" | "upscale" | "chroma", mask?, model?, loras?, seed?,
# denoise?, crop? / crop_size? (inpaint: crop-and-stitch, on by default)}. opts["upscale"] (an upscale model file)
# also writes <label>@4x.png for every result ("upscale" edits only upscale their input).
up_model = opts.get("upscale")
for e in opts.get("edits", []):
    label = e["label"]
    if os.path.exists(f"{out}/{label}.png") and (not up_model or os.path.exists(f"{out}/{label}@4x.png")):
        continue
    t = time.time()
    try:
        inp, (W, H) = stage(e.get("input") or files[0])
        seed = int(e.get("seed", opts.get("seed", 7)))
        loras = [tuple(x) for x in e.get("loras", [])]
        kind = e.get("kind", "qi2")
        changed = e.get("only_if_changed")  # {"ref": a picture, "threshold": mean ΔE}: repaint only if the region changed
        if changed:
            import numpy as np  # noqa: E402
            m = np.asarray(Image.open(os.path.join(src, e["mask"])).convert("L")) > 127
            a = np.asarray(Image.open(os.path.join(src, changed["ref"])).convert("RGB").resize((W, H)), dtype=np.float32)
            b = np.asarray(Image.open(f"{C}/input/{inp}").convert("RGB"), dtype=np.float32)
            diff = float(np.abs(a - b)[m].mean()) if m.any() else 0.0
            report.setdefault("_changed", {})[label] = round(diff, 2)
        if os.path.exists(f"{out}/{label}.png"):
            r = Image.open(f"{out}/{label}.png").convert("RGB")
        elif changed and diff < float(changed.get("threshold", 6.0)):
            r = Image.open(f"{C}/input/{inp}").convert("RGB")  # nothing changed there: keep the picture as it is
        elif kind == "inpaint":
            original = Image.open(f"{C}/input/{inp}").convert("RGB")
            mask_im = Image.open(os.path.join(src, e["mask"])).convert("L")
            box, size = stitch.crop_box(mask_im, size=int(e.get("crop_size", 1024))) if e.get("crop", True) else (None, None)
            model = e.get("model", "illustrious")
            neg = e.get("negative", graphs.SDXL_NEGATIVE.get("wai" if model == "illustrious" else model, graphs.NEGATIVE))
            args = dict(model=model, seed=seed, denoise=float(e.get("denoise", 0.9)), loras=loras, negative=neg + e.get("negative_add", ""),
                        grow=int(e.get("grow", 6)), prefix=f"ev-{label}", cn=e.get("cn"), cn_strength=float(e.get("cn_strength", 0.9)),
                        diffdiff=e.get("diffdiff", (sum(1 for v in mask_im.getdata() if v > 127) / (mask_im.width * mask_im.height)) < 0.5), steps_override=e.get("steps"), cfg_override=e.get("cfg"),
                        # Masks over half the picture are whole-body changes: img2img under the mask, not a blank fill.
                        imc=e.get("imc", (sum(1 for v in mask_im.getdata() if v > 127) / (mask_im.width * mask_im.height)) < 0.5))
            if box:
                ci, cm = stitch.crop(original, mask_im, box, size)
                if e.get("cn"):
                    args["control_name"] = put(stitch.blackout(ci, cm), f"ev-{label}-control.png")
                painted = run_graph(graphs.inpaint(put(ci, f"ev-{label}-crop.png"), put(cm, f"mask-ev-{label}-crop.png"), e["prompt"], **args))
                os.makedirs(f"{out}/_raw", exist_ok=True)  # the painted crop as the model made it (for review)
                painted.save(f"{out}/_raw/{label}.png")
                if e.get("color_match", True):
                    painted = stitch.color_match(painted, ci, cm)
                r = stitch.paste(original, painted, mask_im, box)
                # Gear on skin (ropes, straps) tends to bleach the skin around it: shift it back to the base tone.
                if e.get("skin_tone", e.get("keep_skin")):
                    r = stitch.skin_tone_match(original, r, mask_im)
                if e.get("keep_background", True):
                    r = stitch.keep_background(original, r, mask_im)
            else:
                r = run_graph(graphs.inpaint(inp, stage(e["mask"])[0], e["prompt"], **args))
        elif kind == "upscale":
            r = None
        elif kind == "chroma":  # a new picture from text (a new base): "size" [w, h] or the input's size
            cw, ch = e.get("size", (W, H))
            r = run_graph(graphs.chroma(e["prompt"], int(cw), int(ch), seed=seed, negative=e.get("negative", graphs.CHROMA_NEGATIVE),
                                        steps=int(e.get("steps", 26)), cfg=float(e.get("cfg", 3.8)), prefix=f"ev-{label}"))
            W, H = r.size
        else:
            qm = e.get("model", opts.get("model", "turbo"))
            r = run_graph(graphs.qi2(inp, e["prompt"], W, H, seed=seed, model=qm, loras=loras, cache=report["cache"], steps=e.get("steps"), cfg=e.get("cfg"),
                                     negative=e.get("negative", graphs.QI2_NEGATIVE if qm == "noctqa" else ""), prefix=f"ev-{label}"))
        if r is not None:
            if r.size != (W, H):
                r = r.resize((W, H), Image.LANCZOS)
            r.save(f"{out}/{label}.png")
        if up_model:
            name = put(r if r is not None else Image.open(f"{C}/input/{inp}").convert("RGB"), f"ev-{label}-up.png")
            run_graph(graphs.upscale(name, up_model, prefix=f"ev-{label}-4x")).save(f"{out}/{label}@4x.png", optimize=True)
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
