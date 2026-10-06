const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { uploadMetadata } = require("./upload-metadata");

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function startResponseServer(status, body) {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(body);
    });
  });
  const port = await listen(server);
  return { server, apiUrl: `http://127.0.0.1:${port}` };
}

async function writeMetadata(contents, filename = "certificate.json") {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "certificate-metadata-"));
  const filePath = path.join(tempDir, filename);
  await writeFile(filePath, contents);
  return { tempDir, filePath };
}

test("uploads JSON metadata and returns a configurable gateway URL", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "certificate-metadata-"));
  const filePath = path.join(tempDir, "certificate.json");
  await writeFile(filePath, JSON.stringify({ title: "Degree" }));

  let requestBody = "";
  const server = createServer((request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/api/v0/add?pin=true");
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      requestBody += chunk;
    });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"Name":"certificate.json","Hash":"bafy-test-cid"}\n');
    });
  });

  try {
    const port = await listen(server);
    const result = await uploadMetadata(filePath, {
      apiUrl: `http://127.0.0.1:${port}`,
      gatewayUrl: "https://gateway.example/ipfs/",
    });

    assert.match(requestBody, /certificate\.json/);
    assert.deepEqual(result, {
      cid: "bafy-test-cid",
      gatewayUrl: "https://gateway.example/ipfs/bafy-test-cid",
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("rejects a metadata file that is not JSON", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "certificate-metadata-"));
  const filePath = path.join(tempDir, "invalid.json");
  await writeFile(filePath, "not-json");

  try {
    await assert.rejects(uploadMetadata(filePath), /valid JSON/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("rejects valid JSON that is not a metadata object", async () => {
  const { tempDir, filePath } = await writeMetadata("[]", "array.json");

  try {
    await assert.rejects(uploadMetadata(filePath), /valid JSON object/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("rejects an HTTP error from the IPFS API", async () => {
  const { tempDir, filePath } = await writeMetadata('{"title":"Degree"}');
  const { server, apiUrl } = await startResponseServer(503, '{"Message":"unavailable"}');

  try {
    await assert.rejects(
      uploadMetadata(filePath, { apiUrl }),
      /IPFS upload failed with HTTP 503/
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("rejects a successful IPFS response without a CID", async () => {
  const { tempDir, filePath } = await writeMetadata('{"title":"Degree"}');
  const { server, apiUrl } = await startResponseServer(200, '{"Name":"certificate.json"}\n');

  try {
    await assert.rejects(
      uploadMetadata(filePath, { apiUrl }),
      /IPFS upload response did not include a CID/
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("rejects a successful IPFS response with invalid JSON", async () => {
  const { tempDir, filePath } = await writeMetadata('{"title":"Degree"}');
  const { server, apiUrl } = await startResponseServer(200, "not-json\n");

  try {
    await assert.rejects(
      uploadMetadata(filePath, { apiUrl }),
      /IPFS upload returned invalid JSON/
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  }
});
