const { db } = require("../../config");
const { processDBRequest } = require("../../utils");

const getRoleId = async (roleName) => {
    const query = "SELECT id FROM roles WHERE name ILIKE $1";
    const queryParams = [roleName];
    const { rows } = await processDBRequest({ query, queryParams });
    return rows[0].id;
}

const findAllStudents = async (payload) => {
    const { name, className, section, roll } = payload;
    let query = `
        SELECT
            t1.id,
            t1.name,
            t1.email,
            t1.last_login AS "lastLogin",
            t1.is_active AS "systemAccess"
        FROM users t1
        LEFT JOIN user_profiles t3 ON t1.id = t3.user_id
        LEFT JOIN classes t4 ON t3.class_name = t4.name
        WHERE t1.role_id = 3`;
    let queryParams = [];
    if (name) {
        query += ` AND t1.name = $${queryParams.length + 1}`;
        queryParams.push(name);
    }
    if (className) {
        // The UI sends the class id while API clients may send the class name.
        // Accept both representations at the boundary.
        query += ` AND (t3.class_name = $${queryParams.length + 1} OR t4.id::TEXT = $${queryParams.length + 1})`;
        queryParams.push(className);
    }
    if (section) {
        query += ` AND t3.section_name = $${queryParams.length + 1}`;
        queryParams.push(section);
    }
    if (roll) {
        query += ` AND t3.roll = $${queryParams.length + 1}`;
        queryParams.push(roll);
    }

    query += ' ORDER BY t1.id';

    const { rows } = await processDBRequest({ query, queryParams });
    return rows;
}

const addOrUpdateStudent = async (payload) => {
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        if (!await validStudentPlacement(payload, client)) {
            await client.query("ROLLBACK");
            return { status: false, message: "Invalid class or section" };
        }
        const { rows } = await client.query("SELECT * FROM student_add_update($1)", [payload]);
        await client.query(rows[0].status ? "COMMIT" : "ROLLBACK");
        return rows[0];
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

const validStudentPlacement = async (payload, client) => {
    if (!payload.class) return !payload.section;
    const { rows: classes } = await client.query("SELECT sections FROM classes WHERE name = $1 FOR SHARE", [payload.class]);
    if (!classes[0]) return false;
    if (!payload.section) return true;
    const { rows: sections } = await client.query("SELECT id, name FROM sections WHERE name = $1 FOR SHARE", [payload.section]);
    if (!sections[0]) return false;
    // Original data uses names; newer class forms can persist section IDs.
    const allowed = String(classes[0].sections || "").split(",").map((value) => value.trim());
    return allowed.includes(sections[0].name) || allowed.includes(String(sections[0].id));
};

const findStudentDetail = async (id, client = db) => {
    const query = `
        SELECT
            u.id,
            u.name,
            u.email,
            u.is_active AS "systemAccess",
            p.phone,
            p.gender,
            p.dob,
            p.class_name AS "class",
            p.section_name AS "section",
            p.roll,
            p.father_name AS "fatherName",
            p.father_phone AS "fatherPhone",
            p.mother_name AS "motherName",
            p.mother_phone AS "motherPhone",
            p.guardian_name AS "guardianName",
            p.guardian_phone AS "guardianPhone",
            p.relation_of_guardian as "relationOfGuardian",
            p.current_address AS "currentAddress",
            p.permanent_address AS "permanentAddress",
            p.admission_dt AS "admissionDate",
            r.name as "reporterName"
        FROM users u
        LEFT JOIN user_profiles p ON u.id = p.user_id
        LEFT JOIN users r ON u.reporter_id = r.id
        WHERE u.id = $1 AND u.role_id = 3`;
    const queryParams = [id];
    const { rows } = await client.query(query, queryParams);
    return rows[0];
}

// Serialize partial updates so parallel requests cannot overwrite omitted fields.
const updateStudentById = async (id, payload) => {
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        const { rowCount } = await client.query(
            "SELECT id FROM users WHERE id = $1 AND role_id = 3 FOR UPDATE", [id]
        );
        if (!rowCount) {
            await client.query("ROLLBACK");
            return { status: false, message: "Student not found" };
        }
        const current = await findStudentDetail(id, client);
        for (const field of ["dob", "admissionDate"]) {
            if (current[field] instanceof Date) current[field] = current[field].toISOString().slice(0, 10);
        }
        const merged = { ...current, ...payload, userId: id };
        // Explicitly clearing the class also clears an omitted old section.
        // A section explicitly supplied without a class remains a client error.
        if (Object.hasOwn(payload, "class") && !payload.class && !Object.hasOwn(payload, "section")) merged.section = null;
        if (!await validStudentPlacement(merged, client)) {
            await client.query("ROLLBACK");
            return { status: false, message: "Invalid class or section" };
        }
        const { rows } = await client.query("SELECT * FROM student_add_update($1)", [merged]);
        await client.query(rows[0].status ? "COMMIT" : "ROLLBACK");
        return rows[0];
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
};

const findStudentToSetStatus = async ({ userId, reviewerId, status }) => {
    const now = new Date();
    const query = `
        UPDATE users
        SET
            is_active = $1,
            status_last_reviewed_dt = $2,
            status_last_reviewer_id = $3
        WHERE id = $4 AND role_id = 3
    `;
    const queryParams = [status, now, reviewerId, userId];
    const { rowCount } = await processDBRequest({ query, queryParams });
    return rowCount
}

const deleteStudentById = async (id) => {
    const client = await db.connect();

    try {
        await client.query("BEGIN");

        const { rowCount } = await client.query(
            "SELECT 1 FROM users WHERE id = $1 AND role_id = 3 FOR UPDATE",
            [id]
        );

        if (rowCount === 0) {
            await client.query("ROLLBACK");
            return 0;
        }

        // Preserve unrelated records while removing references to this user.
        await client.query("UPDATE users SET status_last_reviewer_id = NULL WHERE status_last_reviewer_id = $1", [id]);
        await client.query("UPDATE users SET reporter_id = NULL WHERE reporter_id = $1", [id]);
        await client.query("UPDATE user_leaves SET approver_id = NULL WHERE approver_id = $1", [id]);
        await client.query("UPDATE class_teachers SET teacher_id = NULL WHERE teacher_id = $1", [id]);
        await client.query("UPDATE notices SET author_id = NULL WHERE author_id = $1", [id]);
        await client.query("UPDATE notices SET reviewer_id = NULL WHERE reviewer_id = $1", [id]);

        await client.query("DELETE FROM user_profiles WHERE user_id = $1", [id]);
        await client.query("DELETE FROM user_leaves WHERE user_id = $1", [id]);
        await client.query("DELETE FROM user_leave_policy WHERE user_id = $1", [id]);
        const result = await client.query("DELETE FROM users WHERE id = $1 AND role_id = 3", [id]);

        await client.query("COMMIT");
        return result.rowCount;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
};

const findStudentToUpdate = async (paylaod) => {
    const { basicDetails: { name, email }, id } = paylaod;
    const currentDate = new Date();
    const query = `
        UPDATE users
        SET name = $1, email = $2, updated_dt = $3
        WHERE id = $4;
    `;
    const queryParams = [name, email, currentDate, id];
    const { rows } = await processDBRequest({ query, queryParams });
    return rows;
}

module.exports = {
    getRoleId,
    findAllStudents,
    addOrUpdateStudent,
    updateStudentById,
    findStudentDetail,
    findStudentToSetStatus,
    deleteStudentById,
    findStudentToUpdate
};
