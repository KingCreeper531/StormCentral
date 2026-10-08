import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { media, users } from "@/lib/db/schema";
import { forbidden, sameOrigin, tooMany, unauthorized } from "@/lib/server/guard";
import { imageSize, sniffImage, stripMetadata } from "@/lib/server/image";
import { rateLimit } from "@/lib/server/rate-limit";

/** The page crops and shrinks pictures to 256 px before upload, so this is generous. */
const MAX_AVATAR_BYTES = 512 * 1024;
const noStore = { "Cache-Control": "no-store" };
const bad = (error: string) => Response.json({ error }, { status: 400, headers: noStore });

async function setAvatar(userId: string, next: { bytes: Uint8Array; mime: string; width: number | null; height: number | null } | null) {
  const db = await getDb();
  const [row] = await db.select({ old: users.avatarMediaId }).from(users).where(eq(users.id, userId));
  const id = next ? randomUUID() : null;
  if (next && id) {
    await db.insert(media).values({ id, userId, mime: next.mime, width: next.width, height: next.height, size: next.bytes.length, bytes: Buffer.from(next.bytes), createdAt: Date.now() });
  }
  await db.update(users).set({ avatarMediaId: id }).where(eq(users.id, userId));
  if (row?.old) await db.delete(media).where(eq(media.id, row.old));
  return id ? `/api/media/${id}` : null;
}

/** Upload a profile picture (multipart field `image`). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser({ refresh: true });
  if (!user) return unauthorized();
  const rl = rateLimit(`avatar:${user.id}`, 10, 15 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File) || file.size === 0) return bad("Choose a picture");
  if (file.size > MAX_AVATAR_BYTES) return bad("Picture is too large");
  const raw = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImage(raw);
  if (!mime) return bad("Only JPEG, PNG or WebP pictures are accepted");
  let bytes: Uint8Array;
  try {
    bytes = stripMetadata(raw, mime);
  } catch {
    return bad("Picture file appears to be corrupt");
  }
  const size = imageSize(bytes, mime);
  const avatarUrl = await setAvatar(user.id, { bytes, mime, width: size?.width ?? null, height: size?.height ?? null });
  return Response.json({ avatarUrl }, { headers: noStore });
}

/** Remove the profile picture (back to the initial-letter avatar). */
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const user = await getSessionUser({ refresh: true });
  if (!user) return unauthorized();
  await setAvatar(user.id, null);
  return Response.json({ avatarUrl: null }, { headers: noStore });
}
