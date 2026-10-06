const { z } = require("zod");

const LoginSchema = z.object({
    body: z.object({
        username: z.string().trim().min(1, "Username is required").max(100),
        password: z.string().min(6, "Password must be at least 6 characters long").max(128)
    })
});

module.exports = {
    PasswordSetupSchema: z.object({
        body: z.object({
            token: z.string().min(1, "Token is required"),
            username: z.string().email("A valid email is required"),
            password: z.string().min(6, "Password must be at least 6 characters long").max(128),
        }),
    }),
    UserIdSchema: z.object({
        body: z.object({
            userId: z.union([z.number(), z.string().regex(/^[1-9]\d*$/)])
                .pipe(z.coerce.number().int().positive("User ID must be a positive integer").max(2147483647)),
        }),
    }),
    LoginSchema
};
