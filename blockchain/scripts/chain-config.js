const { Mnemonic } = require("ethers");

const TEST_MNEMONIC = "test test test test test test test test test test test junk";

function chainMnemonic(env = process.env) {
  const configured = env.LOCAL_CHAIN_MNEMONIC?.trim().replace(/\s+/g, " ");
  if (env.LOCAL_CHAIN_REQUIRE_PRIVATE_MNEMONIC === "true"
      && (!configured || configured === TEST_MNEMONIC)) {
    throw new Error("This deployment requires a private LOCAL_CHAIN_MNEMONIC; the public test mnemonic is disabled");
  }
  const mnemonic = configured || TEST_MNEMONIC;
  if (mnemonic.length > 512 || !Mnemonic.isValidMnemonic(mnemonic)) {
    throw new Error("LOCAL_CHAIN_MNEMONIC must be a valid English BIP-39 mnemonic");
  }
  return mnemonic;
}

module.exports = { chainMnemonic, TEST_MNEMONIC };
