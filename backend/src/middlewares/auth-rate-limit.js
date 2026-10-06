const { isIP } = require("node:net");
const { createHash } = require("node:crypto");

function clientAddress(req) {
  const value = req.ip || req.socket?.remoteAddress || "unknown";
  if (isIP(value) !== 6) return value;
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(value)) return value.slice(7);
  const [left, right] = value.toLowerCase().split("::");
  const start = left ? left.split(":") : [];
  const end = right ? right.split(":") : [];
  const words = right !== undefined ? [...start, ...Array(8 - start.length - end.length).fill("0"), ...end] : start;
  const parsed = words.map((part) => Number.parseInt(part, 16));
  if (parsed.slice(0, 5).every((word) => word === 0) && parsed[5] === 65535) {
    return [parsed[6] >> 8, parsed[6] & 255, parsed[7] >> 8, parsed[7] & 255].join(".");
  }
  // Rotating addresses inside one IPv6 /64 must not bypass a per-client budget.
  return `${parsed.slice(0, 4).map((word) => word.toString(16)).join(":")}::/64`;
}

function createRateLimit({ limit, windowMs, key = clientAddress, skipSuccessful = false, maxEntries = 10000, now = Date.now }) {
  const buckets = new Map();
  let nextSweep = 0;
  return (req, res, next) => {
    const time = now();
    if (time >= nextSweep || buckets.size >= maxEntries) {
      for (const [entry, bucket] of buckets) if (bucket.resetAt <= time) buckets.delete(entry);
      nextSweep = time + Math.min(windowMs, 60000);
    }
    const identifier = key(req);
    let bucket = buckets.get(identifier);
    if (!bucket || bucket.resetAt <= time) {
      if (!bucket && buckets.size >= maxEntries) {
        res.set("Retry-After", "60");
        return res.status(429).json({ error: "Authentication is busy. Please try again shortly." });
      }
      bucket = { count: 0, resetAt: time + windowMs };
      buckets.set(identifier, bucket);
    }
    const remainingSeconds = Math.max(1, Math.ceil((bucket.resetAt - time) / 1000));
    res.set("RateLimit-Limit", String(limit));
    res.set("RateLimit-Remaining", String(Math.max(0, limit - bucket.count - 1)));
    res.set("RateLimit-Reset", String(remainingSeconds));
    if (bucket.count >= limit) {
      res.set("Retry-After", String(remainingSeconds));
      return res.status(429).json({ error: "Too many authentication attempts. Please try again later." });
    }
    bucket.count++;
    if (skipSuccessful) res.once("finish", () => { if (res.statusCode < 400) bucket.count = Math.max(0, bucket.count - 1); });
    next();
  };
}

const accountKey = (req) => {
  const account = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase().slice(0, 100) : "unknown";
  return `${clientAddress(req)}:${createHash("sha256").update(account).digest("hex")}`;
};
const loginIpLimit = createRateLimit({ limit: 60, windowMs: 15 * 60 * 1000, skipSuccessful: true });
const loginAccountLimit = createRateLimit({ limit: 10, windowMs: 15 * 60 * 1000, key: accountKey, skipSuccessful: true });
const refreshLimit = createRateLimit({ limit: 60, windowMs: 60 * 1000 });
const passwordLinkLimit = createRateLimit({ limit: 10, windowMs: 15 * 60 * 1000 });
const emailLimit = createRateLimit({ limit: 10, windowMs: 60 * 60 * 1000,
  key: (req) => `${clientAddress(req)}:${req.user?.id || "anonymous"}` });

module.exports = { createRateLimit, clientAddress, loginIpLimit, loginAccountLimit, refreshLimit, passwordLinkLimit, emailLimit };
