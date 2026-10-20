#!/bin/bash
# (Written as a fallback for NanoGPT outages; not yet run on a pod.)
# Qwen Image 2.1 edits through upstream ComfyUI (GPL-3.0, run on the pod only, never redistributed),
# with the int8 weights Comfy-Org publishes (Comfy-Org/Qwen-Image-2.1), the same files and native
# nodes that ComfyUI_VNCCS (MIT) uses for its consistent-character edits. Weights are downloaded here
# from Hugging Face; nothing is bundled.
set -euxo pipefail
V=/opt/venvs/qi2edit
python3 -m venv $V
. $V/bin/activate
pip install -q --upgrade pip wheel setuptools
pip install -q torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
mkdir -p /opt/src && cd /opt/src
git clone -q --depth 1 https://github.com/comfyanonymous/ComfyUI.git
git -C ComfyUI rev-parse HEAD > /opt/worker/qi2edit.rev
pip install -q -r ComfyUI/requirements.txt huggingface_hub hf_transfer
python - <<'PY'
import os, shutil
from huggingface_hub import hf_hub_download
M = "/opt/src/ComfyUI/models"
for sub, f in [("diffusion_models", "diffusion_models/qwen_image_2.1_int8_convrot.safetensors"),
               ("text_encoders", "text_encoders/qwen3vl_8b_int8_convrot.safetensors"),
               ("vae", "vae/qwen_image_2.1_vae_bf16.safetensors")]:
    p = hf_hub_download("Comfy-Org/Qwen-Image-2.1", f, local_dir="/opt/weights/qi21")
    os.makedirs(f"{M}/{sub}", exist_ok=True)
    dst = f"{M}/{sub}/{os.path.basename(f)}"
    if not os.path.exists(dst):
        os.symlink(p, dst)
print("weights ok")
PY
# Imports only (no weights loaded); the runner checks the nodes it needs when the server is up.
cd /opt/src/ComfyUI
python -c "import torch, comfy.sd, comfy_extras; print('torch', torch.__version__)"
echo "setup done"
