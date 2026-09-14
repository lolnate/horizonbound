import { spawn } from "node:child_process";
import path from "node:path";

const port = 43128;
const origin = `http://127.0.0.1:${port}`;
const stateDirectory = path.join(process.cwd(), ".horizonbound", "e2e");
const child = spawn("npm", ["start"], {
  stdio: ["ignore", "pipe", "pipe"],
  detached: process.platform !== "win32",
  env: {
    ...process.env,
    APP_BASE_URL: origin,
    HOST: "127.0.0.1",
    PORT: String(port),
    HORIZONBOUND_STATE_DIR: stateDirectory,
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    LINEAR_CLIENT_ID: "synthetic-client",
    HORIZONBOUND_ENABLE_SYNTHETIC_SOURCE: "1",
    NEXT_TELEMETRY_DISABLED: "1"
  }
});
let output = "";
child.stdout.on("data", (chunk) => (output += String(chunk)));
child.stderr.on("data", (chunk) => (output += String(chunk)));

async function stop() {
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

try {
  const deadline = Date.now() + 30_000;
  let response;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Restart server exited early.\n${output}`);
    try {
      response = await fetch(origin, {
        headers: { Cookie: "horizonbound_session=horizonbound-e2e-session" }
      });
      if (response.ok) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (!response?.ok) throw new Error(`Restarted application did not respond.\n${output}`);
  const html = await response.text();
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&middot;", "·")
    .replace(/\s+/g, " ");
  for (const expected of [
    "E2E operator · Synthetic workspace",
    "Launch roadmap",
    "19 / 21 / 23 points",
    "Initial planning baseline"
  ]) {
    if (!text.includes(expected)) throw new Error(`Restarted cached view omitted: ${expected}`);
  }
  console.log(
    "Production restart proof passed: cached roadmap and forecast rendered without refresh."
  );
} finally {
  await stop();
}
