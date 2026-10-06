const { corsPolicy } = require("./cors");
const { db } = require("./db");
const { env, assertProductionConfig } = require("./env");

module.exports = {
  cors: corsPolicy,
  db,
  env,
  assertProductionConfig,
};
