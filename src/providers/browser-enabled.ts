import type { BrowserSessionManager } from "../browser/session-manager.js";
import { CareerPortalError } from "../errors.js";
import type {
  AccountSnapshot,
  JobDetails,
  JobSearchInput,
  MutationRequest,
  ProviderCapability,
  SearchPage,
} from "../types.js";
import type { ProviderAdapter } from "./provider.js";

const commonReadableOperations: AccountSnapshot["kind"][] = [
  "profile",
  "skills",
  "experience",
  "education",
  "job_preferences",
];

const commonWritableOperations = [
  "update_profile",
  "update_skills",
  "update_experience",
  "update_education",
  "update_job_preferences",
];

export class BrowserEnabledAdapter implements ProviderAdapter {
  readonly name;

  constructor(
    private readonly publicAdapter: ProviderAdapter,
    private readonly sessions: BrowserSessionManager,
    private readonly resumeMaxBytes: number,
    private readonly resumeDirectory: string | undefined,
    private readonly mutationsEnabled: boolean,
  ) {
    this.name = publicAdapter.name;
  }

  capabilities(): ProviderCapability[] {
    const browserEnabled = this.sessions.isEnabled(this.name);
    const readableOperations = [
      ...commonReadableOperations,
      ...(this.name === "naukri"
        ? ([
            "resume",
            "recommended_jobs",
            "saved_jobs",
            "applications",
            "recruiter_messages",
          ] as AccountSnapshot["kind"][])
        : this.name === "linkedin"
        ? ([
            "recommended_jobs",
            "saved_jobs",
            "applications",
            "recruiter_messages",
            "visibility_contact_settings",
          ] as AccountSnapshot["kind"][])
        : []),
    ];
    const writableOperations = this.name === "naukri"
      ? [
        ...commonWritableOperations,
        "update_resume",
        "save_job",
        "apply_to_job",
      ]
      : this.name === "linkedin"
      ? [
        "update_profile",
        "update_skills",
        "update_experience",
        "update_education",
        "update_job_preferences",
        "save_job",
        "send_message",
      ]
      : [];
    const overridden = new Set([
      ...readableOperations.map((operation) => `get_${operation}`),
      ...writableOperations,
      ...(this.name === "naukri" ? ["search_jobs"] : []),
      ...(this.name === "linkedin" ? ["get_job_details"] : []),
    ]);
    return [
      ...this.publicAdapter
        .capabilities()
        .filter((capability) => !overridden.has(capability.operation)),
      ...readableOperations.map(
        (operation): ProviderCapability => ({
          provider: this.name,
          operation: `get_${operation}`,
          support: "browser_automation",
          access: "authenticated_session",
          scopes: [],
          mutation: false,
          enabled: browserEnabled,
          fragility: "high",
          reason: browserEnabled
            ? "Opt-in provider-specific Playwright workflow; UI selectors may change."
            : "Browser adapter disabled by configuration.",
        }),
      ),
      ...writableOperations.map(
        (operation): ProviderCapability => ({
          provider: this.name,
          operation,
          support: "browser_automation",
          access: "authenticated_session",
          scopes: [],
          mutation: true,
          enabled: browserEnabled && this.mutationsEnabled,
          fragility: "high",
          reason: browserEnabled && this.mutationsEnabled
            ? "Requires global mutation enablement and exact, unexpired confirmation."
            : "Browser adapter or global mutations are disabled by configuration.",
        }),
      ),
      ...(this.name === "naukri"
        ? [{
            provider: this.name,
            operation: "search_jobs",
            support: "browser_automation" as const,
            access: "authenticated_session" as const,
            scopes: [],
            mutation: false,
            enabled: browserEnabled,
            fragility: "high" as const,
            reason: browserEnabled
              ? "Uses the authenticated Naukri search page and intercepts its provider-generated JSON response."
              : "Browser adapter disabled by configuration.",
          }]
        : []),
      ...(this.name === "linkedin"
        ? [{
            provider: this.name,
            operation: "get_job_details",
            support: "browser_automation" as const,
            access: "authenticated_session" as const,
            scopes: [],
            mutation: false,
            enabled: browserEnabled,
            fragility: "high" as const,
            reason: browserEnabled
              ? "Uses the authenticated LinkedIn job page and current provider-rendered fields."
              : "Browser adapter disabled by configuration.",
          }]
        : []),
    ];
  }

  async searchJobs(input: JobSearchInput): Promise<SearchPage> {
    if (this.name === "naukri" && this.sessions.isEnabled(this.name)) {
      return this.sessions.withAuthenticatedPage(
        this.name,
        async (handle, workflow) => {
          if (!workflow.searchJobs) {
            throw new CareerPortalError(
              "CAPABILITY_UNAVAILABLE",
              "Naukri authenticated search workflow is unavailable",
            );
          }
          return workflow.searchJobs(handle.page, input);
        },
      );
    }
    return this.publicAdapter.searchJobs(input);
  }

