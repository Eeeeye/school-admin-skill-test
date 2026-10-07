const { db } = require("../../config");
const { ApiError, isObjectEmpty } = require("../../utils");
const { findUserById } = require("../../shared/repository");
const {
  insertRole,
  getRoles,
  doesRoleNameExist,
  doesRoleIdExist,
  enableOrDisableRoleStatusByRoleId,
  getRoleById,
  updateRoleById,
  getPermissionsById,
  getUsersByRoleId,
  getAccessControlByIds,
  insertPermissionForRoleId,
  switchUserRole,
  deletePermissionForRoleId,
} = require("./rp-repository");

const normalizePositiveId = (id, label = "id") => {
  const normalizedId = Number(id);
  if (!["string", "number"].includes(typeof id) || !/^[1-9]\d*$/.test(String(id)) || !Number.isInteger(normalizedId) || normalizedId <= 0 || normalizedId > 2147483647) {
    throw new ApiError(400, `Invalid ${label}`);
  }
  return normalizedId;
};

const validateRoleName = (name) => {
  if (typeof name !== "string" || name.trim().length === 0 || name.trim().length > 50) {
    throw new ApiError(400, "Role name must be between 1 and 50 characters");
  }
  return name.trim();
};

const checkIfRoleIdExist = async (id) => {
  const normalizedId = normalizePositiveId(id, "role id");
  const affectedRow = await doesRoleIdExist(normalizedId);
  if (affectedRow <= 0) {
    throw new ApiError(404, "Invalid role id");
  }
  return normalizedId;
};

const addRole = async (name) => {
  const normalizedName = validateRoleName(name);
  const roleNameExist = await doesRoleNameExist(normalizedName);
  if (roleNameExist > 0) {
    throw new ApiError(409, "Role Name already exists.");
  }

  const affectedRow = await insertRole(normalizedName);
  if (affectedRow <= 0) {
    throw new ApiError(500, "Unable to add role");
  }

  return { message: "Role added successfully" };
};

const fetchRoles = async () => {
  const roles = await getRoles();
  if (!Array.isArray(roles) || roles.length <= 0) {
    throw new ApiError(500, "Roles not found");
  }

  return roles;
};

const fetchRole = async (id) => {
  const normalizedId = await checkIfRoleIdExist(id);

  const role = await getRoleById(normalizedId);
  if (isObjectEmpty(role)) {
    throw new ApiError(500, "Unable to get role detail");
  }

  return role;
};

const updateRole = async (id, name) => {
  const normalizedId = await checkIfRoleIdExist(id);
  const normalizedName = validateRoleName(name);

  const role = await getRoleById(normalizedId);
  if (!role.is_editable) throw new ApiError(403, "Built-in roles cannot be renamed");
  if (role.name.toLowerCase() !== normalizedName.toLowerCase() && await doesRoleNameExist(normalizedName) > 0) {
    throw new ApiError(409, "Role name already exists");
  }

  const affectedRow = await updateRoleById(normalizedId, normalizedName);
  if (affectedRow <= 0) {
    throw new ApiError(500, "Unable to update role");
  }

  return { message: "Role updated successfully" };
};

const processRoleStatus = async (id, status) => {
  const normalizedId = await checkIfRoleIdExist(id);
  if (typeof status !== "boolean") {
    throw new ApiError(400, "Role status must be a boolean");
  }
  const role = await getRoleById(normalizedId);
  if (!role.is_editable) throw new ApiError(403, "Built-in roles cannot be disabled");

  const affectedRow = await enableOrDisableRoleStatusByRoleId(normalizedId, status);
  if (affectedRow <= 0) {
    throw new ApiError(500, "Unable to disable role");
  }

  const stsText = status ? "enabled" : "disabled";
  return { message: `Role ${stsText} successfully` };
};

const addRolePermission = async (roleId, permissionIds) => {
  const normalizedRoleId = await checkIfRoleIdExist(roleId);
  if (typeof permissionIds !== "string") {
    throw new ApiError(400, "Permissions must be a comma-separated string");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM roles WHERE id = $1 FOR UPDATE", [normalizedRoleId]);

    const idArray = permissionIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    if (idArray.length === 0) {
      await deletePermissionForRoleId(normalizedRoleId, client);
      await client.query("COMMIT");
      return { message: "Permission of given role deleted successfully" };
    }
    const ids = [...new Set(idArray.map((id) => normalizePositiveId(id, "permission id")))];
    const accessControls = await getAccessControlByIds(ids, client);
    if (accessControls.length !== ids.length) {
      throw new ApiError(400, "One or more permission ids are invalid");
    }

    await deletePermissionForRoleId(normalizedRoleId, client);
    await insertPermissionForRoleId({ roleId: normalizedRoleId, accessControls }, client);

    await client.query("COMMIT");

    return { message: "Permission of given role saved successfully" };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, "Unable to assign permission to given role");
  } finally {
    client.release();
  }
};

const getRolePermissions = async (roleId) => {
  const normalizedRoleId = await checkIfRoleIdExist(roleId);

  const permissions = await getPermissionsById(normalizedRoleId);
  return permissions;
};

const fetchUsersByRoleId = async (id) => {
  const normalizedId = await checkIfRoleIdExist(id);

  const users = await getUsersByRoleId(normalizedId);
  if (!Array.isArray(users) || users.length <= 0) {
    throw new ApiError(404, "Users not found");
  }

  return users;
};

const processSwitchRole = async (userId, newRoleId, actor) => {
  const normalizedUserId = normalizePositiveId(userId, "user id");
  const normalizedRoleId = await checkIfRoleIdExist(newRoleId);
  const user = await findUserById(normalizedUserId);
  if (!user) {
    throw new ApiError(404, "Invalid user id");
  }
  if (Number(actor?.roleId) !== 1) throw new ApiError(403, "Only administrators may assign roles");
  if (Number(actor.id) === normalizedUserId && user.role_id !== normalizedRoleId) throw new ApiError(400, "You cannot change your own role");
  if (user.role_id === 3 || normalizedRoleId === 3) throw new ApiError(400, "Student roles must be managed through student records");
  const role = await getRoleById(normalizedRoleId);
  if (!role.is_active) throw new ApiError(400, "Selected role is disabled");
  const affectedRow = await switchUserRole(normalizedUserId, normalizedRoleId);
  if (affectedRow <= 0) {
    throw new ApiError(500, "Unable to switch role");
  }
  return { message: "Role switched successfully" };
};

module.exports = {
  addRole,
  fetchRoles,
  updateRole,
  processRoleStatus,
  fetchRole,
  addRolePermission,
  getRolePermissions,
  fetchUsersByRoleId,
  processSwitchRole,
};
