const fs = require("node:fs/promises");
const path = require("node:path");
const ganache = require("ganache");
const { Contract, ContractFactory, JsonRpcProvider } = require("ethers");
const { chainMnemonic } = require("./chain-config");

// This is a private demonstration chain, never a source of real credentials or
// assets. Keep its unlocked JSON-RPC inside the Docker network or on loopback.
const CHAIN_ID = 31337;

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
  await fs.rename(temporaryFile, file);
}

async function readDeployment(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Cannot read deployment ${file}: ${error.message}`);
  }
}

async function main() {
  const mnemonic = chainMnemonic();
  const port = Number(process.env.LOCAL_CHAIN_PORT || 8545);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("LOCAL_CHAIN_PORT must be an integer from 0 to 65535");
  }
  const dataPath = path.resolve(process.env.CHAIN_DATA_DIR || "chain-data");
  const deploymentFile = path.resolve(process.env.DEPLOYMENT_FILE || "deployments/localhost.json");
  const readyFile = path.resolve(process.env.CHAIN_READY_FILE || "/tmp/registry-ready.json");
  const artifact = require("../artifacts/contracts/CertificateRegistry.sol/CertificateRegistry.json");
  await fs.mkdir(dataPath, { recursive: true });
  await fs.rm(readyFile, { force: true });
  const previous = await readDeployment(deploymentFile);
  if (!previous && (await fs.readdir(dataPath)).length > 0) {
    throw new Error("Chain data exists but registry deployment metadata is missing; restore the matching deployment file before starting");
  }

  const server = ganache.server({
    chain: { chainId: CHAIN_ID, networkId: CHAIN_ID, hardfork: "shanghai" },
    database: { dbPath: dataPath },
    wallet: { mnemonic, totalAccounts: 10, defaultBalance: 1000 },
    miner: { blockTime: 0 },
    logging: { quiet: true },
  });
  let provider;
  let closing = false;
  async function shutdown(exitCode = 0) {
    if (closing) return;
    closing = true;
    await fs.rm(readyFile, { force: true });
    if (provider) provider.destroy();
    await server.close();
    process.exitCode = exitCode;
  }
  process.once("SIGTERM", () => shutdown().catch(fail));
  process.once("SIGINT", () => shutdown().catch(fail));

  try {
    await server.listen(port, process.env.LOCAL_CHAIN_HOST || "127.0.0.1");
    const actualPort = server.address().port;
    const rpcUrl = `http://127.0.0.1:${actualPort}`;
    provider = new JsonRpcProvider(rpcUrl, CHAIN_ID, { staticNetwork: true });
    const signer = await provider.getSigner(0);
    const deployer = await signer.getAddress();
    let deployment = previous;

    if (previous) {
      if (String(previous.chainId) !== String(CHAIN_ID)) {
        throw new Error("Existing registry has a different chain ID; preserve the volumes and review the deployment");
      }
      if (previous.deployer?.toLowerCase() !== deployer.toLowerCase()) {
        throw new Error("Configured mnemonic does not match the existing chain deployer; restore the original configuration");
      }
      const previousCode = previous.address ? await provider.getCode(previous.address) : "0x";
      if (previousCode === "0x") {
        throw new Error("Existing registry is missing from chain state; restore matching chain and deployment volumes instead of redeploying");
      }
      if (previousCode.toLowerCase() !== artifact.deployedBytecode.toLowerCase()) {
        throw new Error("Existing registry bytecode differs from this build; an explicit migration is required");
      }
    } else {
      const registry = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy();
      await registry.waitForDeployment();
      const receipt = await registry.deploymentTransaction().wait();
      deployment = {
        network: "localhost",
        chainId: String(CHAIN_ID),
        address: await registry.getAddress(),
        deployer,
        transactionHash: receipt.hash,
        deployedAt: new Date().toISOString(),
        deploymentBlock: receipt.blockNumber,
      };
    }

    const registry = new Contract(deployment.address, artifact.abi, provider);
    deployment = {
      ...deployment,
      owner: await registry.owner(),
      issuer: deployer,
      abi: artifact.abi,
      rpcUrl: process.env.LOCAL_CHAIN_PUBLIC_RPC_URL || rpcUrl,
      localOnly: true,
    };
    await writeJsonAtomic(deploymentFile, deployment);
    await writeJsonAtomic(readyFile, { chainId: CHAIN_ID, address: deployment.address, rpcUrl });
    console.log(JSON.stringify({ event: "registry-ready", address: deployment.address, chainId: CHAIN_ID, rpcUrl }));
  } catch (error) {
    await shutdown(1);
    throw error;
  }
}

function fail(error) {
  console.error(error.message);
  process.exitCode = 1;
}

main().catch(fail);
