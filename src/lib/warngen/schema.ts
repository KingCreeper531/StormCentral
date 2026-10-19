/**
 * Spotter WarnGen request validation and the shape the API returns. Shared by
 * the editor (to show problems before sending) and the route handlers (which
 * never trust the client).
 */
import { z } from "zod";
import { closeRing, ringAreaKm2, selfIntersects, type Ring } from "./geometry";
import { HAIL_SIZES, POLYGON_LIMITS, SEVERE_HAIL, SEVERE_WIND, WARN_BASES, WARN_KINDS, WARN_PRODUCTS, WARN_THREATS, WIND_GUSTS_MPH, type WarnBasis, type WarnKind, type WarnThreat } from "./products";

// Place names: printable text only (no control characters or markup).
const placeName = z
  .string()
  .trim()
  .regex(/^[^\u0000-\u001f<>]*$/, "Invalid place name");

const lon = z.number().finite().min(-180).max(180);
const lat = z.number().finite().min(-85).max(85);

const ringSchema = z
  .array(z.tuple([lon, lat]))
  .min(POLYGON_LIMITS.minVertices)
  .max(POLYGON_LIMITS.maxVertices + 1)
  .transform((pts) => closeRing(pts));

const fields = {
  polygon: ringSchema,
  minutes: z.number().int().min(10).max(360),
  storm: z.object({ lat, lon, t: z.number().int().positive() }).nullable(),
  motion: z.object({ headingDeg: z.number().finite().min(0).max(360), speedKt: z.number().finite().min(0).max(120) }).nullable(),
  basis: z.enum(WARN_BASES),
  hail: z.number().refine((v) => v === 0 || HAIL_SIZES.some((h) => h.inches === v), "Pick a hail size from the list"),
  wind: z.number().refine((v) => v === 0 || (WIND_GUSTS_MPH as readonly number[]).includes(v), "Pick a wind gust from the list"),
  tornadoPossible: z.boolean(),
  threat: z.enum(WARN_THREATS),
  notes: z.string().trim().max(300, "Keep the notes under 300 characters").nullable(),
  /** Looked up on the issuer's device (reverse geocoding): the town nearest the storm and towns in the polygon. */
  place: placeName.max(80).nullable(),
  locations: z.array(placeName.min(1).max(60)).max(16),
};

/** Problems with a draft that the schema's types can't express. Empty when it can be issued. */
export function draftProblems(d: { kind: WarnKind; polygon: Ring; minutes: number; hail: number; wind: number; threat: WarnThreat; tornadoPossible: boolean }): string[] {
  const p = WARN_PRODUCTS[d.kind];
  const out: string[] = [];
  const corners = d.polygon.length - 1;
  if (corners < POLYGON_LIMITS.minVertices) out.push("The polygon needs at least three corners");
  else if (corners > POLYGON_LIMITS.maxVertices) out.push(`Use at most ${POLYGON_LIMITS.maxVertices} corners`);
  else if (selfIntersects(d.polygon)) out.push("The polygon's edges cross each other");
  else {
    const area = ringAreaKm2(d.polygon);
    if (area < POLYGON_LIMITS.minAreaKm2) out.push("The polygon is too small");
    if (area > POLYGON_LIMITS.maxAreaKm2) out.push("The polygon is too big for a storm-based warning");
  }
  if (!p.minutes.includes(d.minutes)) out.push("Pick a duration from the list");
  if (!p.threats.includes(d.threat)) out.push("That damage threat isn't available for this product");
  if (d.kind === "SVR" && d.hail < SEVERE_HAIL && d.wind < SEVERE_WIND) out.push("A severe thunderstorm warning needs 1 inch hail or 58 mph wind");
  if (d.kind === "SPS" && (d.hail >= SEVERE_HAIL || d.wind >= SEVERE_WIND)) out.push("Severe hail or wind needs a severe thunderstorm warning");
  if (d.tornadoPossible && !p.tornadoPossible) out.push("Only severe thunderstorm warnings carry the tornado possible tag");
  if (!p.hail && d.hail) out.push("This product doesn't carry a hail size");
  if (!p.wind && d.wind) out.push("This product doesn't carry a wind gust");
  return out;
}

export const issueSchema = z
  .object({ kind: z.enum(WARN_KINDS), ...fields })
  .superRefine((d, ctx) => {
    for (const message of draftProblems(d)) ctx.addIssue({ code: "custom", message });
  });

export type IssueRequest = z.infer<typeof issueSchema>;

/** Update (continue with a new polygon, time or tags) or cancel. The product type can't change. */
export const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("update"), ...fields }),
]);

export type UpdateRequest = z.infer<typeof updateSchema>;

export interface SpotterWarningDto {
  id: string;
  /** Per-year number: "Spotter Tornado Warning #12". */
  number: number;
  kind: WarnKind;
  status: "active" | "cancelled" | "expired";
  polygon: Ring;
  issuedAt: number;
  updatedAt: number;
  expiresAt: number;
  cancelledAt: number | null;
  /** 0 when first issued, +1 for each update. */
  revision: number;
  storm: { lat: number; lon: number; t: number } | null;
  motion: { headingDeg: number; speedKt: number } | null;
  basis: WarnBasis;
  hail: number;
  wind: number;
  tornadoPossible: boolean;
  threat: WarnThreat;
  notes: string | null;
  /** Town nearest the storm when issued ("Moore, OK"). */
  place: string | null;
  /** Towns inside the polygon, biggest first. */
  locations: string[];
  issuer: { username: string; displayName: string; reputation: number; developer: boolean };
  /** The viewer issued it (and so may update or cancel it). */
  mine: boolean;
}

export interface SpotterWarningsResponse {
  warnings: SpotterWarningDto[];
  /** Whether the signed-in viewer may issue warnings, and if not, why. */
  canIssue: boolean;
  reason: string | null;
  /** The viewer is a moderator (may cancel anyone's warning). */
  moderator: boolean;
}
