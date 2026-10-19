import { getSessionUser } from "@/lib/auth/session";
import { MIN_UPDATE_MS, parseStream, positionSchema, type ChasersResponse } from "@/lib/chasers";
import { firstIssue } from "@/lib/community";
import { listChasers, pruneChasers, stopSharing, upsertPosition } from "@/lib/server/chaser-repo";
import { forbidden, sameOrigin, suspended, tooMany, unauthorized } from "@/lib/server/guard";
import { rateLimit } from "@/lib/server/rate-limit";
import { badRequest } from "@/lib/server/respond";

const noStore = { "Cache-Control": "private, no-store" };
/** Stale and ended positions are deleted at most this often per server instance. */
const PRUNE_EVERY_MS = 5 * 60_000;
let lastPrune = 0;

/**
 * GET /api/chasers: spotters sharing their live position right now. Members
 * only, never cached: where someone is driving isn't for the public.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const now = Date.now();
  if (now - lastPrune > PRUNE_EVERY_MS) {
    lastPrune = now;
    await pruneChasers(now);
  }
  const body: ChasersResponse = { chasers: await listChasers(user.id, now) };
  return Response.json(body, { headers: noStore });
}

/** PUT /api/chasers (JSON, lib/chasers `positionSchema`): share or update my position. */
export async function PUT(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const blocked = suspended(user);
  if (blocked) return blocked;
  const rl = rateLimit(`chaser:${user.id}`, 1, MIN_UPDATE_MS);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const raw: unknown = await req.json().catch(() => null);
  const parsed = positionSchema.safeParse(raw);
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const now = Date.now();
  if (parsed.data.until <= now) return badRequest("Sharing has already ended");
  if (parsed.data.stream && !parseStream(parsed.data.stream)) return badRequest("That isn't a YouTube channel or live video link");
  const expiresAt = await upsertPosition(user.id, parsed.data, now);
  return Response.json({ expiresAt }, { headers: noStore });
}

/** DELETE /api/chasers: stop sharing; my position is deleted. */
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  await stopSharing(user.id);
  return new Response(null, { status: 204, headers: noStore });
}
