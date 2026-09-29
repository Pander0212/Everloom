#!/usr/bin/env bash
# Create a backup (database + media) and copy it to ./backups on the host.
set -euo pipefail
cd "$(dirname "$0")"
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"
mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"
if $DOCKER compose exec -T everloom true >/dev/null 2>&1; then
  # Running: take a consistent SQLite online backup inside the container.
  $DOCKER compose exec -T everloom node --input-type=module -e '
    const { default: Database } = await import("better-sqlite3");
    const db = new Database("/data/everloom.db");
    await db.backup("/data/host-backup.db");
    db.close();
  '
  tar -C data -czf "backups/everloom-$STAMP.tar.gz" --transform 's/^host-backup.db$/everloom.db/' host-backup.db $( [ -d data/media ] && echo media )
  rm -f data/host-backup.db
else
  # Stopped: the files are already consistent.
  tar -C data -czf "backups/everloom-$STAMP.tar.gz" everloom.db $( [ -d data/media ] && echo media )
fi
# Keep the 14 newest host backups.
ls -1t backups/everloom-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "Backup written to backups/everloom-$STAMP.tar.gz"
