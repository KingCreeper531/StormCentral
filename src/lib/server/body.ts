import "server-only";

/** Sign-in and account forms are a few hundred bytes of JSON. */
export const MAX_JSON_BYTES = 16 * 1024;

const tooLarge = (message: string) => Response.json({ error: message }, { status: 413, headers: { "Cache-Control": "no-store" } });

/**
 * The request body, or a 413 response when it's over `max` bytes: refused by
 * its Content-Length before anything is read, and counted as it arrives when
 * there's none (a chunked upload), so nobody can make the server hold a huge
 * body in memory.
 */
export async function readBody(req: Request, max: number, message = "That request is too big"): Promise<Uint8Array | Response> {
  if (Number(req.headers.get("content-length")) > max) return tooLarge(message);
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return tooLarge(message);
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** The JSON body (null when it isn't JSON), or a 413 response when it's over `max` bytes. */
export async function readJson(req: Request, max = MAX_JSON_BYTES): Promise<unknown> {
  try {
    const body = await readBody(req, max);
    return body instanceof Response ? body : JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
}

/** The multipart/form-data body (null when it can't be read), or a 413 response when it's over `max` bytes. */
export async function readForm(req: Request, max: number, message?: string): Promise<FormData | Response | null> {
  try {
    const body = await readBody(req, max, message);
    if (body instanceof Response) return body;
    return await new Response(body as BodyInit, { headers: { "Content-Type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return null;
  }
}
