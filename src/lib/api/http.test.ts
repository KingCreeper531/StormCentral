import { describe, expect, it } from "vitest";
import { HttpError, isTransient, retryDelay } from "./http";

describe("isTransient", () => {
  it("retries busy servers, rate limits and dropped connections", () => {
    expect(isTransient(new HttpError("Service is overloaded", 503))).toBe(true);
    expect(isTransient(new HttpError("Too many concurrent requests", 429))).toBe(true);
    expect(isTransient(new HttpError("Bad gateway", 502))).toBe(true);
    expect(isTransient(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("doesn't retry requests that can't succeed", () => {
    expect(isTransient(new HttpError("Bad request", 400))).toBe(false);
    expect(isTransient(new HttpError("Not found", 404))).toBe(false);
  });
});

describe("retryDelay", () => {
  it("backs off to at most about 30 seconds", () => {
    expect(retryDelay(0)).toBeGreaterThanOrEqual(750);
    expect(retryDelay(0)).toBeLessThanOrEqual(1250);
    expect(retryDelay(10)).toBeLessThanOrEqual(37_500);
  });
});
