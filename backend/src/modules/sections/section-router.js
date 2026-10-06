const express = require("express");
const router = express.Router();
const sectionController = require("./section-controller");
const { checkApiAccess } = require("../../middlewares");

router.get("", checkApiAccess, sectionController.handleGetAllSections);
router.post("", checkApiAccess, sectionController.handleAddNewSection);
router.get("/:id", checkApiAccess, sectionController.handleGetSectionById);
router.put("/:id", checkApiAccess, sectionController.handleUpdateSectionById);
router.delete("/:id", checkApiAccess, sectionController.handleDeleteSectionById);

module.exports = { sectionRoutes: router };
