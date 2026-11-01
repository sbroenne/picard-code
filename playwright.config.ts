import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  timeout: 30_000,
  // Each test starts its own server, port and temporary folder, so tests run side by side.
  // They mostly wait on timers, so GitHub's 4-processor runner can use 4 workers.
  fullyParallel: true,
  workers: process.env.CI ? 4 : undefined,
  use: { headless: true },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
  ],
});
