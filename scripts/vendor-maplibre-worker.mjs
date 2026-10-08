#!/usr/bin/env node
/**
 * MapLibre GL v6 ships its WebWorker as a separate ES module that it resolves
 * relative to `import.meta.url`. Bundlers rewrite that URL, so we serve the
 * worker from /public/vendor and point MapLibre at it with setWorkerUrl().
 * Runs on postinstall so the copy always matches the installed version.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve("maplibre-gl/package.json"));
const outDir = path.resolve(process.cwd(), "public/vendor");

await mkdir(outDir, { recursive: true });
await copyFile(
  path.join(pkgDir, "dist/maplibre-gl-worker.mjs"),
  path.join(outDir, "maplibre-gl-worker.mjs"),
);
console.log("✓ maplibre-gl worker vendored to public/vendor/");
