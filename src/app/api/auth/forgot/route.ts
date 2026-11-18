import { eq } from "drizzle-orm";
import { createResetToken, RESET_MINUTES } from "@/lib/auth/reset";
import { firstIssue, forgotSchema } from "@/lib/community";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { readJson } from "@/lib/server/body";
import { forbidden, sameOrigin, tooMany } from "@/lib/server/guard";
import { mailConfigured, mailError, sendMail } from "@/lib/server/mailer";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The site address reset links point to: PUBLIC_SITE_URL. Only the desktop
 * app's loopback server (ALLOWED_HOST set, which sameOrigin() pins the Host to)
 * may use the request's own Origin instead; anywhere else Origin and Host
 * come from the client, so a link built from them could point at another site.
 */
function resetLinkOrigin(req: Request): string | null {
  const site = process.env.PUBLIC_SITE_URL?.trim();
  if (site) {
    try {
      const url = new URL(site);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin + url.pathname.replace(/\/+$/, "");
    } catch {}
    console.error("[forgot] PUBLIC_SITE_URL isn't an http(s) address");
    return null;
  }
  if (!process.env.ALLOWED_HOST) return null;
  try {
    return new URL(req.headers.get("origin") ?? "").origin;
  } catch {
    return null;
  }
}

/**
 * Emails a one-time reset link. The answer is the same whether or not the
 * address has an account, so this can't be used to find out who has one.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  if (!mailConfigured()) {
    return Response.json({ error: "Password reset by email isn't set up on this server yet." }, { status: 503, headers: NO_STORE });
  }
  // Checked before anything else so the answer doesn't depend on whether the address has an account.
  const origin = resetLinkOrigin(req);
  if (!origin) {
    return Response.json({ error: "Password reset by email isn't set up on this server yet (PUBLIC_SITE_URL)." }, { status: 503, headers: NO_STORE });
  }
  // Per IP before the body is read; a refused IP never reaches the per-address counters.
  const ip = await rateLimit(`forgot-ip:${clientIp(req)}`, 5, 15 * 60_000);
  if (!ip.ok) return tooMany(ip.retryAfterSec);
  const body = await readJson(req);
  if (body instanceof Response) return body;
  const parsed = forgotSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: firstIssue(parsed.error) }, { status: 400, headers: NO_STORE });
  const { email } = parsed.data;
  const acct = await rateLimit(`forgot-acct:${email}`, 3, 60 * 60_000);
  if (!acct.ok) return tooMany(acct.retryAfterSec);

  const db = await getDb();
  const [user] = await db.select({ id: users.id, username: users.username }).from(users).where(eq(users.email, email)).limit(1);
  if (user) {
    const link = `${origin}/reset-password?token=${await createResetToken(user.id)}`;
    try {
      await sendMail({
        to: email,
        subject: "Reset your Storm Central password",
        text: `Hi ${user.username},\n\nUse this link to choose a new password. It works once, for ${RESET_MINUTES} minutes:\n\n${link}\n\nIf you didn't ask for this, you can ignore this email; your password stays the same.\n`,
        html: `<p>Hi ${user.username},</p><p>Use this link to choose a new password. It works once, for ${RESET_MINUTES} minutes:</p><p><a href="${link}">Reset my password</a></p><p>If you didn't ask for this, you can ignore this email; your password stays the same.</p>`,
      });
    } catch (err) {
      // Not reported to the client: that would reveal the address has an account.
      console.error("[forgot] sending the reset email failed:", mailError(err));
    }
  }
  return Response.json({ ok: true }, { headers: NO_STORE });
}
