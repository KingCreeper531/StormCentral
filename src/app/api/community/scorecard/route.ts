import { parseWindow } from "@/lib/scorecard";
import { getScorecard } from "@/lib/server/scorecard-repo";
import { badRequest, jsonResponse } from "@/lib/server/respond";

/**
 * GET /api/community/scorecard?days=7|30|90 (default 30)
 * How often the forecast model showed the weather spotters reported.
 */
export async function GET(req: Request) {
  const days = parseWindow(new URL(req.url).searchParams.get("days"));
  if (days == null) return badRequest("days must be 7, 30 or 90");
  try {
    return jsonResponse(await getScorecard(days), 300);
  } catch (err) {
    // Log the cause; don't send database details to the client.
    console.error("[api] scorecard", err);
    return Response.json({ error: "Internal server error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
