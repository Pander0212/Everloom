#!/bin/sh
# Runs the server's convert job on one .blend exactly as the server does: convert.sh <blender> <file.blend> <outdir>
B="$1"; F="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; mkdir -p "$3"; D="$(cd "$3" && pwd)"; R="$(cd "$(dirname "$0")/../.." && pwd)"
rm -rf "$D"; mkdir -p "$D/job"; cp "$F" "$D/job/input.blend"
echo '{"op":"convert","input":"input.blend","output":"output.glb"}' > "$D/job/job.json"
s=$(date +%s)
(cd "$D/job" && timeout 1500 "$B" --background --factory-startup --disable-autoexec --python-exit-code 3 --python "$R/apps/server/src/blender/worker.py" -- "$D/job/job.json" > "$D/convert.log" 2>&1)
echo "exit $? in $(( $(date +%s)-s ))s"
rm -f "$D/job/input.blend"
