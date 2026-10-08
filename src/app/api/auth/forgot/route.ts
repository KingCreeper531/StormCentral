import { eq } from "drizzle-orm";
import { createResetToken, RESET_MINUTES } from "@/lib/auth/reset";
import { firstIssue, forgotSchema } from "@/lib/community";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { forbidden, sameOrigin, tooMany } from "@/lib/server/guard";
import { mailConfigured, sendMail } from "@/lib/server/mailer";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Emails a one-time reset link. The answer is the same whether or not the
 * address has an account, so this can't be used to find out who has one.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  if (!mailConfigured()) {
    return Response.json({ error: "Password reset by email isn't set up on this server yet." }, { status: 503, headers: NO_STORE });
  }
  const parsed = forgotSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: firstIssue(parsed.error) }, { status: 400, headers: NO_STORE });
  const { email } = parsed.data;

  const ip = rateLimit(`forgot-ip:${clientIp(req)}`, 5, 15 * 60_000);
  const acct = rateLimit(`forgot-acct:${email}`, 3, 60 * 60_000);
  if (!ip.ok) return tooMany(ip.retryAfterSec);
  if (!acct.ok) return tooMany(acct.retryAfterSec);

  const db = await getDb();
  const [user] = await db.select({ id: users.id, username: users.username }).from(users).where(eq(users.email, email)).limit(1);
  if (user) {
    // sameOrigin() checked that Origin matches this host, so it's safe to link back to it.
    const origin = process.env.PUBLIC_SITE_URL || req.headers.get("origin")!;
    const link = `${origin.replace(/\/$/, "")}/reset-password?token=${await createResetToken(user.id)}`;
    try {
      await sendMail({
        to: email,
        subject: "Reset your StormCentral password",
        text: `Hi ${user.username},\n\nUse this link to choose a new password. It works once, for ${RESET_MINUTES} minutes:\n\n${link}\n\nIf you didn't ask for this, you can ignore this email; your password stays the same.\n`,
        html: `<p>Hi ${user.username},</p><p>Use this link to choose a new password. It works once, for ${RESET_MINUTES} minutes:</p><p><a href="${link}">Reset my password</a></p><p>If you didn't ask for this, you can ignore this email; your password stays the same.</p>`,
      });
    } catch (err) {
      // Not reported to the client: that would reveal the address has an account.
      console.error("[forgot] sending the reset email failed:", err);
    }
  }
  return Response.json({ ok: true }, { headers: NO_STORE });
}
