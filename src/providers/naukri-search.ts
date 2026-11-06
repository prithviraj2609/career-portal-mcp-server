import { chromium, type Response } from "playwright";
import { CareerPortalError } from "../errors.js";
import type { RateLimiter } from "../rate-limiter.js";
import type { JobSearchInput, JobSummary, SearchPage } from "../types.js";
import { assertProviderUrl } from "../browser/playwright-launcher.js";
import { absoluteProviderUrl, stripHtml } from "./html.js";

const baseUrl = "https://www.naukri.com";
const searchApiPath = "/jobapi/v3/search";

export interface NaukriSearchClient {
  search(input: JobSearchInput, page: number): Promise<SearchPage>;
}

export class PlaywrightNaukriSearchClient implements NaukriSearchClient {
  constructor(
    private readonly timeoutMs: number,
    private readonly rateLimiter: RateLimiter,
  ) {}

  async search(input: JobSearchInput, pageNumber: number): Promise<SearchPage> {
    this.rateLimiter.consume("www.naukri.com");
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      const responsePromise = page.waitForResponse(
        (response) => matchesSearchApi(response),
        { timeout: this.timeoutMs },
      );
      const searchUrl = buildNaukriSearchUrl(input, pageNumber);
      let response: Response;
      try {
        const [, intercepted] = await Promise.all([
          page.goto(searchUrl, {
            waitUntil: "domcontentloaded",
            timeout: this.timeoutMs,
          }).then((navigationResponse) => {
            const status = navigationResponse?.status();
            if (status && status >= 400) {
              throw new CareerPortalError(
                status === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR",
                `Naukri search page returned HTTP ${status}`,
                status === 429 || status >= 500,
              );
            }
          }),
          responsePromise,
        ]);
        assertProviderUrl("naukri", page.url());
        response = intercepted;
      } catch (error: unknown) {
        if (error instanceof CareerPortalError) throw error;
        const body = await page.locator("body").innerText({ timeout: 1000 })
          .catch(() => "");
        if (/captcha|verify you are human|access denied|challenge/i.test(body)) {
          throw new CareerPortalError(
            "ANTI_BOT_CHALLENGE",
            "Naukri blocked anonymous search with a verification challenge",
          );
        }
        throw new CareerPortalError(
          "TIMEOUT",
          "Naukri did not return its public search API response before timeout",
          true,
        );
      }
      return await parseSearchResponse(response, input.limit, pageNumber);
    } finally {
      await browser.close();
    }
  }
}

export function buildNaukriSearchUrl(
  input: JobSearchInput,
  pageNumber: number,
): string {
  const querySlug = slug(input.query);
  const locationSlug = input.location ? slug(input.location) : undefined;
  const path = locationSlug
    ? `/${querySlug}-jobs-in-${locationSlug}`
    : `/${querySlug}-jobs`;
  const url = new URL(path, baseUrl);
  url.searchParams.set("k", input.query);
  if (input.location) url.searchParams.set("l", input.location);
  if (input.postedWithinDays) {
    url.searchParams.set("jobAge", String(input.postedWithinDays));
  }
  if (input.remoteMode) url.searchParams.set("wfhType", input.remoteMode);
  if (pageNumber > 1) url.searchParams.set("pageNo", String(pageNumber));
  return url.toString();
}

export function parseNaukriSearchPayload(
  payload: unknown,
  limit: number,
  pageNumber: number,
): SearchPage {
  const records = findJobArray(payload);
  if (!records) {
    throw new CareerPortalError(
      "PROVIDER_CHANGED",
      "Naukri search API JSON did not contain a recognized jobs array",
    );
  }
  const jobs = records
    .flatMap(normalizeApiJob)
    .slice(0, limit);
  if (records.length > 0 && jobs.length === 0) {
    throw new CareerPortalError(
      "PROVIDER_CHANGED",
      "Naukri search API returned jobs in an unrecognized shape",
    );
  }
  return {
    jobs,
    ...(records.length >= limit && jobs.length === limit
      ? { nextPageToken: encodePageToken(pageNumber + 1) }
      : {}),
  };
}

