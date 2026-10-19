/**
 * The product text for a spotter warning, laid out like an NWS WarnGen
 * product (bullets, HAZARD / SOURCE / IMPACT, call to action, LAT...LON and
 * TIME...MOT...LOC lines, IBW tags) but headed, and signed, as an unofficial
 * spotter-network product. Generated on the viewer's device in their time
 * zone, from the warning's stored fields, so preview and issued text match.
 */
import { compassPoint } from "../geo";
import { latLonLine, type Ring } from "./geometry";
import { hailName, WARN_PRODUCTS, type WarnBasis, type WarnKind, type WarnThreat } from "./products";

export interface WarningTextInput {
  kind: WarnKind;
  number: number | null;
  polygon: Ring;
  issuedAt: number;
  expiresAt: number;
  revision: number;
  cancelledAt: number | null;
  storm: { lat: number; lon: number; t: number } | null;
  motion: { headingDeg: number; speedKt: number } | null;
  basis: WarnBasis;
  hail: number;
  wind: number;
  tornadoPossible: boolean;
  threat: WarnThreat;
  notes: string | null;
  place: string | null;
  locations: string[];
  issuer: { username: string; displayName: string } | null;
}

const KT_TO_MPH = 1.150779;

export const UNOFFICIAL_BANNER = "UNOFFICIAL - STORMCENTRAL SPOTTER NETWORK\nNOT A NATIONAL WEATHER SERVICE WARNING";

function clock(t: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone }).format(t);
}

function stamp(t: number, timeZone?: string): string {
  const d = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone }).formatToParts(t);
  const part = (type: string) => d.find((p) => p.type === type)?.value ?? "";
  return `${clock(t, timeZone)} ${part("weekday")} ${part("month")} ${part("day")} ${part("year")}`;
}

