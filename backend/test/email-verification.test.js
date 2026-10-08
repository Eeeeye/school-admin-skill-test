const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { ApiError } = require("../src/utils/api-error");

function loadWithMocks(relativePath, mocks) {
  const filename = require.resolve(relativePath);
  const original = Module._load;
  delete require.cache[filename];
  Module._load = function (request, parent, isMain) {
    if (parent?.filename === filename && Object.hasOwn(mocks, request)) return mocks[request];
    return original.call(this, request, parent, isMain);
  };
  try { return require(filename); } finally { Module._load = original; }
}

test("verification emails bind their signed links to the destination address and purpose", async () => {
  let tokenPayload, mail;
  const { sendAccountVerificationEmail } = loadWithMocks("../src/utils/send-account-verification-email", {
    "../config": { env: { API_URL: "https://school.example.test" } },
    "./jwt-handle": { generateToken(payload) { tokenPayload = payload; return "signed-token"; } },
    "./send-email": { sendMail: async (value) => { mail = value; } },
    "../templates": { emailVerificationTemplate: (url) => url },
  });
  await sendAccountVerificationEmail({ userId: 7, userEmail: "student@example.test" });
  assert.deepEqual(tokenPayload, { id: 7, email: mail.to, purpose: "verify-email" });
  assert.equal(mail.html, "https://school.example.test/api/v1/auth/verify-email/signed-token");
});

test("verification middleware rejects old unbound links and tokens for other purposes", () => {
  const valid = { id: 7, email: "student@example.test", purpose: "verify-email" };
  let decoded;
  const { handleEmailVerificationToken } = loadWithMocks("../src/middlewares/handle-email-verification-token", {
    "../config": { env: {} }, "../utils": { ApiError, verifyToken: () => decoded },
  });
  for (decoded of [null, { id: 7 }, { ...valid, id: "7" }, { ...valid, email: "" }, { ...valid, purpose: "setup" }]) {
    assert.throws(() => handleEmailVerificationToken({ params: { token: "signed" } }, {}, () => {}), { statusCode: 400 });
  }
  decoded = valid;
  let called = false;
  const req = { params: { token: "signed" } };
  handleEmailVerificationToken(req, {}, () => { called = true; });
  assert.equal(called, true);
  assert.deepEqual(req.user, valid);
});

test("email verification consumes the matching address atomically and sends no setup email for stale links", async () => {
  const state = { id: 7, email: "new@example.test", is_email_verified: false };
  const sent = [];
  const statements = [];
  const repository = loadWithMocks("../src/modules/auth/auth-repository", {
    "../../config": { db: {} },
    "../../utils": { processDBRequest: async ({ query, queryParams }) => {
      statements.push(query);
      // The real PostgreSQL behavior is also exercised by audit.integration.js.
      assert.match(query, /WHERE id = \$1 AND email = \$2 AND is_email_verified = false/);
      const [id, email] = queryParams;
      if (id !== state.id || email !== state.email || state.is_email_verified) return { rows: [] };
      state.is_email_verified = true;
      return { rows: [{ ...state }] };
    } },
  });
  const { processAccountEmailVerify } = loadWithMocks("../src/modules/auth/auth-service", {
    "../../utils": { ApiError, sendPasswordSetupEmail: async (payload) => sent.push(payload) },
    "./auth-repository": repository,
    "../../config": { env: {}, db: {} }, "../../shared/repository": {},
  });
  await assert.rejects(processAccountEmailVerify(7, "old@example.test"), { statusCode: 400 });
  assert.equal(state.is_email_verified, false);
  assert.equal(sent.length, 0);
  const outcomes = await Promise.allSettled([
    processAccountEmailVerify(7, state.email), processAccountEmailVerify(7, state.email),
  ]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.find((result) => result.status === "rejected").reason.statusCode, 400);
  assert.deepEqual(sent, [{ userId: 7, userEmail: state.email }]);
  assert.equal(statements.length, 3);
});
