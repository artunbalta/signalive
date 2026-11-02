import { defineConfig } from "vitest/config";

// The shell's pure parts (bridge messages, routing, navigation rules, the injected
// script), in Node. Nothing here needs a phone or React Native.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
