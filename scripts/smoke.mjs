import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";

const stateDirectory = await mkdtemp(path.join(tmpdir(), "horizonbound-smoke-"));
const port = 43127;
const origin = `http://127.0.0.1:${port}`;

async function startAndCheck() {
  const child = spawn("npm", ["start"], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      APP_BASE_URL: origin,
      HOST: "127.0.0.1",
      PORT: String(port),
      HORIZONBOUND_STATE_DIR: stateDirectory,
      NEXT_TELEMETRY_DISABLED: "1"
    }
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += String(chunk)));
  child.stderr.on("data", (chunk) => (output += String(chunk)));

  const deadline = Date.now() + 30_000;
  let response;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Production server exited early.\n${output}`);
    try {
      response = await fetch(`${origin}/api/health`);
      if (response.ok) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!response?.ok) throw new Error(`Production server did not become healthy.\n${output}`);
  const body = await response.json();
  if (body.status !== "ok" || body.service !== "horizonbound") {
    throw new Error(`Unexpected health response: ${JSON.stringify(body)}`);
  }
  return child;
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const terminate = (signal) => {
    try {
      if (process.platform === "win32") child.kill(signal);
      else process.kill(-child.pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  };
  const exited = new Promise((resolve) => child.once("exit", resolve));
  terminate("SIGTERM");
  let timer;
  await Promise.race([
    exited,
    new Promise((resolve) => {
      timer = setTimeout(() => {
        if (child.exitCode === null) terminate("SIGKILL");
        resolve();
      }, 5_000);
    })
  ]);
  if (timer) clearTimeout(timer);
  child.unref();
}

let child;
try {
  child = await startAndCheck();
  await stop(child);

  const databasePath = path.join(stateDirectory, "horizonbound.sqlite");
  const database = new Database(databasePath);
  database
    .prepare(
      "INSERT INTO oauth_states (correlation_hash, state_hash, verifier_ciphertext, redirect_uri, expires_at) VALUES ('smoke', 'smoke-state', 'ciphertext', ?, ?)"
    )
    .run(`${origin}/api/auth/linear/callback`, Date.now() + 60_000);
  database.close();

  child = await startAndCheck();
  await stop(child);
  const reopened = new Database(databasePath, { readonly: true });
  const persisted = reopened
    .prepare("SELECT COUNT(*) FROM oauth_states WHERE correlation_hash = 'smoke'")
    .pluck()
    .get();
  reopened.close();
  if (persisted !== 1) throw new Error("Persisted state was not readable after production restart");

  console.log(
    "Production smoke passed: migrations, health, restart, and persisted state verified."
  );
} finally {
  if (child) await stop(child);
  await rm(stateDirectory, { recursive: true, force: true });
}