  async getJobDetails(jobId: string): Promise<JobDetails> {
    if (this.name === "linkedin" && this.sessions.isEnabled(this.name)) {
      return this.sessions.withAuthenticatedPage(
        this.name,
        async (handle, workflow) => {
          if (!workflow.getJobDetails) {
            throw new CareerPortalError(
              "CAPABILITY_UNAVAILABLE",
              "LinkedIn authenticated job-detail workflow is unavailable",
            );
          }
          return workflow.getJobDetails(handle.page, jobId);
        },
      );
    }
    return this.publicAdapter.getJobDetails(jobId);
  }

  async readAccount(kind: AccountSnapshot["kind"]): Promise<AccountSnapshot> {
    const capability = this.capabilities().find(
      (item) => item.operation === `get_${kind}` && !item.mutation,
    );
    if (!capability?.enabled) {
      throw new CareerPortalError(
        "CAPABILITY_UNAVAILABLE",
        `${this.name} browser adapter does not support ${kind} reads`,
      );
    }
    return this.sessions.withAuthenticatedPage(this.name, async (handle, workflow) => {
      if (
        workflow.readAccountData &&
        [
          "recommended_jobs",
          "saved_jobs",
          "applications",
          "recruiter_messages",
          "visibility_contact_settings",
        ].includes(kind)
      ) {
        return {
          provider: this.name,
          kind,
          data: await workflow.readAccountData(handle.page, kind),
        };
      }
      const requestedFields = accountFieldsByKind[kind];
      const profile = await workflow.readProfile(handle.page, requestedFields);
      return {
        provider: this.name,
        kind,
        data: selectAccountData(kind, profile),
      };
    });
  }

  async readMutationState(
    request: MutationRequest,
  ): Promise<Record<string, unknown>> {
    validateMutationFields(request);
    return this.sessions.withAuthenticatedPage(this.name, async (handle, workflow) => {
      if (workflow.readMutationState) {
        return workflow.readMutationState(handle.page, request);
      }
      const profile = await workflow.readProfile(
        handle.page,
        request.changes.map((change) => change.field),
      );
      return Object.fromEntries(
        request.changes.map((change) => [
          change.field,
          profile[change.field],
        ]),
      );
    });
  }

  async executeMutation(request: MutationRequest): Promise<unknown> {
    validateMutationFields(request);
    return this.sessions.withAuthenticatedPage(this.name, async (handle, workflow) => {
      if (workflow.executeMutation) {
        await workflow.executeMutation(
          handle.page,
          request,
          this.resumeMaxBytes,
          this.resumeDirectory,
        );
      } else {
        await workflow.applyChanges(
          handle.page,
          request.changes,
          this.resumeMaxBytes,
          this.resumeDirectory,
        );
      }
      return {
        provider: this.name,
        updatedFields: request.changes.map((change) => change.field),
      };
    });
  }

}

const fieldsByKind: Partial<Record<MutationRequest["kind"], string[]>> = {
  profile: ["headline", "summary"],
  resume: ["resume.path"],
  skills: ["skills"],
  experience: [
    "employment.title",
    "employment.company",
    "employment.description",
    "project.history",
  ],
  education: [
    "education.history",
    "education.school",
    "education.degree",
    "certification.history",
  ],
  job_preferences: [
    "careerProfile",
    "jobPreferences.titles",
    "jobPreferences.locations",
  ],
};

const accountFieldsByKind: Partial<
  Record<AccountSnapshot["kind"], string[]>
> = {
  profile: [
    "headline",
    "summary",
    "careerProfile",
    "personalDetails",
    "certification.history",
    "language.history",
  ],
  resume: ["resume.current"],
  skills: ["skills", "skill.history"],
  experience: [
    "employment.history",
    "employment.title",
    "employment.company",
    "employment.description",
  ],
  education: ["education.history", "education.school", "education.degree"],
  job_preferences: [
    "jobPreferences.titles",
    "jobPreferences.locations",
  ],
};

