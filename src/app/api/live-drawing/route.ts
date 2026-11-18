import { getSessionUser, isPresenter } from "@/lib/auth/session";
import { cleanShapes } from "@/lib/draw/shapes";
import { readJson } from "@/lib/server/body";
import { getLiveDrawing, setLiveDrawing } from "@/lib/server/live-drawing-repo";
import { forbidden, sameOrigin, tooMany, unauthorized } from "@/lib/server/guard";
import { rateLimit } from "@/lib/server/rate-limit";
import { badRequest } from "@/lib/server/respond";

const noStore = { "Cache-Control": "no-store" };

/**
 * GET /api/live-drawing: what the presenter has drawn for the live stream,
 * read by the stream's page every couple of seconds. Public: it's on air.
 */
export async function GET() {
  return Response.json(await getLiveDrawing(), { headers: noStore });
}

/**
 * The biggest drawing body accepted. The draw store sends up to 200 shapes
 * with points at full precision (~42 bytes each as JSON) before cleanShapes
 * trims them here; the most that keeps, 200 shapes of 800 points, is under
 * 7 MB that way, so no drawing that could go on air is refused.
 */
const LIVE_DRAWING_MAX_BYTES = 8 * 1024 * 1024;

/** PUT /api/live-drawing ({ shapes }): put a drawing on air. Moderators and the app's developers only. */
export async function PUT(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (!isPresenter(user)) return forbidden();
  const rl = await rateLimit(`live-drawing:${user.id}`, 5, 1000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);
  const json = await readJson(req, LIVE_DRAWING_MAX_BYTES);
  if (json instanceof Response) return json;
  const raw = json as { shapes?: unknown } | null;
  if (!raw || !Array.isArray(raw.shapes)) return badRequest("Send { shapes: [...] }");
  const shapes = cleanShapes(raw.shapes);
  await setLiveDrawing(user.id, shapes);
  return Response.json({ shapes: shapes.length }, { headers: noStore });
}

/** DELETE /api/live-drawing: take the drawing off the air. */
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser();
  if (!user) return unauthorized();
  if (!isPresenter(user)) return forbidden();
  await setLiveDrawing(user.id, []);
  return new Response(null, { status: 204, headers: noStore });
}
