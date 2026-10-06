const { ApiError, sendAccountVerificationEmail } = require("../../utils");
const { findAllStudents, findStudentDetail, findStudentToSetStatus, addOrUpdateStudent, updateStudentById, deleteStudentById } = require("./students-repository");
const { findUserById } = require("../../shared/repository");

const validateStudentPayload = (payload, { requireIdentity = true } = {}) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new ApiError(400, "Student payload is required");
    }

    if (requireIdentity && (typeof payload.name !== "string" || payload.name.trim() === "")) {
        throw new ApiError(400, "Student name is required");
    }

    if (requireIdentity && (typeof payload.email !== "string" || payload.email.trim() === "")) {
        throw new ApiError(400, "Student email is required");
    }

    if ("name" in payload && (typeof payload.name !== "string" || payload.name.trim() === "")) {
        throw new ApiError(400, "Student name cannot be empty");
    }
    if ("email" in payload && (typeof payload.email !== "string" || payload.email.trim() === "")) {
        throw new ApiError(400, "Student email cannot be empty");
    }

    if (requireIdentity && Object.prototype.hasOwnProperty.call(payload, "userId")) {
        throw new ApiError(400, "userId cannot be supplied when creating a student");
    }

    const stringFields = [
        "name", "gender", "phone", "email", "currentAddress", "permanentAddress",
        "fatherName", "fatherPhone", "motherName", "motherPhone", "guardianName",
        "guardianPhone", "relationOfGuardian", "class", "section", "dob", "admissionDate",
    ];
    for (const field of stringFields) {
        if (field in payload && payload[field] !== null && typeof payload[field] !== "string") {
            throw new ApiError(400, `${field} must be a string`);
        }
    }

    const maxLengths = {
        name: 100, email: 100, gender: 10, phone: 20, currentAddress: 50,
        permanentAddress: 50, fatherName: 50, fatherPhone: 20, motherName: 50,
        motherPhone: 20, guardianName: 50, guardianPhone: 20,
        relationOfGuardian: 30, class: 50, section: 50,
    };
    for (const [field, max] of Object.entries(maxLengths)) {
        if (typeof payload[field] === "string" && [...payload[field]].length > max) {
            throw new ApiError(400, `${field} must be at most ${max} characters`);
        }
    }

    if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim())) {
        throw new ApiError(400, "Invalid student email");
    }

    for (const field of ["dob", "admissionDate"]) {
        if (payload[field]) {
            const date = new Date(payload[field]);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(payload[field]) || Number.isNaN(date.getTime())
                || date.toISOString().slice(0, 10) !== payload[field]) {
                throw new ApiError(400, `Invalid ${field}; expected a valid YYYY-MM-DD date`);
            }
        }
    }

    if ("roll" in payload && payload.roll !== null && payload.roll !== "") {
        const validRoll = (typeof payload.roll === "number" && Number.isInteger(payload.roll) && payload.roll >= 0)
            || (typeof payload.roll === "string" && /^\d+$/.test(payload.roll.trim()));
        if (!validRoll || Number(payload.roll) > 2147483647) {
            throw new ApiError(400, "Roll must be a non-negative integer");
        }
    }

    if ("systemAccess" in payload && typeof payload.systemAccess !== "boolean") {
        throw new ApiError(400, "systemAccess must be a boolean");
    }
};

const normalizePayload = (payload) => {
    const result = { ...payload };
    for (const field of ["name", "email"]) {
        if (typeof result[field] === "string") result[field] = result[field].trim();
    }
    for (const field of ["dob", "admissionDate", "roll", "class", "section"]) {
        if (result[field] === "") result[field] = null;
    }
    return result;
};

const checkWriteResult = (result) => {
    if (result.status) return;
    if (result.message === "Student not found") throw new ApiError(404, result.message);
    if (result.message === "Email already exists") throw new ApiError(409, result.message);
    if (["Invalid student reference", "Invalid class or section"].includes(result.message)) {
        throw new ApiError(400, result.message);
    }
    throw new ApiError(500, result.message);
};

const normalizeStudentId = (id) => {
    const normalizedId = Number(id);
    if (!Number.isSafeInteger(normalizedId) || normalizedId <= 0 || normalizedId > 2147483647
        || !/^[1-9]\d*$/.test(String(id))) {
        throw new ApiError(400, "Invalid student id");
    }
    return normalizedId;
};

const checkStudentId = async (id) => {
    const normalizedId = normalizeStudentId(id);
    const student = await findUserById(normalizedId);
    if (!student || student.role_id !== 3) {
        throw new ApiError(404, "Student not found");
    }
    return normalizedId;
}

const getAllStudents = async (payload) => {
    for (const [key, value] of Object.entries(payload)) {
        if (value !== undefined && typeof value !== "string") throw new ApiError(400, `Invalid ${key} filter`);
    }
    if (payload.roll && (!/^\d+$/.test(payload.roll) || Number(payload.roll) > 2147483647)) {
        throw new ApiError(400, "Invalid roll filter");
    }
    return findAllStudents(payload);
}

const getStudentDetail = async (id) => {
    const normalizedId = await checkStudentId(id);

    const student = await findStudentDetail(normalizedId);
    if (!student) {
        throw new ApiError(404, "Student not found");
    }

    return student;
}

const addNewStudent = async (payload) => {
    const ADD_STUDENT_AND_EMAIL_SEND_SUCCESS = "Student added and verification email sent successfully.";
    const ADD_STUDENT_AND_BUT_EMAIL_SEND_FAIL = "Student added, but failed to send verification email.";
    try {
        validateStudentPayload(payload);
        const normalizedPayload = normalizePayload(payload);
        const result = await addOrUpdateStudent(normalizedPayload);
        checkWriteResult(result);

        try {
            await sendAccountVerificationEmail({ userId: result.userId, userEmail: normalizedPayload.email });
            return { userId: result.userId, message: ADD_STUDENT_AND_EMAIL_SEND_SUCCESS };
        } catch (error) {
            return { userId: result.userId, message: ADD_STUDENT_AND_BUT_EMAIL_SEND_FAIL }
        }
    } catch (error) {
        if (error instanceof ApiError) {
            throw error;
        }
        throw new ApiError(500, "Unable to add student");
    }
}

const updateStudent = async (payload) => {
    validateStudentPayload(payload, { requireIdentity: false });
    const normalizedId = normalizeStudentId(payload.userId);
    const result = await updateStudentById(normalizedId, normalizePayload(payload));
    checkWriteResult(result);

    return { message: result.message };
}

const setStudentStatus = async ({ userId, reviewerId, status }) => {
    if (typeof status !== "boolean") {
        throw new ApiError(400, "Student status must be a boolean");
    }

    const normalizedId = await checkStudentId(userId);

    const affectedRow = await findStudentToSetStatus({ userId: normalizedId, reviewerId, status });
    if (affectedRow <= 0) {
        throw new ApiError(500, "Unable to disable student");
    }

    return { message: "Student status changed successfully" };
}

const deleteStudent = async (id) => {
    const normalizedId = normalizeStudentId(id);
    const affectedRow = await deleteStudentById(normalizedId);
    if (affectedRow <= 0) {
        throw new ApiError(404, "Student not found");
    }

    return { message: "Student deleted successfully" };
};

module.exports = {
    getAllStudents,
    getStudentDetail,
    addNewStudent,
    setStudentStatus,
    updateStudent,
    deleteStudent,
};
