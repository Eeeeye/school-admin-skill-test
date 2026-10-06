const { env } = require("../config");
const { verifyToken, ApiError } = require("../utils");

const handlePasswordSetupToken = (req, res, next) => {
  const { token } = req.body;
  if (!token) {
    throw new ApiError(404, "Invalid token");
  }

  const decodeToken = verifyToken(token, env.PASSWORD_SETUP_TOKEN_SECRET);
  if (!decodeToken || !Number.isSafeInteger(decodeToken.id) || decodeToken.id <= 0
      || !["setup", "reset"].includes(decodeToken.purpose)
      || typeof decodeToken.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(decodeToken.fingerprint)) {
    throw new ApiError(400, "Invalid token");
  }

  req.user = decodeToken;
  next();
};

module.exports = { handlePasswordSetupToken };
