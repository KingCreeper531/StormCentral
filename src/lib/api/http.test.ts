import { describe, expect, it, vi } from "vitest";
import { HttpError, isTransient, retryDelay, retryOnce } from "./http";

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

describe("retryOnce", () => {
  const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

  it("tries a dropped connection or a busy server once more", async () => {
    const run = vi.fn().mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce("ok");
    await expect(retryOnce(run, 0)).resolves.toBe("ok");
    const busy = vi.fn().mockRejectedValueOnce(new HttpError("Upstream 503", 503)).mockResolvedValueOnce("ok");
    await expect(retryOnce(busy, 0)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second failure, and doesn't retry a timeout or a 404", async () => {
    const down = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(retryOnce(down, 0)).rejects.toThrow("fetch failed");
    expect(down).toHaveBeenCalledTimes(2);
    const slow = vi.fn().mockRejectedValue(timeout());
    await expect(retryOnce(slow, 0)).rejects.toThrow("timeout");
    expect(slow).toHaveBeenCalledTimes(1);
    const missing = vi.fn().mockRejectedValue(new HttpError("Upstream 404", 404));
    await expect(retryOnce(missing, 0)).rejects.toThrow("404");
    expect(missing).toHaveBeenCalledTimes(1);
  });
});
