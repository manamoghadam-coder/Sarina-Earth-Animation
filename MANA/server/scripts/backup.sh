#!/usr/bin/env bash
# Backup: DB dump (custom format) + photo/file storage. Keeps the last $KEEP_DAYS days (default 30).
# Usage: backup.sh <backup dir>          Needs DATABASE_URL_OWNER (and optionally STORAGE_DIR) in the environment.
# Backups contain PRIVATE family data (diaries, messages): keep them off-box too and never share them.
set -euo pipefail
OUT="${1:?backup dir}"; STAMP=$(date +%Y%m%d-%H%M%S); mkdir -p "$OUT"
pg_dump "$DATABASE_URL_OWNER" --format=custom --file "$OUT/mana-$STAMP.dump"
if [ -d "${STORAGE_DIR:-./storage}" ]; then tar -C "${STORAGE_DIR:-./storage}" -czf "$OUT/files-$STAMP.tgz" . ; fi
# retention: old backups beyond KEEP_DAYS days are removed
find "$OUT" -maxdepth 1 -type f \( -name 'mana-*.dump' -o -name 'files-*.tgz' -o -name 'photos-*.tgz' \) -mtime +"${KEEP_DAYS:-30}" -delete
echo "backup written to $OUT ($STAMP)"
