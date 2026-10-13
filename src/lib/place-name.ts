/**
 * Readable names for "My location" from reverse-geocoding results.
 *
 * Outside towns, geocoders name the civil township ("Township of Wayne").
 * Shown as "Township of Wayne, OH" that reads like the village of Wayne, a
 * hundred miles off; Ohio alone has twenty Wayne Townships. So a township
 * becomes "Wayne Township, Noble County, OH", and a lake or reservoir you are
 * on wins over the township ("Senecaville Lake, OH").
 */

/** "Township of Wayne" / "Charter Township of Canton" → "Wayne" + township; "Town of Torrey", "Village of X" → plain names. */
export function civilName(raw: string): { name: string; township: boolean } {
  const s = raw.trim();
  let m = /^(?:charter\s+)?township of\s+(.+)$/i.exec(s);
  if (m) return { name: `${m[1]} Township`, township: true };
  if (/\s(?:charter\s+)?township$/i.test(s)) return { name: s.replace(/\s+charter(?=\s+township$)/i, ""), township: true };
  // New York and New England towns, Pennsylvania boroughs: real places people use by name.
  m = /^(?:town|village|city|borough|municipality) of\s+(.+)$/i.exec(s);
  if (m) return { name: m[1]!, township: false };
  return { name: s, township: false };
}

/** Water and park features worth naming a spot by when it has no town. */
const FEATURE = /\b(lake|reservoir|pond|bay|island|park|forest|beach)\b/i;
/** Collections ("group of lakes", "Finger Lakes region") are too broad. */
const TOO_BROAD = /\b(group|region|chain|system)\b/i;

export interface BdcPlace {
  city?: string;
  locality?: string;
  principalSubdivisionCode?: string;
  localityInfo?: {
    administrative?: { name?: string; adminLevel?: number; order?: number; description?: string }[];
    informative?: { name?: string; order?: number; description?: string }[];
  };
}

/** The name BigDataCloud's answer should be shown as, e.g. "Norman, OK". */
export function placeLabel(r: BdcPlace, fallback = "My location"): string {
  const region = r.principalSubdivisionCode?.split("-")[1];
  const withRegion = (n: string) => (region ? `${n}, ${region}` : n);
  const raw = (r.city || r.locality || "").trim();
  if (!raw) return fallback;
  const { name, township } = civilName(raw);
  if (!township) return withRegion(name);

  // Out of town: the lake or park you're in, the most specific one listed.
  const feature = (r.localityInfo?.informative ?? [])
    .filter((f) => f.name && FEATURE.test(`${f.name} ${f.description ?? ""}`) && !TOO_BROAD.test(`${f.name} ${f.description ?? ""}`))
    .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))[0];
  if (feature?.name) return withRegion(feature.name);

  const county = (r.localityInfo?.administrative ?? []).find((a) => a.adminLevel === 6 && /\bcounty\b|\bparish\b/i.test(`${a.name} ${a.description ?? ""}`))?.name;
  return withRegion(county ? `${name}, ${county}` : name);
}
