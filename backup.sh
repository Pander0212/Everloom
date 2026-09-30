#!/usr/bin/env bash
# Create a backup (database + media) and copy it to ./backups on the host.
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
OUT="backups/everloom-$STAMP.tar.gz"
fail() {
  rm -f "$OUT"
  echo "Backup failed: $1" >&2
  exit 1
}
if $DOCKER compose exec -T everloom true >/dev/null 2>&1; then
  # Running: take a consistent SQLite online backup inside the container, then stream it out.
  $DOCKER compose exec -T everloom node --input-type=module -e '
    const { default: Database } = await import("better-sqlite3");
    const db = new Database("/data/everloom.db");
    await db.backup("/tmp/everloom.db");
    db.close();
  ' || fail "couldn't copy the database"
  $DOCKER compose exec -T everloom sh -c 'cd /tmp && if [ -d /data/media ]; then tar -czf - everloom.db -C /data media; else tar -czf - everloom.db; fi' >"$OUT" || fail "couldn't write the archive"
  $DOCKER compose exec -T everloom rm -f /tmp/everloom.db /data/host-backup.db >/dev/null 2>&1 || true
else
  # Stopped: the files are already consistent.
  $DOCKER compose run --rm --no-deps -T everloom sh -c 'cd /data && if [ -d media ]; then tar -czf - everloom.db media; else tar -czf - everloom.db; fi' >"$OUT" || fail "couldn't read the data folder"
fi
[ -s "$OUT" ] || fail "the archive is empty"
# Keep the 14 newest host backups.
ls -1t backups/everloom-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "Backup written to $OUT"
