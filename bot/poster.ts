/**
 * How the bot posts: through the official X API (x-client.ts, run from
 * GitHub Actions), or through twikit (bot/local/twikit_post.py, run on your
 * own PC with the account's browser cookies). Both take the same text and an
 * optional image, and report failures as XError so main.ts handles them alike.
 */
import { spawn } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { credentialsFromEnv, postToX, uploadImage, XError, type XCredentials } from "./x-client";

export interface Image {
  bytes: Uint8Array;
  type: string;
}

export interface Poster {
  /** "api" or "twikit", for the log. */
  kind: string;
  /** Posts the text (and the image, when it uploads); returns the post's id. */
  post(text: string, image?: Image | null): Promise<string>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function apiPoster(creds: XCredentials): Poster {
  return {
    kind: "api",
    async post(text, image) {
      let media: string[] = [];
      if (image) {
        try {
          media = [await uploadImage(image.bytes, image.type, creds)];
        } catch (err) {
          console.warn(`Image upload failed (${message(err)}); posting without it.`);
        }
      }
      return postToX(text, creds, media);
    },
  };
}

/** twikit_post.py's one line of output. */
interface TwikitResult {
  ok: boolean;
  id?: string;
  image?: boolean;
  kind?: "duplicate" | "rate" | "locked" | "suspended" | "unauthorized" | "automated" | "rejected" | "error";
  message?: string;
}

/** twikit's failures as the API's statuses: 403 duplicate, 429 rate limit, 401 the account needs you. */
const STATUS: Record<NonNullable<TwikitResult["kind"]>, number> = {
  duplicate: 403,
  rate: 429,
  locked: 401,
  suspended: 401,
  unauthorized: 401,
  automated: 401,
  rejected: 400,
  error: 500,
};

export interface TwikitOptions {
  python: string;
  script: string;
  cookies: string;
  /** The only account it may post as; any other login is refused. */
  account: string;
}

/** Runs twikit_post.py with the post on stdin and reads its JSON answer. */
export function runTwikit(opts: TwikitOptions, args: string[], input: unknown): Promise<TwikitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.python, [opts.script, "--cookies", opts.cookies, "--account", opts.account, ...args], { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    const timer = setTimeout(() => child.kill(), 120_000);
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new XError(`Couldn't start Python (${opts.python}): ${err.message}`, 500));
    });
    child.on("close", () => {
      clearTimeout(timer);
      const line = out.trim().split("\n").at(-1) ?? "";
      try {
        resolve(JSON.parse(line) as TwikitResult);
      } catch {
        reject(new XError(`twikit_post.py gave no answer${line ? `: ${line}` : ""}`, 500));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export function twikitPoster(opts: TwikitOptions): Poster {
  return {
    kind: "twikit",
    async post(text, image) {
      let imagePath: string | null = null;
      if (image) {
        imagePath = join(tmpdir(), `stormcentral-${process.pid}-${Date.now()}.${image.type.split("/")[1] ?? "png"}`);
        writeFileSync(imagePath, image.bytes);
      }
      try {
        const r = await runTwikit(opts, [], { text, image: imagePath });
        if (!r.ok || !r.id) {
          const kind = r.kind ?? "error";
          throw new XError(`twikit ${kind}: ${r.message ?? "post failed"}`, STATUS[kind]);
        }
        if (image && !r.image) console.warn("Image upload failed; posted without it.");
        return r.id;
      } finally {
        if (imagePath) rmSync(imagePath, { force: true });
      }
    },
  };
}

/**
 * The poster this run uses, or null for a dry run: BOT_POSTER=twikit needs
 * the cookies file; otherwise the four X API secrets.
 */
export function posterFromEnv(env: Record<string, string | undefined> = process.env): Poster | null {
  if (env.BOT_POSTER === "twikit") {
    const opts: TwikitOptions = {
      python: env.BOT_PYTHON || (process.platform === "win32" ? "python" : "python3"),
      script: env.BOT_TWIKIT_SCRIPT || "bot/local/twikit_post.py",
      cookies: env.BOT_TWIKIT_COOKIES || "bot/local/cookies.json",
      account: env.BOT_X_ACCOUNT || "Storm__Central",
    };
    if (!existsSync(opts.cookies)) {
      console.warn(`No cookies file at ${opts.cookies}; dry run.`);
      return null;
    }
    return twikitPoster(opts);
  }
  const creds = credentialsFromEnv(env);
  return creds ? apiPoster(creds) : null;
}
