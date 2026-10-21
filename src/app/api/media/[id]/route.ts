import { getMedia } from "@/lib/server/community-repo";

/**
 * Serves stored report photos and profile pictures. An id's bytes never
 * change, but a photo can be deleted (with its report, by a moderator, or
 * replaced as an avatar), so browsers and Cloudflare keep it for an hour, not
 * for good: a removed picture is gone everywhere within the hour.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const m = await getMedia(id);
  if (!m) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(m.bytes), {
    headers: {
      "Content-Type": m.mime,
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
