# Certificate registry

This package contains the on-chain part of the certificate-verification direction.
`CertificateRegistry` records a certificate ID, issuer, recipient, issue time,
revocation time and an IPFS metadata CID. The document itself stays off-chain.

## Local verification

This package expects Node.js 20 or newer because the metadata helper uses the
built-in `fetch`, `FormData`, and `Blob` APIs.

```bash
pnpm install
pnpm compile
pnpm test
```

The test command covers certificate state transitions and the IPFS upload helper
with a local fake Kubo endpoint. It also starts disposable Ganache processes to
verify persistence and bootstrap metadata validation. No pre-existing chain or
IPFS daemon is required. The Solidity compiler is pinned to `solc@0.8.24` in the
lockfile, so compilation requires no separate compiler download.

Start a local chain in one terminal and deploy in another:

```bash
pnpm node
pnpm deploy:local
```

The deployment script refuses networks other than Hardhat and localhost by
default. A remote deployment requires an explicit `ALLOW_REMOTE_DEPLOY=true`
and a signer configured by the selected Hardhat network.

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
