import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // One database per run; the tests share it in order.
    sequence: { concurrent: false },
    fileParallelism: false,
  },
});
