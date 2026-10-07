const { processDBRequest, ApiError } = require("../../utils");
const { db } = require("../../config");

const getAllStaffs = async (payload) => {
    const { userId, roleId, name, departmentId } = payload;
    let query = `
        SELECT
            t1.id,
            t1.name,
            t1.email,
            t3.name AS role,
            t2.department_id AS "departmentId",
            d.name AS "departmentName",
            t1.is_active AS "systemAccess",
            t1.last_login AS "lastLogin"
        FROM users t1
        LEFT JOIN user_profiles t2 ON t1.id = t2.user_id
        LEFT JOIN roles t3 ON t1.role_id = t3.id
        LEFT JOIN departments d ON d.id = t2.department_id
        WHERE 1=1 AND t1.role_id != 3
    `;
    let queryParams = [];
    if (userId) {
        query += ` AND t1.id = $${queryParams.length + 1}`;
        queryParams.push(userId);
    }
    if (roleId) {
        query += ` AND t1.role_id = $${queryParams.length + 1}`;
        queryParams.push(roleId);
    }
    if (name) {
        query += ` AND t1.name ILIKE $${queryParams.length + 1}`;
        queryParams.push(`%${name}%`);
    }
    if (departmentId) {
        query += ` AND t2.department_id = $${queryParams.length + 1}`;
        queryParams.push(departmentId);
    }

    query += ` ORDER  by t1.id`;

    const { rows } = await processDBRequest({ query, queryParams });
    return rows;
}

const getStaffDetailById = async (id, client) => {
    const query = `
        SELECT
            t1.id,
            t1.name,
            t1.is_active AS "systemAccess",
            t1.role_id AS role,
            t4.name AS "roleName",
            t3.department_id AS "departmentId",
            d.name AS "departmentName",
            t1.email,
            t1.reporter_id AS "reporterId",
            t2.name AS "reporterName",
            t3.gender,
            t3.marital_status AS "maritalStatus",
            TO_CHAR(t3.join_dt, 'YYYY-MM-DD') AS "joinDate",
            t3.qualification,
            t3.experience,
            TO_CHAR(t3.dob, 'YYYY-MM-DD') AS dob,
            t3.phone,
            t3.father_name AS "fatherName",
            t3.mother_name AS "motherName",
            t3.emergency_phone AS "emergencyPhone",
            t3.current_address AS "currentAddress",
            t3.permanent_address AS "permanentAddress"
        FROM users t1
        LEFT JOIN users t2 ON t1.reporter_id = t2.id
        LEFT JOIN user_profiles t3 ON t1.id = t3.user_id
        LEFT JOIN roles t4 ON t1.role_id = t4.id
        LEFT JOIN departments d ON d.id = t3.department_id
        WHERE t1.id = $1 AND t1.role_id != 3
    `;
    const queryParams = [id];
    const { rows } = client ? await client.query(query, queryParams) : await processDBRequest({ query, queryParams });
    return rows[0];
}

const addOrUpdateStaff = async (payload) => {
    const query = `SELECT * FROM staff_add_update($1)`;
    const queryParams = [payload];
    const { rows } = await processDBRequest({ query, queryParams });
    return rows[0];
};

const reviewStaffStatus = async (payload) => {
    const now = new Date();
    const { status, userId, reviewerId, actorRoleId } = payload;
    const query = `
        UPDATE users
        SET
            is_active = $1,
            status_last_reviewed_dt = $3,
            status_last_reviewer_id = $4
        WHERE id = $2
        AND role_id != 3
        AND (role_id != 1 OR $5 = 1)
        AND ($1 = false OR is_email_verified = true)
    `;
    const queryParams = [status, userId, now, reviewerId, Number(actorRoleId) || 0];
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(7183001)");
        await client.query("SELECT id FROM users WHERE id=$1 AND role_id!=3 FOR UPDATE", [userId]);
        const { rowCount } = await client.query(query, queryParams);
        if (rowCount && !status) await client.query("DELETE FROM user_refresh_tokens WHERE user_id=$1", [userId]);
        await client.query("COMMIT");
        return rowCount;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally { client.release(); }
}

const validateStaffReferences = async ({ role, departmentId, reporterId, userId }, client) => {
    if (reporterId && Number(reporterId) === Number(userId)) {
        throw new ApiError(400, "A staff member cannot report to themselves");
    }
    const query = `SELECT
            EXISTS(SELECT 1 FROM roles WHERE id = $1 AND id != 3 AND is_active) AS role_valid,
            ($2::INTEGER IS NULL OR EXISTS(SELECT 1 FROM departments WHERE id = $2)) AS department_valid,
            ($3::INTEGER IS NULL OR EXISTS(SELECT 1 FROM users WHERE id = $3 AND role_id != 3)) AS reporter_valid,
            ($4::INTEGER IS NULL OR $1=2 OR NOT EXISTS(SELECT 1 FROM class_teachers WHERE teacher_id=$4)) AS assignment_valid`;
    const queryParams = [role, departmentId || null, reporterId || null, userId || null];
    const { rows } = client ? await client.query(query, queryParams) : await processDBRequest({ query, queryParams });
    if (!rows[0]?.role_valid) throw new ApiError(400, "Staff role does not exist or is disabled");
    if (!rows[0]?.department_valid) throw new ApiError(400, "Department does not exist");
    if (!rows[0]?.reporter_valid) throw new ApiError(400, "Reporting manager must be a staff member");
    if (!rows[0]?.assignment_valid) throw new ApiError(409, "Reassign this teacher's classes before changing their role");
};

const updateStaffById = async (id, payload, actor) => {
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(7183001)");
        const locked = await client.query("SELECT id FROM users WHERE id=$1 AND role_id!=3 FOR UPDATE", [id]);
        if (!locked.rows.length) throw new ApiError(404, "Staff detail not found");
        const current = await getStaffDetailById(id, client);
        const merged = { ...current, ...payload, userId: id };
        if (Number(actor?.roleId) !== 1 && (Number(current.role) === 1 || Number(merged.role) !== Number(current.role) || merged.email !== current.email)) {
            throw new ApiError(403, "Only administrators may change staff login emails, assign roles or change administrator accounts");
        }
        if (Number(actor?.id) === id && (!merged.systemAccess || Number(merged.role) !== Number(current.role))) {
            throw new ApiError(400, "You cannot disable or change the role of your own account");
        }
        await validateStaffReferences(merged, client);
        const { rows } = await client.query("SELECT * FROM staff_add_update($1)", [merged]);
        if (rows[0].status && (current.role !== merged.role || current.email !== merged.email || merged.systemAccess === false)) {
            await client.query("DELETE FROM user_refresh_tokens WHERE user_id = $1", [id]);
        }
        await client.query(rows[0].status ? "COMMIT" : "ROLLBACK");
        return rows[0];
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, "Unable to update staff");
    } finally {
        client.release();
    }
};

module.exports = {
    getAllStaffs,
    getStaffDetailById,
    addOrUpdateStaff,
    reviewStaffStatus,
    validateStaffReferences,
    updateStaffById,
};
