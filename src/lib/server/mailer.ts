import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outgoing email (password resets). Configure with SMTP_URL, for example a
 * Gmail app password:
 *   smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465
 * MAIL_FROM sets the sender ("StormCentral <you@gmail.com>"); it defaults to
 * the SMTP user. Without SMTP_URL, reset emails are turned off.
 */
let transport: Transporter | null = null;

export const mailConfigured = () => !!process.env.SMTP_URL;

function sender(): string {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  try {
    const user = decodeURIComponent(new URL(process.env.SMTP_URL!).username);
    return `StormCentral <${user}>`;
  } catch {
    return "StormCentral";
  }
}

export async function sendMail(msg: { to: string; subject: string; text: string; html: string }) {
  if (!mailConfigured()) throw new Error("Email isn't configured (SMTP_URL)");
  transport ??= nodemailer.createTransport(process.env.SMTP_URL);
  await transport.sendMail({ from: sender(), ...msg });
}
