import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: process.env.IRIS_E2E_URL || 'http://127.0.0.1:5173',
    browserName: 'chromium',
    channel: process.env.IRIS_BROWSER_CHANNEL || undefined,
    trace: 'retain-on-failure',
  },
  workers: 1,
})
