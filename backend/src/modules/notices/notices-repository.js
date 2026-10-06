const { db } = require("../../config");
const { processDBRequest } = require("../../utils");
const { noticeAudienceForRole } = require("./notices-audience");

const getNotices = async (userId) => {
  const query = `SELECT * FROM get_notices($1)`;
  const queryParams = [userId];
  const { rows } = await processDBRequest({ query, queryParams });
  return rows;
};

const getAllPendingNotices = async () => {
  const query = `
    SELECT
        t1.id,
        t1.title,
        t1.description,
        t1.author_id AS "authorId",
        t1.created_dt AS "createdDate",
        t1.updated_dt AS "updatedDate",
        t2.name AS author,
        t4.name AS "reviewerName",
        t1.reviewed_dt AS "reviewedDate",
        t3.alias AS "status",
        t1.status AS "statusId",
        NULL AS "whoHasAccess"
    FROM notices t1
    LEFT JOIN users t2 ON t1.author_id = t2.id
    LEFT JOIN notice_status t3 ON t1.status = t3.id
    LEFT JOIN users t4 ON t1.reviewer_id = t4.id
    WHERE t1.status IN (2, 3)
  `;
  const { rows } = await processDBRequest({ query });
  return rows;
};

const getNoticeById = async (id) => {
  const query = `
        SELECT
            t1.id,
            t1.title,
            t1.description,
            t1.status,
            t1.author_id AS "authorId",
            t1.reviewer_id,
            t1.reviewed_dt,
            t1.created_dt AS "createdDate",
            t1.updated_dt AS "updatedDate",
            t1.recipient_type AS "recipientType",
            t1.recipient_role_id AS "recipientRole",
            t1.recipient_first_field AS "firstField",
            t2.name AS author
        FROM notices t1
        LEFT JOIN users t2 ON t1.author_id = t2.id
        WHERE t1.id = $1
    `;
  const queryParams = [id];
  const { rows } = await processDBRequest({ query, queryParams });
  return rows[0];
};

