/**
 * For uptime checks and the failover watcher (vps/failover.sh): answers as
 * long as the server is up, without touching the database or any upstream,
 * and says which deployment answered.
 */
export function GET() {
  return Response.json(
    {
      ok: true,
      host: process.env.VERCEL ? "vercel" : "server",
      version: process.env.DEPLOYMENT_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
