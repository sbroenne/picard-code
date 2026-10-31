import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  timeout: 30_000,
  use: { headless: true },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
  ],
});
