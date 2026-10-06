const express = require("express");
const router = express.Router();
const staffsController = require("./staffs-controller");
const { checkApiAccess } = require("../../middlewares");

router.get("", checkApiAccess, staffsController.handleGetAllStaffs);
router.post("", checkApiAccess, staffsController.handleAddStaff);
router.get("/:id", checkApiAccess, staffsController.handleGetStaff);
router.put("/:id", checkApiAccess, staffsController.handleUpdateStaff);
router.post("/:id/status", checkApiAccess, staffsController.handleReviewStaffStatus);

module.exports = { staffsRoutes: router };
