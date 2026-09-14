import path from "node:path";

export const e2eStateDirectory = path.join(process.cwd(), ".horizonbound", "e2e");
export const e2eSessionToken = "horizonbound-e2e-session";
export const e2eBaseUrl = "http://127.0.0.1:3000";
export const e2eEncryptionKey = Buffer.alloc(32, 7).toString("base64");
