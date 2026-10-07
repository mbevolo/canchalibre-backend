const axios = require("axios");

async function sendMail(to, subject, html) {
  try {
    const response = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: { name: "CanchaLibre", email: process.env.SMTP_FROM },
        to: [{ email: to }],
        subject,
        htmlContent: html
      },
      {
        headers: {
          "accept": "application/json",
          "api-key": process.env.BREVO_API_KEY,
          "content-type": "application/json"
        }
      }
    );

  } catch (err) {
    console.error("❌ Error enviando email vía Brevo API:");
    throw err;
  }
}

module.exports = { sendMail };
