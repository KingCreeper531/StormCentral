/**
 * Taking the wheel of the live stream: a small HTTP API on the server itself
 * (127.0.0.1 only; reach it through an SSH tunnel, `ssh -L 8787:127.0.0.1:8787
 * root@<stream server>`). Everything it does goes through the director, so
 * graphics, captions and the title stay consistent.
 *
 *   GET  /state                        what's on air, the warnings, the title
 *   POST /show  {lat, lon, name, mode?: "severe"|"professional", seconds?}
 *   POST /pin   {key}                  keep coming back to one warning (DELETE /pin to stop)
 *   POST /say   {text}                 read something out (with captions)
 *   POST /title {text}                 set the live title (DELETE /title to go back to automatic)
 */
import { createServer, type IncomingMessage } from "node:http";

export interface Controls {
  state(): unknown;
  show(place: { lat: number; lon: number; name: string; mode: "severe" | "professional"; seconds: number }): void;
  pin(key: string | null): boolean;
  say(text: string): void;
  title(text: string | null): void;
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error("too large");
  }
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

export function startControl(port: number, c: Controls, log: (msg: string) => void) {
  const server = createServer(async (req, res) => {
    const send = (code: number, data: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      const b = req.method === "POST" ? await body(req) : {};
      const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
      if (req.method === "GET" && path === "/state") return send(200, c.state());
      if (req.method === "POST" && path === "/show") {
        const lat = Number(b.lat), lon = Number(b.lon);
        if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return send(400, { error: "lat and lon please" });
        c.show({ lat, lon, name: text(b.name, 60) || "Storm Central", mode: b.mode === "professional" ? "professional" : "severe", seconds: Math.min(600, Math.max(20, Number(b.seconds) || 60)) });
        return send(200, { ok: true });
      }
      if (path === "/pin" && (req.method === "POST" || req.method === "DELETE")) return send(200, { ok: c.pin(req.method === "POST" ? text(b.key, 80) : null) });
      if (req.method === "POST" && path === "/say") {
        const t = text(b.text, 600);
        if (!t) return send(400, { error: "text please" });
        c.say(t);
        return send(200, { ok: true });
      }
      if (path === "/title" && (req.method === "POST" || req.method === "DELETE")) {
        c.title(req.method === "POST" ? text(b.text, 100) || null : null);
        return send(200, { ok: true });
      }
      send(404, { error: "GET /state, POST /show /pin /say /title" });
    } catch (err) {
      send(400, { error: err instanceof Error ? err.message : String(err) });
    }
  });
  server.listen(port, "127.0.0.1", () => log(`control API on 127.0.0.1:${port}`));
  server.on("error", (err) => log(`control API unavailable: ${err.message}`));
  return server;
}
