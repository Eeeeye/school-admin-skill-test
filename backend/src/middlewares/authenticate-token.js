const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const { ApiError } = require("../utils/api-error");
const { env, db } = require("../config");

const authenticateToken = asyncHandler(async (req, res, next) => {
  const { accessToken, refreshToken } = req.cookies || {};
  if (!accessToken || !refreshToken) {
    throw new ApiError(401, "Unauthorized. Please provide valid tokens.");
  }

  let user;
  let decodedRefreshToken;
  try {
    user = jwt.verify(accessToken, env.JWT_ACCESS_TOKEN_SECRET);
    decodedRefreshToken = jwt.verify(refreshToken, env.JWT_REFRESH_TOKEN_SECRET);
  } catch (_error) {
    throw new ApiError(401, "Unauthorized. Please provide valid tokens.");
  }

  if (!Number.isSafeInteger(user.id) || user.id <= 0 || user.id !== decodedRefreshToken.id) {
    throw new ApiError(401, "Unauthorized. Invalid token pair.");
  }

  // JWT signatures alone do not revoke a logged-out or disabled session. Read
  // the current role as well, so an old admin token cannot survive a demotion.
  let rows;
  try {
    ({ rows } = await db.query(`
      SELECT u.id, u.role_id, u.is_active, r.is_active AS role_active, lower(r.name) AS role
      FROM user_refresh_tokens rt
      JOIN users u ON u.id = rt.user_id
      JOIN roles r ON r.id = u.role_id
      WHERE rt.token = $1 AND u.id = $2 AND rt.expires_at > NOW()
    `, [refreshToken, user.id]));
  } catch (_error) {
    throw new ApiError(503, "Authentication service unavailable.");
  }
  const session = rows[0];
  if (!session || !session.is_active || !session.role_active
      || Number(user.roleId) !== session.role_id) {
    throw new ApiError(401, "Unauthorized. Session is no longer valid.");
  }

  req.user = { ...user, roleId: session.role_id, role: session.role };
  req.refreshToken = decodedRefreshToken;
  next();
});

module.exports = { authenticateToken };
