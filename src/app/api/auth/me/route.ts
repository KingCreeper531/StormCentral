import { getSessionUser } from "@/lib/auth/session";

export async function GET() {
  const user = await getSessionUser({ refresh: true });
  return Response.json({ user }, { headers: { "Cache-Control": "private, no-store" } });
}
