import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — DOM-nesting / hydration smoke tests.
 *
 * These tests walk every route and fail on invalid DOM nesting (e.g. a
 * `<button>` inside a `<button>`) — bugs `tsc` and the (absent) linter cannot
 * catch, because they only surface in React's resolved render tree.
 *
 * Requires the full local stack running first (validator + `novus init all`
 * + `bun dev`). See README → "Running Locally" → smoke-test step.
 */
export default defineConfig({
  testDir: './tests/smoke',
  timeout: 60_000,
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Reuse the dev server from README step 5 if it is already up; otherwise
  // start it. The server still needs the local validator + initialized game
  // data to render game routes.
  webServer: {
    command: 'bun dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
