#!/usr/bin/env bash
# Applies every migration to a throwaway Postgres database (with pgvector) and runs the SQL tests.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
db="lpn_test_$$"
export PGOPTIONS="-c client_min_messages=warning"

createdb "$db"
trap 'dropdb --if-exists "$db"' EXIT

psql -v ON_ERROR_STOP=1 -q -d "$db" -c "create extension if not exists pgcrypto" -f "$here/supabase_stubs.sql"
for f in "$here"/../migrations/*.sql; do
  echo "applying $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -q -d "$db" -f "$f"
done
for f in "$here"/*_test.sql; do
  echo "testing $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -q -o /dev/null -d "$db" -f "$f"
done
echo "all database tests passed"
