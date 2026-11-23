#!/usr/bin/env bash
# Proves that a backup can really be restored: restores the dump into a TEMPORARY database, checks key tables, then drops it.
# Usage: restore-test.sh <dump file> <admin psql URL, e.g. postgres://postgres:PW@host:5432/postgres>
set -euo pipefail
DUMP="${1:?dump file}"; ADMIN="${2:?admin url}"; DB="mana_restore_test_$$"
psql "$ADMIN" -v ON_ERROR_STOP=1 -qc "CREATE DATABASE $DB"
trap 'psql "$ADMIN" -qc "DROP DATABASE IF EXISTS $DB" >/dev/null' EXIT
BASE="${ADMIN%/*}"
pg_restore --no-owner --no-privileges -d "$BASE/$DB" "$DUMP"
for t in users diary_entries reflection_entries mom_messages chat_messages wishes photos; do
  n=$(psql "$BASE/$DB" -Atc "SELECT count(*) FROM $t"); echo "  $t: $n rows"
done
echo "RESTORE TEST OK ($DUMP)"
