import { CareerPortalError } from "./errors.js";
import type { RateLimiter } from "./rate-limiter.js";

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: string;
}

export interface HttpClient {
  get(url: URL): Promise<HttpResponse>;
}

export class ResilientHttpClient implements HttpClient {
  constructor(
    private readonly timeoutMs: number,
    private readonly userAgent: string,
    private readonly rateLimiter: RateLimiter,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async get(url: URL): Promise<HttpResponse> {
    return this.request(url, 0);
  }

  private async request(url: URL, attempt: number): Promise<HttpResponse> {
    this.rateLimiter.consume(url.hostname);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          accept: "text/html,application/json",
          "user-agent": this.userAgent,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new CareerPortalError("TIMEOUT", "Provider request timed out", true);
      }
      throw new CareerPortalError(
        "PROVIDER_ERROR",
        `Provider request failed: ${error instanceof Error ? error.message : "unknown error"}`,
        true,
      );
    }

    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"))
        ?? 250 * 2 ** attempt + Math.floor(Math.random() * 100);
      await this.sleep(Math.min(retryAfterMs, 5000));
      return this.request(url, attempt + 1);
    }

    const body = await response.text();
    if (/captcha|verify you are human|challenge/i.test(body)) {
      throw new CareerPortalError(
        "ANTI_BOT_CHALLENGE",
        "Provider returned an anti-bot challenge; automation stopped",
      );
    }
    if (!response.ok) {
      throw new CareerPortalError(
        response.status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR",
        `Provider returned HTTP ${response.status}`,
        response.status === 429 || response.status >= 500,
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }
    return { status: response.status, headers: response.headers, body };
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}
