const { ApiError } = require("../../utils");
const { noticeAudienceForRole } = require("./notices-audience");
const {
  getNoticeRecipients,
  getNoticeById,
  addNewNotice,
  updateNoticeById,
  manageNoticeStatus,
  getNotices,
  addNoticeRecipient,
  updateNoticeRecipient,
  getNoticeRecipientList,
  deleteNoticeRecipient,
  getNoticeRecipientById,
  getAllPendingNotices,
  isNoticeRecipientValid,
} = require("./notices-repository");

const fetchNoticeRecipients = async () => {
  const recipients = await getNoticeRecipientList();
  return recipients;
};

const processGetNoticeRecipients = async () => {
  const recipients = await getNoticeRecipients();
  return recipients;
};

const processGetNoticeRecipient = async (id) => {
  const recipient = await getNoticeRecipientById(id);
  if (!recipient) {
    throw new ApiError(404, "Recipient detail not found");
  }

  return recipient;
};

const fetchAllNotices = async (userId) => {
  const notices = await getNotices(userId);
  return notices;
};

const fetchNoticeDetailById = async (id, user) => {
  const noticeDetail = await getNoticeById(id);
  if (!noticeDetail) {
    throw new ApiError(404, "Notice detail not found");
  }
  if (!user || (Number(user.roleId) !== 1 && Number(noticeDetail.authorId) !== Number(user.id)
      && !(await getNotices(user.id)).some((notice) => Number(notice.id) === Number(id)))) {
    throw new ApiError(403, "This notice is not shared with you");
  }
  return noticeDetail;
};

const validateNotice = async (payload) => {
  const { title, description, recipientType, currentUserRole } = payload;
  if (typeof title !== "string" || !title.trim() || title.trim().length > 100
      || typeof description !== "string" || !description.trim() || description.trim().length > 400) {
    throw new ApiError(400, "Notice title must contain 1 to 100 characters and description 1 to 400 characters");
  }
  const status = Number(payload.status);
  if (!Number.isInteger(status) || status < 1 || status > 6 || (currentUserRole !== "admin" && status > 3)) {
    throw new ApiError(400, "Invalid notice status for this action");
  }
  if (!["EV", "SP"].includes(recipientType)) throw new ApiError(400, "Invalid notice recipient type");
  const recipientRole = recipientType === "SP" ? Number(payload.recipientRole) : null;
  if (recipientType === "SP" && ![2, 3].includes(recipientRole)) throw new ApiError(400, "Select a teacher or student recipient role");
  const firstField = recipientType === "SP" && payload.firstField ? String(payload.firstField) : null;
  if (firstField && (firstField.length > 50 || (recipientRole === 2 && (!/^[1-9]\d*$/.test(firstField) || Number(firstField) > 2147483647)))) {
    throw new ApiError(400, "Invalid notice recipient filter");
  }
  if (firstField && !await isNoticeRecipientValid(recipientRole, firstField)) throw new ApiError(400, "Selected notice class or department does not exist");
  return { ...payload, title: title.trim(), description: description.trim(), status, recipientRole, firstField };
};

const addNotice = async (payload) => {
  const affectedRow = await addNewNotice(await validateNotice(payload));
  if (affectedRow <= 0) {
    throw new ApiError(500, "Unable to add new notice");
  }

  return { message: "Notice added successfully" };
};

const updateNotice = async (payload) => {
  const current = await getNoticeById(payload.id);
  if (!current) throw new ApiError(404, "Notice not found");
  if (payload.currentUserRole !== "admin" && Number(current.authorId) !== Number(payload.currentUserId)) {
    throw new ApiError(403, "Only the author or an administrator may edit this notice");
  }
  const affectedRow = await updateNoticeById(await validateNotice({ ...current, ...payload }));
  if (affectedRow <= 0) {
    throw new ApiError(500, "Unable to update notice");
  }

  return { message: "Notice updated successfully" };
};

const processNoticeStatus = async (payload) => {
  const { noticeId, currentUserId, currentUserRole } = payload;
  const status = Number(payload.status);
  if (!Number.isInteger(status) || status < 1 || status > 6) throw new ApiError(400, "Invalid notice status");
  const notice = await getNoticeById(noticeId);
  if (!notice) {
    throw new ApiError(404, "Notice not found");
  }

  const now = new Date();
  const {
    authorId,
    reviewer_id: reviewerIdFromDB,
    reviewed_dt: reviewedDateFromDB,
  } = notice;
  const userCanManageStatus = handleStatusCheck(
    currentUserRole,
    currentUserId,
    authorId,
    status
  );
  if (!userCanManageStatus) {
    throw new ApiError(
      403,
      "Forbidden. You do not have permission to access to this resource."
    );
  }

  const affectedRow = await manageNoticeStatus({
    noticeId,
    status,
    reviewerId: currentUserRole === "admin" ? currentUserId : reviewerIdFromDB,
    reviewDate: currentUserRole === "admin" ? now : reviewedDateFromDB,
  });
  if (affectedRow <= 0) {
    throw new ApiError(500, "Unable to review notice");
  }

  return { message: "Success" };
};

const handleStatusCheck = (
  currentUserRole,
  currentUserId,
  authorId,
  status
) => {
  if (currentUserRole === "admin") {
    return true;
  } else if (authorId === currentUserId) {
    switch (status) {
      case 1:
      case 2:
      case 3:
        return true;
      default:
        return false;
    }
  }

  return false;
};

const validateAudience = (payload) => {
  if (!["number", "string"].includes(typeof payload.roleId) || !/^[1-9]\d*$/.test(String(payload.roleId))
      || Number(payload.roleId) > 2147483647) throw new ApiError(400, "Select a valid recipient role");
  const audience = noticeAudienceForRole(payload.roleId);
  if (payload.primaryDependentSelect !== undefined && payload.primaryDependentSelect !== audience.primaryDependentSelect) {
    throw new ApiError(400, "Choose the fixed department or class audience for this role; SQL queries are not supported");
  }
  return { ...payload, roleId: Number(payload.roleId), ...audience };
};

const processAddNoticeRecipient = async (payload) => {
  const affectedRow = await addNoticeRecipient(validateAudience(payload));
  if (affectedRow <= 0) {
    throw new ApiError(400, "Recipient role does not exist");
  }

  return { message: "Notice Recipient added successfully" };
};

const processUpdateNoticeRecipient = async (payload) => {
  const affectedRow = await updateNoticeRecipient(validateAudience(payload));
  if (affectedRow <= 0) {
    throw new ApiError(500, "Unable to update notice recipient");
  }

  return { message: "Notice Recipient updated successfully" };
};

const processDeleteNoticeRecipient = async (id) => {
  const affectedRow = await deleteNoticeRecipient(id);
  if (affectedRow <= 0) {
    throw new ApiError(500, "Unable to delete notice recipient");
  }

  return { message: "Notice Recipient deleted successfully" };
};

const processGetAllPendingNotices = async () => {
  const notices = await getAllPendingNotices();

  return notices;
};

module.exports = {
  fetchNoticeRecipients,
  fetchAllNotices,
  fetchNoticeDetailById,
  addNotice,
  updateNotice,
  processNoticeStatus,
  processAddNoticeRecipient,
  processUpdateNoticeRecipient,
  processGetNoticeRecipients,
  processDeleteNoticeRecipient,
  processGetNoticeRecipient,
  processGetAllPendingNotices,
};
