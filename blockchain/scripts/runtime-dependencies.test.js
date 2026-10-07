const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const { getBytes, id, SigningKey, Wallet } = require('ethers');
const { harden } = require('./harden-ganache.cjs');
const { TEST_MNEMONIC } = require('./chain-config');

test('Ganache resolves the locked patched crypto packages rather than its old bundled copies', () => {
  assert.deepEqual(harden({ checkOnly: true }), {
    ganache: '7.9.2', secp256k1: '4.0.5', elliptic: '6.6.1', 'bn.js': '4.12.3',
  });
});

test('both native-or-fallback and explicit JS secp signing preserve deterministic Ethereum signatures', () => {
  const ganacheRequire = createRequire(require.resolve('ganache/package.json'));
  const secpPath = path.dirname(ganacheRequire.resolve('secp256k1/package.json'));
  const privateKey = getBytes(Wallet.fromPhrase(TEST_MNEMONIC).privateKey);
  const digest = getBytes(id('patched-ganache-runtime-fixture'));
  const expected = new SigningKey(privateKey).sign(digest);
  const expectedBytes = Buffer.concat([Buffer.from(getBytes(expected.r)), Buffer.from(getBytes(expected.s))]);
  for (const secp of [ganacheRequire('secp256k1'), require(path.join(secpPath, 'elliptic.js'))]) {
    const result = secp.ecdsaSign(digest, privateKey);
    assert.deepEqual(Buffer.from(result.signature), expectedBytes);
    assert.equal(result.recid, expected.yParity);
    assert.equal(secp.ecdsaVerify(result.signature, digest, secp.publicKeyCreate(privateKey)), true);
  }
});
