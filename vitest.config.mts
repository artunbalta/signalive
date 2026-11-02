import { defineConfig } from "vitest/config";

// Unit tests for the signal pipeline in lib/sense. The trial app has its own.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    exclude: ["node_modules", "trial", ".next"],
  },
});
