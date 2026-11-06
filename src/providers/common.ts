import { CareerPortalError } from "../errors.js";
import type {
  AccountSnapshot,
  MutationRequest,
  ProviderCapability,
  ProviderName,
} from "../types.js";

const accountOperations: AccountSnapshot["kind"][] = [
  "profile",
  "resume",
  "skills",
  "experience",
  "education",
  "job_preferences",
  "visibility_contact_settings",
  "saved_jobs",
];

const mutationOperations = [
  "update_profile",
  "update_resume",
  "update_skills",
  "update_experience",
  "update_education",
  "update_job_preferences",
  "update_visibility_contact_settings",
  "save_job",
  "apply_to_job",
];

export function publicCapabilities(
  provider: ProviderName,
  jobDetails: boolean,
): ProviderCapability[] {
  return [
    {
      provider,
      operation: "search_jobs",
      support: "public_web",
      access: "anonymous",
      scopes: [],
      mutation: false,
      enabled: true,
      fragility: "high",
      reason:
        "Public HTML/guest endpoints are undocumented and may change or be restricted by provider policy.",
    },
    {
      provider,
      operation: "get_job_details",
      support: jobDetails ? "public_web" : "unsupported",
      access: "anonymous",
      scopes: [],
      mutation: false,
      enabled: jobDetails,
      fragility: "high",
      reason: jobDetails
        ? "Public HTML structure is undocumented and may change."
        : "No stable public detail endpoint has been configured.",
    },
    ...accountOperations.map(
      (operation): ProviderCapability => ({
        provider,
        operation: `get_${operation}`,
        support: "unsupported",
        access: "authenticated_session",
        scopes: [],
        mutation: false,
        enabled: false,
        reason:
          "No generally available official member-account API is configured; browser automation is intentionally not enabled.",
      }),
    ),
    ...mutationOperations.map(
      (operation): ProviderCapability => ({
        provider,
        operation,
        support: "unsupported",
        access: "authenticated_session",
        scopes: [],
        mutation: true,
        enabled: false,
        reason:
          "Provider mutation requires an approved official API or separately reviewed opt-in automation adapter.",
      }),
    ),
  ];
}

export function unsupportedAccountRead(
  provider: ProviderName,
  kind: AccountSnapshot["kind"],
): never {
  throw new CareerPortalError(
    "CAPABILITY_UNAVAILABLE",
    `${provider} ${kind} reads are unavailable without an approved authenticated provider API`,
  );
}

export function unsupportedMutation(
  provider: ProviderName,
  request: MutationRequest,
): never {
  throw new CareerPortalError(
    "CAPABILITY_UNAVAILABLE",
    `${provider} ${request.kind} mutation is not supported by the configured adapter`,
  );
}
