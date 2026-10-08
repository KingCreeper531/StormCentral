import { getSessionUser } from "@/lib/auth/session";
import { conditionsSchema, firstIssue, MAX_IMAGE_BYTES, postSchema } from "@/lib/community";
import { createPost, listPosts, type FeedQuery } from "@/lib/server/community-repo";
import { forbidden, sameOrigin, tooMany, unauthorized } from "@/lib/server/guard";
import { imageSize, sniffImage, stripMetadata } from "@/lib/server/image";
import { rateLimit } from "@/lib/server/rate-limit";
import { badRequest } from "@/lib/server/respond";

const noStore = { "Cache-Control": "private, no-store" };

/**
 * GET /api/posts?sort=latest|nearby|top|bbox&lat&lon&radiusKm&bbox=w,s,e,n&hours&cursor&user
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const sort = sp.get("sort") ?? "latest";
  const viewer = await getSessionUser();
  let q: FeedQuery;
  if (sort === "nearby") {
    const lat = Number(sp.get("lat"));
    const lon = Number(sp.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return badRequest("lat/lon required");
    q = { sort, origin: { lat, lon }, radiusKm: Math.min(500, Math.max(5, Number(sp.get("radiusKm")) || 150)), cursor: sp.get("cursor") };
  } else if (sort === "top") {
    q = { sort, hours: Math.min(168, Math.max(1, Number(sp.get("hours")) || 24)) };
  } else if (sort === "bbox") {
    const [west, south, east, north] = (sp.get("bbox") ?? "").split(",").map(Number);
    if (![west, south, east, north].every(Number.isFinite)) return badRequest("bbox=w,s,e,n required");
    q = { sort, bbox: { west: west!, south: south!, east: east!, north: north! }, hours: Math.min(24, Number(sp.get("hours")) || 6) };
  } else if (sp.get("user")) {
    q = { sort: "user", username: sp.get("user")!, cursor: sp.get("cursor") };
  } else {
    q = { sort: "latest", cursor: sp.get("cursor") };
  }
  return Response.json(await listPosts(q, viewer?.id ?? null), { headers: noStore });
}

/** POST /api/posts (multipart/form-data) */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser({ refresh: true });
  if (!user) return unauthorized();
  const rl = rateLimit(`post:${user.id}`, 10, 15 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("Expected multipart form data");
  const parsed = postSchema.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));

  let conditions = null;
  const rawConditions = form.get("conditions");
  if (typeof rawConditions === "string" && rawConditions) {
    try {
      const c = conditionsSchema.safeParse(JSON.parse(rawConditions));
      if (c.success) conditions = c.data;
    } catch {
      /* ignore malformed snapshot */
    }
  }

  let image = null;
  const file = form.get("image");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_IMAGE_BYTES) return badRequest("Image is too large (max 2.5 MB)");
    const raw = new Uint8Array(await file.arrayBuffer());
    const mime = sniffImage(raw);
    if (!mime) return badRequest("Only JPEG, PNG or WebP images are accepted");
    let bytes: Uint8Array;
    try {
      bytes = stripMetadata(raw, mime);
    } catch {
      return badRequest("Image file appears to be corrupt");
    }
    const size = imageSize(bytes, mime);
    image = { bytes, mime, width: size?.width ?? null, height: size?.height ?? null };
  }

  const id = await createPost({ userId: user.id, ...parsed.data, conditions, image });
  return Response.json({ id }, { status: 201, headers: noStore });
}
