#!/bin/bash
# Qwen Image 2.1 edits through upstream ComfyUI (GPL-3.0, run on the pod only, never redistributed),
# plus Anima and WAI Illustrious for inpainting and the VNCCS LoRAs: the model set ComfyUI_VNCCS (MIT)
# uses, run through native nodes (graphs.py). Weights are downloaded here
# from Hugging Face; nothing is bundled.
set -euxo pipefail
V=/opt/venvs/qi2edit
python3 -m venv $V
. $V/bin/activate
pip install -q --upgrade pip wheel setuptools
# Current ComfyUI needs a current torch; CUDA 12.x wheels run on any 12.x driver (minor-version compatibility).
pip install -q torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
mkdir -p /opt/src && cd /opt/src
git clone -q --depth 1 https://github.com/comfyanonymous/ComfyUI.git
git -C ComfyUI rev-parse HEAD > /opt/worker/qi2edit.rev
pip install -q -r ComfyUI/requirements.txt huggingface_hub hf_transfer
python - <<'PY'
import os
from huggingface_hub import hf_hub_download
M = "/opt/src/ComfyUI/models"
FILES = [  # (repo, path in repo, ComfyUI folder): the model set ComfyUI_VNCCS uses
    ("Comfy-Org/Qwen-Image-2.1", "diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors", "diffusion_models"),
    ("Comfy-Org/Qwen-Image-2.1", "text_encoders/qwen3vl_8b_int8_convrot.safetensors", "text_encoders"),
    ("Comfy-Org/Qwen-Image-2.1", "vae/qwen_image_2.1_vae_bf16.safetensors", "vae"),
    ("circlestone-labs/Anima", "split_files/diffusion_models/anima-base-v1.0.safetensors", "diffusion_models"),
    ("circlestone-labs/Anima", "split_files/text_encoders/qwen_3_06b_base.safetensors", "text_encoders"),
    ("circlestone-labs/Anima", "split_files/vae/qwen_image_vae.safetensors", "vae"),
    ("MIUProject/VNCCS_v3.0", "models/checkpoints/Illustrious/waiIllustriousSDXL_v170.safetensors", "checkpoints"),
    ("MIUProject/VNCCS_v3.0", "models/loras/QI2.1/VNCCS/VNCCS_QI2_ClothesCoreV2.6.safetensors", "loras"),
    ("MIUProject/VNCCS_v3.0", "models/loras/QI2.1/VNCCS/VNCCS_QI2_PoseStudioV1.1.safetensors", "loras"),
    ("MIUProject/VNCCS_v3.0", "models/loras/QI2.1/VNCCS/VNCCS_QI2_AnimeOverhaulV2.safetensors", "loras"),
    ("MIUProject/VNCCS_v3.0", "models/loras/Anima/anima-turbo-lora-v0.1.safetensors", "loras"),
]
only = os.environ.get("QI2EDIT_FILES")  # optional: a comma list of file names to fetch
for repo, f, sub in FILES:
    if only and os.path.basename(f) not in only.split(","):
        continue
    p = hf_hub_download(repo, f, local_dir=f"/opt/weights/{repo.replace('/', '_')}")
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
