#!/usr/bin/env bash
# Nightly backup: DB dump + photo storage. Example cron (03:00): 0 3 * * * /path/to/mana/server/scripts/backup.sh /backups
# Needs DATABASE_URL_OWNER in the environment. Keep backups encrypted/off-box: they contain private family data.
set -euo pipefail
OUT="${1:?backup dir}"; STAMP=$(date +%Y%m%d-%H%M%S); mkdir -p "$OUT"
pg_dump "$DATABASE_URL_OWNER" --format=custom --file "$OUT/mana-$STAMP.dump"
tar -C "${STORAGE_DIR:-./storage}" -czf "$OUT/photos-$STAMP.tgz" photos 2>/dev/null || true
find "$OUT" -name 'mana-*.dump' -mtime +30 -delete; find "$OUT" -name 'photos-*.tgz' -mtime +30 -delete
echo "backup written to $OUT ($STAMP)"
# restore: pg_restore --clean --if-exists -d "$DATABASE_URL_OWNER" mana-<stamp>.dump
