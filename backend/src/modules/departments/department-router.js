const express = require("express");
const router = express.Router();
const departmentController = require("./department-controller");
const { checkApiAccess } = require("../../middlewares");

router.get("", checkApiAccess, departmentController.handleGetAllDepartments);
router.post("", checkApiAccess, departmentController.handleAddNewDepartment);
router.get("/:id", checkApiAccess, departmentController.handleGetDepartmentById);
router.put("/:id", checkApiAccess, departmentController.handleUpdateDepartmentById);
router.delete("/:id", checkApiAccess, departmentController.handleDeleteDepartmentById);

module.exports = { departmentRoutes: router };
