import { open, realpath, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { z } from "zod";
import { CareerPortalError } from "../errors.js";
import type { FieldChange, ProviderName } from "../types.js";
import type {
  BrowserPage,
  ProviderBrowserWorkflow,
} from "./types.js";
import { assertProviderUrl } from "./playwright-launcher.js";

export interface FieldSelector {
  read: string;
  readMany?: boolean;
  edit: string;
  input: string;
  save: string;
  schema: z.ZodType<unknown>;
}

export interface WorkflowSelectors {
  authenticated: string;
  challenge: string[];
  fields: Record<string, FieldSelector>;
  resume?: {
    current: string;
    edit: string;
    input: string;
    save?: string;
  };
}

export abstract class SelectorWorkflow implements ProviderBrowserWorkflow {
  abstract readonly provider: ProviderName;
  abstract readonly loginUrl: string;
  readonly authStatusUrl?: string;
  abstract readonly profileUrl: string;
  protected abstract readonly selectors: WorkflowSelectors;

  async isAuthenticated(page: BrowserPage): Promise<boolean> {
    return page.isVisible(this.selectors.authenticated);
  }

  async assertSafePage(page: BrowserPage): Promise<void> {
    assertProviderUrl(this.provider, page.url());
    if (/captcha|checkpoint|challenge/i.test(page.url())) {
      throw new CareerPortalError(
        "ANTI_BOT_CHALLENGE",
        `${this.provider} requires CAPTCHA, MFA, or account verification`,
      );
    }
    for (const selector of this.selectors.challenge) {
      if (await page.isVisible(selector)) {
        throw new CareerPortalError(
          "ANTI_BOT_CHALLENGE",
          `${this.provider} requires CAPTCHA, MFA, or account verification`,
        );
      }
    }
  }

  async readProfile(
    page: BrowserPage,
    fields?: readonly string[],
  ): Promise<Record<string, unknown>> {
    await this.assertSafePage(page);
    const requested = fields
      ? Object.entries(this.selectors.fields).filter(([field]) =>
          fields.includes(field))
      : Object.entries(this.selectors.fields);
    const entries = await Promise.all(
      requested.map(async ([field, selector]) => [
        field,
        selector.readMany
          ? await page.texts(selector.read)
          : await page.text(selector.read),
      ] as const),
    );
    const resumeSelectors = this.selectors.resume;
    const includeResume = resumeSelectors &&
      (!fields || fields.includes("resume.current") || fields.includes("resume.path"));
    const resume = includeResume
      ? await page.text(resumeSelectors.current)
      : undefined;
    await this.assertSafePage(page);
    return Object.fromEntries([
      ...entries,
      ...(includeResume
        ? ([["resume.current", resume]] as const)
        : []),
    ]);
  }

  async applyChanges(
    page: BrowserPage,
    changes: FieldChange[],
    resumeMaxBytes: number,
    resumeDirectory: string | undefined,
  ): Promise<void> {
    const completed: string[] = [];
    for (const change of changes) {
      try {
        if (change.field === "resume.path") {
          await this.uploadResume(
            page,
            change,
            resumeMaxBytes,
            resumeDirectory,
          );
        } else {
          await this.applyField(page, change);
        }
        await this.assertSafePage(page);
        completed.push(change.field);
      } catch (error: unknown) {
        if (completed.length === 0) throw error;
        const uncertain = error instanceof CareerPortalError &&
          error.code === "OUTCOME_UNKNOWN"
          ? change.field
          : "none";
        throw new CareerPortalError(
          "OUTCOME_UNKNOWN",
          `Mutation stopped. Completed fields: ${completed.join(", ")}; uncertain fields: ${uncertain}; failed field: ${change.field}. Remaining fields were not attempted. Verify provider state before retrying. Cause: ${
            error instanceof Error ? error.message : "unknown browser error"
          }`,
        );
      }
    }
  }

  private async applyField(
    page: BrowserPage,
    change: FieldChange,
  ): Promise<void> {
    const selector = this.selectors.fields[change.field];
    if (!selector) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        `${this.provider} does not support field ${change.field}`,
      );
    }
    const value =
      change.operation === "remove"
        ? ""
        : formatInput(selector.schema.parse(change.value));
    await this.selectorAction(change.field, async (markSubmitted) => {
      await this.assertSafePage(page);
      await page.click(selector.edit);
      await this.assertSafePage(page);
      await page.waitForFirst(selector.input);
      await this.assertSafePage(page);
      await page.fill(selector.input, value);
      await this.assertSafePage(page);
      await page.click(selector.save);
      markSubmitted();
      await page.waitForFirst(selector.read);
      await this.assertSafePage(page);
      const actual = selector.readMany
        ? await page.texts(selector.read)
        : await page.text(selector.read);
      if (!sameValue(actual, change.operation === "remove" ? undefined : selector.schema.parse(change.value))) {
        throw new CareerPortalError(
          "OUTCOME_UNKNOWN",
          `${this.provider} accepted the ${change.field} submission but the requested value was not conclusively observed. Completed fields: none; uncertain fields: ${change.field}.`,
        );
      }
    });
  }

  private async uploadResume(
    page: BrowserPage,
    change: FieldChange,
    resumeMaxBytes: number,
    resumeDirectory: string | undefined,
  ): Promise<void> {
    if (change.operation !== "set" || typeof change.value !== "string") {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "resume.path requires a local file path set operation",
      );
    }
    const resume = this.selectors.resume;
    if (!resume) {
      throw new CareerPortalError(
        "CAPABILITY_UNAVAILABLE",
        `${this.provider} does not expose a supported resume replacement workflow`,
      );
    }
    if (!resumeDirectory) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "Resume uploads require CAREER_PORTAL_RESUME_DIRECTORY",
      );
    }
    const allowedRoot = await realpath(resolve(resumeDirectory));
    const path = await realpath(resolve(change.value));
    const relativePath = relative(allowedRoot, path);
    if (
      relativePath === "" ||
      relativePath.startsWith("..") ||
      resolve(allowedRoot, relativePath) !== path
    ) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "Resume path must be a file inside CAREER_PORTAL_RESUME_DIRECTORY",
      );
    }
    const extension = extname(path).toLowerCase();
    if (![".pdf", ".doc", ".docx"].includes(extension)) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "Resume must be a PDF, DOC, or DOCX file",
      );
    }
    const file = await stat(path);
    if (!file.isFile() || file.size === 0 || file.size > resumeMaxBytes) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        `Resume must be a non-empty file no larger than ${resumeMaxBytes} bytes`,
      );
    }
    if (!(await matchesResumeSignature(path, extension))) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        `Resume contents do not match the ${extension} file type`,
      );
    }
    await this.selectorAction("resume.path", async (markSubmitted) => {
      await this.assertSafePage(page);
      await page.click(resume.edit);
      await this.assertSafePage(page);
      await page.setInputFiles(resume.input, path);
      markSubmitted();
      if (resume.save) {
        await this.assertSafePage(page);
        await page.click(resume.save);
      }
      await page.waitFor(resume.current);
      await this.assertSafePage(page);
      const observed = await page.text(resume.current);
      const expected = path.replace(/^.*[\\/]/, "");
      if (normalizeText(observed) !== normalizeText(expected)) {
        throw new CareerPortalError(
          "OUTCOME_UNKNOWN",
          `${this.provider} accepted the resume submission but ${expected} was not conclusively observed. Completed fields: none; uncertain fields: resume.path.`,
        );
      }
    });
  }

  private async selectorAction(
    field: string,
    action: (markSubmitted: () => void) => Promise<void>,
  ): Promise<void> {
    let submitted = false;
    try {
      await action(() => {
        submitted = true;
      });
    } catch (error: unknown) {
      if (error instanceof CareerPortalError) throw error;
      if (submitted) {
        throw new CareerPortalError(
          "OUTCOME_UNKNOWN",
          `${this.provider} may have updated ${field}, but post-save verification failed. Re-read provider state before retrying.`,
        );
      }
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        `${this.provider} UI selector failed while updating ${field}: ${
          error instanceof Error ? error.message : "unknown browser error"
        }`,
      );
    }
  }
}

function formatInput(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) &&
      JSON.stringify(actual.map(normalizeText)) ===
        JSON.stringify(expected.map((value) => normalizeText(String(value))));
  }
  return normalizeText(typeof actual === "string" ? actual : undefined) ===
    normalizeText(typeof expected === "string" ? expected : undefined);
}

function normalizeText(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ") ?? "";
}

export const textField = z.string().trim().min(1).max(2000);
export const shortTextField = z.string().trim().min(1).max(250);
export const stringListField = z.array(
  z.string().trim().min(1).max(100),
).min(1).max(50);

async function matchesResumeSignature(
  path: string,
  extension: string,
): Promise<boolean> {
  const handle = await open(path, "r");
  try {
    const header = Buffer.alloc(8);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const value = header.subarray(0, bytesRead);
    if (extension === ".pdf") return value.subarray(0, 5).toString() === "%PDF-";
    if (extension === ".docx") {
      return value[0] === 0x50 && value[1] === 0x4b;
    }
    return value.subarray(0, 4).equals(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0]),
    );
  } finally {
    await handle.close();
  }
}