const addNewNotice = async (payload) => {
  const now = new Date();
  const {
    title,
    status,
    description,
    recipientType,
    recipientRole,
    firstField: recipientFirstField,
    authorId,
  } = payload;
  const query = `
        INSERT INTO notices
        (title, description, status, recipient_type, recipient_role_id, recipient_first_field, created_dt, author_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;
  const queryParams = [
    title,
    description,
    status,
    recipientType,
    recipientRole,
    recipientFirstField,
    now,
    authorId,
  ];
  const { rowCount } = await processDBRequest({ query, queryParams });
  return rowCount;
};

const updateNoticeById = async (payload) => {
  const now = new Date();
  const {
    id,
    title,
    status,
    description,
    recipientType,
    recipientRole,
    firstField,
    currentUserId,
    currentUserRole,
  } = payload;
  const query = `
        UPDATE notices
        SET
            title = $1,
            description = $2,
            status = $3,
            recipient_type = $4,
            recipient_role_id = $5,
            recipient_first_field = $6,
            updated_dt = $7
        WHERE id = $8 AND (author_id = $9 OR $10)
    `;
  const queryParams = [
    title,
    description,
    status,
    recipientType,
    recipientRole,
    firstField,
    now,
    id,
    currentUserId,
    currentUserRole === "admin",
  ];
  const { rowCount } = await processDBRequest({ query, queryParams });
  return rowCount;
};

const getNoticeRecipientList = async () => {
  try {
    const noticeRecipientTypesQuery = "SELECT * FROM notice_recipient_types";
    const { rows: noticeRecipientTypes } = await db.query(
      noticeRecipientTypesQuery
    );

    if (noticeRecipientTypes.length <= 0) {
      return [];
    }

    const recipientPromises = noticeRecipientTypes.map(
      async (recipientType) => {
        const { id, role_id } = recipientType;

        const selectRoleQuery = `SELECT name FROM roles WHERE id = $1`;
        const { rows } = await db.query(selectRoleQuery, [role_id]);
        const recipient = { id, roleId: role_id, name: rows[0]?.name || "Unknown role" };

        // Never execute a query supplied by configuration, even legacy rows.
        const query = role_id === 2 ? "SELECT id::text AS id, name FROM departments ORDER BY name"
          : role_id === 3 ? "SELECT name AS id, name FROM classes ORDER BY name" : null;
        const { rows: dependentRows } = query ? await db.query(query) : { rows: [] };

        recipient.primaryDependents = {
          name: noticeAudienceForRole(role_id).primaryDependentName,
          list: dependentRows,
        };

        return recipient;
      }
    );

    const result = await Promise.all(recipientPromises);
    return result;
  } catch (error) {
    throw error;
  }
};

const getNoticeRecipients = async () => {
  const query = `
        SELECT
            t1.id,
            t1.role_id AS "roleId",
            t1.primary_dependent_name AS "primaryDependentName",
            t1.primary_dependent_select AS "primaryDependentSelect",
            t2.name as "roleName"
        FROM notice_recipient_types t1
        JOIN roles t2 ON t1.role_id = t2.id
    `;
  const { rows } = await processDBRequest({ query });
  return rows.map((row) => ({ ...row, ...noticeAudienceForRole(row.roleId) }));
};

const addNoticeRecipient = async (payload) => {
  const { roleId, primaryDependentName, primaryDependentSelect } = payload;
  const query = `
        INSERT INTO notice_recipient_types
            (role_id, primary_dependent_name, primary_dependent_select)
        SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM roles WHERE id = $1)
    `;
  const queryParams = [roleId, primaryDependentName, primaryDependentSelect];
  const { rowCount } = await processDBRequest({ query, queryParams });
  return rowCount;
};

const updateNoticeRecipient = async (payload) => {
  const { id, roleId, primaryDependentName, primaryDependentSelect } = payload;
  const query = `
        UPDATE notice_recipient_types
        SET
            primary_dependent_name = $1,
            primary_dependent_select = $2
        WHERE id = $3 and role_id = $4
    `;
  const queryParams = [
    primaryDependentName,
    primaryDependentSelect,
    id,
    roleId,
  ];
  const { rowCount } = await processDBRequest({ query, queryParams });
  return rowCount;
};

const deleteNoticeRecipient = async (id) => {
  const query = `DELETE FROM notice_recipient_types WHERE id = $1`;
  const queryParams = [id];
  const { rowCount } = await processDBRequest({ query, queryParams });
  return rowCount;
};

const getNoticeRecipientById = async (id) => {
  const query = `
        SELECT
            id,
            role_id AS "roleId",
            primary_dependent_name AS "primaryDependentName",
            primary_dependent_select AS "primaryDependentSelect"
        FROM notice_recipient_types WHERE id = $1
    `;
  const queryParams = [id];
  const { rows } = await processDBRequest({ query, queryParams });
  return rows[0] ? { ...rows[0], ...noticeAudienceForRole(rows[0].roleId) } : undefined;
};

const isNoticeRecipientValid = async (roleId, field) => {
  const query = roleId === 2 ? "SELECT 1 FROM departments WHERE id = $1"
    : "SELECT 1 FROM classes WHERE name = $1";
  const { rowCount } = await processDBRequest({ query, queryParams: [field] });
  return rowCount > 0;
};

const manageNoticeStatus = async (payload) => {
  const { status, reviewerId, noticeId, reviewDate } = payload;
  const query = `
        UPDATE notices
        SET
            status = $1,
            reviewed_dt = $2,
            reviewer_id = $3
        WHERE id = $4
    `;
  const queryParams = [status, reviewDate, reviewerId, noticeId];
  const { rowCount } = await processDBRequest({ query, queryParams });
  return rowCount;
};

module.exports = {
  getNoticeById,
  addNewNotice,
  updateNoticeById,
  getNoticeRecipientList,
  getNoticeRecipients,
  manageNoticeStatus,
  getNotices,
  addNoticeRecipient,
  updateNoticeRecipient,
  deleteNoticeRecipient,
  getNoticeRecipientById,
  getAllPendingNotices,
  isNoticeRecipientValid,
};
