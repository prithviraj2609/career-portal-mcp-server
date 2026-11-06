import { CareerPortalError } from "../errors.js";
import type { SessionStore } from "../security.js";
import type { ProviderName } from "../types.js";
import type {
  BrowserAuthStatus,
  BrowserHandle,
  BrowserLauncher,
  ProviderBrowserWorkflow,
} from "./types.js";

const accountId = "default";

export class BrowserSessionManager {
  private readonly interactive = new Map<ProviderName, BrowserHandle>();

  constructor(
    private readonly launcher: BrowserLauncher,
    private readonly store: SessionStore,
    private readonly workflows: Map<ProviderName, ProviderBrowserWorkflow>,
    private readonly enabled: Set<ProviderName>,
  ) {}

  isEnabled(provider: ProviderName): boolean {
    return this.enabled.has(provider);
  }

  async startInteractiveLogin(provider: ProviderName): Promise<void> {
    this.requireEnabled(provider);
    const previous = this.interactive.get(provider);
    if (previous) await previous.close();
    const handle = await this.launcher.launch(provider, true);
    this.interactive.set(provider, handle);
    try {
      await handle.page.goto(this.workflow(provider).loginUrl);
    } catch (error: unknown) {
      this.interactive.delete(provider);
      await handle.close();
      throw error;
    }
  }

  async completeInteractiveLogin(provider: ProviderName): Promise<void> {
    this.requireEnabled(provider);
    const handle = this.interactive.get(provider);
    if (!handle) {
      throw new CareerPortalError(
        "AUTH_REQUIRED",
        "No interactive login is in progress",
      );
    }
    const workflow = this.workflow(provider);
    const pages = handle.pages();
    let authenticatedPage: typeof handle.page | undefined;
    let challenge: unknown;
    for (const page of pages) {
      try {
        await workflow.assertSafePage(page);
        if (await workflow.isAuthenticated(page)) {
          authenticatedPage = page;
          break;
        }
      } catch (error: unknown) {
        challenge ??= error;
      }
    }
    if (!authenticatedPage) {
      if (challenge) throw challenge;
      const locations = pages.map(safePageLocation).join(", ");
      throw new CareerPortalError(
        "AUTH_REQUIRED",
        `Login is not complete. Inspected ${pages.length} approved browser page(s): ${locations || "none"}`,
      );
    }
    await this.store.set(provider, accountId, await handle.storageState());
    await handle.close();
    this.interactive.delete(provider);
  }

  async authStatus(provider: ProviderName): Promise<BrowserAuthStatus> {
    if (!this.isEnabled(provider)) return "disabled";
    const state = await this.store.get(provider, accountId);
    if (!state) return "not_authenticated";
    const handle = await this.launcher.launch(provider, false, state);
    try {
      const workflow = this.workflow(provider);
      await handle.page.goto(workflow.authStatusUrl ?? workflow.profileUrl);
      await workflow.assertSafePage(handle.page);
      return (await workflow.isAuthenticated(handle.page))
        ? "authenticated"
        : "expired";
    } finally {
      await handle.close();
    }
  }

  async logout(provider: ProviderName): Promise<void> {
    this.requireEnabled(provider);
    const interactive = this.interactive.get(provider);
    if (interactive) {
      await interactive.close();
      this.interactive.delete(provider);
    }
    await this.store.delete(provider, accountId);
  }

  async withAuthenticatedPage<T>(
    provider: ProviderName,
    action: (
      handle: BrowserHandle,
      workflow: ProviderBrowserWorkflow,
    ) => Promise<T>,
  ): Promise<T> {
    this.requireEnabled(provider);
    const state = await this.store.get(provider, accountId);
    if (!state) {
      throw new CareerPortalError(
        "AUTH_REQUIRED",
        `No encrypted ${provider} browser session is stored`,
      );
    }
    const handle = await this.launcher.launch(
      provider,
      true,
      state,
    );
    try {
      const workflow = this.workflow(provider);
      await handle.page.goto(workflow.profileUrl);
      await workflow.assertSafePage(handle.page);
      if (!(await workflow.isAuthenticated(handle.page))) {
        throw new CareerPortalError(
          "AUTH_REQUIRED",
          `${provider} browser session expired`,
        );
      }
      return await action(handle, workflow);
    } finally {
      await handle.close();
    }
  }

  private requireEnabled(provider: ProviderName): void {
    if (!this.isEnabled(provider)) {
      throw new CareerPortalError(
        "CAPABILITY_UNAVAILABLE",
        `${provider} browser adapter is disabled`,
      );
    }
  }

  private workflow(provider: ProviderName): ProviderBrowserWorkflow {
    const workflow = this.workflows.get(provider);
    if (!workflow) {
      throw new CareerPortalError(
        "CAPABILITY_UNAVAILABLE",
        `No browser workflow is configured for ${provider}`,
      );
    }
    return workflow;
  }
}

function safePageLocation(page: { url(): string }): string {
  try {
    const url = new URL(page.url());
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}
