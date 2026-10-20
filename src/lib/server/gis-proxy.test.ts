import { describe, expect, it } from "vitest";
import { checkUrl, isPrivateAddress } from "./gis-proxy";

describe("gis proxy address checks", () => {
  it("refuses private, loopback, link-local and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"])
      expect(isPrivateAddress(ip), ip).toBe(true);
  });

  it("allows public ones", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "129.186.185.33", "2606:4700::6810:1", "::ffff:8.8.8.8"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("checks links before fetching anything", async () => {
    await expect(checkUrl("ftp://example.com/x")).rejects.toThrow(/http/);
    await expect(checkUrl("http://127.0.0.1/x")).rejects.toThrow(/public/);
    await expect(checkUrl("http://[::1]/x")).rejects.toThrow(/public/);
    await expect(checkUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/public/);
    await expect(checkUrl("http://localhost/x")).rejects.toThrow(/public/);
    await expect(checkUrl("https://8.8.8.8:8443/x")).rejects.toThrow(/port/);
    await expect(checkUrl("https://user:pw@8.8.8.8/x")).rejects.toThrow(/login/);
    await expect(checkUrl("not a link")).rejects.toThrow(/link/);
    await expect(checkUrl("https://8.8.8.8/feed.txt")).resolves.toBeInstanceOf(URL);
  });
});
