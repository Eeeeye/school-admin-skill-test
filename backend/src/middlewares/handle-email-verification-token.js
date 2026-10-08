const { env } = require("../config");
const { ApiError, verifyToken } = require("../utils");

const handleEmailVerificationToken = (req, res, next) => {
  const { token } = req.params;
  if (!token) {
    throw new ApiError(404, "Invalid token");
  }

  const decodeToken = verifyToken(token, env.EMAIL_VERIFICATION_TOKEN_SECRET);
  if (!decodeToken || !Number.isSafeInteger(decodeToken.id) || decodeToken.id <= 0
      || decodeToken.purpose !== "verify-email" || typeof decodeToken.email !== "string"
      || !decodeToken.email || decodeToken.email.length > 100) {
    throw new ApiError(400, "Invalid token");
  }

  req.user = decodeToken;
  next();
};

module.exports = {
  handleEmailVerificationToken,
};
