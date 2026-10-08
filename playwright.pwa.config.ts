// The offline tests need a production build served by FastAPI, which they start and stop
// themselves, so they run apart from the dev-server suite.
import { defineConfig, devices } from "@playwright/test";
import { GATEWAY_PORT } from "./tests/pwa/server";

export default defineConfig({
  testDir: "./tests/pwa",
  timeout: 60000,
  fullyParallel: false,
  // The cases share one server and its build.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${GATEWAY_PORT}`,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 720 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
