import "server-only";
import { USER_AGENT } from "../feeds/upstream";
import { withTimeout } from "../api/http";

/**
 * Town name for a report's coordinates, e.g. "Moore, OK", from OpenStreetMap's
 * Nominatim (free; its policy asks for a real User-Agent and light use, which
 * one lookup per report is). Null when it can't find one in time.
 */
export async function placeNameAt(lat: number, lon: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" }, signal: withTimeout(undefined, 4000) });
    if (!res.ok) return null;
    const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {};
    const name = a.city || a.town || a.village || a.hamlet || a.municipality || a.county;
    if (!name) return null;
    const region = a["ISO3166-2-lvl4"]?.split("-")[1] ?? a.state;
    return (region ? `${name}, ${region}` : name).slice(0, 80);
  } catch {
    return null;
  }
}
