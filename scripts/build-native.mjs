#!/usr/bin/env node
/**
 * Builds the web app for a native shell (see next.config.ts for the targets).
 *
 *   node scripts/build-native.mjs desktop   standalone server, staged in build/desktop/server/
 *                                           for electron-builder (npm run desktop:dist)
 *   node scripts/build-native.mjs android   static export in out/, synced into android/
 *                                           (then ./gradlew assembleRelease in android/)
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const target = process.argv[2];
if (target !== "desktop" && target !== "android") {
  console.error("usage: node scripts/build-native.mjs <desktop|android>");
  process.exit(2);
}

const root = path.resolve(import.meta.dirname, "..");
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
const npx = (args, env) => run("npx", ["--no-install", ...args], env);

/**
 * Recursive copy that follows symlinks instead of recreating them. Turbopack
 * links server externals into .next/node_modules (junctions on Windows), and
 * installers handle plain files far better than links.
 */
function copyTree(src, dest) {
  const st = lstatSync(src);
  if (st.isSymbolicLink()) return copyTree(realpathSync(src), dest);
  if (st.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const name of readdirSync(src)) copyTree(path.join(src, name), path.join(dest, name));
    return;
  }
  copyFileSync(src, dest);
}

/**
 * Nothing's Glyph SDK (android/app/src/glyph: Glyph lights and the Glyph Matrix toy). Its licence
 * lets apps use it but not redistribute it, so it isn't in this repository: it's downloaded from
 * Nothing's developer kit into android/app/libs/ (gitignored) and checked against the pinned
 * checksum. When it can't be fetched the app builds without Glyph features (src/noglyph);
 * GLYPH_SDK=off skips it on purpose.
 */
const GLYPH_SDK = {
  url: "https://github.com/Nothing-Developer-Programme/GlyphMatrix-Developer-Kit/raw/refs/heads/main/glyph-matrix-sdk-2.0.aar",
  file: path.join(root, "android", "app", "libs", "glyph-matrix-sdk-2.0.aar"),
  /** Pinned after the first download; a different file fails the build until it is checked and re-pinned. */
  sha256: "be00ee9cd7115f6b11984c6e31fe98e298fb726940d1555063610685ef3bbf29",
};

async function fetchGlyphSdk() {
  const { url, file, sha256 } = GLYPH_SDK;
  if (process.env.GLYPH_SDK === "off") {
    rmSync(file, { force: true });
    console.log("Glyph SDK: off (GLYPH_SDK=off), building without Glyph features");
    return;
  }
  const digest = (buf) => createHash("sha256").update(buf).digest("hex");
  if (existsSync(file) && sha256 && digest(readFileSync(file)) === sha256) return;
  let buf;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    // An .aar is a zip; anything else (an error page) isn't the SDK.
    if (buf.length < 1024 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("the download isn't an .aar");
  } catch (err) {
    rmSync(file, { force: true });
    console.log(`::warning::Couldn't download Nothing's Glyph SDK (${err instanceof Error ? err.message : err}); building without Glyph features.`);
    return;
  }
  const got = digest(buf);
  if (sha256 && got !== sha256) {
    throw new Error(`Nothing's Glyph SDK changed (sha256 ${got}, pinned ${sha256}). Check the new version, then update GLYPH_SDK.sha256 in scripts/build-native.mjs.`);
  }
  if (!sha256) console.log(`::warning::Glyph SDK isn't pinned yet: sha256 ${got}. Set GLYPH_SDK.sha256 in scripts/build-native.mjs.`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, buf);
  console.log(`✓ Glyph SDK ${path.relative(root, file)} (${buf.length} bytes)`);
}

// Builds for different targets share .next/; never let one package another's output.
rmSync(path.join(root, ".next"), { recursive: true, force: true });
npx(["next", "build"], { BUILD_TARGET: target === "android" ? "mobile" : "desktop", NEXT_TELEMETRY_DISABLED: "1" });

if (target === "desktop") {
  // The standalone server serves .next/static and public/ itself once they're copied in.
  const out = path.join(root, "build", "desktop", "server");
  rmSync(out, { recursive: true, force: true });
  copyTree(path.join(root, ".next", "standalone"), out);
  cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
  cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
  // Never ship a developer's local database or env files.
  for (const junk of ["data", ".env", ".env.local", ".env.production", ".env.production.local"]) rmSync(path.join(out, junk), { recursive: true, force: true });
  if (!existsSync(path.join(out, "server.js"))) throw new Error("standalone build is missing server.js");
  console.log(`✓ desktop server staged in ${path.relative(root, out)}/`);
} else {
  // The background runner (alert checks and the widget while the app is closed) is a separate,
  // self-contained script; Capacitor copies it from out/ into the APK's assets.
  npx(["esbuild", "src/native/runner/background.ts", "--bundle", "--format=iife", "--target=es2019", "--platform=neutral", "--main-fields=module,main", "--minify", "--outfile=out/runners/background.js"]);
  // The offline page (Capacitor's server.errorPath when a hosted app doesn't load) retries the build's addresses.
  if (process.env.STORMCENTRAL_URL) {
    const file = path.join(root, "out", "offline.html");
    const backup = process.env.STORMCENTRAL_BACKUP_URL ?? "https://storm-central-pi.vercel.app";
    const attr = (s) => s.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);
    writeFileSync(
      file,
      readFileSync(file, "utf8")
        .replace(/(<meta name="sc-app" content=")[^"]*/, `$1${attr(process.env.STORMCENTRAL_URL)}`)
        .replace(/(<meta name="sc-backup" content=")[^"]*/, `$1${backup === "none" ? "" : attr(backup)}`),
    );
  }
  await fetchGlyphSdk();
  npx(["cap", "sync", "android"]);
  console.log("✓ static bundle synced to android/ (build it with: cd android && ./gradlew assembleRelease)");
}
