# School Management Database

PostgreSQL **15 or newer** is required. The schema uses `UNIQUE NULLS NOT DISTINCT`,
which is unavailable in older PostgreSQL versions. Compose runs PostgreSQL 16.

## Fresh local installation

From the repository root:

```sh
createdb school_mgmt
psql -v ON_ERROR_STOP=1 -d school_mgmt -f seed_db/tables.sql
psql -v ON_ERROR_STOP=1 -d school_mgmt -f seed_db/seed-db.sql
cd backend
# DATABASE_URL in backend/.env must identify this database.
npm run migrate
```

`tables.sql` creates the schema and functions. `seed-db.sql` installs reference
roles, status codes, permissions and local demonstration data. It is transactional
and checks reserved IDs before inserting data. The local-only administrator is
`admin@school-admin.com`; its development password is documented in the root
README. Never use that shared account for an internet-facing deployment.

Docker runs its initialization scripts only when creating an empty PostgreSQL
volume. On existing installations, run migrations instead of running
`tables.sql` again. `AUTO_MIGRATE=true` runs the same migration runner at backend
startup; it takes a database lock and commits each migration and its tracking row
atomically. Applied migration filenames are recorded in `schema_migrations`.
Do not edit an already-applied migration to ship a new change; add a new file.

## Important tables and relationships

- `users`, `user_profiles`: login identity and school profile. Reserved role IDs
  are **1=Admin, 2=Teacher, 3=Student**. Parent statistics count a role explicitly
  named Parent; custom role ID 4 is not implicitly a parent.
- `roles`, `permissions`, `access_controls`: role definitions and exact API/menu
  permissions. Administrator-only operations retain server-side guards even if
  a custom role is assigned every configurable permission.
- `classes`, `sections`, `class_teachers`: placement and teacher assignments.
  Profile class/section names use foreign keys with rename propagation. The
  legacy `classes.sections` field contains comma-separated section names; the API
  accepts old IDs and normalizes new writes to names.
- `leave_policies`, `user_leave_policy`, `user_leaves`: policy membership and
  requests. Status IDs are 1=On Review, 2=Approved and 3=Cancelled. Inclusive leave
  duration is `(to_dt - from_dt) + 1`; dashboard totals are scoped to the user.
- `notices`, `notice_status`, `notice_recipient_types`: announcements and fixed
  role/class/department audiences. Status 5 is Approved; 6 is Deleted. Audience
  configuration is never executed as SQL.
- `user_refresh_tokens`: revocable sessions. Disabling users or roles deletes
  associated refresh tokens. Expired tokens are rejected at authentication.
- `certificates` (migration 001): certificate issuance state and transaction
  history; deleting a student preserves certificate history.

Application transactions also maintain relationships that are not expressible
by the starter's foreign keys: section renames update class membership, class
renames update notice audiences, and deleting a placement clears its reporting
line and teacher assignments. A shared advisory lock orders academic writes
before user-row locks.

## Safe inspection

```sql
SELECT r.id, r.name, COUNT(u.id) AS users
FROM roles r LEFT JOIN users u ON u.role_id = r.id
GROUP BY r.id, r.name ORDER BY r.id;

SELECT name, applied_at FROM schema_migrations ORDER BY name;

SELECT ul.id, u.name, ul.from_dt, ul.to_dt,
       (ul.to_dt - ul.from_dt) + 1 AS days
FROM user_leaves ul JOIN users u ON u.id = ul.user_id
WHERE ul.status = 1;
```

## Verification and backup

With the local Compose stack running, execute `./scripts/test-database.sh` from
the repository root to test a fresh temporary database and repeated migrations.
It leaves the application database unchanged. The HTTP suite in
`backend/test/audit.integration.js` checks authorization, session revocation,
class/section integrity and dashboard totals using isolated fixtures.

For an ordinary SQL backup, use `pg_dump` with database credentials provided via
a protected environment or PostgreSQL password file. The hosted demonstration
also has coordinated database, chain and IPFS backup tooling documented in
[`deploy/README.md`](../deploy/README.md). A successful archive checksum does not
by itself prove that a full restore works.
