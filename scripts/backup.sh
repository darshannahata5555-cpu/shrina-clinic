#!/usr/bin/env bash
# Nightly SHRINA database backup. Schedule with cron, e.g.:
#   15 2 * * *  cd /srv/shrina && ./scripts/backup.sh >> storage/backups/backup.log 2>&1
# Copies a pg_dump (custom format) to storage/backups and, if BACKUP_REMOTE is set
# (e.g. an rclone remote like "r2:shrina-backups"), uploads it off-site.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
DIR="${STORAGE_DIR:-./storage}/backups"
mkdir -p "$DIR"
FILE="$DIR/shrina-$(date -u +%Y-%m-%dT%H-%M-%S).dump"
pg_dump --format=custom --no-owner --no-privileges --file="$FILE" "${DATABASE_URL%%\?*}"
echo "$(date -u +%FT%TZ) backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
find "$DIR" -name '*.dump' -mtime +"${BACKUP_RETENTION_DAYS:-30}" -delete
if [ -n "${BACKUP_REMOTE:-}" ]; then rclone copy "$FILE" "$BACKUP_REMOTE"; fi
