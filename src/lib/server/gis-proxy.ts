import "server-only";
import { lookup as dnsLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { pipeline, type Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { HttpError } from "../api/http";
import { MAX_GIS_BYTES } from "../gis";

/**
 * Fetches a custom map layer (placefile, KML, GeoJSON) or one of a
 * placefile's icon sheets for the browser: many are plain http, or don't
 * send CORS headers. Only public internet addresses (checked after DNS, again
 * as the connection is made, and on every redirect), the default ports, a
 * size cap and a timeout; and the result is only ever served back as plain
 * text or an image, never as a page.
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

/**
 * dns.lookup for the connection itself. checkUrl's answer isn't reused, so a
 * name that resolves to a public address for the check and to a private one
 * a moment later (DNS rebinding) is refused here instead of connected to.
 */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) return callback(new HttpError("Only public addresses", 400, hostname), []);
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

/** One request, on a connection of its own: never a pooled one that was opened without publicLookup. */
function get(url: URL): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        lookup: publicLookup,
        agent: false,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "StormCentral (custom map layers; github.com/KingCreeper531/StormCentral)", Accept: "*/*", "Accept-Encoding": "gzip, br" },
      },
      resolve,
    );
    req.on("error", reject);
    req.end();
  });
}

/** The body, decompressed, up to MAX_GIS_BYTES of it. */
async function readCapped(res: IncomingMessage, raw: string): Promise<Uint8Array> {
  const encoding = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
  const unzip = /^(x-)?gzip$/.test(encoding) ? createGunzip() : encoding === "br" ? createBrotliDecompress() : encoding === "deflate" ? createInflate() : null;
  const body: Readable = unzip ? pipeline(res, unzip, () => {}) : res;
  const parts: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of body as AsyncIterable<Buffer>) {
      size += chunk.byteLength;
      if (size > MAX_GIS_BYTES) throw new HttpError(`Bigger than ${MAX_GIS_BYTES / 1024 / 1024} MB`, 413, raw);
      parts.push(chunk);
    }
  } finally {
    res.destroy();
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
    const res = await get(url);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.destroy();
      if (hop >= MAX_REDIRECTS) throw new HttpError("Too many redirects", 502, raw);
      url = await checkUrl(new URL(res.headers.location, url).toString());
      continue;
    }
    if (status < 200 || status >= 300) {
      res.destroy();
      throw new HttpError(`The link answered ${status}`, status === 404 ? 404 : 502, raw);
    }
    const type = (res.headers["content-type"] ?? "application/octet-stream").trim();
    if (IMAGE.test(type)) return { body: await readCapped(res, raw), type: type.split(";")[0]!.toLowerCase() };
    if (!TEXT.test(type) && !/^text\/html/i.test(type)) {
      res.destroy();
      throw new HttpError(`Not a map layer (${type.split(";")[0]})`, 415, raw);
    }
    // HTML too (some servers label everything text/html); it's served back as plain text either way.
    return { body: await readCapped(res, raw), type: "text/plain; charset=utf-8" };
  }
}
