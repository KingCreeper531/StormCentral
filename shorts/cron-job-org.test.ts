import { describe, expect, it, vi } from "vitest";
import { desiredJobs, firstSecret, KEY_NAMES, syncJobs } from "./cron-job-org";

describe("cron-job.org setup", () => {
  const jobs = desiredJobs("KingCreeper531/StormCentral", "ghp_x");

  it("starts each Short through GitHub's workflow-dispatch API, on Eastern time", () => {
    expect(jobs.map((j) => j.title)).toEqual([
      "Storm Central: outlook",
      "Storm Central: tropical",
      "Storm Central: fire",
      "Storm Central: weekly",
      "Storm Central: recap",
      "Storm Central: lesson",
      "Storm Central: seasonal",
      "Storm Central: review",
      "Storm Central: snow",
      "Storm Central: breaking",
      "Storm Central: facebook",
    ]);
    expect(jobs.find((j) => j.title.endsWith("lesson"))!.schedule).toMatchObject({ hours: [13], minutes: [20], wdays: [3] });
    const recap = jobs.find((j) => j.title.endsWith("recap"))!;
    expect(recap.url).toBe("https://api.github.com/repos/KingCreeper531/StormCentral/actions/workflows/youtube-shorts.yml/dispatches");
    expect(recap.requestMethod).toBe(1);
    expect(JSON.parse(recap.extendedData.body)).toEqual({ ref: "main", inputs: { kind: "recap", scheduled: "true" } });
    expect(recap.extendedData.headers.Authorization).toBe("Bearer ghp_x");
    expect(recap.schedule).toMatchObject({ timezone: "America/New_York", hours: [23], minutes: [15], wdays: [-1] });
    expect(jobs.find((j) => j.title.endsWith("weekly"))!.schedule.wdays).toEqual([0]);
    expect(jobs.find((j) => j.title.endsWith("seasonal"))!.schedule).toMatchObject({ hours: [10], minutes: [45], wdays: [4] });
    const breaking = jobs.find((j) => j.title.endsWith("breaking"))!;
    expect(breaking.url).toContain("/youtube-breaking.yml/dispatches");
    expect(JSON.parse(breaking.extendedData.body)).toEqual({ ref: "main", inputs: { scheduled: "true" } });
    expect(breaking.schedule.minutes).toEqual([5, 15, 25, 35, 45, 55]);
    const facebook = jobs.find((j) => j.title.endsWith("facebook"))!;
    expect(facebook.url).toContain("/facebook-warnings.yml/dispatches");
    expect(facebook.schedule.minutes).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57]);
  });

  it("updates the jobs it made before and creates the rest", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url).replace("https://api.cron-job.org", "");
      calls.push(`${init?.method} ${path}`);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer key");
      if (init?.method === "GET") return Response.json({ jobs: [{ jobId: 7, title: "Storm Central: recap" }, { jobId: 9, title: "Someone else's job" }] });
      if (init?.method === "PUT") return Response.json({ jobId: 100 });
      return new Response("{}");
    });
    const r = await syncJobs("key", jobs, { fetchImpl: fetchImpl as typeof fetch, pauseMs: 0, log: () => {} });
    expect(r).toEqual({ created: 10, updated: 1 });
    expect(calls[0]).toBe("GET /jobs");
    expect(calls).toContain("PATCH /jobs/7");
    expect(calls.filter((c) => c === "PUT /jobs")).toHaveLength(10);
    expect(calls.some((c) => c.includes("/jobs/9"))).toBe(false);
  });

  it("waits out cron-job.org's rate limit and carries on", async () => {
    let puts = 0;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "GET") return Response.json({ jobs: [] });
      // The sixth new job in a minute is refused once.
      if (init?.method === "PUT" && ++puts === 6) return new Response("", { status: 429 });
      return Response.json({ jobId: puts });
    });
    const waits: string[] = [];
    const r = await syncJobs("key", jobs, { fetchImpl: fetchImpl as typeof fetch, pauseMs: 0, retryMs: 1, log: (m: string) => waits.push(m) });
    expect(r).toEqual({ created: 11, updated: 0 });
    expect(waits.filter((m) => m.includes("rate limit"))).toHaveLength(1);
  });

  it("stops with cron-job.org's error", async () => {
    const fetchImpl = vi.fn(async () => new Response("Unauthorized", { status: 401 }));
    await expect(syncJobs("bad", jobs, { fetchImpl: fetchImpl as typeof fetch, pauseMs: 0, log: () => {} })).rejects.toThrow(/401 Unauthorized/);
  });

  it("finds the API key under the names it might have been saved as", () => {
    expect(firstSecret({ CRON_JOB_ORG_API_KEY: " abc ", CRONJOB_KEY: "later" }, KEY_NAMES)).toEqual({ name: "CRON_JOB_ORG_API_KEY", value: "abc" });
    expect(firstSecret({ CRONJOB_API_KEY: "" }, KEY_NAMES)).toBeNull();
  });
});
