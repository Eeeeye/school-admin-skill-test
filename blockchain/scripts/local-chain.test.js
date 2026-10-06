const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Contract, JsonRpcProvider, Wallet, id } = require("ethers");
const { TEST_MNEMONIC } = require("./chain-config");
// Published BIP-39 fixture only, never a real server secret.
const FIXTURE_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

async function startChain(directory, overrides = {}) {
  const env = {
    ...process.env,
    LOCAL_CHAIN_HOST: "127.0.0.1",
    LOCAL_CHAIN_PORT: "0",
    CHAIN_DATA_DIR: path.join(directory, "chain"),
    DEPLOYMENT_FILE: path.join(directory, "deployment.json"),
    CHAIN_READY_FILE: path.join(directory, "ready.json"),
    LOCAL_CHAIN_MNEMONIC: TEST_MNEMONIC,
    LOCAL_CHAIN_REQUIRE_PRIVATE_MNEMONIC: "false",
    ...overrides,
  };
  const child = spawn(process.execPath, [path.join(__dirname, "local-chain.js")], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  async function stop() {
    if (child.exitCode === null) child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
    const code = await closed;
    clearTimeout(timeout);
    return code;
  }

  try {
    const startedAt = Date.now();
    while (!output.includes('"event":"registry-ready"')) {
      if (child.exitCode !== null || Date.now() - startedAt > 20000) {
        throw new Error(`Local chain did not start: ${output}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const deployment = JSON.parse(await fs.readFile(env.DEPLOYMENT_FILE, "utf8"));
    const ready = JSON.parse(await fs.readFile(env.CHAIN_READY_FILE, "utf8"));
    return { stop, deployment, ready, env };
  } catch (error) {
    await stop();
    throw error;
  }
}

test("persistent bootstrap reuses the registry, certificates and issuer grants after restart", { timeout: 40000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "certificate-chain-"));
  let chain;
  let provider;
  try {
    chain = await startChain(directory);
    provider = new JsonRpcProvider(chain.ready.rpcUrl);
    const signer = await provider.getSigner(0);
    const other = await (await provider.getSigner(1)).getAddress();
    const registry = new Contract(chain.deployment.address, chain.deployment.abi, signer);
    const certificateId = id("persistent-certificate");
    await (await registry.issueCertificate(certificateId, other, "bafy-persistent-certificate")).wait();
    await (await registry.setIssuer(other, true)).wait();
    const originalDeployment = chain.deployment;
    provider.destroy();
    provider = null;
    assert.equal(await chain.stop(), 0);
    chain = null;
    await assert.rejects(fs.access(path.join(directory, "ready.json")), { code: "ENOENT" });

    chain = await startChain(directory);
    assert.equal(chain.deployment.address, originalDeployment.address);
    assert.equal(chain.deployment.transactionHash, originalDeployment.transactionHash);
    assert.equal(chain.deployment.chainId, "31337");
    provider = new JsonRpcProvider(chain.ready.rpcUrl);
    const restored = new Contract(chain.deployment.address, chain.deployment.abi, provider);
    const certificate = await restored.verifyCertificate(certificateId);
    assert.equal(certificate.valid, true);
    assert.equal(certificate.metadataCid, "bafy-persistent-certificate");
    assert.equal(await restored.issuers(other), true);

    const healthcheck = spawn(process.execPath, [path.join(__dirname, "chain-healthcheck.js")], { env: chain.env });
    assert.equal(await new Promise((resolve) => healthcheck.once("close", resolve)), 0);
  } finally {
    provider?.destroy();
    if (chain) await chain.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("server mnemonic persists its issuer and supports explicit private-key signing after restart", { timeout: 40000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "certificate-chain-"));
  const env = { LOCAL_CHAIN_MNEMONIC: FIXTURE_MNEMONIC, LOCAL_CHAIN_REQUIRE_PRIVATE_MNEMONIC: "true" };
  let chain;
  let provider;
  try {
    chain = await startChain(directory, env);
    provider = new JsonRpcProvider(chain.ready.rpcUrl);
    const signer = Wallet.fromPhrase(FIXTURE_MNEMONIC).connect(provider);
    const registry = new Contract(chain.deployment.address, chain.deployment.abi, signer);
    assert.equal(chain.deployment.deployer, signer.address);
    const certificateId = id("server-demo-explicit-key");
    await (await registry.issueCertificate(certificateId, signer.address, "bafy-private-chain-fixture")).wait();
    const deployment = chain.deployment;
    provider.destroy();
    provider = null;
    assert.equal(await chain.stop(), 0);
    chain = null;
    chain = await startChain(directory, env);
    assert.equal(chain.deployment.address, deployment.address);
    assert.equal(chain.deployment.transactionHash, deployment.transactionHash);
    provider = new JsonRpcProvider(chain.ready.rpcUrl);
    const restored = new Contract(deployment.address, deployment.abi, provider);
    assert.equal((await restored.verifyCertificate(certificateId)).valid, true);
  } finally {
    provider?.destroy();
    if (chain) await chain.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("changing the mnemonic refuses startup without rewriting deployment identity", { timeout: 40000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "certificate-chain-"));
  let chain;
  try {
    chain = await startChain(directory);
    const deployment = chain.deployment;
    const file = chain.env.DEPLOYMENT_FILE;
    await chain.stop();
    chain = null;
    await assert.rejects(startChain(directory, { LOCAL_CHAIN_MNEMONIC: FIXTURE_MNEMONIC }), /does not match the existing chain deployer/);
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), deployment);
  } finally {
    if (chain) await chain.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("missing chain history or deployment metadata never silently creates a new registry", { timeout: 40000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "certificate-chain-"));
  let chain;
  try {
    chain = await startChain(directory);
    const deployment = chain.deployment;
    const file = chain.env.DEPLOYMENT_FILE;
    await chain.stop();
    chain = null;
    await fs.rename(file, `${file}.backup`);
    await assert.rejects(startChain(directory), /deployment metadata is missing/);
    await fs.rename(`${file}.backup`, file);
    await fs.rename(path.join(directory, "chain"), path.join(directory, "chain-backup"));
    await assert.rejects(startChain(directory), /registry is missing from chain state/);
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), deployment);
  } finally {
    if (chain) await chain.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("bootstrap rejects mismatched deployment metadata without overwriting it", { timeout: 40000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "certificate-chain-"));
  let chain;
  try {
    chain = await startChain(directory);
    const deploymentFile = chain.env.DEPLOYMENT_FILE;
    const mismatched = { ...chain.deployment, chainId: "1" };
    assert.equal(await chain.stop(), 0);
    chain = null;
    await fs.writeFile(deploymentFile, JSON.stringify(mismatched));
    await assert.rejects(startChain(directory), /different chain ID/);
    assert.deepEqual(JSON.parse(await fs.readFile(deploymentFile, "utf8")), mismatched);
  } finally {
    if (chain) await chain.stop();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
