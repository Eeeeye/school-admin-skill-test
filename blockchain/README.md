# Certificate registry

This package contains the on-chain part of the certificate-verification direction.
`CertificateRegistry` records a certificate ID, issuer, recipient, issue time,
revocation time and an IPFS metadata CID. The document itself stays off-chain.

## Local verification

This package expects Node.js 20 or newer because the metadata helper uses the
built-in `fetch`, `FormData`, and `Blob` APIs.

```bash
corepack prepare pnpm@9.15.9 --activate
pnpm install --frozen-lockfile
pnpm compile
pnpm test
```

The test command covers certificate state transitions and the IPFS upload helper
with a local fake Kubo endpoint. It also starts disposable Ganache processes to
verify persistence and bootstrap metadata validation. No pre-existing chain or
IPFS daemon is required. The Solidity compiler is pinned to `solc@0.8.24` in the
lockfile, so compilation requires no separate compiler download.

## Runtime dependencies and security maintenance

The Docker build compiles with Hardhat in one stage and installs only production
dependencies in a separate, clean stage. The final image contains Ganache,
ethers and the explicitly pinned cryptography packages; it does not contain
Hardhat, the Solidity compiler, test runners or deployment plugins. The unused
Hardhat toolbox has been removed. Compiler settings, Ganache version, chain ID
and contract bytecode are unchanged by this dependency update.

