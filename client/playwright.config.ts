import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Browser E2E against an ISOLATED stack: a hermetic backend on :4100 (temp SQLite, rule engine,
 * no real keys / no network) + Vite on :5174 proxying to it. Your dev servers on :4000/:5173 are untouched.
 */
const API_PORT = 4100;
const WEB_PORT = 5174;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 1, // a test that only passes on retry is reported as "flaky" (with trace), never silently green
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: 'chrome', // use the installed Google Chrome
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    permissions: ['microphone'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: 'chrome', viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: 'chrome' }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: 'npx tsx src/index.ts',
      cwd: path.resolve(here, '../server'),
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        SKIP_DOTENV: '1',
        PORT: String(API_PORT),
        DB_PATH: path.join(os.tmpdir(), `shopbuddy-e2e-${Date.now()}.db`),
        APP_NAME: 'ShopBuddy',
        LLM_PROXY_SECRET: 'e2e-secret',
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_TARGET: `http://localhost:${API_PORT}` },
    },
  ],
});
