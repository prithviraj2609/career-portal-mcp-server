import type { AuditSink } from "./audit.js";
import type { BrowserSessionManager } from "./browser/session-manager.js";
import { CareerPortalError } from "./errors.js";
import type { MutationManager } from "./mutations.js";
import type { ProviderAdapter } from "./providers/provider.js";
import type {
  AccountSnapshot,
  JobSearchInput,
  MutationRequest,
  ProviderName,
} from "./types.js";

export class CareerPortalService {
  constructor(
    private readonly providers: Map<ProviderName, ProviderAdapter>,
    private readonly mutations: MutationManager,
    private readonly audit: AuditSink,
    private readonly maxResults: number,
    private readonly browserSessions: BrowserSessionManager,
  ) {}

  capabilities(provider?: ProviderName) {
    return [...this.providers.values()]
      .filter((adapter) => !provider || adapter.name === provider)
      .flatMap((adapter) => adapter.capabilities());
  }

  async searchJobs(
    provider: ProviderName,
    input: JobSearchInput,
  ) {
    const adapter = this.getProvider(provider);
    const boundedInput = {
      ...input,
      limit: Math.min(input.limit, this.maxResults),
    };
    const result = await adapter.searchJobs(boundedInput);
    this.audit.write({
      event: "search_jobs",
      provider,
      operation: "search_jobs",
      outcome: "success",
      details: { resultCount: result.jobs.length },
    });
    return result;
  }

  getJobDetails(provider: ProviderName, jobId: string) {
    return this.getProvider(provider).getJobDetails(jobId);
  }

  readAccount(
    provider: ProviderName,
    kind: AccountSnapshot["kind"],
  ) {
    return this.getProvider(provider).readAccount(kind);
  }

  previewMutation(request: MutationRequest) {
    return this.mutations.preview(request);
  }

  executeMutation(
    operationId: string,
    previewHash: string,
    confirmation: string,
  ) {
    return this.mutations.execute(operationId, previewHash, confirmation);
  }

  browserAuthStatus(provider: ProviderName) {
    return this.browserSessions.authStatus(provider);
  }

  async startBrowserLogin(provider: ProviderName) {
    await this.browserSessions.startInteractiveLogin(provider);
    return {
      provider,
      status: "login_window_opened",
      instruction:
        "Complete login and any MFA manually in the provider window, then call complete_browser_login.",
    };
  }

  async completeBrowserLogin(provider: ProviderName) {
    await this.browserSessions.completeInteractiveLogin(provider);
    return { provider, status: "authenticated" };
  }

  async logoutBrowserSession(provider: ProviderName) {
    await this.browserSessions.logout(provider);
    return { provider, status: "logged_out" };
  }

  private getProvider(provider: ProviderName): ProviderAdapter {
    const adapter = this.providers.get(provider);
    if (!adapter) {
      throw new CareerPortalError(
        "CAPABILITY_UNAVAILABLE",
        `Provider ${provider} is not configured`,
      );
    }
    return adapter;
  }
}
