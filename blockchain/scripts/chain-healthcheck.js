const fs = require("node:fs/promises");

async function main() {
  const ready = JSON.parse(await fs.readFile(process.env.CHAIN_READY_FILE || "/tmp/registry-ready.json", "utf8"));
  const response = await fetch(ready.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      { jsonrpc: "2.0", id: 2, method: "eth_getCode", params: [ready.address, "latest"] },
    ]),
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const results = await response.json();
  const chainId = results.find((result) => result.id === 1)?.result;
  const code = results.find((result) => result.id === 2)?.result;
  if (Number(chainId) !== ready.chainId || !code || code === "0x") {
    throw new Error("Certificate registry is not ready");
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
