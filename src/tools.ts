import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ZodError } from "zod";
import { CareerPortalError } from "./errors.js";
import {
  accountReadSchema,
  jobDetailsSchema,
  mutationExecuteSchema,
  mutationPreviewSchema,
  providerSchema,
  searchJobsSchema,
} from "./schemas.js";
import type { CareerPortalService } from "./service.js";
import type { MutationKind } from "./types.js";

const providerProperty = {
  type: "string",
  enum: ["linkedin", "naukri"],
} as const;

const changesProperty = {
  type: "array",
  minItems: 1,
  maxItems: 25,
  items: {
    type: "object",
    properties: {
      field: { type: "string" },
      operation: { type: "string", enum: ["set", "remove"] },
      value: {},
    },
    required: ["field", "operation"],
    additionalProperties: false,
  },
} as const;

function searchInputSchema(): Tool["inputSchema"] {
  return {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1, maxLength: 200 },
      location: { type: "string", minLength: 1, maxLength: 120 },
      remoteMode: {
        type: "string",
        enum: ["on_site", "hybrid", "remote"],
      },
      postedWithinDays: { type: "integer", minimum: 1, maximum: 30 },
      pageToken: { type: "string", maxLength: 200 },
      limit: { type: "integer", minimum: 1, maximum: 25, default: 10 },
    },
    required: ["query"],
    additionalProperties: false,
  };
}

