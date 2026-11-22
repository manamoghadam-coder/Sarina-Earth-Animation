#!/usr/bin/env bash
# Creates the database and two roles:
#   mana_owner : owns tables, used ONLY by migrate/seed/scheduler/login (system pool)
#   mana_app   : used for every user request; subject to Row Level Security
# Usage: sudo -u postgres bash scripts/db-setup.sh <owner_password> <app_password>
set -euo pipefail
OWNER_PW="${1:?owner password}"; APP_PW="${2:?app password}"
psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mana_owner') THEN CREATE ROLE mana_owner LOGIN PASSWORD '${OWNER_PW}'; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mana_app') THEN CREATE ROLE mana_app LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOBYPASSRLS; END IF;
END \$\$;
SELECT 'CREATE DATABASE mana OWNER mana_owner' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='mana')\gexec
SQL
