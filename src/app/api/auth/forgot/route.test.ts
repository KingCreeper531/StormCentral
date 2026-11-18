import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({ sent: 0, last: "" }));
vi.mock("@/lib/server/mailer", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/mailer")>()),
  mailConfigured: () => true,
  sendMail: async (msg: { text: string }) => {
    mail.sent++;
    mail.last = msg.text;
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

const forgot = (ip: string, body: BodyInit, host = "storm.test", origin = `https://${host}`) =>
  POST(
    new Request(`${origin}/api/auth/forgot`, {
      method: "POST",
      headers: { host, origin, "x-forwarded-for": ip, "content-type": "application/json" },
      body,
    }),
  );

beforeEach(() => {
  mail.sent = 0;
  mail.last = "";
  vi.stubEnv("PUBLIC_SITE_URL", "https://app.storm.test/");
  vi.stubEnv("ALLOWED_HOST", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
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

  it("links to PUBLIC_SITE_URL, never to the address the request claims to come from", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Host and Origin agree, so sameOrigin() lets it through, but both come from the client.
    const res = await forgot("198.51.100.10", JSON.stringify({ email: "bob@example.com" }), "evil.test");
    expect(res.status).toBe(200);
    expect(mail.last).toContain(`https://app.storm.test/reset-password?token=${"t".repeat(32)}`);
    expect(mail.last).not.toContain("evil.test");
  });

  it("refuses with 503 and sends nothing when PUBLIC_SITE_URL isn't set", async () => {
    vi.stubEnv("PUBLIC_SITE_URL", "");
    const res = await forgot("198.51.100.11", JSON.stringify({ email: "bob@example.com" }), "evil.test");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/PUBLIC_SITE_URL/);
    expect(mail.sent).toBe(0);
  });

  it("refuses with 503 when PUBLIC_SITE_URL isn't an http(s) address", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("PUBLIC_SITE_URL", "javascript:alert(1)");
    expect((await forgot("198.51.100.12", JSON.stringify({ email: "bob@example.com" }))).status).toBe(503);
    expect(mail.sent).toBe(0);
  });

  it("uses the request's own address on the desktop app's loopback server", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("PUBLIC_SITE_URL", "");
    vi.stubEnv("ALLOWED_HOST", "127.0.0.1:47613");
    const res = await forgot("127.0.0.1", JSON.stringify({ email: "bob@example.com" }), "127.0.0.1:47613", "http://127.0.0.1:47613");
    expect(res.status).toBe(200);
    expect(mail.last).toContain("http://127.0.0.1:47613/reset-password?token=");
    // A rebinding page with another Host is still turned away by the pinned host.
    expect((await forgot("127.0.0.1", JSON.stringify({ email: "bob@example.com" }), "evil.test")).status).toBe(403);
  });
});
