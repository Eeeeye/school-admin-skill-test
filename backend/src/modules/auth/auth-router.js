const express = require("express");
const router = express.Router();
const { authenticateToken, csrfProtection, handleEmailVerificationToken, handlePasswordSetupToken, checkApiAccess } = require("../../middlewares");
const authController = require("./auth-controller");
const { validateRequest } = require("../../utils");
const { LoginSchema, PasswordSetupSchema, UserIdSchema } = require("./auth-schema");
const { loginIpLimit, loginAccountLimit, refreshLimit, passwordLinkLimit, emailLimit } = require("../../middlewares/auth-rate-limit");

router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
router.post("/login", loginIpLimit, loginAccountLimit, validateRequest(LoginSchema), authController.handleLogin);
router.get("/refresh", refreshLimit, authController.handleTokenRefresh);
router.post("/logout", authenticateToken, csrfProtection, authController.handleLogout);
router.get("/verify-email/:token", passwordLinkLimit, handleEmailVerificationToken, authController.handleAccountEmailVerify);
router.post("/setup-password", passwordLinkLimit, validateRequest(PasswordSetupSchema), handlePasswordSetupToken, authController.handleAccountPasswordSetup);
router.post("/resend-email-verification", validateRequest(UserIdSchema), authenticateToken, csrfProtection, checkApiAccess, emailLimit, authController.handleResendEmailVerification);
router.post("/resend-pwd-setup-link", validateRequest(UserIdSchema), authenticateToken, csrfProtection, checkApiAccess, emailLimit, authController.handleResendPwdSetupLink);
router.post("/reset-pwd", validateRequest(UserIdSchema), authenticateToken, csrfProtection, checkApiAccess, emailLimit, authController.handlePwdReset);

module.exports = { authRoutes: router };
