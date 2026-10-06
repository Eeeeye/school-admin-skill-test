const fs = require("node:fs/promises");
const { Contract, FetchRequest, JsonRpcProvider, Wallet, getAddress, ZeroAddress } = require("ethers");
const { ApiError } = require("../../utils/api-error");

const ABI = [
  "function issuers(address) view returns (bool)",
  "function issueCertificate(bytes32,address,string)",
  "function revokeCertificate(bytes32)",
  "function verifyCertificate(bytes32) view returns (bool exists,bool valid,address issuer,address recipient,string metadataCid,uint64 issuedAt,uint64 revokedAt)",
];
const CID_PATTERN = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})$/;
const MAX_RESPONSE_BYTES = 32768;
const providers = new Map();

async function boundedText(response, maxBytes = MAX_RESPONSE_BYTES) {
  if (!response.body) throw new Error("Empty IPFS response");
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("IPFS response exceeds the allowed size");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}

function ipfsEndpoint(action, env) {
  const base = new URL(env.IPFS_API_URL || "http://127.0.0.1:5001");
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("Invalid IPFS API configuration");
  base.pathname = `${base.pathname.replace(/\/$/, "")}/api/v0/${action}`;
  return base;
}

function createIpfs(env = process.env, fetcher = fetch) {
  return {
    async upload(metadata) {
      const body = JSON.stringify(metadata);
      if (Buffer.byteLength(body) > 8192) throw new Error("Certificate metadata is too large");
      const form = new FormData();
      form.append("file", new Blob([body], { type: "application/json" }), "certificate.json");
      const url = ipfsEndpoint("add", env);
      url.searchParams.set("pin", "true");
      url.searchParams.set("cid-version", "1");
      const response = await fetcher(url, { method: "POST", body: form, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("IPFS upload failed");
      const text = await boundedText(response);
      const records = text.trim().split("\n").map((line) => JSON.parse(line));
      const cid = records.at(-1)?.Hash;
      if (typeof cid !== "string" || !CID_PATTERN.test(cid)) throw new Error("IPFS returned an invalid CID");
      return cid;
    },
    async read(cid) {
      if (!CID_PATTERN.test(cid)) throw new Error("Invalid certificate metadata CID");
      const url = ipfsEndpoint("cat", env);
      url.searchParams.set("arg", cid);
      const response = await fetcher(url, { method: "POST", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("Certificate metadata is unavailable from IPFS");
      const metadata = JSON.parse(await boundedText(response));
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Invalid certificate metadata");
      return metadata;
    },
  };
}

function createChain(env = process.env) {
  return {
    async connect(withSigner = true, requireIssuer = true) {
      const file = env.CERTIFICATE_DEPLOYMENT_FILE;
      if (!file) throw new ApiError(503, "Certificate deployment is not configured.");
      const deploymentText = await fs.readFile(file, "utf8");
      if (deploymentText.length > 128000) throw new Error("Invalid certificate deployment file");
      const deployment = JSON.parse(deploymentText);
      const contractAddress = getAddress(deployment.address);
      if (contractAddress === ZeroAddress) throw new Error("Invalid certificate registry address");
      const rpcUrl = env.CERTIFICATE_RPC_URL || "http://127.0.0.1:8545";
      const rpc = new URL(rpcUrl);
      if (!["http:", "https:"].includes(rpc.protocol)) throw new Error("Invalid certificate RPC configuration");
      let provider = providers.get(rpcUrl);
      if (!provider) {
        const request = new FetchRequest(rpcUrl);
        request.timeout = 10000;
        // The DB lock serializes transactions; disabling the provider's short
        // RPC cache also prevents a freshly constructed wallet reusing a nonce.
        provider = new JsonRpcProvider(request, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
        provider.pollingInterval = 1000;
        providers.set(rpcUrl, provider);
      }
      const chainId = Number((await provider.getNetwork()).chainId);
      if (!Number.isSafeInteger(chainId) || chainId !== Number(deployment.chainId)) {
        throw new Error("Certificate network differs from the configured deployment");
      }
      if (await provider.getCode(contractAddress) === "0x") throw new Error("Certificate registry is not deployed on this network");
      const demoMode = env.CERTIFICATE_DEMO_MODE === "true";
      let signer;
      let issuerAddress = null;
      if (withSigner) {
        if (env.CERTIFICATE_PRIVATE_KEY) {
          signer = new Wallet(env.CERTIFICATE_PRIVATE_KEY, provider);
        } else if (demoMode && env.NODE_ENV !== "production" && chainId === 31337
            && ["localhost", "127.0.0.1", "[::1]", "blockchain"].includes(rpc.hostname)) {
          signer = await provider.getSigner(0);
        } else {
          throw new Error("Certificate issuer signer is not configured");
        }
        issuerAddress = await signer.getAddress();
      }
      const contract = new Contract(contractAddress, ABI, signer || provider);
      if (withSigner && requireIssuer && !await contract.issuers(issuerAddress)) throw new Error("Configured school wallet is not an authorized issuer");
      return {
        chainId, contractAddress, issuerAddress, demoMode,
        chainName: chainId === 31337 ? "School demo network" : `EVM network ${chainId}`,
        rpcUrl: env.CERTIFICATE_PUBLIC_RPC_URL || (env.NODE_ENV === "production" ? null : "http://localhost:8545"),
        async verify(id) {
          const result = await contract.verifyCertificate(id);
          return {
            exists: result.exists, valid: result.valid, issuerAddress: result.issuer,
            recipientAddress: result.recipient, metadataCid: result.metadataCid,
            issuedAt: Number(result.issuedAt) ? new Date(Number(result.issuedAt) * 1000).toISOString() : null,
            revokedAt: Number(result.revokedAt) ? new Date(Number(result.revokedAt) * 1000).toISOString() : null,
          };
        },
        async issue(id, recipient, cid) {
          const transaction = await contract.issueCertificate(id, recipient, cid);
          return transaction.hash;
        },
        async revoke(id) {
          return (await contract.revokeCertificate(id)).hash;
        },
        async receipt(hash, wait = false) {
          const receipt = wait ? await provider.waitForTransaction(hash, 1, 45000) : await provider.getTransactionReceipt(hash);
          return receipt ? { success: receipt.status === 1 } : null;
        },
      };
    },
  };
}

module.exports = { createChain, createIpfs, boundedText, CID_PATTERN };
