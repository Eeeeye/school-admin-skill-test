const { processDBRequest, ApiError } = require("../../utils");
const { db } = require("../../config");

const doesRoleNameExist = async (name) => {
    const query = "SELECT 1 FROM roles WHERE name ILIKE $1 LIMIT 1";
    const queryParams = [name];
    const { rowCount } = await processDBRequest({ query, queryParams });
    return rowCount;
};

const doesRoleIdExist = async (id) => {
    const query = "SELECT 1 FROM roles WHERE id = $1";
    const queryParams = [id];
    const { rowCount } = await processDBRequest({ query, queryParams });
    return rowCount;
};

const insertRole = async (name) => {
    const query = "INSERT INTO roles(name) VALUES($1)";
    const queryParams = [name];
    const { rowCount } = await processDBRequest({ query, queryParams });
    return rowCount;
}

const getRoles = async () => {
    const query = `
        SELECT
            t1.id,
            t1.name,
            COUNT(t2.id) AS "usersAssociated",
            t1.is_active AS status
        FROM roles t1
        LEFT JOIN users t2 ON t1.id = t2.role_id
        GROUP BY (t1.id, t1.name)
        ORDER BY t1.id, t1.name, t1.is_active
    `;
    const { rows } = await processDBRequest({ query });
    return rows;
}

const getRoleById = async (id) => {
    const query = "SELECT * FROM roles WHERE id= $1";
    const queryParams = [id];
    const { rows } = await processDBRequest({ query, queryParams });
    return rows[0];
}

const updateRoleById = async (id, name) => {
    const query = "UPDATE roles SET name = $1 WHERE id = $2 AND is_editable = true";
    const queryParams = [name, id];
    const { rowCount } = await processDBRequest({ query, queryParams });
    return rowCount;
}

const enableOrDisableRoleStatusByRoleId = async (id, status) => {
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(7183001)");
        await client.query("SELECT id FROM users WHERE role_id=$1 ORDER BY id FOR UPDATE", [id]);
        const { rowCount } = await client.query("UPDATE roles SET is_active=$1 WHERE id=$2 AND is_editable=true", [status, id]);
        if (rowCount && !status) await client.query(`DELETE FROM user_refresh_tokens rt USING users u
            WHERE rt.user_id=u.id AND u.role_id=$1`, [id]);
        await client.query("COMMIT");
        return rowCount;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally { client.release(); }
}

const getAccessControlByIds = async (ids, client) => {
    const query = `
        SELECT id, type
        FROM access_controls
        WHERE id = ANY($1::int[])
    `;
    const { rows } = await client.query(query, [ids]);
    return rows;
}

const insertPermissionForRoleId = async ({ roleId, accessControls }, client) => {
    const ids = accessControls.map(({ id }) => id);
    const types = accessControls.map(({ type }) => type);
    const query = `
        INSERT INTO permissions(role_id, access_control_id, type)
        SELECT $1, access_control_id, type
        FROM unnest($2::int[], $3::text[]) AS selected(access_control_id, type)
        ON CONFLICT (role_id, access_control_id) DO NOTHING
    `;
    await client.query(query, [roleId, ids, types]);
}
const deletePermissionForRoleId = async (roleId, client) => {
    const query = `DELETE FROM permissions WHERE role_id = $1`;
    await client.query(query, [roleId]);
}

const getPermissionsById = async (roleId) => {
    const isUserAdmin = Number(roleId) === 1 ? true : false;
    const query = isUserAdmin
        ? `SELECT id, name FROM access_controls`
        : `
            SELECT
                ac.id,
                ac.name
            FROM permissions p
            JOIN access_controls ac ON p.access_control_id = ac.id
            WHERE p.role_id = $1
    `;
    const queryParams = isUserAdmin ? [] : [roleId];
    const { rows } = await processDBRequest({ query, queryParams });
    return rows;
}

const getUsersByRoleId = async (id) => {
    const query = `
        SELECT
            id,
            name,
            last_login AS "lastLogin"
        FROM users
        WHERE role_id = $1
    `;
    const queryParams = [id];
    const { rows } = await processDBRequest({ query, queryParams });
    return rows;
}

const switchUserRole = async (userId, newRoleId) => {
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(7183001)");
        const { rows } = await client.query("SELECT role_id FROM users WHERE id=$1 FOR UPDATE", [userId]);
        if (!rows[0]) throw new ApiError(404, "User not found");
        if (rows[0].role_id === 3 || newRoleId === 3) throw new ApiError(400, "Student roles must be managed through student records");
        const assigned = await client.query("SELECT 1 FROM class_teachers WHERE teacher_id=$1", [userId]);
        if (newRoleId !== 2 && assigned.rows.length) throw new ApiError(409, "Reassign this teacher's classes before changing their role");
        const result = await client.query(`UPDATE users SET role_id=$1, updated_dt=NOW()
            WHERE id=$2 AND EXISTS (SELECT 1 FROM roles WHERE id=$1 AND is_active)`, [newRoleId, userId]);
        if (rows[0].role_id !== newRoleId) await client.query("DELETE FROM user_refresh_tokens WHERE user_id=$1", [userId]);
        await client.query("COMMIT");
        return result.rowCount;
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally { client.release(); }
}

const checkPermission = async (roleId, apiPath, apiMethod) => {
    const query = `
        SELECT 1
        FROM permissions p
        JOIN access_controls ac ON p.access_control_id = ac.id
        WHERE p.role_id = $1 AND ac.path = $2 AND ac.method = $3
    `;
    const queryParams = [roleId, apiPath, apiMethod];
    const { rowCount } = await processDBRequest({ query, queryParams });
    return rowCount;
}

module.exports = {
    insertRole,
    getRoles,
    doesRoleNameExist,
    doesRoleIdExist,
    updateRoleById,
    enableOrDisableRoleStatusByRoleId,
    getRoleById,
    getPermissionsById,
    getUsersByRoleId,
    getAccessControlByIds,
    insertPermissionForRoleId,
    switchUserRole,
    checkPermission,
    deletePermissionForRoleId
};
