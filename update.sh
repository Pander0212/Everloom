#!/usr/bin/env bash
# Update Everloom: backup → pull → rebuild → migrate → restart.
set -euo pipefail
cd "$(dirname "$0")"
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
echo "Backing up first…"
bash backup.sh
echo "Pulling the latest version…"
git pull --ff-only
echo "Rebuilding…"
$DOCKER compose build --build-arg EVERLOOM_COMMIT="$(git rev-parse --short HEAD)" everloom
echo "Applying database migrations…"
$DOCKER compose run --rm everloom node apps/server/dist/index.js --migrate-only
$DOCKER compose up -d
echo "Updated."
