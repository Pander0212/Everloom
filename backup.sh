#!/usr/bin/env bash
# Create a backup (database, media, and the vault's key file when it's on) and copy it to ./backups
# on the host.
# All file work happens inside the container (which owns data/), so this runs as your normal user.
set -euo pipefail
cd "$(dirname "$0")"
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
mkdir -p backups
if [ ! -w backups ]; then
  # An earlier run with sudo can leave the folder owned by root.
  echo "Making backups/ yours again (it was created by root)…"
  sudo chown -R "$(id -u):$(id -g)" backups
fi
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT=""
fail() {
  [ -n "$OUT" ] && rm -f "$OUT"
  echo "Backup failed: $1" >&2
  exit 1
}
# A copy of the data folder made while Everloom is stopped (nothing writes to it then).
stopped_copy() {
  OUT="backups/everloom-$STAMP.tar.gz"
  $DOCKER compose run --rm --no-deps -T everloom sh -c 'cd /data && set -- everloom.db; for f in everloom.db-wal vault.json system.db media; do [ -e "$f" ] && set -- "$@" "$f"; done; tar -czf - "$@"' >"$OUT" || fail "couldn't read the data folder"
}

if $DOCKER compose exec -T everloom true >/dev/null 2>&1; then
  # Running: the server makes the backup itself (it holds the database open, and the vault key when
  # the vault is on), into data/backups; it's then copied out here. Same zip as the app's backups.
  RESULT="$($DOCKER compose exec -T everloom sh -c 'T="$(cat /data/.control-token 2>/dev/null)"; [ -n "$T" ] && curl -fsS -X POST -H "x-control-token: $T" http://127.0.0.1:8787/api/local/backup' 2>/dev/null || true)"
  NAME="$(printf '%s' "$RESULT" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')"
  if [ -n "$NAME" ]; then
    OUT="backups/everloom-$STAMP.zip"
    $DOCKER compose exec -T everloom cat "/data/backups/$NAME" >"$OUT" || fail "couldn't copy the backup out of the container"
  else
    # An older Everloom (no backup route), or the vault couldn't be copied while running: stop it for
    # a moment so the files are consistent, copy them, and start it again.
    echo "Stopping Everloom for a moment to copy its data…"
    $DOCKER compose stop everloom >/dev/null
    trap '$DOCKER compose start everloom >/dev/null 2>&1 || true' EXIT
    stopped_copy
    $DOCKER compose start everloom >/dev/null
    trap - EXIT
  fi
else
  # Stopped: the files are already consistent.
  stopped_copy
fi
[ -s "$OUT" ] || fail "the archive is empty"
# Run with sudo: give the archive to whoever owns this folder, like everything else in it.
[ "$(id -u)" = 0 ] && chown "$(stat -c %u:%g .)" "$OUT" 2>/dev/null || true
# Keep the 14 newest host backups.
ls -1t backups/everloom-*.tar.gz backups/everloom-*.zip 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "Backup written to $OUT"
