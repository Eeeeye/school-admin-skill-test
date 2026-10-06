const { ApiError } = require("../../utils/api-error");

const limits = {
  name: 100, email: 100, gender: 10, maritalStatus: 50, phone: 20,
  qualification: 100, experience: 100, currentAddress: 50,
  permanentAddress: 50, fatherName: 50, motherName: 50, emergencyPhone: 20,
};

function staffId(value, label = "staff id") {
  if (!["string", "number"].includes(typeof value) || !/^[1-9]\d*$/.test(String(value))
    || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) {
    throw new ApiError(400, `Invalid ${label}`);
  }
  return Number(value);
}

function validateStaffPayload(payload, { creating = false } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError(400, "Staff payload is required");
  }
  if (creating && Object.hasOwn(payload, "userId")) {
    throw new ApiError(400, "userId cannot be supplied when creating staff");
  }
  const normalized = {};
  for (const [field, max] of Object.entries(limits)) {
    if (!Object.hasOwn(payload, field)) continue;
    const value = payload[field];
    if (value !== null && typeof value !== "string") throw new ApiError(400, `${field} must be a string`);
    if (typeof value === "string" && [...value].length > max) throw new ApiError(400, `${field} must be at most ${max} characters`);
    normalized[field] = typeof value === "string" ? value.trim() : null;
  }
  for (const field of ["name", "email"]) {
    if ((creating || Object.hasOwn(payload, field)) && !normalized[field]) {
      throw new ApiError(400, `Staff ${field} is required`);
    }
  }
  if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
    throw new ApiError(400, "Invalid staff email");
  }
  for (const field of ["role", "departmentId", "reporterId"]) {
    if (!Object.hasOwn(payload, field)) {
      if (creating && field === "role") throw new ApiError(400, "Staff role is required");
      continue;
    }
    if (field !== "role" && [null, "", 0, "0"].includes(payload[field])) normalized[field] = null;
    else normalized[field] = staffId(payload[field], field);
  }
  if (normalized.role === 3) throw new ApiError(400, "Student cannot be staff");
  for (const field of ["dob", "joinDate"]) {
    if (!Object.hasOwn(payload, field)) continue;
    if (payload[field] === null || payload[field] === "") { normalized[field] = null; continue; }
    const value = payload[field];
    const date = new Date(value);
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new ApiError(400, `Invalid ${field}; expected a valid YYYY-MM-DD date`);
    }
    normalized[field] = value;
  }
  if (Object.hasOwn(payload, "systemAccess")) {
    if (typeof payload.systemAccess !== "boolean") throw new ApiError(400, "systemAccess must be a boolean");
    normalized.systemAccess = payload.systemAccess;
  } else if (creating) normalized.systemAccess = false;
  return normalized;
}

module.exports = { validateStaffPayload, staffId };
