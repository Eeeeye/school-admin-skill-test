const { isIP, BlockList } = require("node:net");

function trustedProxyAddresses(value) {
  if (value === undefined || value === "") return false;
  if (typeof value !== "string") throw new Error("TRUSTED_PROXY_CIDRS must list explicit internal proxy IP addresses or CIDRs");
  const ranges = value.split(",").map((item) => item.trim());
  if (ranges.length > 16 || ranges.some((item) => !item)) throw new Error("Invalid TRUSTED_PROXY_CIDRS list");
  for (const range of ranges) {
    const parts = range.split("/");
    const family = isIP(parts[0]);
    const prefix = parts.length === 1 ? (family === 4 ? 32 : 128) : Number(parts[1]);
    if (!family || parts.length > 2 || (parts.length === 2 && !/^\d+$/.test(parts[1]))
        || !Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) {
      throw new Error("TRUSTED_PROXY_CIDRS must contain IP addresses or CIDRs, never true or hop counts");
    }
    const candidates = family === 4
      ? [["127.0.0.0", 8], ["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16]]
      : [["::1", 128], ["fc00::", 7], ["fe80::", 10]];
    const internal = candidates.some(([network, length]) => {
      const block = new BlockList();
      block.addSubnet(network, length, family === 4 ? "ipv4" : "ipv6");
      return prefix >= length && block.check(parts[0], family === 4 ? "ipv4" : "ipv6");
    });
    if (!internal) throw new Error("Only known internal or loopback proxies may be trusted");
  }
  return ranges;
}

module.exports = { trustedProxyAddresses };
