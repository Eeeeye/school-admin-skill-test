const { processDBRequest, ApiError } = require("../../utils");
const { db } = require("../../config");
const { resolveSections } = require("../../utils/academic-integrity");

const getClassTeachers = async () => {
    const query = `
        SELECT
            t1.id,
            t1.class_name AS class,
            t1.section_name AS section,
            t2.name as "teacher"
        FROM class_teachers t1
        LEFT JOIN users t2 ON t1.teacher_id =  t2.id
        ORDER BY t1.class_name
    `;
    const { rows } = await processDBRequest({ query });
    return rows;
}

const syncStudentReporters = async (client, className, section) => {
    await client.query(`UPDATE users u SET reporter_id = COALESCE(
        (SELECT teacher_id FROM class_teachers WHERE class_name=$1 AND section_name=$2 ORDER BY id LIMIT 1),
        (SELECT id FROM users WHERE role_id=1 ORDER BY id LIMIT 1)
    ), updated_dt=NOW()
    FROM user_profiles p WHERE u.id=p.user_id AND u.role_id=3 AND p.class_name=$1 AND p.section_name=$2`, [className, section]);
};

const saveClassTeacher = async ({ id, className, section, teacher }) => {
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        // Serialize assignment changes, including moves between class/section
        // pairs, so duplicate checks and student reporting-line changes agree.
        await client.query("SELECT pg_advisory_xact_lock(7183001)");
        let previous;
        if (id !== undefined) {
            const result = await client.query("SELECT class_name, section_name FROM class_teachers WHERE id=$1 FOR UPDATE", [id]);
            previous = result.rows[0];
            if (!previous) throw new ApiError(404, "Class teacher assignment not found");
        }
        const classResult = await client.query("SELECT sections FROM classes WHERE name=$1 FOR SHARE", [className]);
        const allowedSections = classResult.rows[0] ? await resolveSections(client, classResult.rows[0].sections || "") : [];
        if (!allowedSections.includes(section)) {
            throw new ApiError(400, "Section does not belong to the selected class");
        }
        const teacherResult = await client.query("SELECT id FROM users WHERE id=$1 AND role_id=2 FOR SHARE", [teacher]);
        if (!teacherResult.rows.length) throw new ApiError(400, "Selected staff member must have the teacher role");
        const duplicate = await client.query(`SELECT id FROM class_teachers
            WHERE class_name=$1 AND section_name=$2 AND ($3::INTEGER IS NULL OR id<>$3)`, [className, section, id || null]);
        if (duplicate.rows.length) throw new ApiError(409, "This class and section already have a teacher; edit the existing assignment");
        const result = id === undefined
            ? await client.query("INSERT INTO class_teachers (class_name, section_name, teacher_id) VALUES($1,$2,$3)", [className, section, teacher])
            : await client.query("UPDATE class_teachers SET class_name=$1, section_name=$2, teacher_id=$3 WHERE id=$4", [className, section, teacher, id]);
        if (previous && (previous.class_name !== className || previous.section_name !== section)) {
            await syncStudentReporters(client, previous.class_name, previous.section_name);
        }
        await syncStudentReporters(client, className, section);
        await client.query("COMMIT");
        return result.rowCount;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        if (error instanceof ApiError) throw error;
        if (error.code === "23503") throw new ApiError(400, "Invalid class, section or teacher");
        if (error.code === "23505") throw new ApiError(409, "This class and section already have a teacher");
        throw new ApiError(500, "Unable to save class teacher assignment");
    } finally {
        client.release();
    }
};

const addClassTeacher = async (payload) => saveClassTeacher(payload);

const getClassTeacherById = async (id) => {
    const query = `
        SELECT
            id,
            class_name AS class,
            section_name AS section,
            teacher_id AS teacher
        FROM class_teachers WHERE id = $1`;
    const { rows } = await processDBRequest({ query, queryParams: [id] });
    return rows[0];
}

const updateClassTeacherById = async (payload) => saveClassTeacher(payload);

const findAllTeachers = async () => {
    const teacherRole = 2;
    const query = `
        SELECT id, name
        FROM users
        WHERE role_id = $1
    `;
    const queryParams = [teacherRole];
    const { rows } = await processDBRequest({ query, queryParams });
    return rows;
};

module.exports = {
    getClassTeachers,
    addClassTeacher,
    getClassTeacherById,
    updateClassTeacherById,
    findAllTeachers,
};
