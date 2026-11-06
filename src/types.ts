export type ProviderName = "linkedin" | "naukri";

export type CapabilitySupport =
  | "official_api"
  | "public_web"
  | "browser_automation"
  | "local_only"
  | "unsupported";

export interface ProviderCapability {
  provider: ProviderName;
  operation: string;
  support: CapabilitySupport;
  access: "anonymous" | "oauth" | "authenticated_session";
  scopes: string[];
  mutation: boolean;
  enabled: boolean;
  fragility?: "low" | "medium" | "high";
  reason?: string;
}

export interface JobSearchInput {
  query: string;
  location?: string | undefined;
  remoteMode?: "on_site" | "hybrid" | "remote" | undefined;
  postedWithinDays?: number | undefined;
  pageToken?: string | undefined;
  limit: number;
}

export interface JobSummary {
  provider: ProviderName;
  providerJobId: string;
  title: string;
  company: string;
  locations: string[];
  remoteMode?: "on_site" | "hybrid" | "remote" | "unknown";
  employmentType?: string;
  descriptionSnippet?: string;
  postedAt?: string;
  salary?: string;
  detailAvailability: "available" | "search_only";
  sourceUrl: string;
}

export interface JobDetails extends JobSummary {
  description: string;
  applyUrl?: string;
}

export interface SearchPage {
  jobs: JobSummary[];
  nextPageToken?: string;
}

export interface AccountSnapshot {
  provider: ProviderName;
  kind:
    | "profile"
    | "resume"
    | "skills"
    | "experience"
    | "education"
    | "job_preferences"
    | "visibility_contact_settings"
    | "saved_jobs"
    | "recommended_jobs"
    | "applications"
    | "recruiter_messages";
  data: unknown;
}

export interface FieldChange {
  field: string;
  operation: "set" | "remove";
  value?: unknown;
}

export type MutationKind =
  | "profile"
  | "resume"
  | "skills"
  | "experience"
  | "education"
  | "job_preferences"
  | "visibility_contact_settings"
  | "save_job"
  | "application"
  | "message";

export interface MutationRequest {
  provider: ProviderName;
  kind: MutationKind;
  changes: FieldChange[];
}

export interface MutationPreview {
  operationId: string;
  previewHash: string;
  provider: ProviderName;
  kind: MutationKind;
  changes: Array<FieldChange & { before?: unknown }>;
  warnings: string[];
  confirmationPhrase: string;
  expiresAt: string;
}
