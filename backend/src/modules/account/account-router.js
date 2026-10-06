const express = require("express");
const router = express.Router();
const accountController = require("./account-controller");
const { validateRequest } = require("../../utils");
const { PasswordChangeSchema } = require("./account-schema");
const { passwordLinkLimit } = require("../../middlewares/auth-rate-limit");

router.post("/change-password", passwordLinkLimit, validateRequest(PasswordChangeSchema), accountController.handlePasswordChange);
router.get("/me", accountController.handleGetAccountDetail);

module.exports = { accountRoutes: router };
