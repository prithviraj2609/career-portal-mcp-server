import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

export interface SessionStore {
  get(provider: string, accountId: string): Promise<string | undefined>;
  set(provider: string, accountId: string, value: string): Promise<void>;
  delete(provider: string, accountId: string): Promise<void>;
}

export class MemorySessionStore implements SessionStore {
  private readonly values = new Map<string, string>();

  async get(provider: string, accountId: string): Promise<string | undefined> {
    return this.values.get(`${provider}:${accountId}`);
  }

  async set(
    provider: string,
    accountId: string,
    value: string,
  ): Promise<void> {
    this.values.set(`${provider}:${accountId}`, value);
  }

  async delete(provider: string, accountId: string): Promise<void> {
    this.values.delete(`${provider}:${accountId}`);
  }
}

interface EncryptedPayload {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class EncryptedFileSessionStore implements SessionStore {
  private readonly key: Buffer;
  private writeChain = Promise.resolve();

  constructor(
    private readonly filePath: string,
    base64Key: string,
  ) {
    this.key = Buffer.from(base64Key, "base64");
    if (this.key.length !== 32) {
      throw new Error("CAREER_PORTAL_SESSION_KEY must decode to exactly 32 bytes");
    }
  }

  async get(provider: string, accountId: string): Promise<string | undefined> {
    const values = await this.readValues();
    return values[`${provider}:${accountId}`];
  }

  async set(
    provider: string,
    accountId: string,
    value: string,
  ): Promise<void> {
    await this.mutate((values) => {
      values[`${provider}:${accountId}`] = value;
    });
  }

  async delete(provider: string, accountId: string): Promise<void> {
    await this.mutate((values) => {
      delete values[`${provider}:${accountId}`];
    });
  }

  private encrypt(values: Record<string, string>): EncryptedPayload {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from("CareerPortalMCP/session-store/v1"));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(values), "utf8"),
      cipher.final(),
    ]);
    return {
      version: 1,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
  }

  private decrypt(payload: EncryptedPayload): Record<string, string> {
    if (payload.version !== 1) {
      throw new Error("Unsupported encrypted session-store version");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(payload.iv, "base64"),
    );
    decipher.setAAD(Buffer.from("CareerPortalMCP/session-store/v1"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as Record<string, string>;
  }

  private async readValues(): Promise<Record<string, string>> {
    try {
      const payload = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as EncryptedPayload;
      return this.decrypt(payload);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return {};
      }
      throw error;
    }
  }

  private async writeValues(values: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        JSON.stringify(this.encrypt(values)),
        { encoding: "utf8", mode: 0o600, flag: "wx" },
      );
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600);
    } catch (error: unknown) {
      await unlink(temporaryPath).catch((cleanupError: unknown) => {
        if (
          !(cleanupError instanceof Error) ||
          !("code" in cleanupError) ||
          cleanupError.code !== "ENOENT"
        ) {
          throw cleanupError;
        }
      });
      throw error;
    }
  }

  private async mutate(
    update: (values: Record<string, string>) => void,
  ): Promise<void> {
    const operation = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        const values = await this.readValues();
        update(values);
        await this.writeValues(values);
      });
    this.writeChain = operation;
    await operation;
  }
}

const sensitiveKeys =
  /authorization|cookie|token|password|secret|session|resume|contact|email|phone/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sensitiveKeys.test(key) ? "[REDACTED]" : redact(child),
      ]),
    );
  }
  return value;
}
