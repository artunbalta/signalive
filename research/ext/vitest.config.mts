import { defineConfig } from "vitest/config";

// The phone's own detectors on public recordings (research/ext). Not part of
// `npm test`: it needs the downloads in research/ext/data first.
export default defineConfig({
  test: {
    include: ["research/ext/**/*.test.ts"],
    testTimeout: 900_000,
  },
});
