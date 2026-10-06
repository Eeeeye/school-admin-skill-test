# School Management Backend

Node.js 20 + Express + PostgreSQL 15+ API for the school management system. The
API uses httpOnly JWT cookies, an HMAC-bound CSRF token, database-backed
refresh-token revocation, and database-backed role permissions.

## Run locally

```bash
cp .env.example .env
# edit DATABASE_URL and the secret values
npm ci
psql -d school_mgmt -f ../seed_db/tables.sql
psql -d school_mgmt -f ../seed_db/seed-db.sql
npm run migrate
npm start
```

For the complete stack, use the repository root instead:

```bash
docker compose up --build
```

The backend listens on `http://localhost:5007`. `GET /health` performs a
PostgreSQL readiness check and returns `503` while the database is unavailable.
The Docker image runs as the non-root `node` user.

## Configuration

Copy `.env.example` and provide values for the database URL, JWT access and
refresh secrets, CSRF secret, token lifetimes, UI/API URLs, cookie domain and
email provider. Set `COOKIE_SECURE=false` only for local HTTP; use `true` when
the API is served through HTTPS. Email sending is optional during local
development and returns a controlled `503` when no Resend key is configured.

## API conventions

The versioned base path is `/api/v1`. Login sets the access, refresh and CSRF
cookies. Protected requests must send the CSRF cookie value in the
`x-csrf-token` header. Protected routes authenticate the access/refresh pair,
then apply the role permission for the exact path and method. Role and
permission administration is restricted to administrators.

### Authentication

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/auth/login` | Sign in and set cookies |
| GET | `/auth/refresh` | Rotate the access and CSRF cookies |
| POST | `/auth/logout` | Invalidate the refresh token and clear cookies |

### Student management

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/students` | List students; supports `class`, `section`, `name`, and `roll` filters |
| POST | `/students` | Create a student; `name` and `email` are required |
| GET | `/students/:id` | Read one student |
| PUT | `/students/:id` | Partially update a student while preserving omitted fields |
| POST | `/students/:id/status` | Enable or disable system access with `{ "status": boolean }` |
| DELETE | `/students/:id` | Permanently remove the profile and student-owned leave records in a transaction |

Student IDs are checked against the student role. Updates with a missing ID
cannot fall through to the database function's insert path. Deletes clear
optional references from notices, approvals and reviewer fields before
removing the student.

### Other modules

The API also exposes CRUD workflows for classes, sections, departments,
notices, staff, leave policies/requests, class teachers, roles and access
controls. These routes use the same authentication, CSRF and RBAC middleware;
role administration is administrator-only.

## Certificates

`GET /certificates/verify/:id` is public and returns chain/IPFS verification
without student names or emails. It returns `503` for unavailable dependencies
rather than declaring a certificate invalid. All other certificate routes require
login and CSRF. Administrators can issue, retry and revoke; students can only read
their own records. `GET /certificates/config` returns the configured network.

`POST /certificates` accepts `{ studentId, title, description, recipientAddress }`
and an optional `Idempotency-Key` header. Issuance returns `201` when confirmed,
`202` when pending, or `503` with the persisted failed certificate for retry.
`POST /certificates/:id/retry` recovers the same operation. Revocation uses
`POST /certificates/:id/revoke`; the issuer must be authorized by the contract.
Public metadata is pinned before the chain transaction. The transaction hash is
saved before waiting for its receipt. A PostgreSQL advisory lock serializes
issuer mutations across API processes. A network/deployment mismatch fails closed.

## Database seed

`seed_db/tables.sql` creates the schema and stored procedures. `seed_db/seed-db.sql`
adds the admin account, roles, permission definitions, classes, sections and
departments. Docker runs both scripts only when its named PostgreSQL volume is
created for the first time. `AUTO_MIGRATE=true` applies ordered files under
`seed_db/migrations` using a database lock and per-file transaction; each version
runs once. It upgrades existing volumes without reseeding or deleting records.
Run `npm run migrate` explicitly for a non-Compose installation.

## Verification

Run the backend syntax check:

```bash
npm test
# or run the isolated authentication regression suite
npm run test:auth
```

The suites cover authentication/session revocation, password links, certificate
RBAC/idempotence, chain/IPFS outages and metadata integrity. Real integration
checks use the running five-service stack:

```bash
# from repository root
./scripts/test-product.sh
docker compose exec -T backend node < backend/test/school-workflows.integration.js
```

## Production notes

- Keep `.env` files and provider keys outside version control.
- `NODE_ENV=production` requires HTTPS `UI_URL`/`API_URL`, secure cookies,
  an empty `COOKIE_DOMAIN` (host-only cookies), five distinct random token/CSRF
  secrets of at least 32 characters, and valid token durations. Production
  startup refuses an active default demonstration administrator.
- Set `TRUSTED_PROXY_CIDRS` to the exact internal reverse proxy address or subnet,
  for example `172.30.0.2/32` for a proxy with that fixed Docker address. The
  default trusts no proxies. Public addresses, `true`, aliases and hop counts
  are rejected. Do not publish the backend port directly or trust an entire
  private network when the proxy can be identified by one address.
- Login limits allow 10 failed attempts per IP/account and 60 failed attempts
  per IP in 15 minutes; successful logins release their budget. Refresh allows
  60 requests per IP/minute. Password links allow 10 requests per IP/15 minutes;
  authenticated mail/reset requests allow 10 per actor/IP/hour. IPv6 addresses
  share a /64 budget. `429` responses include `Retry-After`. These bounded
  in-memory limits are intended for this single-instance demo; multiple API
  replicas need a shared gateway or rate-limit store.
- Use a managed PostgreSQL backup and migration process instead of relying on
  init scripts for an existing production volume.
- Password setup/reset links issued before the fingerprinted-token change must
  be sent again; new links are single-use against the current password state.
- Review dependency audit output before deploying; the task intentionally
  avoids unreviewed major-version upgrades.

### Initialize a private administrator before public startup

Initialize the database and run migrations first. Pass the following variables
from a protected environment file or secret manager to the one-time command;
never put a literal password in shell history or a tracked file:

- `BOOTSTRAP_ADMIN_EMAIL`: your administrator email, different from
  `admin@school-admin.com` in production.
- `BOOTSTRAP_ADMIN_PASSWORD`: a generated 16–128 character secret. Placeholders,
  low-diversity strings and the repository's shared demo password are rejected.
- `BOOTSTRAP_ADMIN_NAME`: optional display name; defaults to `School Administrator`.

```sh
npm run bootstrap:admin
# equivalent, also suitable for a one-off backend container:
node src/scripts/bootstrap-admin.js
```

The command creates or updates only an administrator account; it refuses to
promote a matching student/teacher account. In one transaction it disables the
old default account, removes its shared password, and revokes its sessions.
Re-running with the same values preserves the password hash and administrator
sessions. Changing the password or account settings revokes existing sessions.
Output contains operation status and IDs, never the password. Remove the
bootstrap variables from the long-running service environment after setup.

Local development keeps its seeded login because this command is never invoked
automatically and the production account guard only runs in production. A
public deployment without a public certificate RPC returns `rpcUrl: null`;
wallet network setup is then unavailable while server-side issuance remains usable.
