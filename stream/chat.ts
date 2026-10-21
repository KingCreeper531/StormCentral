/**
 * Live chat commands. Viewers type `!forecast Moore, OK`, `!alerts Tulsa` or
 * `!radar Wichita, KS`; the answer goes on screen (a card over the radar) and,
 * within a daily budget, as a reply in chat.
 *
 * Chat is read through YouTube's liveChatMessages.streamList, a gRPC stream
 * that pushes messages as they're posted (5 quota units per connection,
 * instead of 5 per poll). Replies cost 20 units each.
 *
 * Nothing a viewer types is ever shown or read out: answers name only places
 * from the town list (or Open-Meteo's geocoder), so a message can't put words
 * on the stream. Slurs and abuse are filtered by YouTube's own chat moderation
 * (blocked words, held messages; vps/README.md), before anyone sees them.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { describeCode } from "../src/lib/weather/wmo";
import { clockText, zoneFor } from "../shorts/kinds/breaking";
import type { Place } from "./analysis";

// ── Commands ──────────────────────────────────────────────────────────────

export type CommandName = "forecast" | "alerts" | "radar" | "help";
export interface Command {
  cmd: CommandName;
  /** What follows the command, trimmed ("Moore, OK"). */
  arg: string;
}

const ALIASES: Record<string, CommandName> = {
  forecast: "forecast",
  weather: "forecast",
  wx: "forecast",
  alerts: "alerts",
  alert: "alerts",
  warnings: "alerts",
  radar: "radar",
  show: "radar",
  help: "help",
  commands: "help",
};

export const HELP = "Commands: !forecast <town, ST> · !alerts <town, ST> · !radar <town, ST>. Example: !forecast Moore, OK";

/** The command in a chat message, or null when it isn't one. */
export function parseCommand(text: string): Command | null {
  const m = /^\s*!([a-z]+)\b\s*(.*)$/i.exec(text);
  const cmd = m && ALIASES[m[1]!.toLowerCase()];
  return cmd ? { cmd, arg: m[2]!.replace(/\s+/g, " ").trim().slice(0, 60) } : null;
}

// ── Places ────────────────────────────────────────────────────────────────

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};
const CODES = new Set(Object.values(STATES));
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\bsaint\b/g, "st")
    .replace(/\s+/g, " ")
    .trim();

/** "Moore, OK", "moore oklahoma", "Oklahoma City": the most populous town of that name (in that state, when given). */
export function findPlace(arg: string, places: Place[]): Place | null {
  const words = norm(arg).split(" ").filter(Boolean);
  if (!words.length) return null;
  let state: string | null = null;
  for (const n of [3, 2, 1]) {
    if (words.length <= n) continue;
    const tail = words.slice(-n).join(" ");
    const code = STATES[tail] ?? (n === 1 && CODES.has(tail.toUpperCase()) ? tail.toUpperCase() : null);
    if (code) {
      state = code;
      words.splice(-n);
      break;
    }
  }
  const name = words.join(" ");
  let best: Place | null = null;
  for (const p of places) if ((!state || p.state === state) && norm(p.name) === name && (!best || p.pop > best.pop)) best = p;
  return best;
}