Ganache 7.9.2 includes bundled copies of dependencies that a lockfile-only
`pnpm audit` does not report. `scripts/harden-ganache.cjs` replaces its bundled
`secp256k1`, `elliptic` and `bn.js` with locked, compatible versions 4.0.5,
6.6.1 and 4.12.3. This addresses the published
[elliptic signing vulnerability](https://github.com/advisories/GHSA-vjh7-7g9h-fjfh),
[secp256k1 ECDH vulnerability](https://github.com/advisories/GHSA-584q-6j8j-r5pm)
and [bn.js denial of service](https://github.com/advisories/GHSA-378v-28hj-76wf).
It changes only installed package resolution, not Ganache source or chain data.
Docker runs and verifies it before copying dependencies into the runtime image;
`pnpm test` and `pnpm node:persistent` also run it automatically. If launching
`scripts/local-chain.js` directly after a new installation, run
`pnpm harden:runtime` first.

Recheck using the pinned pnpm version, since advisory results change over time:

```bash
pnpm --version # 9.15.9
pnpm harden:runtime
node scripts/harden-ganache.cjs --check
pnpm audit --prod
pnpm audit
pnpm test
```

At the October 2026 audit, the production lockfile reported one low-severity
[elliptic advisory without an available fix](https://github.com/advisories/GHSA-848j-6mx2-7j84).
The full development graph still reported 11 high, 12 moderate and 7 low
advisories in Hardhat's development dependencies and elliptic. These results are
not a claim that every bundled package or the application is vulnerability-free.
Do not expose RPC publicly or use this demonstration chain with real assets.
Keep development tools out of the running server; migrating Hardhat major
versions requires separate compatibility validation. The tests check actual
Ganache dependency resolution and deterministic signature compatibility, as
well as persistent certificate state after a restart.

Start a local chain in one terminal and deploy in another:

```bash
pnpm node
pnpm deploy:local
```

The deployment script refuses networks other than Hardhat and localhost by
default. A remote deployment requires an explicit `ALLOW_REMOTE_DEPLOY=true`
and a signer configured by the selected Hardhat network.
It also refuses to overwrite an existing `deployments/<network>.json` before
accessing a signer. Do not run `deploy:local` against the integrated persistent
product: its bootstrap already deploys and reuses the registry. For an intentional
new standalone experiment, preserve the old chain state and deployment file,
then move that metadata file out of the output location before deploying again.
Run standalone deployments serially. Exclusive metadata writing prevents a
concurrent invocation from overwriting the winning deployment file, but cannot
undo an extra deployment transaction already submitted by another invocation.

To publish certificate metadata to a local Kubo IPFS node, set `IPFS_API_URL`
if needed and run:

```bash
# metadata/certificate.json (example)
# {"title":"BSc Computer Science","recipient":"0x...","documentSha256":"..."}
pnpm upload:metadata ./metadata/certificate.json
```

The helper validates that the input is JSON, times out after 30 seconds, and
prints a CID plus a gateway URL. Set `IPFS_GATEWAY_URL` to use a gateway you
control. The returned CID is passed to `issueCertificate`.

For a disposable local Kubo smoke test, run the daemon in Docker and stop it
afterwards:

```bash
docker run --rm -d --name certificate-kubo -p 127.0.0.1:5001:5001 \
  ipfs/kubo:v0.30.0 daemon --offline
IPFS_API_URL=http://127.0.0.1:5001 pnpm upload:metadata ./metadata/certificate.json
# Kubo's cat endpoint accepts POST:
curl -X POST "http://127.0.0.1:5001/api/v0/cat?arg=<CID>"
docker stop certificate-kubo
```

`CertificateRegistry` only stores the CID and certificate identity on-chain;
the JSON and any document it references are public to anyone who can access
the IPFS content. Do not put sensitive personal data in metadata unless it is
encrypted before upload. Issuers may issue certificates, the original issuer
or contract owner may revoke them, and an issuer that has been disabled can
still revoke certificates it issued. Ownership transfers use
`transferOwnership` followed by `acceptOwnership` so a mistyped address
cannot permanently lock out the administrator; the current owner can cancel a
pending transfer. Certificate IDs and CIDs are bounded to prevent accidental
oversized writes.

## Integrated local product

The root Docker Compose stack starts a persistent Ganache chain and automatically
deploys this registry. `docker compose up --build` is the normal product startup;
manual `pnpm node` is only needed for standalone contract experiments.

The chain uses ID `31337` and listens on port `8545`. Docker must publish that
port on `127.0.0.1` only. Its public, disposable test accounts are derived from:

```text
test test test test test test test test test test test junk
```

Account 0 is the local school issuer:

```text
Address:     0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Private key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

These are public demo credentials, not secrets. They must never hold real assets
or sign transactions on a public network. Student wallets can connect to this
local chain through the product, while the backend signs issuance and revocation
using the school test account.

`scripts/local-chain.js` stores chain state under `/chain-data`, and writes the
contract address, ABI, chain ID, owner and deployment transaction atomically to
`/deployments/localhost.json`. Docker mounts both paths as named volumes. The
backend reads the deployment volume read-only, so every service uses the same
contract. A restart reuses the contract and existing certificate records. A
changed contract binary fails startup with a migration error instead of silently
orphaning old certificates. The health check only passes after both the chain
and deployed contract respond.

## Private server demonstration

The same persistent chain can run on an interview-demo server, with its RPC
available only inside the Docker network. Do not publish port `8545`, proxy the
raw RPC to the internet, or use this chain for real assets or credentials.

Provision these values through the server's protected environment configuration:

- `LOCAL_CHAIN_MNEMONIC`: a newly generated English BIP-39 mnemonic, retained
  across restarts. Never use either published mnemonic in this repository's tests.
- `LOCAL_CHAIN_REQUIRE_PRIVATE_MNEMONIC=true`: refuses a missing mnemonic or the
  built-in public local-development mnemonic. This guard cannot detect every
  publicly known mnemonic; generate a fresh secret during deployment.
- Backend `CERTIFICATE_PRIVATE_KEY`: account 0 derived from that same mnemonic,
  using path `m/44'/60'/0'/0/0`. The backend signs explicitly in production mode;
  it cannot rely on Ganache's unlocked-account shortcut there.
- Backend `CERTIFICATE_RPC_URL=http://blockchain:8545` and its deployment-file
  mount continue to use the internal network and matching deployment volume.
- Leave backend `CERTIFICATE_PUBLIC_RPC_URL` empty when RPC is private. Visitors
  may connect their wallet to obtain a recipient address, with no network switch
  or browser-signed transaction required.

The bootstrap process never generates, writes, or prints the mnemonic/private
key. Back up the protected environment separately from the chain, deployment,
PostgreSQL and IPFS data. Changing the mnemonic of an existing chain is refused.
Missing registry bytecode, mismatched deployment information or chain data with
a missing deployment file also stop startup instead of silently deploying a new
registry. Restore the matching volumes/configuration if this happens. An initial
bootstrap interrupted before its first deployment metadata is saved requires
operator inspection before resetting that fresh, unused chain data.

For local development without Docker:

```bash
pnpm compile
CHAIN_DATA_DIR=./chain-data DEPLOYMENT_FILE=./deployments/localhost.json \
  CHAIN_READY_FILE=./chain-data/ready.json pnpm node:persistent
```

Keep the blockchain, PostgreSQL and IPFS volumes together: the database links
students to certificate IDs, IPFS retains the metadata and the chain retains
issuance/revocation. `docker compose down` preserves them; deleting volumes
resets the demo. The report/PDF export direction is not included in this product.
