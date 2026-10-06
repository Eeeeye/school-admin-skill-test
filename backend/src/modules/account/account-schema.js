const { z } = require("zod");

const PasswordChangeSchema = z.object({
  body: z.object({
    oldPassword: z.string().min(6, "Old password must be at least 6 characters long").max(128),
    newPassword: z.string().min(6, "New password must be at least 6 characters long").max(128),
  }),
});

module.exports = { PasswordChangeSchema };
