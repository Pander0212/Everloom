#!/bin/bash
# On the rented GPU pod (nvidia/cuda:12.4.1-devel-ubuntu22.04; the bundle is already unpacked): start its
# HTTP server, then set up each model in $MODELS (each in its own virtualenv, weights downloaded
# from the official sources at this point: nothing is redistributed). The server stops the pod when
# idle or past its time limit.
set -uo pipefail
cd /opt/worker
unset W_BUNDLE
export DEBIAN_FRONTEND=noninteractive
# The CUDA image has no Python: install it first, then the server can answer.
apt-get update -qq && apt-get install -y -qq --no-install-recommends python3 python3-venv python3-dev git git-lfs curl ca-certificates \
  libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 libjpeg-dev build-essential ninja-build >/opt/worker/setup.system.log 2>&1
python3 worker/server.py &
# A host with a broken GPU fails here, in seconds, instead of after the whole setup.
if python3 -c "import ctypes,sys; sys.exit(ctypes.CDLL('libcuda.so.1').cuInit(0))" 2>/dev/null; then echo "ok $(nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader 2>/dev/null)" > stage.gpu
else echo "failed: CUDA does not start on this host ($(nvidia-smi --query-gpu=name --format=csv,noheader 2>&1 | head -c 120))" > stage.gpu; wait; fi
export TORCH_CUDA_ARCH_LIST="${TORCH_CUDA_ARCH_LIST:-8.6}"
export MAX_JOBS="${MAX_JOBS:-4}"
export HF_HUB_ENABLE_HF_TRANSFER=0
for m in $MODELS; do
  ( echo "starting" > stage.$m
    if bash models/$m/setup.sh > setup.$m.log 2>&1; then echo "ready" > stage.$m; else echo "failed: $(tail -c 250 setup.$m.log | tr '\n' ' ')" > stage.$m; fi ) &
done
wait
