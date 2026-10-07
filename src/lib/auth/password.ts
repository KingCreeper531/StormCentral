/**
 * Password hashing with Node's built-in scrypt (memory-hard; no native deps).
 * Parameters follow OWASP's scrypt guidance (N=2^15, r=8, p=3 ≈ 32 MiB).
 * Encoded as `scrypt$N$r$p$salt$hash` so parameters can be raised later
 * without invalidating existing hashes.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (pw: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw.normalize("NFKC"), salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

const PARAMS = { N: 2 ** 15, r: 8, p: 3 };
const KEYLEN = 32;
const maxmem = (N: number, r: number, p: number) => 128 * N * r * p + 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { ...PARAMS, maxmem: maxmem(PARAMS.N, PARAMS.r, PARAMS.p) });
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = encoded.split("$");
  if (alg !== "scrypt" || !saltB64 || !hashB64) return false;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (![N, R, P].every((x) => Number.isInteger(x) && x > 0)) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const key = await scrypt(password, Buffer.from(saltB64, "base64url"), expected.length, {
    N,
    r: R,
    p: P,
    maxmem: maxmem(N, R, P),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

let dummy: Promise<string> | null = null;

/**
 * Burns the same CPU as a real verification. Called when the user doesn't
 * exist so response timing can't be used to enumerate accounts.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummy ??= hashPassword("stormcentral-timing-equaliser");
  await verifyPassword(password, await dummy);
  return false;
}
