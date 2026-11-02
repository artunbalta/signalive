import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // The earbud software lives at the repo root, shared with the site.
      "@sense": fileURLToPath(new URL("../lib/sense", import.meta.url)),
      // Next.js resolves this marker package itself; outside Next it throws.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
