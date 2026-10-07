export const canEditNotice = (
  authorId: number,
  statusId: number,
  userId: number | undefined,
  role: string | undefined
) => statusId !== 6 && (role === 'admin' || authorId === userId);

export const canDeleteNotice = (
  authorId: number,
  statusId: number,
  userId: number | undefined,
  role: string | undefined
) => statusId !== 6 && (role === 'admin' || (authorId === userId && statusId !== 3));

export const canReviewNotice = (statusId: number, role: string | undefined) =>
  role === 'admin' && (statusId === 2 || statusId === 3);
