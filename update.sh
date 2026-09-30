#!/usr/bin/env bash
# Update Everloom: backup → pull → rebuild → migrate → restart → check the new build is running.
# Run it as your normal user (sudo is used for docker when needed). Running it with sudo also works.
set -euo pipefail
cd "$(dirname "$0")"
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"

# git runs as the owner of this folder: under sudo, git refuses a folder owned by someone else
# ("dubious ownership"), and pulling as root would leave files your user can't update later.
OWNER="$(stat -c %U .)"
git_() {
  if [ "$(id -u)" = 0 ] && [ "$OWNER" != root ]; then sudo -u "$OWNER" git "$@"; else git "$@"; fi
}

echo "Backing up first…"
bash backup.sh

echo "Pulling the latest version…"
BEFORE="$(git_ rev-parse --short HEAD)"
if ! git_ pull --ff-only; then
  echo >&2
  echo "Couldn't pull the new version, so nothing was changed. Usually this means files in this folder were" >&2
  echo "edited by hand. See what changed with:  git status   (undo local edits with: git checkout -- <file>)" >&2
  exit 1
fi
AFTER="$(git_ rev-parse --short HEAD)"
[ "$BEFORE" = "$AFTER" ] && echo "Already on the latest version ($AFTER); rebuilding anyway." || echo "Updating $BEFORE → $AFTER"

echo "Rebuilding…"
$DOCKER compose build --build-arg EVERLOOM_COMMIT="$AFTER" everloom
echo "Applying database migrations…"
$DOCKER compose run --rm everloom node apps/server/dist/index.js --migrate-only
$DOCKER compose up -d

echo "Waiting for Everloom to start…"
RUNNING=""
for _ in $(seq 1 60); do
  RUNNING="$($DOCKER compose exec -T everloom curl -fsS http://127.0.0.1:8787/api/health 2>/dev/null | sed -n 's/.*"build":"\([^"]*\)".*/\1/p' || true)"
  [ -n "$RUNNING" ] && break
  sleep 2
done
if [ "$RUNNING" = "$AFTER" ]; then
  echo "Updated: Everloom is running build $AFTER (Settings → About shows the same)."
  echo "If a browser still shows the old version, reload the page once or twice."
else
  echo "Warning: expected build $AFTER but the server reports '${RUNNING:-nothing}'. Check: $DOCKER compose logs everloom" >&2
  exit 1
fi
