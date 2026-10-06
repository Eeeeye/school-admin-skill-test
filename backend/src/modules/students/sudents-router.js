const express = require("express");
const router = express.Router();
const studentController = require("./students-controller");
const { checkApiAccess } = require("../../middlewares");

router.get("", checkApiAccess, studentController.handleGetAllStudents);
router.post("", checkApiAccess, studentController.handleAddStudent);
router.get("/:id", checkApiAccess, studentController.handleGetStudentDetail);
router.post("/:id/status", checkApiAccess, studentController.handleStudentStatus);
router.put("/:id", checkApiAccess, studentController.handleUpdateStudent);
router.delete("/:id", checkApiAccess, studentController.handleDeleteStudent);

module.exports = { studentsRoutes: router };
