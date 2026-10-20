import { CapacitorHttp } from "@capacitor/core";
import { MAX_GIS_BYTES } from "../gis";

/** Custom map layers in the Android app: the platform's HTTP stack, which CORS doesn't apply to. */
const TIMEOUT_MS = 15_000;

export async function nativeText(url: string): Promise<string> {
  const res = await CapacitorHttp.get({ url, responseType: "text", connectTimeout: TIMEOUT_MS, readTimeout: TIMEOUT_MS });
  if (res.status < 200 || res.status >= 300) throw new Error(`The link answered ${res.status}`);
  const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  if (text.length > MAX_GIS_BYTES) throw new Error("The layer is too big");
  return text;
}

export async function nativeBlob(url: string): Promise<Blob> {
  // Binary responses arrive base64-encoded.
  const res = await CapacitorHttp.get({ url, responseType: "blob", connectTimeout: TIMEOUT_MS, readTimeout: TIMEOUT_MS });
  if (res.status < 200 || res.status >= 300 || typeof res.data !== "string") throw new Error(`The link answered ${res.status}`);
  const bytes = Uint8Array.from(atob(res.data), (c) => c.charCodeAt(0));
  return new Blob([bytes]);
}
