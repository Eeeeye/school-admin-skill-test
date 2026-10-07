const { db } = require("../config");
const { ApiError } = require("./api-error");

const academicId = (id) => {
  if (!["string", "number"].includes(typeof id) || !/^[1-9]\d*$/.test(String(id)) || Number(id) > 2147483647) {
    throw new ApiError(400, "Invalid academic record id");
  }
  return Number(id);
};

const academicName = (name, label) => {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 50 || name.includes(",")) {
    throw new ApiError(400, `${label} name must contain 1 to 50 characters and no commas`);
  }
  return name.trim();
};

const sectionTokens = (value) => {
  if (typeof value !== "string" || value.length > 50) throw new ApiError(400, "Sections must be a comma-separated string of at most 50 characters");
  return [...new Set(value.split(",").map((part) => part.trim()).filter(Boolean))];
};

const academicTransaction = async (operation) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Share the class-teacher assignment lock to keep placement changes atomic.
    await client.query("SELECT pg_advisory_xact_lock(7183001)");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof ApiError) throw error;
    if (error.code === "23505") throw new ApiError(409, "This name already exists");
    if (error.code === "22001") throw new ApiError(400, "The resulting section list exceeds 50 characters");
    throw error;
  } finally {
    client.release();
  }
};

const resolveSections = async (client, value) => {
  const tokens = sectionTokens(value);
  const { rows } = await client.query("SELECT id, name FROM sections ORDER BY id FOR SHARE");
  const names = tokens.map((token) => {
    const section = rows.find((row) => row.name === token) || rows.find((row) => String(row.id) === token);
    if (!section) throw new ApiError(400, "Selected section does not exist");
    return section.name;
  });
  const unique = [...new Set(names)];
  if (unique.join(",").length > 50) throw new ApiError(400, "The resulting section list exceeds 50 characters");
  return unique;
};

module.exports = { academicId, academicName, sectionTokens, academicTransaction, resolveSections };
