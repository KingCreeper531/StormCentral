import type { LookupAddress } from "node:dns";
import { describe, expect, it, vi } from "vitest";

// "rebind.test" answers like a DNS-rebinding name: public for the first lookup, then the cloud metadata address.
const dns = vi.hoisted(() => ({ answers: {} as Record<string, string[]> }));
vi.mock("node:dns", async (orig) => {
  const real = await orig<typeof import("node:dns")>();
  const lookup = (host: string, _opts: unknown, cb: (err: Error | null, a: LookupAddress[]) => void) => {
    const a = dns.answers[host];
    if (!a) return cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" }), []);
    cb(null, a.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
  };
  return { ...real, default: { ...real, lookup }, lookup };
});
vi.mock("node:dns/promises", async (orig) => {
  const real = await orig<typeof import("node:dns/promises")>();
  const lookup = async (host: string) => (host === "rebind.test" ? [{ address: "93.184.215.14", family: 4 }] : real.lookup(host, { all: true }));
  return { ...real, default: { ...real, lookup }, lookup };
});

const { checkUrl, fetchGis, isPrivateAddress, publicLookup } = await import("./gis-proxy");

const resolve = (host: string, all: boolean) =>
  new Promise<{ err: NodeJS.ErrnoException | null; address: string | LookupAddress[]; family?: number }>((done) =>
    publicLookup(host, { all }, (err, address, family) => done({ err, address, family })),
  );

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

  it("checks the addresses again when connecting", async () => {
    dns.answers = { "feeds.test": ["129.186.185.33", "2606:4700::6810:1"], "mixed.test": ["129.186.185.33", "10.0.0.5"], "meta.test": ["169.254.169.254"] };
    expect(await resolve("feeds.test", true)).toMatchObject({ err: null, address: [{ address: "129.186.185.33", family: 4 }, { address: "2606:4700::6810:1", family: 6 }] });
    expect(await resolve("feeds.test", false)).toEqual({ err: null, address: "129.186.185.33", family: 4 });
    expect((await resolve("mixed.test", true)).err?.message).toMatch(/public/);
    expect((await resolve("meta.test", false)).err?.message).toMatch(/public/);
    expect((await resolve("nowhere.test", true)).err?.code).toBe("ENOTFOUND");
  });

  it("doesn't connect to a name that turns private after the check (DNS rebinding)", async () => {
    dns.answers = { "rebind.test": ["169.254.169.254"] };
    await expect(checkUrl("http://rebind.test/latest/meta-data")).resolves.toBeInstanceOf(URL);
    await expect(fetchGis("http://rebind.test/latest/meta-data")).rejects.toMatchObject({ status: 400, message: "Only public addresses" });
    dns.answers = { "rebind.test": ["127.0.0.1"] };
    await expect(fetchGis("https://rebind.test/feed.txt")).rejects.toMatchObject({ status: 400 });
  });
});
