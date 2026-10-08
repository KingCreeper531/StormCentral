// @ts-check
import { app, utilityProcess } from "electron";
import { createWriteStream } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

/**
 * Runs the app's own Next.js server (the `standalone` build staged by
 * scripts/build-native.mjs) in an Electron utility process, bound to
 * loopback only. The port is fixed so the UI keeps one origin across
 * launches, and with it its saved settings and cache.
 */
const PREFERRED_PORT = 47613;
const START_TIMEOUT_MS = 45_000;

/** @param {number} port */
function canListen(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });
}

/** @returns {Promise<number>} */
function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      s.close(() => (addr && typeof addr === "object" ? resolve(addr.port) : reject(new Error("no port"))));
    });
  });
}

/** @param {string} url */
function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(2_000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** libSQL `file:` URL for a Windows or POSIX path (forward slashes, URL-special characters escaped). */
export function sqliteUrl(file) {
  return "file:" + file.replace(/\\/g, "/").replace(/%/g, "%25").replace(/#/g, "%23").replace(/\?/g, "%3F");
}

/**
 * @param {{ log: (m: string) => void, onCrash: (code: number) => void }} opts
 * @returns {Promise<string>} the server's base URL
 */
export async function startLocalServer({ log, onCrash }) {
  const dir = app.isPackaged ? path.join(process.resourcesPath, "server") : path.resolve(app.getAppPath(), "..", "build", "desktop", "server");
  let port = PREFERRED_PORT;
  if (!(await canListen(port))) {
    port = await ephemeralPort();
    log(`server: port ${PREFERRED_PORT} is in use, falling back to ${port} (saved settings won't load this session)`);
  }

  const child = utilityProcess.fork(path.join(dir, "server.js"), [], {
    cwd: dir,
    serviceName: "StormCentral server",
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      // Accounts and reports live with the user's app data, so updates never touch them.
      DATABASE_URL: sqliteUrl(path.join(app.getPath("userData"), "stormcentral.db")),
      DATABASE_AUTH_TOKEN: "",
      // Plain HTTP on loopback: no Secure cookies, and only our own Host may write.
      SESSION_COOKIE_SECURE: "false",
      ALLOWED_HOST: `127.0.0.1:${port}`,
    },
  });
  const out = createWriteStream(path.join(app.getPath("logs"), "server.log"), { flags: "a" });
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);

  let ready = false;
  let quitting = false;
  app.once("will-quit", () => {
    quitting = true;
    child.kill();
  });
  const exited = new Promise((_, reject) => {
    child.once("exit", (code) => {
      log(`server: exited with code ${code}`);
      if (ready && !quitting) onCrash(code);
      reject(new Error(`The local server stopped during startup (exit code ${code}).`));
    });
  });
  exited.catch(() => {}); // after startup, crashes go to onCrash

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + START_TIMEOUT_MS;
  const waitReady = (async () => {
    while (Date.now() < deadline) {
      if (await ping(`${base}/api/auth/me`)) return;
      await new Promise((r) => setTimeout(r, 150));
    }
    child.kill();
    throw new Error("The local server didn't start in time.");
  })();
  await Promise.race([waitReady, exited]);
  ready = true;
  log(`server: ready on ${base}`);
  return base;
}
