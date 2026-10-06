const cors = require("cors");
const { env } = require("./env");

const corsPolicy = cors({
  origin: env.UI_URL,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Accept", "Origin", "X-CSRF-TOKEN", "Idempotency-Key"],
  credentials: true,
});

module.exports = { corsPolicy };
