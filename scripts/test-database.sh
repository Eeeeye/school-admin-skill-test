#!/bin/sh
# Validate a fresh install and repeated seed/migration application in an isolated database.
set -eu
cd "$(dirname "$0")/.."
test_database="school_product_test_$(date +%s)_$$"
docker compose exec -T postgres createdb -U postgres "$test_database"
cleanup() { docker compose exec -T postgres dropdb -U postgres --if-exists "$test_database"; }
trap cleanup EXIT HUP INT TERM
sql() { docker compose exec -T postgres psql -X -v ON_ERROR_STOP=1 -U postgres -d "$test_database" "$@"; }
sql -q < seed_db/tables.sql
sql -q < seed_db/seed-db.sql
for migration in seed_db/migrations/*.sql; do sql -q -1 < "$migration"; done
# The seed and migration SQL must also tolerate re-application without duplicates.
sql -q < seed_db/seed-db.sql
for migration in seed_db/migrations/*.sql; do sql -q -1 < "$migration"; done
sql -q <<'SQL'
DO $$
BEGIN
  IF (SELECT count(*) FROM users WHERE email='admin@school-admin.com') <> 1
    OR (SELECT count(*) FROM roles WHERE id IN (1,2,3)) <> 3
    OR (SELECT count(*) FROM classes) <> 12
    OR (SELECT count(*) FROM sections) <> 3
    OR EXISTS (SELECT 1 FROM access_controls GROUP BY path,method HAVING count(*)>1)
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='department_id')
    OR NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='student_certificates')
  THEN RAISE EXCEPTION 'Fresh installation invariants failed'; END IF;
END $$;
SQL
echo "PASS: fresh schema, seed, migrations and repeated application; existing database untouched."
