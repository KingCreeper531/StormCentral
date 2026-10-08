// @ts-check
import { appendFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAX_BYTES = 1_000_000;

/** Append-only log file, truncated when it passes ~1 MB. Never throws. */
export function createLog(file) {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    if (statSync(file, { throwIfNoEntry: false })?.size > MAX_BYTES) writeFileSync(file, "");
  } catch {
    /* logging is best-effort */
  }
  /** @param {string} message */
  return (message) => {
    const line = `${new Date().toISOString()} ${message}\n`;
    try {
      appendFileSync(file, line);
    } catch {
      /* best-effort */
    }
    if (!process.env.STORMCENTRAL_QUIET) process.stdout.write(line);
  };
}
