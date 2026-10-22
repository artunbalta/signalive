import { defineConfig, devices } from "@playwright/test";

/**
 * End to end tests in Chromium with a fake microphone that plays speech from
 * tests/fixtures/audio (run `node scripts/make-test-audio.mjs` first, macOS).
 * They run against mock providers and the in-memory store, so no keys are
 * needed, and keys in .env.local are never used: the variables below win
 * over .env files. Each spec picks its own fixture through
 * test.use({ launchOptions }).
 */
const port = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: `npx next dev -p ${port}`,
    url: `http://localhost:${port}/api/config`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: {
      STT_PROVIDER: "mock",
      LLM_PROVIDER: "mock",
      TTS_PROVIDER: "mock",
      EMBEDDINGS_PROVIDER: "mock",
      // Empty counts as unset, which selects the in-memory store.
      NEXT_PUBLIC_SUPABASE_URL: "",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
