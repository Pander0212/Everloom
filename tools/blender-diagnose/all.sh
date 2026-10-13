#!/bin/sh
# Converts every .blend in samples/3d with the server's job and prints each result: all.sh <blender> [outdir]
B="$1"; O="${2:-samples/repro2}"; R="$(cd "$(dirname "$0")/../.." && pwd)"
for f in "$R"/samples/3d/*.blend "$R"/samples/3d/*.blend1; do
  [ -f "$f" ] || continue
  n=$(basename "$f" | sed 's/\.blend1\{0,1\}$//; s/[^A-Za-z0-9._-]/_/g')
  echo "== $n"
  "$R/tools/blender-diagnose/convert.sh" "$B" "$f" "$R/$O/$n"
  node "$R/tools/blender-diagnose/summary.mjs" "$R/$O/$n/job/result.json"
done
