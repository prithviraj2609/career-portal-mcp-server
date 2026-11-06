import {
  chromium,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from "playwright";
import type {
  BrowserHandle,
  BrowserLauncher,
  BrowserPage,
} from "./types.js";
import { CareerPortalError } from "../errors.js";
import type { ProviderName } from "../types.js";

interface SerializedStorageState {
  cookies: Array<{ domain: string; [key: string]: unknown }>;
  origins: Array<{ origin: string; [key: string]: unknown }>;
}

const providerDomains: Record<ProviderName, string> = {
  linkedin: "linkedin.com",
  naukri: "naukri.com",
};

export function assertProviderUrl(provider: ProviderName, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw unsafeOrigin(provider, value);
  }
  if (
    url.protocol !== "https:" ||
    !isProviderHost(provider, url.hostname)
  ) {
    throw unsafeOrigin(provider, value);
  }
}

export function sanitizeStorageState(
  provider: ProviderName,
  serialized: string,
): string {
  let state: SerializedStorageState;
  try {
    state = JSON.parse(serialized) as SerializedStorageState;
  } catch {
    throw new CareerPortalError(
      "AUTH_REQUIRED",
      `Stored ${provider} browser session is invalid`,
    );
  }
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw new CareerPortalError(
      "AUTH_REQUIRED",
      `Stored ${provider} browser session has an invalid shape`,
    );
  }
  for (const entry of state.origins) {
    if (!entry || typeof entry.origin !== "string") {
      throw new CareerPortalError(
        "AUTH_REQUIRED",
        `Stored ${provider} browser session has an invalid origin`,
      );
    }
    assertProviderUrl(provider, entry.origin);
  }
  return JSON.stringify({
    ...state,
    cookies: state.cookies.filter(
      (cookie) =>
        cookie &&
        typeof cookie.domain === "string" &&
        isProviderHost(provider, cookie.domain.replace(/^\./, "")),
    ),
  });
}

class PlaywrightPage implements BrowserPage {
  constructor(
    private readonly page: Page,
    private readonly provider: ProviderName,
  ) {}

  async goto(url: string): Promise<void> {
    assertProviderUrl(this.provider, url);
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    this.assertCurrentUrl();
  }

  url(): string {
    return this.page.url();
  }

  async title(): Promise<string> {
    this.assertCurrentUrl();
    const value = await this.page.title();
    this.assertCurrentUrl();
    return value;
  }

  async text(selector: string): Promise<string | undefined> {
    this.assertCurrentUrl();
    const locator = this.page.locator(selector);
    const count = await locator.count();
    if (count === 0) return undefined;
    if (count !== 1) throw ambiguousSelector(selector, count);
    const value = (await locator.textContent())?.trim() || undefined;
    this.assertCurrentUrl();
    return value;
  }

  async texts(selector: string): Promise<string[]> {
    this.assertCurrentUrl();
    const values = (await this.page.locator(selector).allTextContents())
      .map((value) => value.trim())
      .filter(Boolean);
    this.assertCurrentUrl();
    return values;
  }

  async attributes(selector: string, name: string): Promise<string[]> {
    this.assertCurrentUrl();
    const values = await this.page.locator(selector).evaluateAll(
      (elements, attributeName) =>
        elements.flatMap((element) => {
          const value = element.getAttribute(attributeName);
          return value === null ? [] : [value];
        }),
      name,
    );
    this.assertCurrentUrl();
    return values;
  }

