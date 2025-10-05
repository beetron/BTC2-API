import nodemailer from "nodemailer";

let transporter = null;

const createTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: 587,
      secure: false, // false for STARTTLS on port 587
      requireTLS: true, // Force STARTTLS upgrade
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false, // Accept self-signed certificates
      },
    });
  }
  return transporter;
};

export const sendEmail = async ({ to, subject, text }) => {
  try {
    const emailTransporter = createTransporter();
    await emailTransporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      text,
    });
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
};
