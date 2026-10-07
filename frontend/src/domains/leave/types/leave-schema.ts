import { parseISO } from 'date-fns';
import { z } from 'zod';

export const NewLeavePolicySchema = z.object({
  name: z.string().trim().min(1, 'Policy name is required')
});

export const PolicyUsersSchema = z.object({
  users: z.array(z.number()).min(1, 'You must select at least one user')
});

export const BaseLeaveSchema = z.object({
  policy: z.number().min(1, 'Policy is required'),
  note: z.string().trim().min(1, 'Note is required')
});

const requiredDate = z
  .union([z.string().transform((value) => (value ? parseISO(value) : null)), z.null(), z.date()])
  .refine(
    (value) => value instanceof Date && !Number.isNaN(value.getTime()),
    'A valid date is required'
  );

export const LeaveRequestFormSchema = BaseLeaveSchema.extend({
  from: requiredDate,
  to: requiredDate
}).refine((data) => !data.from || !data.to || data.from <= data.to, {
  message: "The 'from' date must be before or equal to 'to' date.",
  path: ['to']
});

export const LeaveRequestApiSchema = BaseLeaveSchema.extend({
  from: z.string(),
  to: z.string()
});
