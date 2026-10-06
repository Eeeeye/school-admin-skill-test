const { ApiError } = require("../../utils");
const { getClassTeachers, addClassTeacher, getClassTeacherById, updateClassTeacherById, findAllTeachers } = require("./class-teacher-repository")
const { staffId } = require("../staffs/staffs-validation");

const validateAssignment = (payload) => {
    const normalized = { ...payload, teacher: staffId(payload.teacher, "teacher id") };
    for (const key of ["className", "section"]) {
        if (typeof payload[key] !== "string" || !payload[key].trim() || [...payload[key]].length > 50) {
            throw new ApiError(400, `${key} must be between 1 and 50 characters`);
        }
        normalized[key] = payload[key].trim();
    }
    if (payload.id !== undefined) normalized.id = staffId(payload.id, "class teacher assignment id");
    return normalized;
};

const fetchAllClassTeachers = async () => {
    const data = await getClassTeachers();

    return data;
}

const addNewClassTeacher = async (payload) => {
    const affectedRow = await addClassTeacher(validateAssignment(payload));
    if (affectedRow <= 0) {
        throw new ApiError(500, "Unable to add class teacher");
    }

    return { message: "Class teacher added successfully" };
}

const fetchClassTeacherDetailById = async (id) => {
    const classTeacherDetail = await getClassTeacherById(staffId(id, "class teacher assignment id"));
    if (!classTeacherDetail) {
        throw new ApiError(404, "Class teacher detail not found");
    }

    return classTeacherDetail;
}

const updateClassTeacher = async (payload) => {
    const affectedRow = await updateClassTeacherById(validateAssignment(payload));
    if (affectedRow <= 0) {
        throw new ApiError(404, "Class teacher assignment not found");
    }

    return { message: "Class teacher detail updated successfully" };
}

const getAllTeachers = async () => {
    const teachers = await findAllTeachers();
    return teachers;
}

module.exports = {
    fetchAllClassTeachers,
    addNewClassTeacher,
    fetchClassTeacherDetailById,
    updateClassTeacher,
    getAllTeachers
};
