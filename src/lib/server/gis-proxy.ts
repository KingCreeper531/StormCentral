import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { HttpError } from "../api/http";
import { MAX_GIS_BYTES } from "../gis";

/**
 * Fetches a custom map layer (placefile, KML, GeoJSON) or one of a
 * placefile's icon sheets for the browser: many are plain http, or don't
 * send CORS headers. Only public internet addresses (checked after DNS, and
 * again on every redirect), the default ports, a size cap and a timeout; and
 * the result is only ever served back as plain text or an image, never as a
 * page.
 */

const TEXT = /^(text\/|application\/(json|geo\+json|vnd\.google-earth\.kml\+xml|xml|octet-stream|x-[\w.+-]*)\b)/i;
const IMAGE = /^image\/(png|gif|jpeg|webp)\b/i;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

function v4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

/** Loopback, private, link-local, carrier-grade NAT, documentation, multicast and reserved ranges. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return v4Private(ip);
  if (kind !== 6) return true;
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return v4Private(mapped[1]!);
  return v6 === "::" || v6 === "::1" || /^(fc|fd|fe[89ab]|ff)/.test(v6) || v6.startsWith("64:ff9b:") || v6.startsWith("2001:db8:") || v6.startsWith("::ffff:");
}

/** The URL if it's a public http(s) address on the default port; throws a 400 otherwise. */
export async function checkUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError("That isn't a link", 400, raw);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new HttpError("Only http and https links", 400, raw);
  if (u.port || u.username || u.password) throw new HttpError("Links with a port or a login aren't supported", 400, raw);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.(local|localhost|internal|lan|home\.arpa))$/i.test(host)) throw new HttpError("Only public addresses", 400, raw);
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new HttpError(`Couldn't find ${host}`, 400, raw);
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new HttpError("Only public addresses", 400, raw);
  return u;
}

async function readCapped(res: Response): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_GIS_BYTES) {
      await reader.cancel();
      throw new HttpError(`Bigger than ${MAX_GIS_BYTES / 1024 / 1024} MB`, 413, res.url);
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

export async function fetchGis(raw: string): Promise<{ body: Uint8Array; type: string }> {
  let url = await checkUrl(raw);
  for (let hop = 0; ; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "StormCentral (custom map layers; github.com/KingCreeper531/StormCentral)", Accept: "*/*" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      if (hop >= MAX_REDIRECTS) throw new HttpError("Too many redirects", 502, raw);
      url = await checkUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok) throw new HttpError(`The link answered ${res.status}`, res.status === 404 ? 404 : 502, raw);
    const type = (res.headers.get("content-type") ?? "application/octet-stream").trim();
    if (IMAGE.test(type)) return { body: await readCapped(res), type: type.split(";")[0]!.toLowerCase() };
    if (!TEXT.test(type) && !/^text\/html/i.test(type)) throw new HttpError(`Not a map layer (${type.split(";")[0]})`, 415, raw);
    // HTML too (some servers label everything text/html); it's served back as plain text either way.
    return { body: await readCapped(res), type: "text/plain; charset=utf-8" };
  }
}
