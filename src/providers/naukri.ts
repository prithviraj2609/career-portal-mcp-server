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
import { stripHtml } from "./html.js";
import { absoluteProviderUrl } from "./html.js";
import type { ProviderAdapter } from "./provider.js";
import type { NaukriSearchClient } from "./naukri-search.js";

const baseUrl = "https://www.naukri.com";

interface JsonLdJob {
  "@type"?: string;
  title?: string;
  description?: string;
  datePosted?: string;
  employmentType?: string | string[];
  hiringOrganization?: { name?: string };
  jobLocation?: JsonLdLocation | JsonLdLocation[];
  identifier?: { value?: string | number };
  url?: string;
}

interface JsonLdLocation {
  address?: {
    addressLocality?: string;
    addressRegion?: string;
    addressCountry?: string;
  };
}

export class NaukriAdapter implements ProviderAdapter {
  readonly name = "naukri" as const;

  constructor(
    private readonly http: HttpClient,
    private readonly searchClient?: NaukriSearchClient,
  ) {}

  capabilities(): ProviderCapability[] {
    return publicCapabilities(this.name, true).map((capability) =>
      capability.operation === "search_jobs" && !this.searchClient
        ? {
            ...capability,
            support: "unsupported" as const,
            enabled: false,
            reason:
              "Naukri currently rejects legitimate anonymous browser search with HTTP 403; bypassing rotating browser state is intentionally unsupported.",
          }
        : capability
    );
  }

  async searchJobs(input: JobSearchInput): Promise<SearchPage> {
    if (!this.searchClient) {
      throw new CareerPortalError(
        "CAPABILITY_UNAVAILABLE",
        "Naukri public search is unavailable because the provider rejects legitimate anonymous browser access; no anti-bot bypass is attempted",
      );
    }
    const page = decodePageToken(input.pageToken);
    return this.searchClient.search(input, page);
  }

  async getJobDetails(jobId: string): Promise<JobDetails> {
    const response = await this.http.get(
      new URL(`/job-listings-${encodeURIComponent(jobId)}`, baseUrl),
    );
    const record = extractJsonLd(response.body).find(
      (candidate) => String(candidate.identifier?.value) === jobId,
    );
    const summary = parseNaukriJsonLd(response.body).find(
      (item) => item.providerJobId === jobId,
    );
    if (!record || !summary) {
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        "Naukri job detail markup was not recognized",
      );
    }
    return {
      ...summary,
      description: stripHtml(record.description ?? ""),
      applyUrl: summary.sourceUrl,
    };
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

export function parseNaukriJsonLd(html: string): JobSummary[] {
  return extractJsonLd(html).flatMap((job) => {
    const id = job.identifier?.value;
    if (!id || !job.title || !job.url) return [];
    const locations = normalizeLocations(job.jobLocation);
    return [{
      provider: "naukri",
      providerJobId: String(id),
      title: stripHtml(job.title),
      company: stripHtml(job.hiringOrganization?.name ?? "Unknown"),
      locations: locations.length > 0 ? locations : ["Unknown"],
      ...(job.employmentType
        ? {
            employmentType: Array.isArray(job.employmentType)
              ? job.employmentType.join(", ")
              : job.employmentType,
          }
        : {}),
      ...(job.description
        ? { descriptionSnippet: stripHtml(job.description).slice(0, 300) }
        : {}),
      ...(job.datePosted ? { postedAt: job.datePosted } : {}),
      detailAvailability: "available",
      sourceUrl: absoluteProviderUrl(job.url, baseUrl, "naukri.com"),
    }];
  });
}

function extractJsonLd(html: string): JsonLdJob[] {
  const scripts = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  return scripts.flatMap((match) => {
    try {
      return flattenJsonLd(JSON.parse(match[1] ?? "null")).filter(
        (record): record is JsonLdJob =>
          typeof record === "object" &&
          record !== null &&
          (record as JsonLdJob)["@type"] === "JobPosting",
      );
    } catch (error: unknown) {
      if (error instanceof SyntaxError) return [];
      throw error;
    }
  });
}

function flattenJsonLd(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value && typeof value === "object" && "@graph" in value) {
    return flattenJsonLd((value as { "@graph": unknown })["@graph"]);
  }
  return [value];
}

function normalizeLocations(
  value?: JsonLdLocation | JsonLdLocation[],
): string[] {
  const locations = value ? (Array.isArray(value) ? value : [value]) : [];
  return locations
    .map((location) =>
      [
        location.address?.addressLocality,
        location.address?.addressRegion,
        location.address?.addressCountry,
      ].filter(Boolean).join(", "),
    )
    .filter(Boolean);
}

function decodePageToken(token?: string): number {
  if (!token) return 1;
  const match = /^naukri:(\d+)$/.exec(
    Buffer.from(token, "base64url").toString("utf8"),
  );
  if (!match?.[1]) {
    throw new CareerPortalError("VALIDATION_FAILED", "Invalid Naukri page token");
  }
  return Number(match[1]);
}
