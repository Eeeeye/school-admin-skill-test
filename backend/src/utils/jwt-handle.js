const jwt = require("jsonwebtoken");
const { randomUUID } = require("node:crypto");
const { ApiError } = require("./api-error");

const generateToken = (payload, secret, time) => {
    // Two logins in the same second must not recreate a revoked refresh token.
    return jwt.sign(payload, secret, { expiresIn: time, jwtid: randomUUID() });
}

const verifyToken = (token, secret) => {
    try {
        return jwt.verify(token, secret);
    } catch (error) {
        if (error.name === "TokenExpiredError") {
            throw new ApiError(400, "Token expired");
        }
        return null;
    }
}

module.exports = {
    generateToken,
    verifyToken,
};
