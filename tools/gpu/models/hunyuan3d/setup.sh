#!/bin/bash
# Hunyuan3D 2.1 (Tencent, "Tencent Hunyuan 3D 2.1 Community License"; it does not apply in the EU,
# UK and South Korea: the owner chose to use it for private use, outputs only, weights never
# redistributed; see docs/3d-gen/DECISION.md). https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1,
# weights tencent/Hunyuan3D-2.1. Follows the README; the demo-only packages (gradio, bpy, deepspeed,
# tensorboard) are left out: the textured OBJ is turned into a GLB by Everloom's own Blender.
set -euxo pipefail
V=/opt/venvs/hunyuan3d
python3 -m venv $V
. $V/bin/activate
pip install -q --upgrade pip wheel setuptools
pip install -q torch==2.5.1 torchvision==0.20.1 --index-url https://download.pytorch.org/whl/cu124
mkdir -p /opt/src && cd /opt/src
git clone -q https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1.git
cd Hunyuan3D-2.1
git rev-parse HEAD > /opt/worker/hunyuan3d.rev
grep -v -E '^(--extra-index-url|gradio|fastapi|uvicorn|bpy|deepspeed|tb_nightly|pythreejs)' requirements.txt > /tmp/hy-req.txt
pip install -q -r /tmp/hy-req.txt
cd hy3dpaint/custom_rasterizer && pip install -q . --no-build-isolation && cd ../..
cd hy3dpaint/DifferentiableRenderer && bash compile_mesh_painter.sh && cd ../..
mkdir -p hy3dpaint/ckpt
curl -fsSL -o hy3dpaint/ckpt/RealESRGAN_x4plus.pth https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth
python - <<'EOF'
from huggingface_hub import snapshot_download
snapshot_download("tencent/Hunyuan3D-2.1")
snapshot_download("facebook/dinov2-giant")
EOF
