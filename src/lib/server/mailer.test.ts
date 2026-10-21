import { describe, expect, it } from "vitest";
import { mailError } from "./mailer";

describe("mail errors for the logs", () => {
  it("keep the codes and the message, but no email addresses", () => {
    const rejected = Object.assign(new Error("Can't send mail - all recipients were rejected: 550 5.1.1 <bob.smith+wx@example.co.uk>: Recipient address rejected"), {
      code: "EENVELOPE",
      responseCode: 550,
      rejected: ["bob.smith+wx@example.co.uk"],
    });
    expect(mailError(rejected)).toBe("EENVELOPE 550 Can't send mail - all recipients were rejected: 550 5.1.1 <<address>>: Recipient address rejected");
    expect(mailError(Object.assign(new Error("Invalid login: 535 Bad credentials"), { code: "EAUTH" }))).toBe("EAUTH Invalid login: 535 Bad credentials");
    expect(mailError("socket hang up")).toBe("socket hang up");
  });
});
