const assert = require("node:assert/strict");
const { test } = require("node:test");
const { isLoopbackRpc } = require("./deploy-policy");

test("accepts IPv4, hostname and IPv6 loopback RPC URLs", () => {
  for (const url of [undefined, "http://127.0.0.1:8545", "http://localhost:8545", "http://[::1]:8545"]) {
    assert.equal(isLoopbackRpc(url), true);
  }
});

test("rejects non-loopback hosts and invalid RPC protocols", () => {
  assert.equal(isLoopbackRpc("https://example.com"), false);
  assert.equal(isLoopbackRpc("http://localhost.example.com:8545"), false);
  assert.equal(isLoopbackRpc("http://[2001:db8::1]:8545"), false);
  assert.throws(() => isLoopbackRpc("not-a-url"), /valid HTTP\(S\) URL/);
  assert.throws(() => isLoopbackRpc("file:///tmp/socket"), /valid HTTP\(S\) URL/);
});