  async values(selector: string): Promise<string[]> {
    this.assertCurrentUrl();
    const values = await this.page.locator(selector).evaluateAll((elements) =>
      elements.flatMap((element) => {
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        ) {
          return [element.value];
        }
        return [];
      })
    );
    this.assertCurrentUrl();
    return values;
  }

  async click(selector: string): Promise<void> {
    this.assertCurrentUrl();
    await (await this.unique(selector)).click();
    this.assertCurrentUrl();
  }

  async clickAt(selector: string, index: number): Promise<void> {
    this.assertCurrentUrl();
    const locator = this.page.locator(selector);
    const count = await locator.count();
    if (index < 0 || index >= count) {
      throw new Error(
        `Selector ${selector} has ${count} elements; index ${index} is unavailable`,
      );
    }
    await locator.nth(index).click();
    this.assertCurrentUrl();
  }

  async selectOption(
    inputSelector: string,
    listboxSelector: string,
    label: string,
  ): Promise<void> {
    this.assertCurrentUrl();
    await (await this.unique(inputSelector)).click();
    const options = this.page.locator(listboxSelector).getByText(label, {
      exact: true,
    });
    const count = await options.count();
    if (count !== 1) {
      throw ambiguousSelector(
        `${listboxSelector} option "${label}"`,
        count,
      );
    }
    if (await options.isVisible()) {
      await options.click({ force: true });
    } else {
      await options.dispatchEvent("click");
    }
    this.assertCurrentUrl();
  }

  async selectNative(selector: string, label: string): Promise<void> {
    this.assertCurrentUrl();
    await (await this.unique(selector)).selectOption({ label });
    this.assertCurrentUrl();
  }

  async selectRoleOption(label: string): Promise<void> {
    this.assertCurrentUrl();
    const options = this.page.getByRole("option", {
      name: label,
      exact: true,
    });
    const count = await options.count();
    if (count !== 1) {
      throw ambiguousSelector(`role option "${label}"`, count);
    }
    await options.click({ force: true });
    this.assertCurrentUrl();
  }

  async fill(selector: string, value: string): Promise<void> {
    this.assertCurrentUrl();
    await (await this.unique(selector)).fill(value);
    this.assertCurrentUrl();
  }

  async typeText(selector: string, value: string): Promise<void> {
    this.assertCurrentUrl();
    await (await this.unique(selector)).pressSequentially(value, {
      delay: 50,
    });
    this.assertCurrentUrl();
  }

  async setChecked(selector: string, checked: boolean): Promise<void> {
    this.assertCurrentUrl();
    await (await this.unique(selector)).setChecked(checked);
    this.assertCurrentUrl();
  }

  async press(selector: string, key: string): Promise<void> {
    this.assertCurrentUrl();
    await (await this.unique(selector)).press(key);
    this.assertCurrentUrl();
  }

  async setInputFiles(selector: string, path: string): Promise<void> {
    this.assertCurrentUrl();
    await (await this.unique(selector)).setInputFiles(path);
    this.assertCurrentUrl();
  }

  async waitFor(selector: string): Promise<void> {
    this.assertCurrentUrl();
    await (await this.unique(selector)).waitFor({ state: "visible" });
    this.assertCurrentUrl();
  }

  async waitForFirst(selector: string): Promise<void> {
    this.assertCurrentUrl();
    await this.page.locator(selector).first().waitFor({ state: "visible" });
    this.assertCurrentUrl();
  }

  async waitForCount(selector: string, count: number): Promise<void> {
    this.assertCurrentUrl();
    await this.page.waitForFunction(
      ({ selector: value, expected }) =>
        document.querySelectorAll(value).length === expected,
      { selector, expected: count },
    );
    this.assertCurrentUrl();
  }

  async waitForHidden(selector: string): Promise<void> {
    this.assertCurrentUrl();
    await this.page.locator(selector).first().waitFor({ state: "hidden" });
    this.assertCurrentUrl();
  }

  async isVisible(selector: string): Promise<boolean> {
    this.assertCurrentUrl();
    const locator = this.page.locator(selector);
    const visible = (await locator.count()) > 0 && await locator.first().isVisible();
    this.assertCurrentUrl();
    return visible;
  }

  count(selector: string): Promise<number> {
    this.assertCurrentUrl();
    return this.page.locator(selector).count();
  }

  async getJson(url: string): Promise<unknown> {
    assertProviderUrl(this.provider, url);
    this.assertCurrentUrl();
    const result = await this.page.evaluate(async (target) => {
      const response = await fetch(target, {
        method: "GET",
        credentials: "include",
        headers: { accept: "application/json" },
      });
      return {
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        body: await response.text(),
      };
    }, url);
    this.assertCurrentUrl();
    if (result.status !== 200) {
      throw new CareerPortalError(
        result.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR",
        `${this.provider} account API returned HTTP ${result.status}`,
        result.status === 429 || result.status >= 500,
      );
    }

    if (!/^application\/json(?:;|$)/i.test(result.contentType)) {
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        `${this.provider} account API returned unexpected content type`,
      );
    }
    try {
      return JSON.parse(result.body) as unknown;
    } catch {
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        `${this.provider} account API returned invalid JSON`,
      );
    }
  }

  async gotoAndCaptureJson(
    url: string,
    responsePath: string,
  ): Promise<unknown> {
    assertProviderUrl(this.provider, url);
    const responsePromise = this.page.waitForResponse((response) => {
      try {
        const responseUrl = new URL(response.url());
        assertProviderUrl(this.provider, responseUrl.toString());
        return responseUrl.pathname === responsePath;
      } catch {
        return false;
      }
    });
    const [, response] = await Promise.all([
      this.page.goto(url, { waitUntil: "domcontentloaded" }),
      responsePromise,
    ]);
    this.assertCurrentUrl();
    if (response.status() !== 200) {
      throw new CareerPortalError(
        response.status() === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR",
        `${this.provider} account API returned HTTP ${response.status()}`,
        response.status() === 429 || response.status() >= 500,
      );
    }
    const contentType = response.headers()["content-type"] ?? "";
    if (!/^application\/json(?:;|$)/i.test(contentType)) {
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        `${this.provider} account API returned unexpected content type`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        `${this.provider} account API returned invalid JSON`,
      );
    }
  }

  private assertCurrentUrl(): void {
    assertProviderUrl(this.provider, this.page.url());
  }

  private async unique(selector: string): Promise<Locator> {
    const locator = this.page.locator(selector);
    const count = await locator.count();
    if (count !== 1) throw ambiguousSelector(selector, count);
    return locator;
  }
}

