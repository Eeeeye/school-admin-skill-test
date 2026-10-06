const { Resend } = require("resend");
const { env } = require("../config");
const { ApiError } = require("./api-error");

// Email is optional for local development. Keep the API bootable without a
// provider key; callers still receive a controlled failure when they attempt
// to send a message.
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
const sendMail = async (mailOptions) => {
  if (!resend) {
    throw new ApiError(503, "Email service is not configured");
  }
  const { error } = await resend.emails.send(mailOptions);
  if (error) {
    throw new ApiError(500, "Unable to send email");
  }
};

module.exports = {
  sendMail,
};