async function parseSearchResponse(
  response: Response,
  limit: number,
  pageNumber: number,
): Promise<SearchPage> {
  const url = new URL(response.url());
  assertProviderUrl("naukri", url.toString());
  if (url.pathname !== searchApiPath) {
    throw new CareerPortalError(
      "PROVIDER_CHANGED",
      "Naukri returned an unexpected search API path",
    );
  }
  if (response.status() !== 200) {
    throw new CareerPortalError(
      response.status() === 429 ? "RATE_LIMITED" : "PROVIDER_ERROR",
      `Naukri search API returned HTTP ${response.status()}`,
      response.status() === 429 || response.status() >= 500,
    );
  }
  const contentType = response.headers()["content-type"] ?? "";
  if (!/^application\/json(?:;|$)/i.test(contentType)) {
    throw new CareerPortalError(
      "PROVIDER_CHANGED",
      `Naukri search API returned unexpected content type ${contentType || "missing"}`,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CareerPortalError(
      "PROVIDER_CHANGED",
      "Naukri search API returned invalid JSON",
    );
  }
  return parseNaukriSearchPayload(payload, limit, pageNumber);
}

function matchesSearchApi(response: Response): boolean {
  const url = new URL(response.url());
  if (url.pathname !== searchApiPath) return false;
  assertProviderUrl("naukri", url.toString());
  return true;
}

function findJobArray(payload: unknown): unknown[] | undefined {
  if (!isRecord(payload)) return undefined;
  if (Array.isArray(payload.jobDetails)) return payload.jobDetails;
  if (Array.isArray(payload.jobs)) return payload.jobs;
  if (Array.isArray(payload.list)) return payload.list;
  if (isRecord(payload.data)) {
    if (Array.isArray(payload.data.jobDetails)) return payload.data.jobDetails;
    if (Array.isArray(payload.data.jobs)) return payload.data.jobs;
  }
  return undefined;
}

function normalizeApiJob(value: unknown): JobSummary[] {
  if (!isRecord(value)) return [];
  const id = firstString(value.jobId, value.jobid, value.id);
  const title = firstString(value.title, value.jobTitle);
  const urlValue = firstString(
    value.jdURL,
    value.jobUrl,
    value.url,
    value.staticUrl,
  );
  if (!id || !title || !urlValue) return [];
  const locations = extractLocations(value);
  const description = firstString(
    value.jobDescription,
    value.description,
    value.tagsAndSkills,
  );
  const postedAt = firstString(value.createdDate, value.datePosted);
  const employmentType = firstString(value.type, value.employmentType);
  const salary = placeholder(value, "salary");
  return [{
    provider: "naukri",
    providerJobId: id,
    title: stripHtml(title),
    company: stripHtml(
      firstString(value.companyName, value.company) ?? "Unknown",
    ),
    locations: locations.length > 0 ? locations : ["Unknown"],
    ...(employmentType ? { employmentType } : {}),
    ...(description
      ? { descriptionSnippet: stripHtml(description).slice(0, 300) }
      : {}),
    ...(postedAt ? { postedAt } : {}),
    ...(salary ? { salary } : {}),
    detailAvailability: "available",
    sourceUrl: absoluteProviderUrl(urlValue, baseUrl, "naukri.com"),
  }];
}

function extractLocations(value: Record<string, unknown>): string[] {
  const direct = value.location;
  if (typeof direct === "string" && direct.trim()) return [stripHtml(direct)];
  if (Array.isArray(value.locations)) {
    return value.locations
      .filter((item): item is string => typeof item === "string")
      .map(stripHtml)
      .filter(Boolean);
  }
  const fromPlaceholder = placeholder(value, "location");
  return fromPlaceholder ? [stripHtml(fromPlaceholder)] : [];
}

function placeholder(
  value: Record<string, unknown>,
  type: string,
): string | undefined {
  if (!Array.isArray(value.placeholders)) return undefined;
  for (const entry of value.placeholders) {
    if (
      isRecord(entry) &&
      entry.type === type &&
      typeof entry.label === "string"
    ) {
      return entry.label;
    }
  }
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string | number =>
      (typeof value === "string" && value.trim().length > 0) ||
      typeof value === "number",
  )?.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function encodePageToken(page: number): string {
  return Buffer.from(`naukri:${page}`).toString("base64url");
}
