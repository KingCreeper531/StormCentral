import { describe, expect, it } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";

describe("robots and sitemap", () => {
  it("lists the public pages on the hosted app and keeps private tools out", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain("https://app.stormcentralwx.com/");
    expect(urls).toContain("https://app.stormcentralwx.com/privacy");
    expect(urls.some((u) => /moderation|settings|reset-password|\/api\//.test(u))).toBe(false);
    const r = robots();
    expect(r.sitemap).toBe("https://app.stormcentralwx.com/sitemap.xml");
    expect(Array.isArray(r.rules) ? r.rules[0]?.disallow : r.rules.disallow).toEqual(expect.arrayContaining(["/api/", "/moderation"]));
  });
});
