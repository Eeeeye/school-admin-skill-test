const { URL } = require("node:url");

function isLoopbackRpc(rpcUrl = "http://127.0.0.1:8545") {
  let url;
  try {
    url = new URL(rpcUrl);
  } catch {
    throw new Error("LOCAL_RPC_URL must be a valid HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("LOCAL_RPC_URL must be a valid HTTP(S) URL");
  }
  // URL.hostname preserves brackets around IPv6 addresses in Node.js.
  return ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
}

module.exports = { isLoopbackRpc };
