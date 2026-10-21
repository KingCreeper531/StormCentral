import { describe, expect, it } from "vitest";
import { compareVersions, httpsUrl, parseRelease } from "./release-info.mjs";

describe("compareVersions", () => {
  it("compares each part as a number", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
    expect(compareVersions("1.0.0", "0.99.99")).toBe(1);
    expect(compareVersions("0.5.1", "0.5.1")).toBe(0);
  });

  it("ignores a v prefix, missing parts and suffixes", () => {
    expect(compareVersions("v0.6.0", "0.6.0")).toBe(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2")).toBe(1);
    expect(compareVersions("0.6.0-beta.1", "0.6.0")).toBe(0);
  });
});

describe("parseRelease", () => {
  const release = {
    tag_name: "v0.6.0",
    html_url: "https://github.com/KingCreeper531/StormCentral/releases/tag/v0.6.0",
    assets: [
      { name: "StormCentral-0.6.0.apk", browser_download_url: "https://github.com/x/y/releases/download/v0.6.0/StormCentral-0.6.0.apk" },
      { name: "StormCentral-Setup-0.6.0.exe", browser_download_url: "https://github.com/x/y/releases/download/v0.6.0/StormCentral-Setup-0.6.0.exe" },
      { name: "StormCentral-0.6.0.dmg", browser_download_url: "https://github.com/x/y/releases/download/v0.6.0/StormCentral-0.6.0.dmg" },
    ],
  };

  it("picks the version and the .dmg", () => {
    expect(parseRelease(release)).toEqual({
      version: "0.6.0",
      downloadUrl: "https://github.com/x/y/releases/download/v0.6.0/StormCentral-0.6.0.dmg",
      releaseUrl: "https://github.com/KingCreeper531/StormCentral/releases/tag/v0.6.0",
    });
  });

  it("falls back to the release page without a .dmg", () => {
    expect(parseRelease({ ...release, assets: release.assets.slice(0, 2) })?.downloadUrl).toBe(release.html_url);
  });

  it("refuses unusable releases and links that aren't https", () => {
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease({ ...release, tag_name: "latest" })).toBeNull();
    expect(parseRelease({ ...release, prerelease: true })).toBeNull();
    expect(parseRelease({ tag_name: "v1.0.0", html_url: "http://example.com/", assets: [{ name: "a.dmg", browser_download_url: "javascript:alert(1)" }] })).toBeNull();
    expect(httpsUrl("https://user:pw@example.com/")).toBeNull();
    expect(httpsUrl("file:///Applications")).toBeNull();
  });
});
