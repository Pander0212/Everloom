#!/bin/bash
# TRELLIS.2 (Microsoft, MIT): https://github.com/microsoft/TRELLIS.2, weights microsoft/TRELLIS.2-4B.
# Follows the repo's setup.sh, with two changes so nothing gated or non-commercial is needed:
#  - attention through xformers (ATTN_BACKEND=xformers) instead of compiling flash-attn;
#  - the image features come from an ungated copy of Meta's DINOv3 ViT-L/16 that carries Meta's
#    DINOv3 License (which allows redistribution), and background removal from BiRefNet (MIT)
#    instead of RMBG-2.0 (CC BY-NC). Both are set in a local copy of pipeline.json.
set -euxo pipefail
REV=main
V=/opt/venvs/trellis2
python3 -m venv $V
. $V/bin/activate
pip install -q --upgrade pip wheel setuptools
pip install -q torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
pip install -q xformers==0.0.29.post3 --index-url https://download.pytorch.org/whl/cu124
pip install -q imageio imageio-ffmpeg tqdm easydict opencv-python-headless ninja trimesh "transformers>=4.56" zstandard kornia timm einops pillow huggingface_hub safetensors scipy
pip install -q git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8
mkdir -p /opt/src && cd /opt/src
git clone -q -b $REV --recursive https://github.com/microsoft/TRELLIS.2.git
git -C TRELLIS.2 rev-parse HEAD > /opt/worker/trellis2.rev
git clone -q -b v0.4.0 https://github.com/NVlabs/nvdiffrast.git && pip install -q ./nvdiffrast --no-build-isolation
git clone -q -b renderutils https://github.com/JeffreyXiang/nvdiffrec.git && pip install -q ./nvdiffrec --no-build-isolation
git clone -q --recursive https://github.com/JeffreyXiang/CuMesh.git && pip install -q ./CuMesh --no-build-isolation
git clone -q --recursive https://github.com/JeffreyXiang/FlexGEMM.git && pip install -q ./FlexGEMM --no-build-isolation
pip install -q ./TRELLIS.2/o-voxel --no-build-isolation
# Weights, and the patched pipeline.json.
python - <<'EOF'
import json
from huggingface_hub import snapshot_download
d = snapshot_download("microsoft/TRELLIS.2-4B", local_dir="/opt/weights/TRELLIS.2-4B")
snapshot_download("microsoft/TRELLIS-image-large", allow_patterns=["ckpts/ss_dec_conv3d_16l8_fp16*"], local_dir="/opt/weights/TRELLIS-image-large")
snapshot_download("camenduru/dinov3-vitl16-pretrain-lvd1689m", local_dir="/opt/weights/dinov3-vitl16")
snapshot_download("ZhengPeng7/BiRefNet", local_dir="/opt/weights/BiRefNet")
p = f"{d}/pipeline.json"
c = json.load(open(p))
a = c["args"]
a["models"]["sparse_structure_decoder"] = "/opt/weights/TRELLIS-image-large/ckpts/ss_dec_conv3d_16l8_fp16"
a["image_cond_model"]["args"]["model_name"] = "/opt/weights/dinov3-vitl16"
a["rembg_model"]["args"]["model_name"] = "/opt/weights/BiRefNet"
json.dump(c, open(p, "w"), indent=1)
EOF
