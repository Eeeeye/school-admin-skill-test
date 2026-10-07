const { ApiError } = require("../../utils");
const { academicId, academicName } = require("../../utils/academic-integrity");
const { getAllSections, getSectionById, updateSectionById, deleteSectionById, addNewSection } = require("./section-repository")

const processGetAllSections = async () => {
    const sections = await getAllSections();

    return sections;
}

const processAddNewSection = async (name) => {
    const affectedRow = await addNewSection(academicName(name, "Section"));
    if (affectedRow <= 0) {
        throw new ApiError(500, "Unable to add new section");
    }

    return { message: "Section added successfully" };
}

const processGetSectionById = async (id) => {
    const section = await getSectionById(academicId(id));
    if (!section) {
        throw new ApiError(404, "Section does not exist");
    }

    return section;
}

const processUpdateSectionById = async (payload) => {
    const affectedRow = await updateSectionById({ id: academicId(payload.id), name: academicName(payload.name, "Section") });
    if (affectedRow <= 0) {
        throw new ApiError(404, "Section not found");
    }

    return { message: "Section updated successfully" };
}

const processDeleteSectionById = async (id) => {
    const affectedRow = await deleteSectionById(academicId(id));
    if (affectedRow <= 0) {
        throw new ApiError(404, "Section not found");
    }

    return { message: "Section deleted successfully" };
}
module.exports = {
    processGetAllSections,
    processGetSectionById,
    processUpdateSectionById,
    processDeleteSectionById,
    processAddNewSection
};
