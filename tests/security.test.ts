import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EncryptedFileSessionStore,
  redact,
} from "../src/security.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("session security", () => {
  it("encrypts persisted session material", async () => {
    const directory = await mkdtemp(join(tmpdir(), "career-portal-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "sessions.enc");
    const store = new EncryptedFileSessionStore(
      file,
      randomBytes(32).toString("base64"),
    );
    await store.set("linkedin", "me", "sensitive-cookie");

    expect(await store.get("linkedin", "me")).toBe("sensitive-cookie");
    expect(await readFile(file, "utf8")).not.toContain("sensitive-cookie");
  });

  it("redacts nested secrets and personal data", () => {
    expect(
      redact({
        authorization: "Bearer secret",
        nested: { email: "person@example.com", safe: "visible" },
      }),
    ).toEqual({
      authorization: "[REDACTED]",
      nested: { email: "[REDACTED]", safe: "visible" },
    });
  });

  it("rejects invalid encryption keys", () => {
    expect(
      () => new EncryptedFileSessionStore("unused", "dG9vLXNob3J0"),
    ).toThrowError("exactly 32 bytes");
  });

  it("rejects tampered encrypted session data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "career-portal-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "sessions.enc");
    const store = new EncryptedFileSessionStore(
      file,
      randomBytes(32).toString("base64"),
    );
    await store.set("linkedin", "me", "session");
    const payload = JSON.parse(await readFile(file, "utf8")) as {
      ciphertext: string;
    };
    payload.ciphertext = `${payload.ciphertext.slice(0, -2)}AA`;
    await writeFile(file, JSON.stringify(payload));
    await expect(store.get("linkedin", "me")).rejects.toThrow();
  });

  it("serializes concurrent encrypted updates without losing data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "career-portal-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "sessions.enc");
    const store = new EncryptedFileSessionStore(
      file,
      randomBytes(32).toString("base64"),
    );
    await Promise.all([
      store.set("linkedin", "me", "linked-session"),
      store.set("naukri", "me", "naukri-session"),
    ]);
    await expect(store.get("linkedin", "me")).resolves.toBe("linked-session");
    await expect(store.get("naukri", "me")).resolves.toBe("naukri-session");
  });
});
