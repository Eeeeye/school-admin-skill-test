const { ApiError } = require("../../utils");
const { academicId, academicName, sectionTokens } = require("../../utils/academic-integrity");
const { getAllClasses, getClassDetail, addNewClass, updateClassDetailById, deleteClassById } = require("./classes-repository")

const fetchAllClasses = async () => {
    const classes = await getAllClasses();

    return classes;
}

const fetchClassDetail = async (id) => {
    const classDetail = await getClassDetail(academicId(id));
    if (!classDetail) {
        throw new ApiError(404, "Class detail not found");
    }

    return classDetail;
}

const addClass = async (payload) => {
    const affectedRow = await addNewClass({ name: academicName(payload.name, "Class"), sections: sectionTokens(payload.sections).join(",") });
    if (affectedRow <= 0) {
        throw new ApiError(500, "Unable to add new class");
    }

    return { message: "Class added successfully" };
}

const updateClassDetail = async (payload) => {
    const affectedRow = await updateClassDetailById({ id: academicId(payload.id), name: academicName(payload.name, "Class"), sections: sectionTokens(payload.sections).join(",") });
    if (affectedRow <= 0) {
        throw new ApiError(404, "Class not found");
    }
    return { message: "Class detail updated successfully" };
}

const deleteClass = async (id) => {
    const affectedRow = await deleteClassById(academicId(id));
    if (affectedRow <= 0) {
        throw new ApiError(404, "Class not found");
    }
    return { message: "Class deleted successfully" };
}

module.exports = {
    fetchAllClasses,
    fetchClassDetail,
    addClass,
    updateClassDetail,
    deleteClass
};
