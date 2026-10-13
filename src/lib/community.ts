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

/** Shown instead of the rank for the people who build StormCentral. */
export const DEVELOPER_BADGE = { name: "Developer", color: "#5b9cf6" } as const;

/** The badge next to someone's name: Developer, or their rank. */
export function badgeFor(author: { reputation: number; developer?: boolean }) {
  return author.developer ? DEVELOPER_BADGE : tierFor(author.reputation);
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

const newPassword = z.string().min(10, "Use at least 10 characters").max(200, "Password is too long");

export const forgotSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email")).pipe(z.string().max(254)),
});

export const resetSchema = z.object({
  token: z.string().min(16).max(128),
  password: newPassword,
});

export const changePasswordSchema = z.object({
  current: z.string().min(1, "Enter your current password").max(200),
  password: newPassword,
});

export const profileSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a display name").max(40, "Keep it under 40 characters"),
  bio: z.string().trim().max(300, "Keep your bio under 300 characters").optional(),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Enter your password").max(200),
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

/* ---------- Blocking and moderation ---------- */

/** Why someone flags a report, comment or account for the moderators. */
export const FLAG_REASONS = {
  spam: "Spam or advertising",
  harassment: "Harassment or bullying",
  hate: "Hateful or abusive content",
  sexual: "Sexual or graphic content",
  violence: "Threats or violence",
  misleading: "False or misleading weather report",
  privacy: "Shares someone's private information",
  other: "Something else",
} as const;

export type FlagReason = keyof typeof FLAG_REASONS;
export const FLAG_REASON_IDS = Object.keys(FLAG_REASONS) as [FlagReason, ...FlagReason[]];
export const FLAG_TARGETS = ["post", "comment", "user"] as const;
export type FlagTarget = (typeof FLAG_TARGETS)[number];

/** Open flags from this many different people hide a report or comment until a moderator looks at it. */
export const AUTO_HIDE_FLAGS = 3;

export const flagSchema = z.object({
  type: z.enum(FLAG_TARGETS),
  id: z.string().trim().min(1).max(64),
  reason: z.enum(FLAG_REASON_IDS),
  details: z.string().trim().max(500, "Keep it under 500 characters").optional(),
});

export const blockSchema = z.object({ username });

/** Suspension lengths a moderator can choose, in days; 0 means permanent. */
export const SUSPENSION_DAYS = [1, 7, 30, 0] as const;
/** Stored for permanent suspensions (year 9999). */
export const PERMANENT_SUSPENSION = 253_402_300_799_000;

export const moderationActionSchema = z.discriminatedUnion("action", [
  /** Close the flags and show the content again. */
  z.object({ action: z.literal("keep"), type: z.enum(FLAG_TARGETS), id: z.string().min(1).max(64) }),
  /** Delete the report or comment and close its flags. */
  z.object({ action: z.literal("remove"), type: z.enum(["post", "comment"]), id: z.string().min(1).max(64) }),
  z.object({ action: z.literal("suspend"), username, days: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(0)]) }),
  z.object({ action: z.literal("unsuspend"), username }),
]);
export type ModerationAction = z.infer<typeof moderationActionSchema>;

/** "Suspended until Oct 20, 2026" / "Suspended" for permanent suspensions. */
export function suspensionText(until: number) {
  if (until >= PERMANENT_SUSPENSION) return "This account has been suspended.";
  return `This account is suspended until ${new Date(until).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" })}.`;
}

export interface BlockedUserDto {
  username: string;
  displayName: string;
  avatarHue: number;
  avatarUrl: string | null;
  blockedAt: number;
}

/** One flagged item in the moderation queue, with every open flag against it. */
export interface QueueItemDto {
  type: FlagTarget;
  id: string;
  /** Hidden from others while it waits for review. */
  hidden: boolean;
  firstFlaggedAt: number;
  flags: { reason: FlagReason; details: string | null; reporter: string; createdAt: number }[];
  author: { username: string; displayName: string; avatarHue: number; avatarUrl: string | null; suspendedUntil: number | null } | null;
  /** The flagged text: a report's or comment's body, or an account's bio. */
  body: string | null;
  image: string | null;
  createdAt: number | null;
  /** For a comment: the report it belongs to. */
  postId: string | null;
}

/** Placeholder names that say nothing about where a report is ("My location"). */
export const isGenericPlace = (p: string | null | undefined) => !p || /^(my|current|your)( current)? location$/i.test(p.trim());

/** Public URL of a profile picture stored in `media`. */
export const avatarUrl = (mediaId: string | null | undefined) => (mediaId ? `/api/media/${mediaId}` : null);

export interface PostAuthor {
  username: string;
  displayName: string;
  avatarHue: number;
  avatarUrl: string | null;
  reputation: number;
  /** One of the app's developers (DEVELOPERS); shown as a badge instead of the rank. */
  developer: boolean;
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
  /** Only ever true for the author: hidden from everyone else while flags await a moderator. */
  hidden: boolean;
  distanceKm?: number;
}

export interface CommentDto {
  id: string;
  body: string;
  createdAt: number;
  author: Omit<PostAuthor, "reputation">;
  isOwn: boolean;
  hidden: boolean;
}

export interface FeedResponse {
  posts: PostDto[];
  nextCursor: string | null;
}

export function firstIssue(err: z.ZodError) {
  return err.issues[0]?.message ?? "Invalid input";
}
