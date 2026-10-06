const { ApiError, sendAccountVerificationEmail } = require("../../utils");
const { addOrUpdateStaff, reviewStaffStatus, getAllStaffs, getStaffDetailById, validateStaffReferences, updateStaffById } = require("./staffs-repository");
const { validateStaffPayload, staffId } = require("./staffs-validation");

const processGetAllStaffs = async (payload) => {
    const filters = {};
    for (const key of ["userId", "roleId", "departmentId"]) {
        if (payload[key] !== undefined && payload[key] !== "") filters[key] = staffId(payload[key], key);
    }
    if (payload.name !== undefined) {
        if (typeof payload.name !== "string") throw new ApiError(400, "Invalid staff name filter");
        filters.name = payload.name.trim();
    }
    return getAllStaffs(filters);
}

const processGetStaff = async (id) => {
    const staff = await getStaffDetailById(staffId(id));
    if (!staff) {
        throw new ApiError(404, "Staff detail not found");
    }
    return staff;
}

const checkWriteResult = (result) => {
    if (result?.status) return;
    if (result?.message === "Staff not found") throw new ApiError(404, result.message);
    if (result?.message === "Email already exists" || /duplicate key/i.test(result?.description || "")) {
        throw new ApiError(409, "Email already exists");
    }
    if (["Student cannot be staff", "Invalid role, reporter or department"].includes(result?.message)
        || /foreign key/i.test(result?.description || "")) {
        throw new ApiError(400, "Invalid staff role, department or reporting manager");
    }
    throw new ApiError(500, "Unable to save staff");
};

const processReviewStaffStatus = async ({ status, userId, reviewerId }) => {
    if (typeof status !== "boolean") throw new ApiError(400, "Staff status must be a boolean");
    const id = staffId(userId);
    if (!status && id === Number(reviewerId)) throw new ApiError(400, "You cannot disable your own account");
    await processGetStaff(id);
    const affectedRow = await reviewStaffStatus({ status, userId: id, reviewerId });
    if (affectedRow <= 0) throw new ApiError(400, "Verify the staff email before enabling system access");
    return { message: "Staff status updated successfully" };
}

const processAddStaff = async (payload) => {
    const normalized = validateStaffPayload(payload, { creating: true });
    await validateStaffReferences(normalized);
    const result = await addOrUpdateStaff(normalized);
    checkWriteResult(result);
    try {
        await sendAccountVerificationEmail({ userId: result.userId, userEmail: normalized.email });
        return { userId: result.userId, message: "Staff added and verification email sent successfully." };
    } catch {
        return { userId: result.userId, message: "Staff added, but failed to send verification email." };
    }
}

const processUpdateStaff = async (payload) => {
    const normalized = validateStaffPayload(payload);
    const id = staffId(payload.userId);
    const result = await updateStaffById(id, normalized);
    checkWriteResult(result);

    return { message: result.message };
}

module.exports = {
    processGetAllStaffs,
    processGetStaff,
    processReviewStaffStatus,
    processAddStaff,
    processUpdateStaff
};
