import assert from 'node:assert/strict';
import { test } from 'node:test';
import { walletRpcUrl } from './wallet-network.ts';

test('recipient-only configuration never offers a network endpoint', () => {
  assert.equal(walletRpcUrl('', 'https://school.example'), undefined);
  assert.equal(walletRpcUrl(undefined, 'https://school.example'), undefined);
});

test('remote visitors never connect to a local RPC or mixed-content endpoint', () => {
  for (const rpc of [
    'http://localhost:8545',
    'https://localhost:8545',
    'http://127.0.0.1:8545',
    'https://127.0.0.2:8545',
    'http://[::1]:8545',
    'http://node.example:8545',
    'https://secret:password@node.example',
    'ws://node.example'
  ]) {
    assert.equal(walletRpcUrl(rpc, 'https://school.example'), undefined);
  }
});

test('local development and explicitly configured HTTPS public RPC remain available', () => {
  assert.equal(
    walletRpcUrl('http://localhost:8545', 'http://localhost:5173'),
    'http://localhost:8545/'
  );
  assert.equal(
    walletRpcUrl('https://rpc.example/chain', 'https://school.example'),
    'https://rpc.example/chain'
  );
});
