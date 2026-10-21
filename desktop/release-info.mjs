// @ts-check
/**
 * Reads GitHub's latest release for the Mac app's update notice
 * (release-check.mjs). No Electron imports, so it's unit-tested on its own
 * (release-info.test.mjs).
 */

/** @typedef {{ version: string, downloadUrl: string, releaseUrl: string }} ReleaseInfo */

/** "0.6.0", "v0.6.0", "1.2.3-beta.1" (the suffix is ignored when comparing). */
const VERSION = /^\d+(\.\d+)*([-+][0-9A-Za-z.-]+)?$/;

/**
 * Compares dotted versions part by part as numbers, so 0.10.0 is newer than
 * 0.9.0. A leading "v" and a prerelease or build suffix are ignored, and
 * missing parts count as 0 (1.2 is 1.2.0).
 * @param {string} a
 * @param {string} b
 * @returns {-1 | 0 | 1} 1 when a is newer than b
 */
export function compareVersions(a, b) {
  /** @param {string} v */
  const parts = (v) =>
    (v.trim().replace(/^v/i, "").split(/[-+]/)[0] ?? "")
      .split(".")
      .map((n) => (/^\d+$/.test(n) ? Number(n) : 0));
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * The value as an https URL, or null: the app only ever opens https links
 * from a release in the browser.
 * @param {unknown} value
 */
export function httpsUrl(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * The version and Mac download of a release, from the GitHub API's JSON
 * (`/repos/{owner}/{repo}/releases/latest`). The download is
 * StormCentral-<version>.dmg, else any .dmg, else the release page. Null when
 * the release isn't usable (a draft or prerelease, no version, no https link).
 * @param {unknown} release
 * @returns {ReleaseInfo | null}
 */
export function parseRelease(release) {
  if (!release || typeof release !== "object" || Array.isArray(release)) return null;
  const rel = /** @type {Record<string, unknown>} */ (release);
  if (rel.draft === true || rel.prerelease === true) return null;
  const version = typeof rel.tag_name === "string" ? rel.tag_name.trim().replace(/^v/i, "") : "";
  if (!VERSION.test(version)) return null;
  const releaseUrl = httpsUrl(rel.html_url);
  /** @type {{ name: string, browser_download_url?: unknown }[]} */
  const assets = (Array.isArray(rel.assets) ? rel.assets : []).filter(
    (a) => a !== null && typeof a === "object" && typeof (/** @type {{ name?: unknown }} */ (a).name) === "string",
  );
  const dmg = assets.find((a) => a.name === `StormCentral-${version}.dmg`) ?? assets.find((a) => a.name.toLowerCase().endsWith(".dmg"));
  const downloadUrl = httpsUrl(dmg?.browser_download_url) ?? releaseUrl;
  if (!downloadUrl) return null;
  return { version, downloadUrl, releaseUrl: releaseUrl ?? downloadUrl };
}