function validateMutationFields(request: MutationRequest): void {
  const allowed = fieldsByKind[request.kind];
  const validNaukriEmployment =
    request.provider === "naukri" &&
    request.kind === "experience" &&
    request.changes.every((change) =>
      change.field === "employment.add" ||
      (
        /^employment\.[A-Za-z0-9_-]+(?:\.(?:title|company|description|dates|employmentType|skills|salary|noticePeriod))?$/.test(
          change.field,
        ) ||
        change.field === "project.add" ||
        /^project\.[A-Za-z0-9_-]+(?:\.(?:title|description))?$/.test(
          change.field,
        )
      ),
    );
  const validNaukriSkills =
    request.provider === "naukri" &&
    request.kind === "skills" &&
    request.changes.every((change) =>
      change.field === "skills" ||
      change.field === "itSkill.add" ||
      /^itSkill\.[A-Za-z0-9_-]+$/.test(change.field)
    );
  const validNaukriEducation =
    request.provider === "naukri" &&
    request.kind === "education" &&
    request.changes.every((change) =>
      change.field === "education.add" ||
      /^education\.[A-Za-z0-9_-]+$/.test(change.field) ||
      change.field === "certification.add" ||
      /^certification\.[A-Za-z0-9_-]+$/.test(change.field)
    );
  const validNaukriPreferences =
    request.provider === "naukri" &&
    request.kind === "job_preferences" &&
    request.changes.length === 1 &&
    request.changes[0]!.field === "careerProfile";
  const validNaukriSaveJob =
    request.provider === "naukri" &&
    request.kind === "save_job" &&
    request.changes.length === 1 &&
    /^job\.[A-Za-z0-9_-]+\.saved$/.test(request.changes[0]!.field);
  const validLinkedInSaveJob =
    request.provider === "linkedin" &&
    request.kind === "save_job" &&
    request.changes.length === 1 &&
    /^job\.\d{1,30}\.saved$/.test(request.changes[0]!.field);
  const validLinkedInEntityMutation =
    request.provider === "linkedin" &&
    request.changes.length === 1 &&
    (
      (request.kind === "experience" &&
        /^(?:employment\.add|employment\.\d{1,30})$/.test(
          request.changes[0]!.field,
        )) ||
      (request.kind === "education" &&
        /^(?:education\.add|education\.\d{1,30})$/.test(
          request.changes[0]!.field,
        )) ||
      (request.kind === "skills" &&
        /^(?:skill\.add|skill\.\d{1,30})$/.test(
          request.changes[0]!.field,
        ))
    );
  const validLinkedInMessage =
    request.provider === "linkedin" &&
    request.kind === "message" &&
    request.changes.length === 1 &&
    /^message\.[A-Za-z0-9=_-]{1,300}\.send$/.test(
      request.changes[0]!.field,
    );
  const invalidLinkedInEntityMutation =
    request.provider === "linkedin" &&
    ["experience", "education", "skills"].includes(request.kind) &&
    !validLinkedInEntityMutation;
  const validNaukriApplication =
    request.provider === "naukri" &&
    request.kind === "application" &&
    request.changes.length === 1 &&
    /^application\.[A-Za-z0-9_-]+\.submission$/.test(
      request.changes[0]!.field,
    );
  if (
    invalidLinkedInEntityMutation ||
    (!allowed && !validNaukriEmployment && !validNaukriSkills &&
      !validNaukriEducation &&
      !validNaukriPreferences &&
      !validLinkedInEntityMutation &&
      !validLinkedInMessage &&
      !validLinkedInSaveJob &&
      !validNaukriSaveJob &&
      !validNaukriApplication) ||
    (request.kind === "resume" && request.provider !== "naukri") ||
    (!validNaukriEmployment && !validNaukriSkills &&
      !validNaukriEducation && !validNaukriPreferences &&
      !validLinkedInEntityMutation &&
      !validLinkedInMessage &&
      !validLinkedInSaveJob &&
      !validNaukriSaveJob &&
      !validNaukriApplication &&
      request.changes.some((change) => !allowed?.includes(change.field)))
  ) {
    throw new CareerPortalError(
      "VALIDATION_FAILED",
      `${request.provider} does not support one or more ${request.kind} fields`,
    );
  }
}

function selectAccountData(
  kind: AccountSnapshot["kind"],
  profile: Record<string, unknown>,
): unknown {
  const prefixes: Partial<Record<AccountSnapshot["kind"], string[]>> = {
    profile: [
      "headline",
      "summary",
      "careerProfile",
      "personalDetails",
      "certification.",
      "language.",
    ],
    resume: ["resume."],
    skills: ["skills", "skill."],
    experience: ["employment.", "project."],
    education: ["education.", "certification."],
    job_preferences: ["careerProfile", "jobPreferences."],
    recommended_jobs: ["recommendedJobs"],
    saved_jobs: ["savedJobs"],
    applications: ["applications"],
    recruiter_messages: ["recruiterMessages"],
  };
  const selected = prefixes[kind];
  if (!selected) return {};
  return Object.fromEntries(
    Object.entries(profile).filter(([field]) =>
      selected.some((prefix) =>
        prefix.endsWith(".") ? field.startsWith(prefix) : field === prefix,
      ),
    ),
  );
}
