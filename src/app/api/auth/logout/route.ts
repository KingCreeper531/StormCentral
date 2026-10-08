import { destroySession } from "@/lib/auth/session";
import { forbidden, sameOrigin } from "@/lib/server/guard";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  await destroySession();
  return Response.json({ ok: true });
}
