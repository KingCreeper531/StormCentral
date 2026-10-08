import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { HttpError } from "../api/http";
import { USER_AGENT, type UpstreamTransport } from "../feeds/upstream";

/**
 * Upstream requests through the platform's HTTP stack instead of the
 * WebView. NWS, SPC, USGS and CelesTrak don't all send CORS headers, and
 * native requests aren't subject to CORS (they can also carry the
 * User-Agent NWS asks for).
 */
export const nativeTransport: UpstreamTransport = async (url, { headers, timeoutMs }) => {
  const res = await CapacitorHttp.get({
    url,
    headers: { ...headers, "User-Agent": USER_AGENT },
    responseType: "json",
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
  });
  if (res.status < 200 || res.status >= 300) throw new HttpError(`Upstream ${res.status} for ${new URL(url).host}`, res.status, url);
  // Android only auto-parses `application/json`; GeoJSON and friends arrive as text.
  return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
};

export const hasNativeHttp = () => Capacitor.isNativePlatform();
