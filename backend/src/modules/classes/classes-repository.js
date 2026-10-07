const { processDBRequest } = require("../../utils");
const { ApiError } = require("../../utils/api-error");
const { academicTransaction, resolveSections } = require("../../utils/academic-integrity");

const getAllClasses = async () => {
    const query = "SELECT * FROM classes ORDER BY name";
    const { rows } = await processDBRequest({ query });
    return rows;
}

const getClassDetail = async (id) => {
    const query = "SELECT * from classes WHERE id = $1";
    const { rows } = await processDBRequest({ query, queryParams: [id] });
    return rows[0];
}

const addNewClass = async (payload) => {
    return academicTransaction(async (client) => {
        const sections = await resolveSections(client, payload.sections);
        return (await client.query("INSERT INTO classes (name, sections) VALUES ($1, $2)", [payload.name, sections.join(",")])).rowCount;
    });
}

const updateClassDetailById = async (payload) => {
    const { id, name, sections } = payload;
    return academicTransaction(async (client) => {
        const { rows } = await client.query("SELECT name FROM classes WHERE id=$1 FOR UPDATE", [id]);
        if (!rows[0]) return 0;
        const selected = await resolveSections(client, sections);
        const assigned = await client.query(`SELECT section_name FROM user_profiles WHERE class_name=$1 AND section_name IS NOT NULL
            UNION SELECT section_name FROM class_teachers WHERE class_name=$1 AND section_name IS NOT NULL`, [rows[0].name]);
        if (assigned.rows.some((row) => !selected.includes(row.section_name))) {
            throw new ApiError(409, "Reassign students and class teachers before removing their section from this class");
        }
        const result = await client.query("UPDATE classes SET name=$1, sections=$2 WHERE id=$3", [name, selected.join(","), id]);
        await client.query("UPDATE notices SET recipient_first_field=$1 WHERE recipient_type='SP' AND recipient_role_id=3 AND recipient_first_field=$2", [name, rows[0].name]);
        return result.rowCount;
    });
}

const deleteClassById = async (id) => {
    return academicTransaction(async (client) => {
        const { rows } = await client.query("SELECT name FROM classes WHERE id=$1 FOR UPDATE", [id]);
        if (!rows[0]) return 0;
        const name = rows[0].name;
        // Preserve student records, clearing the entire placement and its reviewer.
        await client.query(`UPDATE users SET reporter_id=(SELECT id FROM users WHERE role_id=1 AND is_active ORDER BY id LIMIT 1)
            WHERE role_id=3 AND id IN (SELECT user_id FROM user_profiles WHERE class_name=$1)`, [name]);
        await client.query("UPDATE user_profiles SET section_name=NULL WHERE class_name=$1", [name]);
        await client.query("DELETE FROM class_teachers WHERE class_name=$1", [name]);
        return (await client.query("DELETE FROM classes WHERE id=$1", [id])).rowCount;
    });
}

module.exports = {
    getAllClasses,
    getClassDetail,
    addNewClass,
    updateClassDetailById,
    deleteClassById
};