/** Anywhere else (a smaller town, a ZIP code, abroad), from Open-Meteo's geocoder. */
export async function geocode(arg: string): Promise<{ label: string; lat: number; lon: number; state?: string } | null> {
  if (!/^[\p{L}\p{N} ,.'-]{2,60}$/u.test(arg)) return null;
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(arg.split(",")[0]!.trim())}&count=1&language=en&format=json`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const r = ((await res.json()) as { results?: { name: string; admin1?: string; country_code?: string; latitude: number; longitude: number }[] }).results?.[0];
  if (!r) return null;
  const state = r.country_code === "US" && r.admin1 ? STATES[norm(r.admin1)] : undefined;
  return { label: [r.name, state ?? r.admin1 ?? r.country_code].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude, state };
}

// ── Answers ───────────────────────────────────────────────────────────────

/** YouTube's limit for a chat message. */
const MAX_CHARS = 200;

export interface ForecastData {
  current?: { temperature_2m?: number; weather_code?: number; wind_gusts_10m?: number };
  daily?: { time?: string[]; weather_code?: number[]; temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: (number | null)[]; wind_gusts_10m_max?: number[] };
}

export async function fetchForecast(lat: number, lon: number): Promise<ForecastData> {
  const q = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    current: "temperature_2m,weather_code,wind_gusts_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_gusts_10m_max",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    timezone: "auto",
    forecast_days: "2",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`forecast ${res.status}`);
  return (await res.json()) as ForecastData;
}

const deg = (v: number | undefined | null) => (v == null ? "?" : `${Math.round(v)}°F`);
const sky = (code: number | undefined) => describeCode(code).label.toLowerCase();

/** "Moore, OK: now 72°F, partly cloudy. Today: 78°F/60°F, thunderstorm, 70% rain, gusts 35 mph. Tomorrow: …" (≤ 200 characters). */
export function forecastText(label: string, f: ForecastData): string {
  const d = f.daily ?? {};
  const day = (i: number, name: string) => {
    const parts = [`${deg(d.temperature_2m_max?.[i])}/${deg(d.temperature_2m_min?.[i])}`, sky(d.weather_code?.[i])];
    const rain = d.precipitation_probability_max?.[i];
    if (rain != null && rain >= 20) parts.push(`${Math.round(rain)}% rain`);
    const gust = d.wind_gusts_10m_max?.[i];
    if (gust != null && gust >= 30) parts.push(`gusts ${Math.round(gust)} mph`);
    return `${name}: ${parts.join(", ")}.`;
  };
  const now = f.current ? `${label}: now ${deg(f.current.temperature_2m)}, ${sky(f.current.weather_code)}.` : `${label}:`;
  const full = [now, day(0, "Today"), day(1, "Tomorrow")].join(" ");
  return full.length <= MAX_CHARS ? full : [now, day(0, "Today")].join(" ").slice(0, MAX_CHARS);
}

export interface PointAlert {
  event: string;
  ends: string | null;
}

export async function fetchAlerts(lat: number, lon: number, userAgent: string): Promise<PointAlert[]> {
  const res = await fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, {
    headers: { "User-Agent": userAgent, Accept: "application/geo+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`alerts ${res.status}`);
  const fc = (await res.json()) as { features?: { properties: { event: string; ends?: string | null; expires?: string | null } }[] };
  return (fc.features ?? []).map((f) => ({ event: f.properties.event, ends: f.properties.ends ?? f.properties.expires ?? null }));
}

/** "Moore, OK: Tornado Warning until 8:15 PM CDT · Flood Watch until 1:00 AM CDT" (≤ 200 characters). */
export function alertsText(label: string, state: string | undefined, alerts: PointAlert[]): string {
  if (!alerts.length) return `${label}: no watches, warnings or advisories in effect right now.`;
  const seen = new Set<string>();
  const items = alerts
    .filter((a) => !seen.has(a.event) && seen.add(a.event))
    .map((a) => (a.ends ? `${a.event} until ${clockText(a.ends, zoneFor(state, a.ends)).short}` : a.event));
  // As many as fit, with room left to say how many didn't.
  let text = `${label}: ${items[0]}`;
  for (let i = 1; i < items.length; i++) {
    const rest = i + 1 < items.length ? ` · and ${items.length - i - 1} more`.length : 0;
    if (text.length + 3 + items[i]!.length + rest > MAX_CHARS) return `${text} · and ${items.length - i} more`;
    text += ` · ${items[i]}`;
  }
  return text.slice(0, MAX_CHARS);
}

// ── Cooldowns ─────────────────────────────────────────────────────────────

/** Who may run a command now: each viewer once a minute, everyone every few seconds; the channel's moderators skip their own wait. */
export class Cooldowns {
  private users = new Map<string, number>();
  private last = -Infinity;
  constructor(
    private perUser = 60_000,
    private global = 6_000,
  ) {}
  take(user: string, moderator: boolean, now = Date.now()): boolean {
    if (now - this.last < this.global) return false;
    if (!moderator && now - (this.users.get(user) ?? -Infinity) < this.perUser) return false;
    this.last = now;
    this.users.set(user, now);
    if (this.users.size > 5000) for (const [u, t] of this.users) if (now - t > this.perUser) this.users.delete(u);
    return true;
  }
}

// ── Reading chat (gRPC streamList) ────────────────────────────────────────

// From YouTube's stream_list.proto (developers.google.com/youtube/v3/live/streaming-live-chat), cut to the
// fields used here; the decoder skips the others.
const PROTO = `syntax = "proto2";
package youtube.api.v3;
service V3DataLiveChatMessageService {
  rpc StreamList(LiveChatMessageListRequest) returns (stream LiveChatMessageListResponse) {}
}
message LiveChatMessageListRequest {
  optional string live_chat_id = 1;
  optional string hl = 2;
  optional uint32 profile_image_size = 3;
  optional uint32 max_results = 98;
  optional string page_token = 99;
  repeated string part = 100;
}
message LiveChatMessageListResponse {
  optional string kind = 200;
  optional string etag = 201;
  optional string offline_at = 2;
  optional string next_page_token = 100602;
  repeated LiveChatMessage items = 1007;
}
message LiveChatMessage {
  optional string kind = 200;
  optional string etag = 201;
  optional string id = 101;
  optional LiveChatMessageSnippet snippet = 2;
  optional LiveChatMessageAuthorDetails author_details = 3;
}
message LiveChatMessageAuthorDetails {
  optional string channel_id = 10101;
  optional string display_name = 103;
  optional bool is_chat_owner = 5;
  optional bool is_chat_moderator = 7;
}
message LiveChatMessageSnippet {
  message TypeWrapper {
    enum Type {
      INVALID_TYPE = 0;
      TEXT_MESSAGE_EVENT = 1;
      TOMBSTONE = 2;
      FAN_FUNDING_EVENT = 3;
      CHAT_ENDED_EVENT = 4;
      SPONSOR_ONLY_MODE_STARTED_EVENT = 5;
      SPONSOR_ONLY_MODE_ENDED_EVENT = 6;
      NEW_SPONSOR_EVENT = 7;
      USER_BANNED_EVENT = 10;
      SUPER_CHAT_EVENT = 15;
      SUPER_STICKER_EVENT = 16;
      MEMBER_MILESTONE_CHAT_EVENT = 17;
      MEMBERSHIP_GIFTING_EVENT = 18;
      GIFT_MEMBERSHIP_RECEIVED_EVENT = 19;
      POLL_EVENT = 20;
      GIFT_EVENT = 21;
    }
  }
  optional TypeWrapper.Type type = 1;
  optional string live_chat_id = 201;
  optional string author_channel_id = 301;
  optional string published_at = 4;
  optional bool has_display_content = 17;
  optional string display_message = 16;
  oneof displayed_content {
    LiveChatTextMessageDetails text_message_details = 19;
  }
}
message LiveChatTextMessageDetails {
  optional string message_text = 1;
}
`;

export interface ChatMessage {
  id: string;
  /** The author's channel id. */
  author: string;
  /** The channel's owner or one of its moderators. */
  moderator: boolean;
  text: string;
  at: number;
}

interface RawResponse {
  nextPageToken?: string;
  offlineAt?: string;
  items?: {
    id?: string;
    snippet?: { type?: string; publishedAt?: string; displayMessage?: string; textMessageDetails?: { messageText?: string } };
    authorDetails?: { channelId?: string; isChatOwner?: boolean; isChatModerator?: boolean };
  }[];
}

type StreamClient = grpc.Client & { StreamList(req: object, md: grpc.Metadata): grpc.ClientReadableStream<RawResponse> };

let definition: protoLoader.PackageDefinition | null = null;
/** The service definition (proto-loader reads it from a file, removed once it's read). */
export function chatService() {
  if (!definition) {
    const dir = mkdtempSync(join(tmpdir(), "scl-chat-"));
    try {
      const file = join(dir, "stream_list.proto");
      writeFileSync(file, PROTO);
      definition = protoLoader.loadSync(file, { keepCase: false, longs: String, enums: String, defaults: false, oneofs: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const pkg = grpc.loadPackageDefinition(definition) as unknown as { youtube: { api: { v3: { V3DataLiveChatMessageService: grpc.ServiceClientConstructor } } } };
  return pkg.youtube.api.v3.V3DataLiveChatMessageService;
}

export interface ChatReaderOptions {
  /** An OAuth access token (fresh for each connection). */
  token: () => Promise<string>;
  /** The live chat to read, or null while the stream isn't live. */
  chatId: () => Promise<string | null>;
  onMessage: (m: ChatMessage) => void;
  log: (msg: string) => void;
  /** Tests: a local server instead of YouTube's. */
  address?: string;
  credentials?: grpc.ChannelCredentials;
}

/**
 * Keeps one streamList connection open to the live chat, picking up where it
 * left off after a drop (nextPageToken), and hands on new text messages. The
 * history sent when it first connects is skipped: those were posted before the
 * director was listening.
 */
export class ChatReader {
  private client: StreamClient;
  private closed = false;
  private call: grpc.ClientReadableStream<RawResponse> | null = null;
  private seen = new Set<string>();

  constructor(private o: ChatReaderOptions) {
    const Service = chatService();
    this.client = new Service(o.address ?? "dns:///youtube.googleapis.com:443", o.credentials ?? grpc.credentials.createSsl()) as unknown as StreamClient;
  }

  async run() {
    let pageToken: string | undefined;
    let chat: string | null = null;
    let backoff = 2_500;
    let opened = 0;
    const since = Date.now() - 5_000;
    while (!this.closed) {
      try {
        const id = await this.o.chatId();
        if (!id) {
          await sleep(60_000);
          continue;
        }
        if (id !== chat) [chat, pageToken] = [id, undefined];
        const md = new grpc.Metadata();
        md.set("authorization", `Bearer ${await this.o.token()}`);
        opened = Date.now();
        pageToken = await this.stream(id, pageToken, md, since);
      } catch (err) {
        const code = (err as { code?: number }).code;
        this.o.log(`chat: ${err instanceof Error ? err.message : err}`);
        // The chat ended or is off (a new broadcast has a new chat): look it up again.
        if (code === grpc.status.FAILED_PRECONDITION || code === grpc.status.NOT_FOUND) chat = null;
      }
      // A connection that lasted a while was fine (tokens expire hourly); one that ends at once is backed off from.
      backoff = Date.now() - opened > 120_000 ? 5_000 : Math.min(backoff * 2, 300_000);
      if (!this.closed) await sleep(backoff);
    }
  }

  /** One connection; resolves with the last page token when the server ends it. */
  private stream(chatId: string, pageToken: string | undefined, md: grpc.Metadata, since: number) {
    return new Promise<string | undefined>((resolve, reject) => {
      const call = this.client.StreamList({ liveChatId: chatId, pageToken, part: ["id", "snippet", "authorDetails"] }, md);
      this.call = call;
      let token = pageToken;
      call.on("data", (r: RawResponse) => {
        token = r.nextPageToken || token;
        for (const m of r.items ?? []) {
          if (m.snippet?.type !== "TEXT_MESSAGE_EVENT" || !m.id || this.seen.has(m.id)) continue;
          this.seen.add(m.id);
          if (this.seen.size > 20_000) this.seen = new Set([...this.seen].slice(-10_000));
          const at = Date.parse(m.snippet.publishedAt ?? "") || Date.now();
          if (at < since) continue;
          const a = m.authorDetails ?? {};
          this.o.onMessage({ id: m.id, author: a.channelId ?? "", moderator: !!(a.isChatOwner || a.isChatModerator), text: m.snippet.textMessageDetails?.messageText ?? m.snippet.displayMessage ?? "", at });
        }
      });
      call.on("error", (err) => (this.closed ? resolve(token) : reject(err)));
      call.on("end", () => resolve(token));
    });
  }

  close() {
    this.closed = true;
    this.call?.cancel();
    this.client.close();
  }
}

// ── Replying ──────────────────────────────────────────────────────────────

/** Posts a message in the live chat as the channel (20 quota units). */
export async function postChat(chatId: string, text: string, token: string): Promise<void> {
  const res = await fetch("https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ snippet: { liveChatId: chatId, type: "textMessageEvent", textMessageDetails: { messageText: text.slice(0, MAX_CHARS) } } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`chat reply ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
