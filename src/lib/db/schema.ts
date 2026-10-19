/**
 * Community database schema (SQLite / libSQL via Drizzle).
 * Timestamps are epoch milliseconds. Keep SCHEMA_SQL in sync — the
 * `schema.test.ts` drift test exercises every table through Drizzle
 * against a database created only from SCHEMA_SQL.
 */
import { blob, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  avatarHue: integer("avatar_hue").notNull(),
  bio: text("bio"),
  /** Profile picture (a row in `media`), or null for the initial-letter avatar. */
  avatarMediaId: text("avatar_media_id"),
  createdAt: integer("created_at").notNull(),
  /** Set by a moderator: no posting, commenting or confirming until then, and the account's content is hidden. */
  suspendedUntil: integer("suspended_until"),
});

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 of the bearer token — the raw token never touches the DB. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** One-time password-reset links. Like sessions, only the token's SHA-256 is stored. */
export const passwordResets = sqliteTable(
  "password_resets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("password_resets_user_idx").on(t.userId)],
);

export const media = sqliteTable("media", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  width: integer("width"),
  height: integer("height"),
  size: integer("size").notNull(),
  bytes: blob("bytes", { mode: "buffer" }).notNull(),
  createdAt: integer("created_at").notNull(),
});

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    category: text("category").notNull(),
    severity: integer("severity").notNull().default(0),
    lat: real("lat").notNull(),
    lon: real("lon").notNull(),
    place: text("place"),
    mediaId: text("media_id").references(() => media.id, { onDelete: "set null" }),
    /** JSON snapshot of model conditions at post time (ground truth vs. model). */
    conditions: text("conditions"),
    createdAt: integer("created_at").notNull(),
    /** Hidden from everyone but its author while flagged reports await a moderator. */
    hidden: integer("hidden").notNull().default(0),
    /** JSON of the NWS Local Storm Report that confirmed this one (lib/nws-match), when one did. */
    nwsReport: text("nws_report"),
    nwsConfirmedAt: integer("nws_confirmed_at"),
    /** The report's id at NOAA's mPING once it was sent there (lib/mping). */
    mpingId: text("mping_id"),
  },
  (t) => [index("posts_created_idx").on(t.createdAt), index("posts_geo_idx").on(t.lat, t.lon), index("posts_user_idx").on(t.userId)],
);

export const verifications = sqliteTable(
  "verifications",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
    hidden: integer("hidden").notNull().default(0),
  },
  (t) => [index("comments_post_idx").on(t.postId, t.createdAt)],
);

