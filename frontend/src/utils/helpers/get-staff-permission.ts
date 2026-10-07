export const canCreateStaff = (actorRole: string | undefined) => actorRole === 'admin';

export const canEditStaff = (actorRole: string | undefined, targetRole: string | number) =>
  Boolean(actorRole) && (actorRole === 'admin' || ![1, '1', 'admin'].includes(targetRole));

export const canDisableStaff = (
  actorRole: string | undefined,
  actorId: number | undefined,
  targetRole: string | number,
  targetId: number
) => canEditStaff(actorRole, targetRole) && actorId !== targetId;

export const prepareStaffUpdate = <T extends { email: string; role: number }>(
  values: T,
  original: { email: string; role: number },
  actorRole: string | undefined
): T =>
  actorRole === 'admin' ? values : { ...values, email: original.email, role: original.role };
