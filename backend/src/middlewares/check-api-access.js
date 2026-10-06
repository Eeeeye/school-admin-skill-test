const asyncHandler = require("express-async-handler");
const { checkPermission } = require("../modules/roles-and-permissions/rp-repository");
const { ApiError } = require("../utils");

const checkApiAccess = asyncHandler(async (req, res, next) => {
    const { baseUrl, route: { path }, method } = req;
    const { roleId } = req.user;
    const originalUrl = `${baseUrl}${path}`;

    if (Number(roleId) !== 1) {
        const affectedRow = await checkPermission(roleId, originalUrl, method);
        if (affectedRow <= 0) {
            throw new ApiError(403, `You do not have permission to access to this resource - ${originalUrl}`);
        }
    }
    next();
});

module.exports = { checkApiAccess };
