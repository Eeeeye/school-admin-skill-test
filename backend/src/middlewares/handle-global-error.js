const { ApiError } = require("../utils");

const handleGlobalError = (err, req, res, next) => {
    if (err.type === "entity.parse.failed") {
        return res.status(400).json({ error: "Request body must contain valid JSON" });
    }
    if (err.type === "entity.too.large") {
        return res.status(413).json({ error: "Request body is too large" });
    }
    if (err instanceof ApiError) {
        return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: "Internal server error" });
}

module.exports = { handleGlobalError };
