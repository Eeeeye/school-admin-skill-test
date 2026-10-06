const express = require("express");
const cookieParser = require("cookie-parser"); 
const dotenv = require("dotenv");
dotenv.config();

const { handle404Error, handleGlobalError, } = require("./middlewares");
const { v1Routes } = require("./routes/v1");
const { cors, db } = require("./config");
const path = require("path");
const app = express();
const { trustedProxyAddresses } = require("./config/trusted-proxies");

app.disable("x-powered-by");
app.set("trust proxy", trustedProxyAddresses(process.env.TRUSTED_PROXY_CIDRS));

app.use(cors)
app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(cookieParser());

app.get("/health", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok", database: "ok" });
  } catch (_error) {
    res.status(503).json({ status: "degraded", database: "unavailable" });
  }
});

app.use("/api/v1", v1Routes);

app.use(handle404Error);
app.use(handleGlobalError);

module.exports = { app };
