import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // Tests run server modules directly; the marker only matters to bundlers.
      "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "shorts/**/*.test.ts", "stream/**/*.test.ts", "desktop/*.test.mjs", "scripts/*.test.ts"],
  },
});
