const { ApiError } = require("../../utils");
const { academicId, academicName } = require("../../utils/academic-integrity");
const { createNewLeavePolicy, updateLeavePolicyById, getLeavePolicies, getUsersByPolicyId, updatePolicyUsersById, enableDisableLeavePolicy, deleteUserFromPolicyById, getPolicyEligibleUsers, createNewLeaveRequest, updateLeaveRequestById, getLeaveRequestHistoryByUser, deleteLeaveRequestByRequestId, getPendingLeaveRequests, approveOrCancelPendingLeaveRequest, findReviewerIdByRequestId, getMyLeavePolicy, findPolicyStatusById } = require("./leave-repository");

const checkIfPolicyIsActive = async (id) => {
    academicId(id);
    const policy = await findPolicyStatusById(id);
    if (!policy) throw new ApiError(404, "Leave policy not found");
    if (!policy.is_active) throw new ApiError(403, "Policy is not active. Please activate the policy first.")
}

const makeNewLeavePolicy = async (name) => {
    const affectedRow = await createNewLeavePolicy(academicName(name, "Leave policy"));
    if (affectedRow <= 0) {
        throw new ApiError(500, "Unable to add policy");
    }

    return { message: "Policy added successfully" };
}

const updateLeavePolicy = async (name, id) => {
    await checkIfPolicyIsActive(id);

    const affectedRow = await updateLeavePolicyById(academicName(name, "Leave policy"), id);
    if (affectedRow <= 0) {
        throw new ApiError(500, "Unable to update policy");
    }

    return { message: "Policy updated successfully" };
}

const fetchLeavePolicies = async () => {
    const policies = await getLeavePolicies();

    return policies;
}

const processGetMyLeavePolicy = async (id) => {
    const policies = await getMyLeavePolicy(id);

    return policies;
}

const fetchPolicyUsers = async (id) => {
    await checkIfPolicyIsActive(id);

    const users = await getUsersByPolicyId(id);

    return users;
}

const updatePolicyUsers = async (policyId, userIds) => {
    if (typeof userIds !== "string" || !userIds.trim()) throw new ApiError(400, "Users must be a non-empty comma-separated list of IDs");
    const users = [...new Set(userIds.split(",").map((id) => academicId(id.trim())))].join(",");
    await checkIfPolicyIsActive(policyId);

    const affectedRow = await updatePolicyUsersById(policyId, users);
    if (affectedRow <= 0) {
        throw new ApiError(404, "No users were updated or policy not found");
    }

    return { message: "Users of policy updated" };
}

const deletePolicyUser = async (userId, policyId) => {
    academicId(userId);
    await checkIfPolicyIsActive(policyId);

    const affectedRow = await deleteUserFromPolicyById(userId, policyId);
    if (affectedRow <= 0) {
        throw new ApiError(500, "Unable to delete user from policy");
    }

    return { message: "User deleted from policy successfully" };
}

const reviewLeavePolicy = async (status, policyId) => {
    academicId(policyId);
    if (typeof status !== "boolean") throw new ApiError(400, "Policy status must be a boolean");
    const affectedRow = await enableDisableLeavePolicy(status, policyId);
    if (affectedRow <= 0) {
        const sts = status ? "enable" : "disable";
        throw new ApiError(500, `Unable to ${sts} policy`);
    }

    const responseStatus = status ? "enabled" : "disabled";
    return { message: `Policy ${responseStatus} successfully`, };
}

const fetchPolicyEligibleUsers = async () => {
    const users = await getPolicyEligibleUsers();

    return users;
}

const validateLeaveRequest = (payload) => {
    academicId(payload.policy);
    for (const field of ["from", "to"]) {
        const value = payload[field];
        const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(NaN);
        if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ApiError(400, "Leave dates must be valid dates in YYYY-MM-DD format");
    }
    if (payload.to < payload.from) throw new ApiError(400, "Leave end date must not precede the start date");
    if (payload.note != null && (typeof payload.note !== "string" || payload.note.length > 100)) throw new ApiError(400, "Leave note must contain at most 100 characters");
};

const addNewLeaveRequest = async (payload) => {
    validateLeaveRequest(payload);
    await checkIfPolicyIsActive(payload.policy);

    const affectedRow = await createNewLeaveRequest(payload);
    if (affectedRow <= 0) {
        throw new ApiError(403, "You are not assigned to this leave policy");
    }

    return { message: "Leave request added successfully" };
}

const updateLeaveRequest = async (payload) => {
    academicId(payload.id);
    validateLeaveRequest(payload);
    await checkIfPolicyIsActive(payload.policy);

    const affectedRow = await updateLeaveRequestById(payload);
    if (affectedRow <= 0) {
        throw new ApiError(403, "Only your own pending leave request may be edited, using an assigned policy");
    }

    return { message: "Leave request updated successfully" };
}

const getUserLeaveHistory = async (userId) => {
    const leaves = await getLeaveRequestHistoryByUser(userId);

    return leaves;
}

const deleteLeaveRequest = async (leaveRequestId, userId) => {
    academicId(leaveRequestId);
    const affectedRow = await deleteLeaveRequestByRequestId(leaveRequestId, userId);
    if (affectedRow <= 0) {
        throw new ApiError(403, "Only your own pending leave request may be deleted");
    }

    return { message: "Leave request deleted successfully" };
}

const fetchPendingLeaveRequests = async (user) => {
    const leaves = await getPendingLeaveRequests(user);

    return leaves;
}

const reviewPendingLeaveRequest = async (userId, requestId, status, reviewerRoleId) => {
    academicId(requestId);
    if (!["number", "string"].includes(typeof status)) throw new ApiError(400, "Invalid leave review status");
    status = Number(status);
    if (![2, 3].includes(status)) throw new ApiError(400, "Leave review status must be approved or cancelled");
    const user = await findReviewerIdByRequestId(requestId);
    if (!user) {
        throw new ApiError(404, "User does not exist.");
    }

    const { reporter_id } = user;
    if (Number(reviewerRoleId) !== 1 && reporter_id !== userId) {
        throw new ApiError(403, "Forbidden. Authorised reviewer only.");
    }

    const affectedRow = await approveOrCancelPendingLeaveRequest(userId, requestId, status, reviewerRoleId);
    if (affectedRow <= 0) {
        throw new ApiError(409, "This leave request has already been reviewed")
    }

    return { message: "Success" };
}

module.exports = {
    makeNewLeavePolicy,
    updateLeavePolicy,
    fetchLeavePolicies,
    fetchPolicyUsers,
    updatePolicyUsers,
    reviewLeavePolicy,
    deletePolicyUser,
    fetchPolicyEligibleUsers,
    addNewLeaveRequest,
    updateLeaveRequest,
    getUserLeaveHistory,
    deleteLeaveRequest,
    fetchPendingLeaveRequests,
    reviewPendingLeaveRequest,
    processGetMyLeavePolicy,
};
