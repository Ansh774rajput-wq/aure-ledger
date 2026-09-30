import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const port = process.env.TEST_PORT || "3001";
const baseURL = `http://127.0.0.1:${port}`;
const testDbUrl =
  process.env.TEST_DATABASE_URL ||
  "postgresql://lending:local_password@localhost:5432/lending_test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--disable-gpu",
          ],
        }
      : undefined,
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `DATABASE_URL="${testDbUrl}" APP_ORIGIN="${baseURL}" PORT=${port} npm run start`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