const readTools: Tool[] = [
  {
    name: "discover_provider_capabilities",
    description:
      "Discover runtime support, access requirements, and fragility for LinkedIn and Naukri operations.",
    inputSchema: {
      type: "object",
      properties: { provider: providerProperty },
      additionalProperties: false,
    },
  },
  {
    name: "get_browser_auth_status",
    description:
      "Get opt-in provider browser authentication status without returning cookies or credentials.",
    inputSchema: {
      type: "object",
      properties: { provider: providerProperty },
      required: ["provider"],
      additionalProperties: false,
    },
  },
  {
    name: "start_browser_login",
    description:
      "Open the selected provider login page in a headed Playwright window for manual login and MFA. Passwords are never accepted by this tool.",
    inputSchema: {
      type: "object",
      properties: { provider: providerProperty },
      required: ["provider"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_browser_login",
    description:
      "Verify a manually completed provider login and persist only encrypted browser storage state.",
    inputSchema: {
      type: "object",
      properties: { provider: providerProperty },
      required: ["provider"],
      additionalProperties: false,
    },
  },
  {
    name: "logout_browser_session",
    description:
      "Delete the selected provider's encrypted local browser session. This does not revoke sessions in the provider's security settings.",
    inputSchema: {
      type: "object",
      properties: { provider: providerProperty },
      required: ["provider"],
      additionalProperties: false,
    },
  },
  {
    name: "search_jobs",
    description:
      "Search public LinkedIn or Naukri job listings with bounded pagination.",
    inputSchema: {
      type: "object",
      properties: {
        provider: providerProperty,
        query: { type: "string", minLength: 1, maxLength: 200 },
        location: { type: "string", minLength: 1, maxLength: 120 },
        remoteMode: {
          type: "string",
          enum: ["on_site", "hybrid", "remote"],
        },
        postedWithinDays: { type: "integer", minimum: 1, maximum: 30 },
        pageToken: { type: "string", maxLength: 200 },
        limit: { type: "integer", minimum: 1, maximum: 25, default: 10 },
      },
      required: ["provider", "query"],
      additionalProperties: false,
    },
  },
  {
    name: "search_linkedin_jobs",
    description:
      "Search public LinkedIn job listings with bounded pagination.",
    inputSchema: searchInputSchema(),
  },
  {
    name: "search_naukri_jobs",
    description:
      "Search Naukri job listings through the configured authenticated browser session with bounded pagination.",
    inputSchema: searchInputSchema(),
  },
  {
    name: "get_job_details",
    description: "Get normalized public details for a provider job ID.",
    inputSchema: {
      type: "object",
      properties: {
        provider: providerProperty,
        jobId: { type: "string", pattern: "^[A-Za-z0-9_-]{1,80}$" },
      },
      required: ["provider", "jobId"],
      additionalProperties: false,
    },
  },
  {
    name: "read_account_data",
    description:
      "Read profile, resume, skills, experience, education, preferences, visibility settings, recommended jobs, saved jobs, application history, or recruiter-message summaries when supported.",
    inputSchema: {
      type: "object",
      properties: {
        provider: providerProperty,
        kind: {
          type: "string",
          enum: [
            "profile",
            "resume",
            "skills",
            "experience",
            "education",
            "job_preferences",
            "visibility_contact_settings",
            "saved_jobs",
            "recommended_jobs",
            "applications",
            "recruiter_messages",
          ],
        },
      },
      required: ["provider", "kind"],
      additionalProperties: false,
    },
  },
];

function mutationTool(name: string, kind: MutationKind): Tool {
  return {
    name,
    description: `Preview a ${kind} mutation. Disabled by default and available only when the provider advertises an approved mutation capability.`,
    inputSchema: {
      type: "object",
      properties: {
        provider: providerProperty,
        changes: changesProperty,
      },
      required: ["provider", "changes"],
      additionalProperties: false,
    },
  };
}

const mutationKinds: Record<string, MutationKind> = {
  preview_profile_update: "profile",
  preview_resume_update: "resume",
  preview_skills_update: "skills",
  preview_experience_update: "experience",
  preview_education_update: "education",
  preview_job_preferences_update: "job_preferences",
  preview_visibility_contact_update: "visibility_contact_settings",
  preview_save_job: "save_job",
  preview_application_submission: "application",
  preview_message_send: "message",
};

const mutationTools: Tool[] = [
  ...Object.entries(mutationKinds).map(([name, kind]) =>
    mutationTool(name, kind),
  ),
  {
    name: "execute_confirmed_mutation",
    description:
      "Execute one exact, unexpired mutation preview after fresh explicit user confirmation. A preview is single-use even when execution fails.",
    inputSchema: {
      type: "object",
      properties: {
        operationId: { type: "string", format: "uuid" },
        previewHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
        confirmation: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["operationId", "previewHash", "confirmation"],
      additionalProperties: false,
    },
  },
];

export function registerTools(
  server: Server,
  service: CareerPortalService,
): void {
  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({ tools: [...readTools, ...mutationTools] }),
  );
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const args = request.params.arguments ?? {};
      let result: unknown;
      switch (request.params.name) {
        case "discover_provider_capabilities": {
          const provider = providerSchema.optional().parse(args.provider);
          result = service.capabilities(provider);
          break;
        }
        case "get_browser_auth_status": {
          const provider = providerSchema.parse(args.provider);
          result = {
            provider,
            status: await service.browserAuthStatus(provider),
          };
          break;
        }
        case "start_browser_login": {
          const provider = providerSchema.parse(args.provider);
          result = await service.startBrowserLogin(provider);
          break;
        }
        case "complete_browser_login": {
          const provider = providerSchema.parse(args.provider);
          result = await service.completeBrowserLogin(provider);
          break;
        }
        case "logout_browser_session": {
          const provider = providerSchema.parse(args.provider);
          result = await service.logoutBrowserSession(provider);
          break;
        }
        case "search_jobs": {
          const parsed = searchJobsSchema.parse(args);
          result = await service.searchJobs(parsed.provider, parsed);
          break;
        }
        case "search_linkedin_jobs":
        case "search_naukri_jobs": {
          const provider =
            request.params.name === "search_linkedin_jobs"
              ? "linkedin"
              : "naukri";
          const parsed = searchJobsSchema.parse({ ...args, provider });
          result = await service.searchJobs(provider, parsed);
          break;
        }
        case "get_job_details": {
          const parsed = jobDetailsSchema.parse(args);
          result = await service.getJobDetails(parsed.provider, parsed.jobId);
          break;
        }

        case "read_account_data": {
          const parsed = accountReadSchema.parse(args);
          result = await service.readAccount(parsed.provider, parsed.kind);
          break;
        }
        case "execute_confirmed_mutation": {
          const parsed = mutationExecuteSchema.parse(args);
          result = await service.executeMutation(
            parsed.operationId,
            parsed.previewHash,
            parsed.confirmation,
          );
          break;
        }
        default: {
          const kind = mutationKinds[request.params.name];
          if (!kind) {
            throw new CareerPortalError(
              "VALIDATION_FAILED",
              `Unknown tool ${request.params.name}`,
            );
          }
          result = await service.previewMutation(
            mutationPreviewSchema.parse({ ...args, kind }),
          );
        }
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (error: unknown) {
      const normalized =
        error instanceof CareerPortalError
          ? error.toJSON()
          : error instanceof ZodError
            ? {
                code: "VALIDATION_FAILED",
                message: "Tool input validation failed",
                issues: error.issues,
              }
            : {
                code: "PROVIDER_ERROR",
                message:
                  error instanceof Error ? error.message : "Unknown error",
              };
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(normalized, null, 2) }],
      };
    }
  });
}
