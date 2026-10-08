const {
  ApiError,
  generateToken,
  generateCsrfHmacHash,
  verifyToken,
  sendPasswordSetupEmail,
  verifyPassword,
  generateHashedPassword,
  sendAccountVerificationEmail,
  formatMyPermission,
} = require("../../utils");
const {
  findUserByUsername,
  invalidateRefreshToken,
  findUserByRefreshToken,
  getMenusByRoleId,
  getRoleNameByRoleId,
  saveUserLastLoginDate,
  deleteOldRefreshTokenByUserId,
  verifyAccountEmail,
  setupUserPassword,
  findUserForPasswordUpdate,
} = require("./auth-repository");
const { matchesPasswordToken } = require("../../utils/password-token");
const { v4: uuidV4 } = require("uuid");
const { env, db } = require("../../config");
const { insertRefreshToken, findUserById } = require("../../shared/repository");
const { DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD } = require("../../security/demo-credentials");

const PWD_SETUP_EMAIL_SEND_SUCCESS =
  "Password setup link emailed successfully.";
const USER_DOES_NOT_EXIST = "User does not exist";
const EMAIL_NOT_VERIFIED =
  "Email not verified yet. Please verify your email first.";
const USER_ALREADY_ACTIVE = "User already in active status. Please login.";
const UNABLE_TO_VERIFY_EMAIL = "Unable to verify email";
const login = async (username, passwordFromUser) => {
  if (env.NODE_ENV === "production" && (username.trim().toLowerCase() === DEMO_ADMIN_EMAIL || passwordFromUser === DEMO_ADMIN_PASSWORD)) {
    throw new ApiError(400, "Invalid credential");
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const user = await findUserByUsername(username, client);
    if (!user) {
      throw new ApiError(400, "Invalid credential");
    }

    const {
      id: userId,
      role_id,
      name,
      email,
      password: passwordFromDB,
      is_active,
    } = user;
    if (!is_active) {
      throw new ApiError(403, "Your account is disabled");
    }

    await verifyPassword(passwordFromDB, passwordFromUser);

    const roleName = await getRoleNameByRoleId(role_id, client);
    const csrfToken = uuidV4();
    const csrfHmacHash = generateCsrfHmacHash(csrfToken);
    const accessToken = generateToken(
      { id: userId, role: roleName, roleId: role_id, csrf_hmac: csrfHmacHash },
      env.JWT_ACCESS_TOKEN_SECRET,
      env.JWT_ACCESS_TOKEN_TIME_IN_MS
    );
    const refreshToken = generateToken(
      { id: userId, role: roleName, roleId: role_id },
      env.JWT_REFRESH_TOKEN_SECRET,
      env.JWT_REFRESH_TOKEN_TIME_IN_MS
    );

    await deleteOldRefreshTokenByUserId(userId, client);
    await insertRefreshToken({ userId, refreshToken }, client);
    await saveUserLastLoginDate(userId, client);

    const permissions = await getMenusByRoleId(role_id, client);
    const { hierarchialMenus, apis, uis } = formatMyPermission(permissions);

    await client.query("COMMIT");

    const accountBasic = {
      id: userId,
      name,
      email,
      role: roleName,
      menus: hierarchialMenus,
      uis,
      apis,
    };

    return { accessToken, refreshToken, csrfToken, accountBasic };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const logout = async (refreshToken) => {
  const affectedRow = await invalidateRefreshToken(refreshToken);
  if (affectedRow <= 0) {
    throw new ApiError(500, "Unable to logout");
  }
  return { message: "Logged out successfully" };
};

const getNewAccessAndCsrfToken = async (refreshToken) => {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const decodedToken = verifyToken(
      refreshToken,
      env.JWT_REFRESH_TOKEN_SECRET
    );
    if (!decodedToken || !decodedToken.id) {
      throw new ApiError(401, "Invalid refresh token");
    }

    const user = await findUserByRefreshToken(refreshToken);
    if (!user) {
      throw new ApiError(401, "Refresh token does not exist");
    }

    const { id: userId, role_id, is_active } = user;
    if (!is_active) {
      throw new ApiError(401, "Your account is disabled");
    }

    const roleName = await getRoleNameByRoleId(role_id, client);
    const csrfToken = uuidV4();
    const csrfHmacHash = generateCsrfHmacHash(csrfToken);
    const accessToken = generateToken(
      { id: userId, role: roleName, roleId: role_id, csrf_hmac: csrfHmacHash },
      env.JWT_ACCESS_TOKEN_SECRET,
      env.JWT_ACCESS_TOKEN_TIME_IN_MS
    );

    await client.query("COMMIT");

    return {
      accessToken,
      csrfToken,
      message: "Refresh-token and csrf-token generated successfully",
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const processAccountEmailVerify = async (id, email) => {
  const EMAIL_VERIFIED_AND_EMAIL_SEND_SUCCESS =
    "Email verified successfully. Please setup password using link provided in the email.";
  const EMAIL_VERIFIED_BUT_EMAIL_SEND_FAIL =
    "Email verified successfully but fail to send password setup email. Please setup password using link provided in the email.";
  try {
    const user = await verifyAccountEmail(id, email);
    if (!user) {
      throw new ApiError(400, "Verification link is invalid, has already been used, or belongs to a previous email address");
    }

    try {
      await sendPasswordSetupEmail({ userId: id, userEmail: user.email });
      return { message: EMAIL_VERIFIED_AND_EMAIL_SEND_SUCCESS };
    } catch (error) {
      return { message: EMAIL_VERIFIED_BUT_EMAIL_SEND_FAIL };
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, UNABLE_TO_VERIFY_EMAIL);
  }
};

const processPasswordSetup = async (payload) => {
  const { userId, userEmail, password, purpose, fingerprint } = payload;
  if (!["setup", "reset"].includes(purpose)) {
    throw new ApiError(400, "Invalid password token purpose");
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Serialize consumers of the same link. The second request sees the new
    // password hash after the first commits and fails the fingerprint check.
    const user = await findUserForPasswordUpdate(userId, client);
    if (!user || user.email !== userEmail || !user.is_email_verified || !user.role_active) {
      throw new ApiError(400, "Invalid password setup request");
    }
    if (!matchesPasswordToken(user, purpose, fingerprint)) {
      throw new ApiError(400, "Password link is invalid or has already been used");
    }
    if ((purpose === "setup" && user.is_active) || (purpose === "reset" && !user.is_active)) {
      throw new ApiError(400, "Password link does not match account status");
    }

    const hashedPassword = await generateHashedPassword(password);
    const affectedRow = await setupUserPassword({ userId, userEmail, password: hashedPassword }, client);
    if (affectedRow !== 1) {
      throw new ApiError(500, "Unable to setup password");
    }
    await deleteOldRefreshTokenByUserId(userId, client);
    await client.query("COMMIT");
    return { message: "Password setup successful. Please login now using your email and password." };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const processResendEmailVerification = async (userId) => {
  try {
    const user = await findUserById(userId);
    if (!user) {
      throw new ApiError(404, USER_DOES_NOT_EXIST);
    }

    const { email, is_email_verified, is_active } = user;
    if (is_active) {
      throw new ApiError(400, USER_ALREADY_ACTIVE);
    }

    if (is_email_verified) {
      throw new ApiError(
        400,
        "Email already verified. Please setup your account password using the link sent in the email."
      );
    }

    await sendAccountVerificationEmail({ userId, userEmail: email });
    return {
      message:
        "Verification email sent successfully. Please setup password using link provided in the email.",
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    } else {
      throw new ApiError(500, "Unable to send verification email");
    }
  }
};

const processResendPwdSetupLink = async (userId) => {
  try {
    const user = await findUserById(userId);
    if (!user) {
      throw new ApiError(404, USER_DOES_NOT_EXIST);
    }

    const { email, is_active, is_email_verified } = user;
    if (is_active) {
      throw new ApiError(400, USER_ALREADY_ACTIVE);
    }

    if (!is_email_verified) {
      throw new ApiError(400, EMAIL_NOT_VERIFIED);
    }

    await sendPasswordSetupEmail({ userId, userEmail: email });
    return { message: PWD_SETUP_EMAIL_SEND_SUCCESS };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    } else {
      throw new ApiError(500, "Unable to send password setup email");
    }
  }
};

const processPwdReset = async (userId) => {
  try {
    const user = await findUserById(userId);
    if (!user) {
      throw new ApiError(404, USER_DOES_NOT_EXIST);
    }

    const { email, is_email_verified } = user;
    if (!is_email_verified) {
      throw new ApiError(400, EMAIL_NOT_VERIFIED);
    }

    await sendPasswordSetupEmail({ userId, userEmail: email, purpose: "reset" });
    return { message: PWD_SETUP_EMAIL_SEND_SUCCESS };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    } else {
      throw new ApiError(500, "Unable to reset password");
    }
  }
};

module.exports = {
  login,
  logout,
  getNewAccessAndCsrfToken,
  processAccountEmailVerify,
  processPasswordSetup,
  processResendEmailVerification,
  processResendPwdSetupLink,
  processPwdReset,
};
