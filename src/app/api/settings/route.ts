import { getSessionUser } from "@/lib/auth/session";
import { readBody } from "@/lib/server/body";
import { deleteSettings, getSettings, putSettings } from "@/lib/server/settings-repo";
import { forbidden, sameOrigin, tooMany, unauthorized } from "@/lib/server/guard";
import { rateLimit } from "@/lib/server/rate-limit";
import { badRequest } from "@/lib/server/respond";
import { MAX_SETTINGS_CHARS, validateSettings } from "@/lib/sync/settings";

const noStore = { "Cache-Control": "no-store" };
const MAX_BODY_CHARS = MAX_SETTINGS_CHARS + 1024;
const TOO_BIG = "Those settings are too big to keep";

/** Changes stamped further ahead than this are taken as now: a device's clock running fast can't win every conflict. */
const MAX_CLOCK_AHEAD_MS = 5 * 60_000;

/** GET /api/settings: your synced settings ({ data: null } when there are none). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const stored = await getSettings(user.id);
  return Response.json(stored ?? { data: null, changedAt: 0 }, { headers: noStore });
}

/**
 * PUT /api/settings ({ data, changedAt }): keep this device's settings. 409
 * with the account's settings when another device changed them later.
 */
export async function PUT(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const rl = rateLimit(`settings:${user.id}`, 30, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  // UTF-8 takes at most 3 bytes for each character JavaScript counts.
  const body = await readBody(req, MAX_BODY_CHARS * 3, TOO_BIG);
  if (body instanceof Response) return body;
  const text = new TextDecoder().decode(body);
  if (text.length > MAX_BODY_CHARS) return Response.json({ error: TOO_BIG }, { status: 413, headers: noStore });
  let raw: { data?: unknown; changedAt?: unknown } | null = null;
  try {
    raw = JSON.parse(text);
  } catch {
    /* handled below */
  }
  const data = validateSettings(raw?.data);
  if (!data || typeof raw?.changedAt !== "number" || !Number.isFinite(raw.changedAt) || raw.changedAt <= 0) return badRequest("Send { data, changedAt }");
  const now = Date.now();
  const changedAt = Math.min(raw.changedAt, now + MAX_CLOCK_AHEAD_MS);
  const r = await putSettings(user.id, data, changedAt, now);
  if (!r.ok) return Response.json(r.current, { status: 409, headers: noStore });
  return Response.json({ changedAt }, { headers: noStore });
}

/** DELETE /api/settings: forget your synced settings (each device keeps its own). */
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  await deleteSettings(user.id);
  return new Response(null, { status: 204, headers: noStore });
}
