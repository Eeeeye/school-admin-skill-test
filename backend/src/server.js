require("dotenv").config();

const { env, assertProductionConfig } = require("./config");

assertProductionConfig();

const { app } = require("./app.js");

const PORT = env.PORT;
let server;
const start = async () => {
  if (process.env.AUTO_MIGRATE === "true") {
    const { migrate } = require("./migrate");
    const { db } = require("./config");
    await migrate(db);
  }
  const { assertSafeProductionAdmin } = require("./security/demo-credentials");
  await assertSafeProductionAdmin(require("./config").db);
  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
};
start().catch(async (error) => {
  console.error("Server startup failed:", error.message);
  await require("./config").db.end();
  process.exitCode = 1;
});

const shutdown = async (signal) => {
  console.log(`Received ${signal}; shutting down`);
  if (!server) return;
  server.close(async () => {
    const { db } = require("./config");
    await db.end();
    process.exit(0);
  });
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