const zulu = (t: number) => {
  const d = new Date(t);
  return `${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
};

/** "Norman, Moore, Noble and Lexington." */
function list(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const DIRECTION_WORD: Record<string, string> = {
  N: "north",
  NNE: "north-northeast",
  NE: "northeast",
  ENE: "east-northeast",
  E: "east",
  ESE: "east-southeast",
  SE: "southeast",
  SSE: "south-southeast",
  S: "south",
  SSW: "south-southwest",
  SW: "southwest",
  WSW: "west-southwest",
  W: "west",
  WNW: "west-northwest",
  NW: "northwest",
  NNW: "north-northwest",
};

function where(w: WarningTextInput): string {
  if (w.place) return `near ${w.place}`;
  if (!w.storm) return "in the warned area";
  const ns = w.storm.lat >= 0 ? "N" : "S";
  const ew = w.storm.lon >= 0 ? "E" : "W";
  return `near ${Math.abs(w.storm.lat).toFixed(2)}°${ns} ${Math.abs(w.storm.lon).toFixed(2)}°${ew}`;
}

function subject(w: WarningTextInput): { what: string; verb: string } {
  const confirmed = w.basis !== "radar";
  switch (w.kind) {
    case "TOR":
      return { what: confirmed ? "a confirmed tornado" : "a severe thunderstorm capable of producing a tornado", verb: "was located" };
    case "SVR":
      return { what: "a severe thunderstorm", verb: "was located" };
    case "FFW":
      return { what: confirmed ? "flash flooding" : "heavy rain capable of producing flash flooding", verb: confirmed ? "was ongoing" : "was falling" };
    case "SQW":
      return { what: "a snow squall", verb: "was located" };
    case "SPS":
      return { what: "a strong thunderstorm", verb: "was located" };
  }
}

const SOURCE: Record<WarnKind, Record<WarnBasis, string>> = {
  TOR: { radar: "Radar indicated rotation.", spotter: "Spotter network confirmed tornado.", observed: "Tornado observed." },
  SVR: { radar: "Radar indicated.", spotter: "Trained weather spotters.", observed: "Observed." },
  FFW: { radar: "Radar indicated.", spotter: "Weather spotters reported flash flooding.", observed: "Flash flooding observed." },
  SQW: { radar: "Radar indicated.", spotter: "Weather spotters reported whiteout conditions.", observed: "Observed." },
  SPS: { radar: "Radar indicated.", spotter: "Weather spotters.", observed: "Observed." },
};

function hazard(w: WarningTextInput): string {
  const hail = w.hail ? `${hailName(w.hail)} hail` : null;
  const wind = w.wind ? `${w.wind} mph wind gusts` : null;
  switch (w.kind) {
    case "TOR":
      return hail ? `Tornado and ${hail}.` : "Tornado.";
    case "FFW":
      return "Life threatening flash flooding.";
    case "SQW":
      return wind ? `Whiteout conditions in heavy snow with ${wind}.` : "Whiteout conditions with near zero visibility in heavy snow.";
    default: {
      const parts = [wind, hail].filter(Boolean) as string[];
      return parts.length ? `${list(parts)}.`.replace(/^./, (c) => c.toUpperCase()) : "Strong thunderstorm.";
    }
  }
}

function impact(w: WarningTextInput): string {
  switch (w.kind) {
    case "TOR":
      return w.threat === "base"
        ? "Flying debris will be dangerous to those caught without shelter. Mobile homes will be damaged or destroyed. Damage to roofs, windows, and vehicles will occur. Tree damage is likely."
        : "You are in a life-threatening situation. Flying debris may be deadly to those caught without shelter. Mobile homes will be destroyed. Considerable damage to homes, businesses, and vehicles is likely and complete destruction is possible.";
    case "FFW":
      return w.threat === "base"
        ? "Flooding of small creeks and streams, urban areas, highways, streets and underpasses as well as other drainage and low lying areas."
        : "Life threatening flash flooding of creeks and streams, urban areas, highways, streets and underpasses. Water rescues are likely.";
    case "SQW":
      return "Travel will become dangerous with sudden drops in visibility to near zero. Roads may quickly become snow covered and slick.";
    case "SPS": {
      const out: string[] = [];
      if (w.hail) out.push("Minor hail damage to vegetation is possible.");
      if (w.wind) out.push("Gusty winds could knock down tree limbs and blow around unsecured objects.");
      return out.join(" ") || "Brief heavy rain and frequent lightning.";
    }
    case "SVR": {
      const out: string[] = [];
      if (w.wind >= 80 || w.threat === "destructive")
        out.push("Flying debris will be dangerous to those caught without shelter. Mobile homes will be heavily damaged. Expect considerable damage to roofs, windows, and vehicles. Extensive tree damage and power outages are likely.");
      else if (w.wind >= 70) out.push("Expect considerable tree damage. Damage is likely to mobile homes, roofs, and outbuildings.");
      else if (w.wind) out.push("Expect damage to roofs, siding, and trees.");
      if (w.hail >= 1.75) out.push("People and animals outdoors will be injured. Expect hail damage to roofs, siding, windows, and vehicles.");
      else if (w.hail) out.push("Hail damage to vehicles is expected.");
      return out.join(" ");
    }
  }
}

function actions(w: WarningTextInput): string[] {
  switch (w.kind) {
    case "TOR":
      return [
        "TAKE COVER NOW! Move to a basement or an interior room on the lowest floor of a sturdy building. Avoid windows. If you are outdoors, in a mobile home, or in a vehicle, move to the closest substantial shelter and protect yourself from flying debris.",
      ];
    case "SVR":
      return [
        "For your protection move to an interior room on the lowest floor of a building.",
        ...(w.tornadoPossible ? ["Tornadoes can develop quickly from severe thunderstorms. Although a tornado is not immediately likely, this storm is capable of producing one. Be ready to act quickly."] : []),
      ];
    case "FFW":
      return ["Turn around, don't drown when encountering flooded roads. Most flood deaths occur in vehicles. Move to higher ground now."];
    case "SQW":
      return ["Consider avoiding or delaying travel until the snow squall passes. If you're driving, slow down, turn on your headlights, and leave plenty of distance ahead of you."];
    case "SPS":
      return ["If outdoors, consider seeking shelter inside a building."];
  }
}

function headline(w: WarningTextInput): string | null {
  const at = w.place ? ` FOR ${w.place.toUpperCase()}` : "";
  if (w.kind === "TOR" && w.threat === "catastrophic") return `...TORNADO EMERGENCY${at}...`;
  if (w.kind === "FFW" && w.threat === "catastrophic") return `...FLASH FLOOD EMERGENCY${at}...`;
  if (w.kind === "TOR" && w.threat === "considerable") return "...THIS IS A PARTICULARLY DANGEROUS SITUATION. TAKE COVER NOW...";
  if (w.kind === "SVR" && w.threat === "destructive") return `...THIS IS A DESTRUCTIVE STORM${at}...`;
  return null;
}

/** The IBW tag block at the bottom of the product. */
function tags(w: WarningTextInput): string[] {
  const out: string[] = [];
  if (w.kind === "TOR") out.push(`TORNADO...${w.basis === "radar" ? "RADAR INDICATED" : "OBSERVED"}`);
  if (w.kind === "SVR" && w.tornadoPossible) out.push("TORNADO...POSSIBLE");
  if (w.kind === "TOR" && w.threat !== "base") out.push(`TORNADO DAMAGE THREAT...${w.threat.toUpperCase()}`);
  if (w.kind === "SVR" && w.threat !== "base") out.push(`THUNDERSTORM DAMAGE THREAT...${w.threat.toUpperCase()}`);
  if (w.kind === "FFW") out.push(`FLASH FLOOD...${w.basis === "radar" ? "RADAR INDICATED" : "OBSERVED"}`, ...(w.threat !== "base" ? [`FLASH FLOOD DAMAGE THREAT...${w.threat.toUpperCase()}`] : []));
  if (w.kind === "SQW") out.push(`SNOW SQUALL...${w.basis === "radar" ? "RADAR INDICATED" : "OBSERVED"}`);
  if (w.kind !== "FFW" && w.kind !== "SQW" && w.hail) out.push(`MAX HAIL SIZE...${w.hail.toFixed(2)} IN`);
  if ((w.kind === "SVR" || w.kind === "SPS" || w.kind === "SQW") && w.wind) out.push(`MAX WIND GUST...${w.wind} MPH`);
  return out;
}

export function productName(kind: WarnKind, number?: number | null): string {
  return `Spotter ${WARN_PRODUCTS[kind].label}${number ? ` #${number}` : ""}`;
}

export function warningText(w: WarningTextInput, opts: { timeZone?: string } = {}): string {
  const tz = opts.timeZone;
  const name = productName(w.kind, w.number);
  const lines: string[] = [UNOFFICIAL_BANNER, "", name];
  if (w.issuer) lines.push(`Issued by ${w.issuer.displayName} (@${w.issuer.username})`);
  lines.push(stamp(w.issuedAt, tz));

  if (w.cancelledAt) {
    lines.push("", `The ${name} has been cancelled as of ${clock(w.cancelledAt, tz)}.`, "", latLonLine(w.polygon), "", "$$");
    if (w.issuer) lines.push(`@${w.issuer.username}`);
    return lines.join("\n");
  }

  const head = headline(w);
  if (head) lines.push("", head);
  if (w.revision > 0) lines.push("", `* Updated (revision ${w.revision}). Remains in effect until ${clock(w.expiresAt, tz)}.`);
  else lines.push("", `* Until ${clock(w.expiresAt, tz)}.`);

  const s = subject(w);
  const at = clock(w.storm?.t ?? w.issuedAt, tz);
  const movement = w.motion && w.motion.speedKt >= 3 ? `, moving ${DIRECTION_WORD[compassPoint(w.motion.headingDeg)]} at ${Math.round(w.motion.speedKt * KT_TO_MPH)} mph` : ", nearly stationary";
  lines.push("", `* At ${at}, ${s.what} ${s.verb} ${where(w)}${movement}.`);

  lines.push("", `HAZARD...${hazard(w)}`, "", `SOURCE...${SOURCE[w.kind][w.basis]}`, "", `IMPACT...${impact(w)}`);
  if (w.locations.length) lines.push("", "* Locations impacted include...", `  ${list(w.locations)}.`);
  lines.push("", "PRECAUTIONARY/PREPAREDNESS ACTIONS...", "", ...actions(w).flatMap((a, i) => (i ? ["", a] : [a])));
  if (w.notes) lines.push("", `Spotter notes: ${w.notes}`);
  lines.push("", "Always follow official National Weather Service warnings and your local emergency officials.", "", latLonLine(w.polygon));
  if (w.storm) {
    const from = w.motion && w.motion.speedKt >= 3 ? Math.round((w.motion.headingDeg + 180) % 360) : 0;
    const kt = w.motion && w.motion.speedKt >= 3 ? Math.round(w.motion.speedKt) : 0;
    lines.push(`TIME...MOT...LOC ${zulu(w.storm.t)} ${String(from).padStart(3, "0")}DEG ${kt}KT ${Math.round(w.storm.lat * 100)} ${Math.round(Math.abs(w.storm.lon) * 100)}`);
  }
  const t = tags(w);
  if (t.length) lines.push("", ...t);
  lines.push("", "$$");
  if (w.issuer) lines.push(`@${w.issuer.username}`);
  return lines.join("\n");
}
