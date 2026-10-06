const fs = require("node:fs");
const path = require("node:path");
const { ethers, network } = require("hardhat");
const { isLoopbackRpc } = require("./deploy-policy");

async function main() {
  const remoteDeployAllowed = process.env.ALLOW_REMOTE_DEPLOY === "true";
  if (
    (!["hardhat", "localhost"].includes(network.name) ||
      (network.name === "localhost" && !isLoopbackRpc(process.env.LOCAL_RPC_URL))) &&
    !remoteDeployAllowed
  ) {
    throw new Error(
      `Refusing deployment to '${network.name}'. Set ALLOW_REMOTE_DEPLOY=true only after reviewing the network and signer.`
    );
  }

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

  const outputDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, `${network.name}.json`),
    `${JSON.stringify(deployment, null, 2)}\n`
  );
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
