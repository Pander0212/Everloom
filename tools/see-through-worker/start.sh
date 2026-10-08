#!/bin/bash
# Sets up See-through on a fresh GPU machine and serves it (tools/see-through-worker/server.py).
# Used as the pod's start command on RunPod's PyTorch image (torch 2.8, CUDA 12.8), and by the
# Dockerfile. The API answers from the first second, so the watchdog guards setup too.
set -u
WORK=${WORK_DIR:-/work}
REPO=${SEE_THROUGH_DIR:-/opt/see-through}
COMMIT=${SEE_THROUGH_COMMIT:-df019de5129d6c4b406587a14c3501669441a783}
mkdir -p "$WORK" /opt
stage() { echo "$1" > "$WORK/STAGE"; echo "[$(date -u +%H:%M:%S)] $1" >> "$WORK/setup.log"; }
python /opt/worker/server.py >> "$WORK/server.log" 2>&1 &
if [ ! -f "$WORK/READY" ]; then
  stage "fetching See-through ($COMMIT)"
  if [ ! -d "$REPO" ]; then
    git clone -q https://github.com/shitagaki-lab/see-through.git "$REPO" >> "$WORK/setup.log" 2>&1
    git -C "$REPO" checkout -q "$COMMIT" >> "$WORK/setup.log" 2>&1
  fi
  cd "$REPO" && ln -sf common/assets assets
  stage "installing Python packages"
  # Everything inference needs from requirements.txt; not torch (the image has 2.8/cu128), not the
  # Qt UI, notebooks, tests or the training-only losses.
  grep -vE '^(PyQt6|PyQt6-Qt6|qtpy|ipykernel|pytest|lpips|convnext_perceptual_loss|grad-cam)' requirements.txt > /tmp/req.txt
  # Progress shows in /health (the last line pip printed), and a dead mirror fails after a minute
  # instead of hanging the pod.
  ( while [ ! -f "$WORK/PIP_DONE" ]; do sleep 30; l=$(tail -c 300 "$WORK/setup.log" | tr '\r' '\n' | grep -v '^\s*$' | tail -1 | cut -c1-120); echo "installing Python packages: $l" > "$WORK/STAGE"; done ) &
  pip install --no-cache-dir --progress-bar off --timeout 60 --retries 3 -r /tmp/req.txt >> "$WORK/setup.log" 2>&1 || stage "pip install failed"
  touch "$WORK/PIP_DONE"
  stage "downloading the model weights"
  python -c "
from huggingface_hub import snapshot_download
for repo in ('layerdifforg/seethroughv0.0.2_layerdiff3d', '24yearsold/seethroughv0.0.1_marigold'):
    snapshot_download(repo); print('downloaded', repo, flush=True)
" >> "$WORK/setup.log" 2>&1
  python -c "import torch; print('cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0))" >> "$WORK/setup.log" 2>&1
  touch "$WORK/READY"
  stage "ready"
fi
wait
