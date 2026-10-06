const test = require("node:test");
const assert = require("node:assert/strict");
const { createCertificateService, validateInput, metadataFor } = require("../src/modules/certificates/certificates-service");
const { createIpfs, boundedText } = require("../src/modules/certificates/certificates-adapters");

const admin = { id: 1, roleId: 1 };
const student = { id: 3, roleId: 3 };
const recipient = "0x0000000000000000000000000000000000000002";
const cid = `bafkre${"a".repeat(54)}`;
const input = { studentId: 3, title: "Course completion", description: "Completed the public course", recipientAddress: recipient };

function setup() {
  const rows = new Map();
  const states = new Map();
  const metadata = new Map();
  const state = { issues: 0, revokes: 0, unavailable: false, ipfsUnavailable: false, receipt: true, confirmation: true };
  const repository = {
    async findStudent(id) { return id === 3 ? { id, name: "Private Student" } : undefined; },
    async insert(data) { const row = { ...data, studentName: "Private Student", metadataCid: null, transactionHash: null,
      revocationTransactionHash: null, status: "pending", createdAt: new Date().toISOString() }; rows.set(row.id, row); return row; },
    async find(id) { return rows.get(id); },
    async findByRequestKey(key) { return [...rows.values()].find((row) => row.requestKey === key); },
    async list(id) { return [...rows.values()].filter((row) => id === undefined || row.studentId === id); },
    async update(id, data) { const row = { ...rows.get(id), ...data }; rows.set(id, row); return row; },
    async withMutationLock(fn) { return fn(repository); },
  };
  const client = {
    chainId: 31337, contractAddress: "0x0000000000000000000000000000000000000004", issuerAddress: recipient,
    chainName: "Local school network", rpcUrl: "http://localhost:8545", demoMode: true,
    async verify(id) { return states.get(id) || { exists: false, valid: false }; },
    async issue(id, address, metadataCid) {
      state.issues++;
      if (state.confirmation) states.set(id, { exists: true, valid: true, recipientAddress: address, metadataCid,
        issuerAddress: recipient, issuedAt: "2026-10-07T00:00:00.000Z", revokedAt: null });
      return `0x${"a".repeat(64)}`;
    },
    async revoke(id) { state.revokes++; if (state.confirmation) states.set(id, { ...states.get(id), valid: false, revokedAt: "2026-10-07T01:00:00.000Z" }); return `0x${"b".repeat(64)}`; },
    async receipt() { return state.receipt ? { success: true } : null; },
  };
  const chain = { async connect() { if (state.unavailable) throw new Error("https://secret@example.com/private"); return client; } };
  const ipfs = {
    async upload(value) { if (state.ipfsUnavailable) throw new Error("IPFS offline"); metadata.set(cid, value); return cid; },
    async read(value) { if (state.ipfsUnavailable) throw new Error("IPFS offline"); return metadata.get(value); },
  };
  const service = createCertificateService({ repository, chain, ipfs, env: { UI_URL: "http://localhost:5173", IPFS_GATEWAY_URL: "http://localhost:5173/ipfs" } });
  return { service, repository, rows, states, metadata, state, client };
}

test("issuance stores a transaction, binds a student, and verifies metadata without publishing identity", async () => {
  const { service, state, metadata } = setup();
  const row = await service.create(admin, input);
  assert.equal(row.status, "issued");
  assert.equal(row.studentId, 3);
  assert.equal(state.issues, 1);
  const verified = await service.verify(row.id);
  assert.equal(verified.valid, true);
  assert.equal(verified.status, "issued");
  assert.equal(verified.studentName, undefined);
  assert.equal(verified.studentId, undefined);
  assert.equal(JSON.stringify(verified).includes("Private Student"), false);
  assert.deepEqual(Object.keys(metadata.get(cid)).sort(), ["certificateId", "description", "recipientAddress", "schema", "title"]);
});

test("input rejects invalid addresses, title size, and nonnumeric student IDs", () => {
  for (const change of [{ recipientAddress: "0x0" }, { recipientAddress: `0x${"0".repeat(40)}` },
    { title: " " }, { title: "x".repeat(121) }, { description: "x".repeat(1001) }, { studentId: "3 OR 1=1" }, { studentId: 1.5 }, { studentId: [3] }]) {
    assert.throws(() => validateInput({ ...input, ...change }), { statusCode: 400 });
  }
});

test("only administrators issue and revoke; students can only list and read their own certificates", async () => {
  const { service } = setup();
  const row = await service.create(admin, input);
  assert.equal((await service.list(student)).length, 1);
  assert.equal((await service.get(student, row.id)).id, row.id);
  await assert.rejects(service.list(student, 99), { statusCode: 403 });
  await assert.rejects(service.get({ id: 4, roleId: 3 }, row.id), { statusCode: 403 });
  await assert.rejects(service.create(student, input), { statusCode: 403 });
  await assert.rejects(service.revoke(student, row.id), { statusCode: 403 });
  await assert.rejects(service.retry(student, row.id), { statusCode: 403 });
  await assert.rejects(service.list({ id: 2, roleId: 2 }), { statusCode: 403 });
});

test("unknown students cannot receive certificates", async () => {
  const { service, state } = setup();
  await assert.rejects(service.create(admin, { ...input, studentId: 999 }), { statusCode: 404 });
  assert.equal(state.issues, 0);
});

