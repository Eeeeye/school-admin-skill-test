# Single-server interview demo

This profile runs the complete product with PostgreSQL, backend, Caddy/frontend,
an isolated persistent demonstration chain and an offline IPFS node. It does not
publish a real blockchain credential or implement PDF report export.

## Prerequisites

- Linux server with Docker Engine and the Compose plugin, 2 GB RAM and 4 GB swap.
- A hostname whose DNS points to the server. Set only that hostname in
  `PUBLIC_HOST`, without a scheme, port, slash or path. Check any AAAA record too.
- Allow inbound TCP 80/443 in the cloud firewall; restrict SSH to your own access.
  No database, API, IPFS or blockchain port needs to be opened.
- The `172.30.77.0/24` Docker subnet must not overlap another server/VPN network.

The five runtime memory limits total 1,312 MiB. Image builds need additional
memory; build images separately or serially before starting this small server.
The Compose project is `school-demo`; this profile is independent of the local
`docker-compose.yml` stack. Do not combine the two Compose files.

## Configure and start

The application images use Node.js 22 LTS. Installation on Alibaba Cloud Linux 3
follows the [vendor Docker instructions](https://www.alibabacloud.com/help/en/ecs/user-guide/install-and-use-docker).
Check the Node.js [release status](https://nodejs.org/en/about/previous-releases)
again for future deployments.

1. Copy `deploy/.env.example` to `deploy/.env.server`, apply `chmod 600`, and
   populate fresh secrets privately. The example is deliberately not runnable.
   Use distinct URL-safe random values of at least 32 bytes for the five token
   secrets; the database password must also be URL-safe. Generate a new BIP-39
   mnemonic and derive the issuer private key from `m/44'/60'/0'/0/0`. Preserve
   both for every future restart; never use the public local/test fixtures.

   Alternatively, with backend or blockchain dependencies installed, run
   `node scripts/generate-server-env.cjs school.example.com admin@example.com`.
   It creates a private `deploy/.env.server` and `.server-deploy/access.json`
   (both excluded from Git), prints no credentials, and refuses to overwrite an
   existing deployment. Keep the latter file on the administrator's computer.
2. Build or load the images named `school-demo-backend:latest`,
   `school-demo-frontend:latest` and `school-demo-blockchain:latest`. Build
   serially on this small server:

   ```bash
   dc() { docker compose --env-file deploy/.env.server -f docker-compose.server.yml "$@"; }
   dc config --quiet
   dc build backend
   dc build frontend
   dc build blockchain
   dc up -d --wait postgres blockchain ipfs
   dc run --rm --no-deps backend node src/migrate.js
   ```

3. Bootstrap a private administrator before starting the public site. Enter a
   generated password with 16–128 characters. These prompts keep it out of shell
   history; the bootstrap script does not print it.

   ```bash
   read -r -p 'Administrator email: ' BOOTSTRAP_ADMIN_EMAIL
   read -r -s -p 'Administrator password: ' BOOTSTRAP_ADMIN_PASSWORD; echo
   export BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
   dc run --rm --no-deps -e BOOTSTRAP_ADMIN_EMAIL -e BOOTSTRAP_ADMIN_PASSWORD \
     backend node src/scripts/bootstrap-admin.js
   unset BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
   dc up -d --wait backend frontend
   ```

   Use an address other than `admin@school-admin.com`. Bootstrap disables the
   published default administrator; production startup refuses that default
   account while it still has usable credentials. The same bootstrap command is
   safe to repeat; changing its password invalidates the administrator's sessions.
4. Open `https://<PUBLIC_HOST>`. Caddy obtains and renews the certificate; its
   state persists in dedicated volumes. Confirm login, student CRUD, certificate
   issuance, public verification and revocation. Copy public links from the
   server deployment, not from an earlier localhost session.

Invitation/password-setup email requires a verified `MAIL_FROM_USER` and
`RESEND_API_KEY`. Without those, the bootstrapped administrator and management/demo
flows work, but mail delivery and emailed account activation do not.

Only Caddy publishes 80/443. Its fixed internal address is `172.30.77.10`; the
backend trusts that exact proxy. Browser wallets supply recipient addresses;
they are not offered a private RPC or asked to sign issuance transactions.

After the public site is ready, run `node scripts/test-server.cjs` on the
administrator's computer. It reads `.server-deploy/access.json` privately and
checks HTTPS, authentication, CSRF, student management, IPFS, and certificate
issuance/verification/revocation. It retains one clearly fictional demo student
and a valid certificate, and prints public verification links without credentials.

## Operation and backup

```bash
dc ps
dc logs --tail 100 backend blockchain frontend
dc exec -T frontend wget -q -O - http://127.0.0.1:8081/health
dc restart backend
```

The frontend's internal HTTP health listener is not published. All five services
restart automatically and use bounded Docker logs. Health checks establish
service readiness; verify an actual certificate after a restart as well.

Run `bash deploy/backup.sh /var/backups/school-demo` before upgrades and regularly
while retaining data. It temporarily stops the site, backend, chain and IPFS,
keeps PostgreSQL up to take a custom-format dump, then archives the stopped
volumes and restarts only services that were previously running. Run one backup
at a time. `ENV_FILE` and `COMPOSE_PROJECT_NAME` may override the defaults.
Restoration uses `up -d --wait --no-deps --no-recreate` for those services, which
waits for health without recreating their containers or starting other services.
This also works with Compose v2.27, whose `start` command has no `--wait` option.

Each backup contains the database dump, chain and deployment state, IPFS,
Caddy data/config, deployment files, checksums and **the protected environment
including private keys**. Keep it inaccessible to other users, copy an encrypted
backup off the server, and do not put it into Git or a public bucket. A directory
with an `INCOMPLETE` marker is not a successful backup. Check `SHA256SUMS` before
restoring. Old public certificate links depend on the same hostname and data.

Restore into fresh, empty volumes with the same saved environment and matching
images. Keep the previous volumes untouched until verification passes. Restore
the five `.tar.gz` archives into their corresponding volumes while services are
stopped; start PostgreSQL alone and restore `postgres.dump` using
`dc exec -T postgres pg_restore --exit-on-error --clean --if-exists -U postgres -d school_mgmt < "$BACKUP_DIR/postgres.dump"`.
Set `BACKUP_DIR` to the verified backup directory first. Then start the chain,
IPFS, backend and frontend in dependency order and verify an existing certificate.
Two stacks cannot simultaneously claim this profile's fixed subnet or public
ports. Never use `docker compose down -v` on data that must be retained.

Deployment-file checks without starting a server:

```bash
docker compose --env-file deploy/.env.example -f docker-compose.server.yml config --quiet
bash -n deploy/backup.sh
python3 deploy/test-backup.py
```

The backup tests use a fake Docker CLI and do not access live containers. Perform
a real backup and restore rehearsal on disposable volumes before relying on it
for irreplaceable data.
