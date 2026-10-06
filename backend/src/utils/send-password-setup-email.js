const { env, db } = require("../config");
const { generateToken } = require("./jwt-handle");
const { sendMail } = require("./send-email");
const { passwordTokenFingerprint } = require("./password-token");
const { ApiError } = require("./api-error");
const { pwdSetupTemplate } = require("../templates");

const sendPasswordSetupEmail = async ({ userId, userEmail, purpose = "setup" }) => {
  if (!["setup", "reset"].includes(purpose)) throw new ApiError(400, "Invalid password token purpose");
  const { rows } = await db.query("SELECT id, email, password FROM users WHERE id = $1 AND email = $2", [userId, userEmail]);
  if (!rows[0]) throw new ApiError(404, "User does not exist");
  const pwdToken = generateToken(
    { id: userId, purpose, fingerprint: passwordTokenFingerprint(rows[0], purpose) },
    env.PASSWORD_SETUP_TOKEN_SECRET,
    env.PASSWORD_SETUP_TOKEN_TIME_IN_MS
  );
  const link = `${env.UI_URL}/auth/setup-password/${pwdToken}`;
  const mailOptions = {
    from: env.MAIL_FROM_USER,
    to: userEmail,
    subject: "Setup account password",
    html: pwdSetupTemplate(link),
  };
  await sendMail(mailOptions);
};

module.exports = { sendPasswordSetupEmail };
