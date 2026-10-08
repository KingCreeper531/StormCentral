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
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from "node:fs";
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
  npx(["cap", "sync", "android"]);
  console.log("✓ static bundle synced to android/ (build it with: cd android && ./gradlew assembleRelease)");
}
