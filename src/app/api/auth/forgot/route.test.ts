import { beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({ sent: 0 }));
vi.mock("@/lib/server/mailer", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/mailer")>()),
  mailConfigured: () => true,
  sendMail: async () => {
    mail.sent++;
    // What nodemailer throws when the server turns the recipient down.
    throw Object.assign(new Error("Can't send mail - all recipients were rejected: 550 5.1.1 <bob@example.com>: Recipient address rejected"), {
      code: "EENVELOPE",
      responseCode: 550,
      rejected: ["bob@example.com"],
    });
  },
}));
vi.mock("@/lib/db/client", () => ({ getDb: async () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "u1", username: "bob" }] }) }) }) }) }));
vi.mock("@/lib/auth/reset", () => ({ createResetToken: async () => "t".repeat(32), RESET_MINUTES: 30 }));

const { POST } = await import("./route");

const forgot = (ip: string, body: BodyInit) =>
  POST(
    new Request("https://storm.test/api/auth/forgot", {
      method: "POST",
      headers: { host: "storm.test", origin: "https://storm.test", "x-forwarded-for": ip, "content-type": "application/json" },
      body,
    }),
  );

beforeEach(() => {
  mail.sent = 0;
});

describe("/api/auth/forgot", () => {
  it("logs a failed send without the recipient's address", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await forgot("198.51.100.1", JSON.stringify({ email: "bob@example.com" }));
    expect(res.status).toBe(200);
    expect(mail.sent).toBe(1);
    const line = log.mock.calls.flat().map(String).join(" ");
    expect(line).toMatch(/EENVELOPE 550/);
    expect(line).not.toMatch(/bob@example\.com/);
  });

  it("throttles per IP before reading the body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i < 5; i++) await forgot("198.51.100.2", JSON.stringify({ email: `p${i}@example.com` }));
    expect((await forgot("198.51.100.2", "x".repeat(100_000))).status).toBe(429);
    expect((await forgot("198.51.100.3", "x".repeat(100_000))).status).toBe(413);
  });
});
