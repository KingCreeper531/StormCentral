/**
 * Community "Spotter Network" — shared (client + server) definitions.
 */
import { z } from "zod";

export const CATEGORIES = {
  observation: { label: "Observation", icon: "cloudy-2-day", color: "#94a3b8" },
  rain: { label: "Heavy rain", icon: "rainy-3", color: "#38bdf8" },
  snow: { label: "Snow / ice", icon: "snowy-2", color: "#e0f2fe" },
  hail: { label: "Hail", icon: "hail", color: "#a5f3fc" },
  wind: { label: "Wind damage", icon: "wind", color: "#fbbf24" },
  tornado: { label: "Tornado / funnel", icon: "tornado", color: "#f43f5e" },
  flooding: { label: "Flooding", icon: "rainy-3", color: "#0f9d8a" },
  lightning: { label: "Lightning", icon: "thunderstorms", color: "#c084fc" },
  fog: { label: "Fog / visibility", icon: "fog", color: "#cbd5e1" },
  sky: { label: "Sky photo", icon: "clear-day", color: "#fde68a" },
} as const;

export type Category = keyof typeof CATEGORIES;
export const CATEGORY_IDS = Object.keys(CATEGORIES) as [Category, ...Category[]];

export const SEVERITY_LABELS = ["Info", "Notable", "Significant", "Dangerous"] as const;

export const TIERS = [
  { min: 500, name: "Legend", color: "#f472b6" },
  { min: 100, name: "Storm Chaser", color: "#f97316" },
  { min: 25, name: "Trusted Spotter", color: "#a78bfa" },
  { min: 5, name: "Spotter", color: "#38bdf8" },
  { min: 0, name: "Observer", color: "#94a3b8" },
] as const;

export function tierFor(reputation: number) {
  return TIERS.find((t) => reputation >= t.min) ?? TIERS[TIERS.length - 1]!;
}

const username = z
  .string()
  .trim()
  .min(3, "Username must be at least 3 characters")
  .max(24, "Username must be at most 24 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "Letters, numbers and underscores only");

export const registerSchema = z.object({
  username,
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")).pipe(z.string().max(254)),
  password: z.string().min(10, "Use at least 10 characters").max(200, "Password is too long"),
  displayName: z.string().trim().max(40).optional(),
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your username or email").max(254),
  password: z.string().min(1, "Enter your password").max(200),
});

export const conditionsSchema = z
  .object({
    tempC: z.number().min(-90).max(65).nullable(),
    code: z.number().int().min(0).max(99).nullable(),
    windMs: z.number().min(0).max(150).nullable(),
    gustMs: z.number().min(0).max(150).nullable(),
    /** Model precipitation this hour (mm) and its probability (%); scored by the forecast scorecard. */
    precipMm: z.number().min(0).max(500).nullable().optional(),
    precipProb: z.number().min(0).max(100).nullable().optional(),
  })
  .strict();

export type ConditionsSnapshot = z.infer<typeof conditionsSchema>;

export const postSchema = z.object({
  body: z.string().trim().min(3, "Say a little more").max(1000, "Keep it under 1000 characters"),
  category: z.enum(CATEGORY_IDS),
  severity: z.coerce.number().int().min(0).max(3),
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  place: z.string().trim().max(80).optional(),
  /** Opt-in: keep ~100 m precision. Default rounds to ~1 km for privacy. */
  precise: z
    .union([z.boolean(), z.enum(["true", "false", "on"])])
    .optional()
    .transform((v) => v === true || v === "true" || v === "on"),
});

export const commentSchema = z.object({
  body: z.string().trim().min(1).max(500),
});

export const MAX_IMAGE_BYTES = 2.5 * 1024 * 1024;

export interface PostAuthor {
  username: string;
  displayName: string;
  avatarHue: number;
  reputation: number;
}

export interface PostDto {
  id: string;
  body: string;
  category: Category;
  severity: number;
  lat: number;
  lon: number;
  place: string | null;
  createdAt: number;
  image: { url: string; width: number | null; height: number | null } | null;
  conditions: ConditionsSnapshot | null;
  author: PostAuthor;
  verifications: number;
  comments: number;
  viewerVerified: boolean;
  isOwn: boolean;
  distanceKm?: number;
}

export interface CommentDto {
  id: string;
  body: string;
  createdAt: number;
  author: Omit<PostAuthor, "reputation">;
  isOwn: boolean;
}

export interface FeedResponse {
  posts: PostDto[];
  nextCursor: string | null;
}

export function firstIssue(err: z.ZodError) {
  return err.issues[0]?.message ?? "Invalid input";
}
