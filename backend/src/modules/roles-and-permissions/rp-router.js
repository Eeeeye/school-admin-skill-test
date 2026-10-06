const express = require("express");
const router = express.Router();
const rpController = require("./rp-controller");
const { isUserAdmin } = require("../../middlewares");

router.get("", isUserAdmin, rpController.handleGetRoles);
router.post("", isUserAdmin, rpController.handleAddRole);
router.post("/switch", isUserAdmin, rpController.handleSwitchRole);
router.put("/:id", isUserAdmin, rpController.handleUpdateRole);
router.post("/:id/status", isUserAdmin, rpController.handleRoleStatus);
router.get("/:id", isUserAdmin, rpController.handleGetRole);
router.get("/:id/permissions", isUserAdmin, rpController.handleGetRolePermission);
router.post("/:id/permissions", isUserAdmin, rpController.handleAddRolePermission);
router.get("/:id/users", isUserAdmin, rpController.handleGetUsersByRoleId);

module.exports = { rpRoutes: router };
