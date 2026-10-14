/**
 * Fetching the Shorts' source data, or reading it from saved fixtures
 * (SHORTS_FIXTURES), and saving what was fetched (SHORTS_SAVE) to make them.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { KindContext } from "./video";

export const USER_AGENT = "StormCentralBot/1.0 (github.com/KingCreeper531/StormCentral)";

/** `url` as JSON, or the fixture `name` when testing; saved as `name` with SHORTS_SAVE. */
export async function getJson<T>(ctx: KindContext, name: string, url: string): Promise<T> {
  if (ctx.fixtures) return JSON.parse(readFileSync(join(ctx.fixtures, name), "utf8")) as T;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/geo+json, application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const json = (await res.json()) as T;
  saveJson(ctx, name, json);
  return json;
}

export function saveJson(ctx: KindContext, name: string, json: unknown) {
  if (!ctx.save) return;
  mkdirSync(ctx.save, { recursive: true });
  writeFileSync(join(ctx.save, name), JSON.stringify(json));
}

export const readVendor = (file: string) => JSON.parse(readFileSync(join("shorts/vendor", file), "utf8")) as unknown;
