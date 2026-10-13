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
  },
  (t) => [index("posts_created_idx").on(t.createdAt), index("posts_geo_idx").on(t.lat, t.lon)],
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
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS posts_created_idx ON posts(created_at);
CREATE INDEX IF NOT EXISTS posts_geo_idx ON posts(lat, lon);
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
`;

export const schema = { users, sessions, passwordResets, media, posts, verifications, comments, blocks, flags };

/**
 * Columns added after a table first shipped. CREATE TABLE IF NOT EXISTS
 * won't touch an existing table, so these are added when missing.
 */
export const COLUMN_MIGRATIONS: readonly { table: string; column: string; sql: string }[] = [
  { table: "users", column: "avatar_media_id", sql: "ALTER TABLE users ADD COLUMN avatar_media_id TEXT" },
  { table: "users", column: "suspended_until", sql: "ALTER TABLE users ADD COLUMN suspended_until INTEGER" },
  { table: "posts", column: "hidden", sql: "ALTER TABLE posts ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0" },
  { table: "comments", column: "hidden", sql: "ALTER TABLE comments ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0" },
];