test("same idempotency key returns the same certificate and rejects changed input", async () => {
  const { service, state } = setup();
  const first = await service.create(admin, input, "request-123");
  const second = await service.create(admin, input, "request-123");
  assert.equal(first.id, second.id);
  assert.equal(state.issues, 1);
  await assert.rejects(service.create(admin, { ...input, title: "Other course" }, "request-123"), { statusCode: 409 });
});

test("IPFS failure persists a recoverable failed record and retries the same certificate", async () => {
  const { service, state } = setup();
  state.ipfsUnavailable = true;
  const failed = await service.create(admin, input);
  assert.equal(failed.status, "failed");
  assert.equal(state.issues, 0);
  state.ipfsUnavailable = false;
  const result = await service.retry(admin, failed.id);
  assert.equal(result.status, "issued");
  assert.equal(result.id, failed.id);
  assert.equal(state.issues, 1);
});

test("pending transactions are not broadcast a second time during retry", async () => {
  const { service, state, states } = setup();
  state.confirmation = false;
  state.receipt = false;
  const row = await service.create(admin, input);
  assert.equal(row.status, "pending");
  assert.ok(row.transactionHash);
  await service.retry(admin, row.id);
  assert.equal(state.issues, 1);
  states.set(row.id, { exists: true, valid: true, recipientAddress: recipient, metadataCid: cid,
    issuerAddress: recipient, issuedAt: "2026-10-07T00:00:00.000Z", revokedAt: null });
  assert.equal((await service.retry(admin, row.id)).status, "issued");
  assert.equal(state.issues, 1);
});

test("revocation is idempotent and public verification follows on-chain revocation", async () => {
  const { service, state } = setup();
  const row = await service.create(admin, input);
  assert.equal((await service.revoke(admin, row.id)).status, "revoked");
  assert.equal((await service.revoke(admin, row.id)).status, "revoked");
  const verified = await service.verify(row.id);
  assert.equal(verified.valid, false);
  assert.equal(verified.status, "revoked");
  assert.equal(state.revokes, 1);
});

test("pending revocation is recoverable without rebroadcasting", async () => {
  const { service, state, states } = setup();
  const row = await service.create(admin, input);
  state.receipt = false;
  state.confirmation = false;
  const pending = await service.revoke(admin, row.id);
  assert.equal(pending.status, "issued");
  assert.match(pending.error, /awaiting confirmation/);
  await service.revoke(admin, row.id);
  assert.equal(state.revokes, 1);
  states.set(row.id, { ...states.get(row.id), valid: false, revokedAt: "2026-10-07T01:00:00.000Z" });
  assert.equal((await service.revoke(admin, row.id)).status, "revoked");
});

test("chain and IPFS outages produce 503 rather than claiming an invalid certificate", async () => {
  const { service, state } = setup();
  const row = await service.create(admin, input);
  state.unavailable = true;
  await assert.rejects(service.verify(row.id), { statusCode: 503 });
  const config = await service.config();
  assert.equal(config.available, false);
  assert.equal(JSON.stringify(config).includes("secret@example"), false);
  state.unavailable = false;
  state.ipfsUnavailable = true;
  await assert.rejects(service.verify(row.id), { statusCode: 503 });
});

test("tampered metadata invalidates verification even if the chain certificate exists", async () => {
  const { service, metadata } = setup();
  const row = await service.create(admin, input);
  metadata.set(cid, { ...metadataFor(row), recipientAddress: "0x0000000000000000000000000000000000000003" });
  const verified = await service.verify(row.id);
  assert.equal(verified.exists, true);
  assert.equal(verified.valid, false);
  assert.equal(verified.status, "invalid");
});

test("registry changes fail closed and an absent certificate is reported distinctly", async () => {
  const { service, client } = setup();
  const missing = await service.verify(`0x${"f".repeat(64)}`);
  assert.equal(missing.status, "not_found");
  const row = await service.create(admin, input);
  client.chainId = 1337;
  await assert.rejects(service.verify(row.id), { statusCode: 503 });
  const retry = await service.retry(admin, row.id);
  assert.equal(retry.status, "issued");
  assert.match(retry.error, /another registry deployment/);
});

test("a lost or reset chain cannot turn a known issued certificate into a not-found result", async () => {
  const { service, states } = setup();
  const row = await service.create(admin, input);
  states.delete(row.id);
  await assert.rejects(service.verify(row.id), { statusCode: 503 });
});

test("IPFS adapter checks returned CID, parses metadata and rejects excessive response size", async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(String(url).includes("/add") ? JSON.stringify({ Hash: cid }) : JSON.stringify({ schema: "school-certificate/v1" }));
  };
  const ipfs = createIpfs({ IPFS_API_URL: "http://ipfs:5001" }, fakeFetch);
  assert.equal(await ipfs.upload({ title: "Hello" }), cid);
  assert.deepEqual(await ipfs.read(cid), { schema: "school-certificate/v1" });
  assert.equal(calls[0].options.method, "POST");
  assert.match(calls[1].url, /\/api\/v0\/cat\?arg=/);
  await assert.rejects(ipfs.read("../../private"), /Invalid certificate metadata CID/);
  await assert.rejects(boundedText(new Response("x".repeat(33000))), /exceeds/);
  await assert.rejects(createIpfs({}, async () => new Response('{"Hash":"bad"}')).upload({}), /invalid CID/);
});
