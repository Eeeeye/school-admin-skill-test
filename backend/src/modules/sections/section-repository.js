const { processDBRequest } = require("../../utils");
const { academicTransaction, sectionTokens } = require("../../utils/academic-integrity");

const referencedSection = (sections, token) => sections.find((row) => row.name === token)
    || sections.find((row) => String(row.id) === token);

const getAllSections = async () => {
    const query = "SELECT * FROM sections";
    const { rows } = await processDBRequest({ query });
    return rows;
}

const addNewSection = async (name) => {
    const query = "INSERT INTO sections(name) VALUES ($1)";
    const queryParams = [name];
    return academicTransaction(async (client) => {
        if (/^\d+$/.test(name)) {
            // A newly introduced numeric name must not reinterpret existing
            // legacy ID tokens. Resolve their meaning before adding that name.
            const classes = await client.query("SELECT id, sections FROM classes ORDER BY id FOR UPDATE");
            const sections = await client.query("SELECT id, name FROM sections ORDER BY id FOR UPDATE");
            for (const schoolClass of classes.rows) {
                const tokens = sectionTokens(schoolClass.sections || "");
                const names = [...new Set(tokens.map((token) => referencedSection(sections.rows, token)?.name || token))];
                if (names.join(",") !== tokens.join(",")) {
                    await client.query("UPDATE classes SET sections=$1 WHERE id=$2", [names.join(","), schoolClass.id]);
                }
            }
        }
        return (await client.query(query, queryParams)).rowCount;
    });
}

const getSectionById = async (id) => {
    const query = "SELECT * FROM sections WHERE id = $1";
    const queryParams = [id];
    const { rows } = await processDBRequest({ query, queryParams });
    return rows[0];
}

const mutateSection = async (id, name) => academicTransaction(async (client) => {
    // Match student placement's lock order: class first, then section.
    const classes = await client.query("SELECT id, sections FROM classes ORDER BY id FOR UPDATE");
    const { rows } = await client.query("SELECT id, name FROM sections ORDER BY id FOR UPDATE");
    const current = rows.find((row) => row.id === id);
    if (!current) return 0;
    const oldName = current.name;
    for (const schoolClass of classes.rows) {
        const oldTokens = sectionTokens(schoolClass.sections || "");
        const next = oldTokens.flatMap((token) => {
            // Numeric section names win over legacy IDs, just as when saving a
            // class. Renaming ID 7 must not rename another section named "7".
            const referenced = referencedSection(rows, token);
            if (referenced?.id === id) return name ? [name] : [];
            return [name && /^\d+$/.test(name) && referenced ? referenced.name : token];
        });
        if (next.join(",") !== oldTokens.join(",")) {
            await client.query("UPDATE classes SET sections=$1 WHERE id=$2", [[...new Set(next)].join(","), schoolClass.id]);
        }
    }
    if (name) return (await client.query("UPDATE sections SET name=$1 WHERE id=$2", [name, id])).rowCount;
    await client.query(`UPDATE users SET reporter_id=(SELECT id FROM users WHERE role_id=1 AND is_active ORDER BY id LIMIT 1)
        WHERE role_id=3 AND id IN (SELECT user_id FROM user_profiles WHERE section_name=$1)`, [oldName]);
    await client.query("DELETE FROM class_teachers WHERE section_name=$1", [oldName]);
    return (await client.query("DELETE FROM sections WHERE id=$1", [id])).rowCount;
});

const updateSectionById = ({ id, name }) => mutateSection(id, name);
const deleteSectionById = (id) => mutateSection(id);

module.exports = {
    getAllSections,
    getSectionById,
    updateSectionById,
    deleteSectionById,
    addNewSection
};
