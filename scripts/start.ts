import { config as loadEnvironment } from "dotenv";
import { mkdir, chmod } from "node:fs/promises";
import { spawn } from "node:child_process";
import { loadRuntimeConfig } from "../src/config/runtime";
import { openDatabase } from "../src/db/database";

loadEnvironment({ quiet: true });
const config = loadRuntimeConfig(process.env);
await mkdir(config.stateDirectory, { recursive: true, mode: 0o700 });
await chmod(config.stateDirectory, 0o700);
const migratedDatabase = openDatabase(`${config.stateDirectory}/horizonbound.sqlite`);
console.log(`Applied ${migratedDatabase.schemaVersion()} Horizonbound migration(s).`);
migratedDatabase.close();

if (config.nonLoopbackWarning) {
  console.warn(`\nWARNING: ${config.nonLoopbackWarning}\n`);
}

const nextBin = new URL("../node_modules/next/dist/bin/next", import.meta.url).pathname;
const child = spawn(
  process.execPath,
  [nextBin, "start", "--hostname", config.host, "--port", String(config.port)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      APP_BASE_URL: config.appBaseUrl.origin,
      HORIZONBOUND_STATE_DIR: config.stateDirectory
    }
  }
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}

child.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