/** One person blocking another: neither sees the other's reports or comments, and they can't interact. */
export const blocks = sqliteTable(
  "blocks",
  {
    blockerId: text("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: text("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index("blocks_blocked_idx").on(t.blockedId)],
);

/**
 * A person flagging a report, comment or account for moderators. One flag per
 * person per target; `status` is open until a moderator acts on it.
 */
export const flags = sqliteTable(
  "flags",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    details: text("details"),
    status: text("status").notNull().default("open"),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (t) => [
    uniqueIndex("flags_once_idx").on(t.reporterId, t.targetType, t.targetId),
    index("flags_target_idx").on(t.targetType, t.targetId, t.status),
    index("flags_status_idx").on(t.status, t.createdAt),
  ],
);

/**
 * Spotter WarnGen: unofficial warnings a spotter drew and issued from
 * Professional mode, shown only to signed-in spotter-network members. One
 * row per warning; an update replaces the polygon, time and tags and bumps
 * `revision`. The product text is generated from these fields when shown.
 */
export const spotterWarnings = sqliteTable(
  "spotter_warnings",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Per-year sequence ("Spotter Tornado Warning #12"). */
    year: integer("year").notNull(),
    number: integer("number").notNull(),
    kind: text("kind").notNull(),
    /** Closed [lon, lat] ring as JSON. */
    polygon: text("polygon").notNull(),
    /** Bounding box, for the time/area queries. */
    west: real("west").notNull(),
    south: real("south").notNull(),
    east: real("east").notNull(),
    north: real("north").notNull(),
    issuedAt: integer("issued_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    cancelledAt: integer("cancelled_at"),
    revision: integer("revision").notNull().default(0),
    /** {lat, lon, t} of the storm when issued, JSON or null. */
    storm: text("storm"),
    /** {headingDeg, speedKt}, JSON or null (stationary). */
    motion: text("motion"),
    basis: text("basis").notNull(),
    hail: real("hail").notNull().default(0),
    wind: integer("wind").notNull().default(0),
    tornadoPossible: integer("tornado_possible").notNull().default(0),
    threat: text("threat").notNull().default("base"),
    notes: text("notes"),
    place: text("place"),
    /** Town names inside the polygon, JSON array. */
    locations: text("locations"),
  },
  (t) => [index("spotter_warnings_expires_idx").on(t.expiresAt), index("spotter_warnings_user_idx").on(t.userId, t.issuedAt), uniqueIndex("spotter_warnings_number_idx").on(t.year, t.number)],
);

/**
 * Spotters sharing their live position as storm chasers: one row each, only
 * the latest fix (no history), deleted when they stop sharing and pruned once
 * stale or past the sharing window.
 */
export const chaserPositions = sqliteTable(
  "chaser_positions",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    lat: real("lat").notNull(),
    lon: real("lon").notNull(),
    /** Degrees clockwise from north; null when standing still or unknown. */
    heading: real("heading"),
    speedKmh: real("speed_kmh"),
    accuracyM: real("accuracy_m"),
    updatedAt: integer("updated_at").notNull(),
    /** Their YouTube live stream link (lib/chasers parseStream), when they gave one. */
    stream: text("stream"),
    /** When sharing turns itself off (the window picked in Settings, at most 12 h). */
    expiresAt: integer("expires_at").notNull(),
  },
  (t) => [index("chaser_positions_updated_idx").on(t.updatedAt)],
);

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_hue INTEGER NOT NULL,
  bio TEXT,
  created_at INTEGER NOT NULL,
  avatar_media_id TEXT,
  suspended_until INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets(user_id);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  size INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  category TEXT NOT NULL,
  severity INTEGER NOT NULL DEFAULT 0,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  place TEXT,
  media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  conditions TEXT,
  created_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  nws_report TEXT,
  nws_confirmed_at INTEGER,
  mping_id TEXT
);
CREATE INDEX IF NOT EXISTS posts_created_idx ON posts(created_at);
CREATE INDEX IF NOT EXISTS posts_geo_idx ON posts(lat, lon);
CREATE INDEX IF NOT EXISTS posts_user_idx ON posts(user_id);
CREATE TABLE IF NOT EXISTS verifications (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments(post_id, created_at);
CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS blocks_blocked_idx ON blocks(blocked_id);
CREATE TABLE IF NOT EXISTS flags (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS flags_once_idx ON flags(reporter_id, target_type, target_id);
CREATE INDEX IF NOT EXISTS flags_target_idx ON flags(target_type, target_id, status);
CREATE INDEX IF NOT EXISTS flags_status_idx ON flags(status, created_at);
CREATE TABLE IF NOT EXISTS spotter_warnings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  number INTEGER NOT NULL,
  kind TEXT NOT NULL,
  polygon TEXT NOT NULL,
  west REAL NOT NULL,
  south REAL NOT NULL,
  east REAL NOT NULL,
  north REAL NOT NULL,
  issued_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  cancelled_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 0,
  storm TEXT,
  motion TEXT,
  basis TEXT NOT NULL,
  hail REAL NOT NULL DEFAULT 0,
  wind INTEGER NOT NULL DEFAULT 0,
  tornado_possible INTEGER NOT NULL DEFAULT 0,
  threat TEXT NOT NULL DEFAULT 'base',
  notes TEXT,
  place TEXT,
  locations TEXT
);
CREATE INDEX IF NOT EXISTS spotter_warnings_expires_idx ON spotter_warnings(expires_at);
CREATE INDEX IF NOT EXISTS spotter_warnings_user_idx ON spotter_warnings(user_id, issued_at);
CREATE UNIQUE INDEX IF NOT EXISTS spotter_warnings_number_idx ON spotter_warnings(year, number);
CREATE TABLE IF NOT EXISTS chaser_positions (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  heading REAL,
  speed_kmh REAL,
  accuracy_m REAL,
  updated_at INTEGER NOT NULL,
  stream TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chaser_positions_updated_idx ON chaser_positions(updated_at);
`;

export const schema = { users, sessions, passwordResets, media, posts, verifications, comments, blocks, flags, spotterWarnings, chaserPositions };

/**
 * Columns added after a table first shipped. CREATE TABLE IF NOT EXISTS
 * won't touch an existing table, so these are added when missing.
 */
export const COLUMN_MIGRATIONS: readonly { table: string; column: string; sql: string }[] = [
  { table: "users", column: "avatar_media_id", sql: "ALTER TABLE users ADD COLUMN avatar_media_id TEXT" },
  { table: "users", column: "suspended_until", sql: "ALTER TABLE users ADD COLUMN suspended_until INTEGER" },
  { table: "posts", column: "hidden", sql: "ALTER TABLE posts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0" },
  { table: "comments", column: "hidden", sql: "ALTER TABLE comments ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0" },
  { table: "posts", column: "nws_report", sql: "ALTER TABLE posts ADD COLUMN nws_report TEXT" },
  { table: "posts", column: "nws_confirmed_at", sql: "ALTER TABLE posts ADD COLUMN nws_confirmed_at INTEGER" },
  { table: "posts", column: "mping_id", sql: "ALTER TABLE posts ADD COLUMN mping_id TEXT" },
  { table: "chaser_positions", column: "stream", sql: "ALTER TABLE chaser_positions ADD COLUMN stream TEXT" },
];
