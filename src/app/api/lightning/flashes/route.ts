import { parseBbox } from "@/lib/radar/lightning";
import { glmFlashes } from "@/lib/server/glm";
import { badRequest, errorResponse, jsonResponse } from "@/lib/server/respond";

/**
 * GET /api/lightning/flashes?bbox=west,south,east,north → LightningFile: the
 * GOES GLM flashes of the last 15 minutes in the area, for the map's bolts.
 * NOAA's files are read once per server for everyone (src/lib/server/glm.ts),
 * and answers are cached for 30 s.
 */
export async function GET(req: Request) {
  const bbox = parseBbox(new URL(req.url).searchParams.get("bbox"));
  if (!bbox) return badRequest("bbox=west,south,east,north required");
  try {
    return jsonResponse(await glmFlashes(bbox), 30);
  } catch (err) {
    return errorResponse(err);
  }
}
