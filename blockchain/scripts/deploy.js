const fs = require("node:fs");
const path = require("node:path");
const { isLoopbackRpc } = require("./deploy-policy");

async function main(hre = require("hardhat"), options = {}) {
  const { ethers, network } = hre;
  const env = options.env || process.env;
  const remoteDeployAllowed = env.ALLOW_REMOTE_DEPLOY === "true";
  if (
    (!["hardhat", "localhost"].includes(network.name) ||
      (network.name === "localhost" && !isLoopbackRpc(env.LOCAL_RPC_URL))) &&
    !remoteDeployAllowed
  ) {
    throw new Error(
      `Refusing deployment to '${network.name}'. Set ALLOW_REMOTE_DEPLOY=true only after reviewing the network and signer.`
    );
  }

  const outputDir = options.outputDir || path.join(__dirname, "..", "deployments");
  const outputFile = path.join(outputDir, `${network.name}.json`);
  if (fs.existsSync(outputFile)) {
    throw new Error("Deployment metadata already exists; refusing to replace the registry. Preserve the existing file and chain state before an intentional new deployment.");
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer account is configured for this network");
  }
  const Factory = await ethers.getContractFactory("CertificateRegistry");
  const registry = await Factory.deploy();
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  const deploymentTransaction = registry.deploymentTransaction();
  const deployment = {
    network: network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    address,
    owner: await registry.owner(),
    deployer: deployer.address,
    transactionHash: deploymentTransaction?.hash || null,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    outputFile,
    `${JSON.stringify(deployment, null, 2)}\n`,
    { flag: "wx" }
  );
  console.log(JSON.stringify(deployment, null, 2));
  return deployment;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main };
