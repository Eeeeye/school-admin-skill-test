# School Admin second review — 8 October 2026

Baseline: published and deployed commit `b1a133e`. This is a second pass over the
existing interview demonstration, with regression coverage for independently
reproduced failures. It does not add the excluded Go/PDF export exercise or change
the private-chain deployment model.

## Findings and fixes

### Account verification and database locks

- An email-verification token originally identified only the account. After an
  administrator replaced the email, an old link could verify the new address.
  Tokens now bind the account, exact destination email and verification purpose.
  One conditional database update consumes the matching unverified address, so
  concurrent requests cannot both trigger password-setup mail. Old unbound links
  are intentionally rejected; the existing resend operation issues a new link.
- A failed advisory unlock could return a still-locked PostgreSQL connection to
  the pool. Certificate operations could subsequently remain busy. Certificate
  and migration cleanup now discard connections whose unlock fails, preserving
  the original operation result or error.

### Editing records, permissions and leave policies

- Several edit screens reused the last query result while fetching another ID.
  The old values could therefore remain editable under the next record's ID.
  Class, section, department, class-teacher, notice and notice-recipient editors
  now wait for the current record. Notice detail uses the same rule.
- Failed role-permission loading previously exposed an empty selectable list and
  a Save action. The editor now fails closed, offers Retry and restores editing
  only after valid permission data arrives. Missing permission-catalog data is
  also handled explicitly.
- Renaming/disabling leave policies and changing policy membership now invalidate
  their dependent cached queries, including personal policies, membership counts
  and relevant dashboard/history/approval views.

### HTTP routing, chain startup and test isolation

- Caddy now rejects hidden files and development-server paths and returns 404 for
  missing built assets. Normal SPA pages, API/icon proxies, read-only IPFS and
  valid ACME challenges continue to work. The old live server returned SPA HTML
  for scanner paths; this was not evidence that deployed secrets had leaked.
  Tests deliberately place private fixtures in a disposable static root to prove
  that the new guard protects files even if accidentally copied there.
- A secondary Ganache shutdown error could hide the actual occupied-port startup
  failure. Startup now preserves the original error and does not publish ready
  state. The Solidity contract, bytecode and deployed registry identity are
  unchanged.
- Destructive restart rehearsals now check the explicit isolated Compose project,
  local Docker endpoint, development containers and matching loopback frontend
  port before making changes. Failed preflight cannot run cleanup against another
  project. Docker-context precedence is respected in restore checks as well.

## Verification

Focused checks completed during review:

- Backend: 88 unit tests, including six new email/lock-cleanup regressions.
- Frontend: 21 Node tests, ESLint and production build; 10 controlled browser
  checks covering record navigation and permission failures/recovery.
- Chain: 30 contract/helper tests, including occupied-port startup failure.
- Reverse proxy: 104 HTTP assertions against two real disposable Caddy servers.
- Backup: seven failure/recovery tests.
- Restart preflight: nine tests, including a child-process check proving that an
  invalid target cannot trigger Docker cleanup.

The unchanged first-round API, database, browser, restart and full restore
rehearsals remain in CI. Three additional real HTTP checks verify email-address
binding and concurrent link consumption against PostgreSQL. The workflow also
runs the new reverse-proxy and browser regressions. Consult the Actions run for
the exact submitted commit for the full integrated result; focused checks alone
do not establish deployment or online acceptance.

## Compatibility and remaining boundaries

There is no schema change or administrator credential change. Existing valid and
revoked certificate links must retain their identity through deployment. Old
email-verification links require resending; live mail delivery still needs a
configured provider. The demonstration still uses a shared administrator account,
a private test chain and locally stored IPFS content. The dependency-advisory
limitations in the [first review](review-2026-10-08.md) still apply; this pass does
not claim a fresh zero-vulnerability dependency audit.
