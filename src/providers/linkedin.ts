import { CareerPortalError } from "../errors.js";
import type { HttpClient } from "../http.js";
import type {
  AccountSnapshot,
  JobDetails,
  JobSearchInput,
  JobSummary,
  MutationRequest,
  ProviderCapability,
  SearchPage,
} from "../types.js";
import {
  publicCapabilities,
  unsupportedAccountRead,
  unsupportedMutation,
} from "./common.js";
import { absoluteProviderUrl, firstMatch, stripHtml } from "./html.js";
import type { ProviderAdapter } from "./provider.js";

const baseUrl = "https://www.linkedin.com";

export class LinkedInAdapter implements ProviderAdapter {
  readonly name = "linkedin" as const;

  constructor(private readonly http: HttpClient) {}

  capabilities(): ProviderCapability[] {
    return publicCapabilities(this.name, true);
  }

  async searchJobs(input: JobSearchInput): Promise<SearchPage> {
    const offset = decodePageToken(input.pageToken);
    const url = new URL("/jobs-guest/jobs/api/seeMoreJobPostings/search", baseUrl);
    url.searchParams.set("keywords", input.query);
    if (input.location) url.searchParams.set("location", input.location);
    if (input.remoteMode) {
      url.searchParams.set(
        "f_WT",
        { on_site: "1", remote: "2", hybrid: "3" }[input.remoteMode],
      );
    }
    if (input.postedWithinDays) {
      url.searchParams.set("f_TPR", `r${input.postedWithinDays * 86400}`);
    }
    url.searchParams.set("start", String(offset));

    const response = await this.http.get(url);
    const jobs = parseLinkedInCards(response.body).slice(0, input.limit);
    return {
      jobs,
      ...(jobs.length < input.limit
        ? {}
        : { nextPageToken: encodePageToken(offset + jobs.length) }),
    };
  }

  async getJobDetails(jobId: string): Promise<JobDetails> {
    const response = await this.http.get(
      new URL(`/jobs-guest/jobs/api/jobPosting/${jobId}`, baseUrl),
    );
    return parseLinkedInDetails(jobId, response.body);
  }

  async readAccount(kind: AccountSnapshot["kind"]): Promise<AccountSnapshot> {
    return unsupportedAccountRead(this.name, kind);
  }

  async readMutationState(
    request: MutationRequest,
  ): Promise<Record<string, unknown>> {
    return unsupportedMutation(this.name, request);
  }

  async executeMutation(request: MutationRequest): Promise<unknown> {
    return unsupportedMutation(this.name, request);
  }
}

export function parseLinkedInCards(html: string): JobSummary[] {
  const cards =
    html.match(/<li\b[\s\S]*?<\/li>/gi) ??
    html.match(/<div[^>]+base-card[\s\S]*?<\/div>\s*<\/div>/gi) ??
    [];
  return cards.flatMap((card) => {
    const sourceUrl = firstMatch(
      card,
      /<a[^>]+(?:base-card__full-link|base-card__full-link[^"]*)[^>]+href=["']([^"']+)/i,
    );
    const id =
      firstMatch(card, /data-entity-urn=["'][^"']*jobPosting:(\d+)/i) ??
      (sourceUrl
        ? firstMatch(sourceUrl, /\/jobs\/view\/(?:[^/?]+-)?(\d+)/i)
        : undefined);
    const title = firstMatch(
      card,
      /<h3[^>]*base-search-card__title[^>]*>([\s\S]*?)<\/h3>/i,
    );
    if (!sourceUrl || !id || !title) return [];
    const company =
      firstMatch(
        card,
        /<h4[^>]*base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/i,
      ) ?? "Unknown";
    const location =
      firstMatch(
        card,
        /<span[^>]*job-search-card__location[^>]*>([\s\S]*?)<\/span>/i,
      ) ?? "Unknown";
    const postedAt = firstMatch(card, /<time[^>]+datetime=["']([^"']+)/i);
    return [
      {
        provider: "linkedin",
        providerJobId: id,
        title: stripHtml(title),
        company: stripHtml(company),
        locations: [stripHtml(location)],
        ...(postedAt ? { postedAt } : {}),
        detailAvailability: "available",
        sourceUrl: absoluteProviderUrl(
          sourceUrl,
          baseUrl,
          "linkedin.com",
        ),
      },
    ];
  });
}

export function parseLinkedInDetails(
  jobId: string,
  html: string,
): JobDetails {
  const title = firstMatch(
    html,
    /<h2[^>]*top-card-layout__title[^>]*>([\s\S]*?)<\/h2>/i,
  );
  const description = firstMatch(
    html,
    /<div[^>]*show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/i,
  );
  if (!title || !description) {
    throw new CareerPortalError(
      "PROVIDER_CHANGED",
      "LinkedIn job detail markup was not recognized",
    );
  }
  const company =
    firstMatch(
      html,
      /<a[^>]*topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/i,
    ) ?? "Unknown";
  const location =
    firstMatch(
      html,
      /<span[^>]*topcard__flavor--bullet[^>]*>([\s\S]*?)<\/span>/i,
    ) ?? "Unknown";
  return {
    provider: "linkedin",
    providerJobId: jobId,
    title: stripHtml(title),
    company: stripHtml(company),
    locations: [stripHtml(location)],
    description: stripHtml(description),
    detailAvailability: "available",
    sourceUrl: `${baseUrl}/jobs/view/${jobId}`,
  };
}

function decodePageToken(token?: string): number {
  if (!token) return 0;
  const match = /^linkedin:(\d+)$/.exec(
    Buffer.from(token, "base64url").toString("utf8"),
  );
  if (!match?.[1]) {
    throw new CareerPortalError("VALIDATION_FAILED", "Invalid LinkedIn page token");
  }
  return Number(match[1]);
}

function encodePageToken(offset: number): string {
  return Buffer.from(`linkedin:${offset}`).toString("base64url");
}
