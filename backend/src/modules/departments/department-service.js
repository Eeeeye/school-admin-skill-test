const { ApiError } = require("../../utils");
const {
  getAllDepartments,
  addNewDepartment,
  getDepartmentById,
  updateDepartmentById,
  deleteDepartmentById,
} = require("./department-repository");
const { departmentModuleHandler } = require("./department-module");

const normalizeDepartmentId = (id) => {
  const normalizedId = Number(id);
  if (!["string", "number"].includes(typeof id) || !/^[1-9]\d*$/.test(String(id))
    || !Number.isInteger(normalizedId) || normalizedId <= 0 || normalizedId > 2147483647) {
    throw new ApiError(400, "Invalid department id");
  }
  return normalizedId;
};

const validateDepartmentName = (name) => {
  if (typeof name !== "string" || name.trim().length === 0 || name.trim().length > 50) {
    throw new ApiError(400, "Department name must be between 1 and 50 characters");
  }
  return name.trim();
};

const processGetAllDepartments = async () => {
  const departments = await getAllDepartments();
  return departments;
};

const processAddNewDepartment = async (name) => {
  const affectedRow = await addNewDepartment(validateDepartmentName(name));
  if (affectedRow <= 0) {
    throw new ApiError(500, "Unable to add new department");
  }

  return { message: "Department added successfully" };
};

const processGetDepartmentById = async (id) => {
  const department = await getDepartmentById(normalizeDepartmentId(id));
  if (!department) {
    throw new ApiError(404, "Department does not exist");
  }

  return department;
};
const processUpdateDepartmentById = async (payload) => {
  if (!payload || typeof payload !== "object") {
    throw new ApiError(400, "Department payload is required");
  }
  const affectedRow = await updateDepartmentById({
    id: normalizeDepartmentId(payload.id),
    name: validateDepartmentName(payload.name),
  });
  if (affectedRow <= 0) {
    throw new ApiError(404, "Department does not exist");
  }

  return { message: "Department updated successfully" };
};

const processDeleteDepartmentById = async (id) => {
  const affectedRow = await deleteDepartmentById(normalizeDepartmentId(id));
  if (affectedRow <= 0) {
    throw new ApiError(404, "Department does not exist");
  }

  return { message: "Department deleted successfully" };
};

module.exports = departmentModuleHandler(() => {
  return {
    processGetAllDepartments,
    processGetDepartmentById,
    processUpdateDepartmentById,
    processDeleteDepartmentById,
    processAddNewDepartment,
  };
});