function ambiguousSelector(selector: string, count: number): Error {
  return new Error(
    `Expected exactly one element for selector ${selector}, found ${count}`,
  );
}

class PlaywrightHandle implements BrowserHandle {
  readonly page: BrowserPage;

  constructor(
    private readonly context: BrowserContext,
    page: Page,
    private readonly provider: ProviderName,
  ) {
    this.page = new PlaywrightPage(page, provider);
  }

  async storageState(): Promise<string> {
    return sanitizeStorageState(
      this.provider,
      JSON.stringify(await this.context.storageState()),
    );
  }

  pages(): BrowserPage[] {
    return this.context.pages().map(
      (page) => new PlaywrightPage(page, this.provider),
    );
  }

  async close(): Promise<void> {
    await this.context.browser()?.close();
  }
}

export class PlaywrightLauncher implements BrowserLauncher {
  async launch(
    provider: ProviderName,
    headed: boolean,
    storageState?: string,
  ): Promise<BrowserHandle> {
    const sanitizedState = storageState
      ? sanitizeStorageState(provider, storageState)
      : undefined;
    const options: BrowserContextOptions = storageState
      ? {
          storageState: JSON.parse(sanitizedState!) as NonNullable<
            BrowserContextOptions["storageState"]
          >,
        }
      : {};
    const browser = await chromium.launch({ headless: !headed });
    const context = await browser.newContext(options);
    const page = await context.newPage();
    return new PlaywrightHandle(context, page, provider);
  }
}

function isProviderHost(provider: ProviderName, hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  const domain = providerDomains[provider];
  return normalized === domain || normalized.endsWith(`.${domain}`);
}

function unsafeOrigin(provider: ProviderName, value: string): CareerPortalError {
  return new CareerPortalError(
    "PROVIDER_CHANGED",
    `${provider} browser navigation left the approved HTTPS provider origin: ${value}`,
  );
}
