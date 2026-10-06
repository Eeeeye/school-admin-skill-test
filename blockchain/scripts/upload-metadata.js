const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const DEFAULT_API_URL = "http://127.0.0.1:5001";
const DEFAULT_GATEWAY_URL = "https://ipfs.io/ipfs";
const REQUEST_TIMEOUT_MS = 30_000;

async function uploadMetadata(inputPath, options = {}) {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new Error("Metadata file path is required");
  }

  const apiUrl = options.apiUrl || process.env.IPFS_API_URL || DEFAULT_API_URL;
  const gatewayUrl = options.gatewayUrl || process.env.IPFS_GATEWAY_URL || DEFAULT_GATEWAY_URL;
  if (typeof apiUrl !== "string" || typeof gatewayUrl !== "string") {
    throw new Error("IPFS API and gateway URLs must be strings");
  }
  for (const value of [apiUrl, gatewayUrl]) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error("IPFS API and gateway URLs must be valid HTTP(S) URLs");
    }
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("IPFS API and gateway URLs must be valid HTTP(S) URLs");
    }
  }
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("IPFS timeout must be a positive integer in milliseconds");
  }
  const normalizedGatewayUrl = gatewayUrl.replace(/\/$/, "");
  const filePath = path.resolve(inputPath);
  const file = await fs.readFile(filePath);

  // Fail before making a network request when the input is not JSON. The
  // certificate metadata format is intentionally application-defined, but it
  // must be a JSON document for consumers to verify it consistently.
  try {
    const metadata = JSON.parse(file.toString("utf8"));
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      throw new Error("Metadata must be a JSON object");
    }
  } catch {
    throw new Error("Metadata file must contain a valid JSON object");
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([file], { type: "application/json" }),
    path.basename(filePath)
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let responseText;
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/v0/add?pin=true`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`IPFS upload failed with HTTP ${response.status}`);
    }
    // Keep the deadline active until the response body is fully consumed.
    responseText = await response.text();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`IPFS upload timed out after ${timeoutMs / 1000}s`);
    }
    if (error.message.startsWith("IPFS upload failed with HTTP")) throw error;
    throw new Error(`IPFS upload request failed: ${error.message}`);
  } finally {
    clearTimeout(timeout);
  }

  // Kubo returns newline-delimited JSON for some API configurations. The last
  // record is the file added by this command.
  let records;
  try {
    records = responseText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    throw new Error("IPFS upload returned invalid JSON");
  }
  const result = records.at(-1);
  if (typeof result?.Hash !== "string" || !result.Hash.trim()) {
    throw new Error("IPFS upload response did not include a CID");
  }

  return {
    cid: result.Hash,
    gatewayUrl: `${normalizedGatewayUrl}/${result.Hash}`,
  };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Usage: pnpm upload:metadata ./metadata/certificate.json");
  }

  console.log(JSON.stringify(await uploadMetadata(inputPath), null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { uploadMetadata };
