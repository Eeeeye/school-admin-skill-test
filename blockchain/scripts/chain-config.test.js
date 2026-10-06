const assert = require("node:assert/strict");
const test = require("node:test");
const { chainMnemonic, TEST_MNEMONIC } = require("./chain-config");

// Published BIP-39 test vector. Never a deployment secret.
const FIXTURE_MNEMONIC = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

test("local mode keeps the documented disposable accounts", () => {
  assert.equal(chainMnemonic({}), TEST_MNEMONIC);
});

test("server mode requires an explicitly provisioned mnemonic", () => {
  assert.throws(() => chainMnemonic({ LOCAL_CHAIN_REQUIRE_PRIVATE_MNEMONIC: "true" }), /private LOCAL_CHAIN_MNEMONIC/);
  assert.throws(() => chainMnemonic({
    LOCAL_CHAIN_REQUIRE_PRIVATE_MNEMONIC: "true", LOCAL_CHAIN_MNEMONIC: TEST_MNEMONIC,
  }), /public test mnemonic is disabled/);
  assert.equal(chainMnemonic({
    LOCAL_CHAIN_REQUIRE_PRIVATE_MNEMONIC: "true", LOCAL_CHAIN_MNEMONIC: `  ${FIXTURE_MNEMONIC}  `,
  }), FIXTURE_MNEMONIC);
});

test("invalid mnemonics are rejected without echoing their contents", () => {
  assert.throws(() => chainMnemonic({ LOCAL_CHAIN_MNEMONIC: "do-not-echo-this-input" }), (error) => {
    assert.match(error.message, /valid English BIP-39/);
    assert.ok(!error.message.includes("do-not-echo"));
    return true;
  });
});
