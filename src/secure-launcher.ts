#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const keyFile = process.env.CAREER_PORTAL_SESSION_KEY_FILE;
if (!keyFile) {
  throw new Error("CAREER_PORTAL_SESSION_KEY_FILE is required");
}

const key = (await readFile(keyFile, "utf8")).trim();
let decoded: Buffer;
try {
  decoded = Buffer.from(key, "base64");
} catch {
  throw new Error("Session key file must contain base64");
}
if (decoded.length !== 32 || decoded.toString("base64") !== key) {
  throw new Error("Session key file must contain exactly 32 base64 bytes");
}

const serverPath = fileURLToPath(new URL("./index.js", import.meta.url));
const child = spawn(process.execPath, [serverPath], {
  stdio: "inherit",
  env: {
    ...process.env,
    CAREER_PORTAL_SESSION_KEY: key,
  },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  process.stderr.write(`CareerPortalMCP launcher failed: ${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
