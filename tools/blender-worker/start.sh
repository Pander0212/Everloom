#!/bin/bash
# On the rented CPU pod: install Blender 5.2 LTS (checked against blender.org's checksum) and start
# the converter server. The pod ends itself after IDLE_SECONDS without requests or MAX_SECONDS in all.
set -euo pipefail
cd /opt/worker
echo "installing" > stage
(apt-get update -qq && apt-get install -y -qq xz-utils curl python3 libxi6 libxxf86vm1 libxfixes3 libxrender1 libgl1 libxkbcommon0 libsm6 >/dev/null) || true
V=5.2.0
curl -fsSL -o b.tar.xz "https://download.blender.org/release/Blender5.2/blender-$V-linux-x64.tar.xz"
WANT=$(curl -fsSL "https://download.blender.org/release/Blender5.2/blender-$V.sha256" | grep "linux-x64.tar.xz" | cut -d' ' -f1)
echo "$WANT  b.tar.xz" | sha256sum -c - >/dev/null
tar -xJf b.tar.xz && rm b.tar.xz
echo "ready" > stage
exec python3 server.py
