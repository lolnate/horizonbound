import { defineConfig } from "@playwright/test";
import { e2eBaseUrl, e2eEncryptionKey, e2eStateDirectory } from "./e2e/support";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: e2eBaseUrl,
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npm start",
    url: `${e2eBaseUrl}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      APP_BASE_URL: e2eBaseUrl,
      HOST: "127.0.0.1",
      PORT: "3000",
      HORIZONBOUND_STATE_DIR: e2eStateDirectory,
      TOKEN_ENCRYPTION_KEY: e2eEncryptionKey,
      LINEAR_CLIENT_ID: "synthetic-client",
      HORIZONBOUND_ENABLE_SYNTHETIC_SOURCE: "1"
    }
  }
});
