const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { main } = require("./deploy");

test("standalone deployment refuses existing registry metadata before accessing any signer", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "registry-deploy-"));
  const file = path.join(directory, "localhost.json");
  const existing = '{"address":"existing-registry","chainId":"31337"}\n';
  let signerRequests = 0;
  const hre = {
    network: { name: "localhost" },
    ethers: { async getSigners() { signerRequests++; throw new Error("Must not access the chain"); } },
  };
  try {
    await fs.writeFile(file, existing);
    await assert.rejects(main(hre, { env: {}, outputDir: directory }), /refusing to replace the registry/);
    assert.equal(signerRequests, 0);
    assert.equal(await fs.readFile(file, "utf8"), existing);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("an existing metadata file is never overwritten after a concurrent deployment wins", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "registry-deploy-"));
  const file = path.join(directory, "localhost.json");
  const competing = '{"address":"first-completed-registry"}\n';
  const registry = {
    async waitForDeployment() { await fs.writeFile(file, competing); },
    async getAddress() { return "second-registry"; },
    deploymentTransaction() { return { hash: "fixture-transaction" }; },
    async owner() { return "fixture-owner"; },
  };
  const hre = {
    network: { name: "localhost" },
    ethers: {
      async getSigners() { return [{ address: "fixture-deployer" }]; },
      async getContractFactory() { return { async deploy() { return registry; } }; },
      provider: { async getNetwork() { return { chainId: 31337n }; } },
    },
  };
  try {
    await assert.rejects(main(hre, { env: {}, outputDir: directory }), { code: "EEXIST" });
    assert.equal(await fs.readFile(file, "utf8"), competing);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
