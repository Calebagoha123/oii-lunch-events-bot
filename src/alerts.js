const nodemailer = require("nodemailer");

/**
 * Emails an operational alert. Silently no-ops when mail isn't configured, so
 * a missing ALERT_EMAIL never takes the bot down.
 *
 * ALERT_EMAIL should be a shared alias, not one person's inbox — see the README handover section.
 */
async function sendAlert(subject, body) {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  const to = process.env.ALERT_EMAIL;
  if (!user || !pass || !to) return false;

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
    await transporter.sendMail({
      from: user,
      to,
      subject: `[lunch-bot] ${subject}`,
      text: body,
    });
    console.log("Alert email sent.");
    return true;
  } catch (err) {
    console.error("Failed to send alert email:", err.message);
    return false;
  }
}

module.exports = { sendAlert };
