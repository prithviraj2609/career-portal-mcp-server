import {
  SelectorWorkflow,
  shortTextField,
  stringListField,
  textField,
  type WorkflowSelectors,
} from "./workflow-base.js";
import { z } from "zod";
import type { BrowserPage } from "./types.js";
import { CareerPortalError } from "../errors.js";
import type {
  AccountSnapshot,
  FieldChange,
  JobSearchInput,
  MutationRequest,
  SearchPage,
} from "../types.js";
import {
  assertProviderUrl,
} from "./playwright-launcher.js";
import {
  buildNaukriSearchUrl,
  parseNaukriSearchPayload,
} from "../providers/naukri-search.js";

const profileApiPath =
  "/cloudgateway-mynaukri/resman-aggregator-services/v2/users/self";
const recommendedJobsUrl =
  "https://www.naukri.com/mnjuser/recommendedjobs";
const recommendedJobsApiPath = "/jobapi/v2/search/recom-jobs";
const savedJobsUrl = "https://www.naukri.com/mnjuser/savedjobs";
const savedJobsApiPath = "/jobapi/v3/user/savedJobs/detail";
const applicationHistoryUrl = "https://www.naukri.com/myapply/historypage";
const applicationHistoryApiPath =
  "/cloudgateway-apply/whtma-services/v0/applyapi/v5/history";
const recruiterInboxUrl = "https://www.naukri.com/mnjuser/inbox";
const recruiterInboxApiPath =
  "/cloudgateway-nc-js/nc-services/v0/template/ni-inboxusermails-svc-tmpl_v0";
const naukriSummaryField = z.string().trim().min(1).max(1_000);
const naukriSkillsField = stringListField.max(20).refine(
  (skills) => skills.join(",").length <= 250,
  "Naukri key skills must total no more than 250 comma-separated characters",
);

interface NaukriProfilePayload {
  profile?: Array<{
    resumeHeadline?: string;
    summary?: string;
    keySkills?: string;
    cvInfo?: { fileName?: string; isAvailable?: boolean };
    desiredRole?: Array<{ value?: string }>;
    locationPrefId?: Array<{ value?: string }>;
    noticePeriod?: { id?: number; value?: string } | string;
    entityIndustry?: { value?: string };
    entityDepartment?: { value?: string };
    entityRoleCategory?: { value?: string };
    entityRole?: { value?: string };
    desiredJobType?: string[];
    desiredEmploymentType?: string[];
    expectedCtcCurrency?: string;
    absoluteExpectedCtc?: string | number;
    gender?: string;
    birthDate?: string;
    maritalStatus?: string;
    category?: string;
    contactAddress?: string;
    mailCity?: string;
    pincode?: string;
    workPermitForCountry?: Array<{ value?: string }>;
  }>;
  employments?: Array<{
    employmentId?: string;
    designation?: string;
    organization?: string;
    jobDescription?: string;
    keySkills?: string;
    startDate?: string;
    endDate?: string | null;
    employmentType?: string;
    experienceType?: string;
    salary?: string | number | null;
    currency?: string | { value?: string } | null;
    location?: { value?: string } | string | null;
    department?: { value?: string } | string | null;
    roleCategory?: { value?: string } | string | null;
    role?: { value?: string } | string | null;
  }>;
  itskills?: Array<{
    skillId?: string;
    skill?: string;
    version?: string;
    lastUsed?: { value?: number };
    experienceTime?: { year?: number; month?: number };
  }>;
  educations?: Array<{
    educationId?: string;
    institute?: string;
    entityInstitute?: { value?: string };
    course?: { value?: string };
    specialisation?: { value?: string };
    yearOfStart?: number;
    yearOfCompletion?: number;
    courseType?: string;
    grade?: string | { value?: string };
    marks?: string | number;
  }>;
  projects?: Array<{
    projectId?: string;
    eduExpId?: string;
    projectTitle?: string;
    clientName?: string;
    startDate?: string;
    endDate?: string | null;
    projectDetails?: string;
    projectLocation?: string;
    isOnSiteProject?: boolean;
    employmentType?: string;
    teamSize?: string | number;
    role?: string | { value?: string };
    roleDesc?: string;
    skills?: string;
  }>;
  certifications?: Array<{
    certificationId?: string;
    course?: string | { value?: string };
    vendor?: string | { value?: string };
    completionId?: string;
    url?: string;
    issueDate?: string;
    expiryDate?: string | null;
  }>;
  languages?: Array<{
    languageId?: string;
    lang?: string | { value?: string };
    proficiency?: string | { value?: string };
    ability?: string[] | { read?: boolean; write?: boolean; speak?: boolean };
  }>;
}

export class NaukriBrowserWorkflow extends SelectorWorkflow {
  readonly provider = "naukri" as const;
  readonly loginUrl = "https://www.naukri.com/nlogin/login";
  readonly authStatusUrl = "https://www.naukri.com/mnjuser/homepage";
  readonly profileUrl = "https://www.naukri.com/mnjuser/profile";

  override async isAuthenticated(page: BrowserPage): Promise<boolean> {
    const url = new URL(page.url());
    return url.protocol === "https:" &&
      (url.hostname === "naukri.com" || url.hostname.endsWith(".naukri.com")) &&
      (
        url.pathname === "/mnjuser/homepage" ||
        url.pathname === "/mnjuser/profile"
      );
  }

  async searchJobs(
    page: BrowserPage,
    input: JobSearchInput,
  ): Promise<SearchPage> {
    await this.assertSafePage(page);
    const pageNumber = decodeNaukriPageToken(input.pageToken);
    const payload = await page.gotoAndCaptureJson(
      buildNaukriSearchUrl(input, pageNumber),
      "/jobapi/v3/search",
    );
    return parseNaukriSearchPayload(payload, input.limit, pageNumber);
  }

  async readAccountData(
    page: BrowserPage,
    kind: AccountSnapshot["kind"],
  ): Promise<unknown> {
    await this.assertSafePage(page);
    if (kind === "recommended_jobs") {
      const payload = await page.gotoAndCaptureJson(
        recommendedJobsUrl,
        recommendedJobsApiPath,
      );
      return parseNaukriSearchPayload(payload, 25, 1).jobs;
    }
    if (kind === "saved_jobs") {
      const payload = await page.gotoAndCaptureJson(
        savedJobsUrl,
        savedJobsApiPath,
      );
      return parseNaukriSearchPayload(payload, 25, 1).jobs;
    }
    if (kind === "applications") {
      const payload = await page.gotoAndCaptureJson(
        applicationHistoryUrl,
        applicationHistoryApiPath,
      );
      return parseApplicationHistory(payload);
    }
    if (kind === "recruiter_messages") {
      const payload = await page.gotoAndCaptureJson(
        recruiterInboxUrl,
        recruiterInboxApiPath,
      );
      return parseRecruiterMessages(payload);
    }
    throw new CareerPortalError(
      "CAPABILITY_UNAVAILABLE",
      `Naukri does not expose ${kind} through its account job workflow`,
    );
  }

  async readMutationState(
    page: BrowserPage,
    request: MutationRequest,
  ): Promise<Record<string, unknown>> {
    if (request.kind === "save_job") {
      const change = onlyChange(request);
      const jobId = mutationJobId(change.field, "job", "saved");
      const desired = parseSchema(savedJobMutation, change.value);
      const state = await readJobState(page, jobId, desired.sourceUrl);
      return {
        [change.field]: {
          sourceUrl: desired.sourceUrl,
          saved: state.saved,
        },
      };
    }
    if (request.kind === "application") {
      const change = onlyChange(request);
      const jobId = mutationJobId(
        change.field,
        "application",
        "submission",
      );
      const desired = parseSchema(applicationMutation, change.value);
      const applications = await this.readAccountData(page, "applications");
      if (
        Array.isArray(applications) &&
        applications.some((entry) =>
          isRecord(entry) && scalarString(entry.jobId) === jobId
        )
      ) {
        throw new CareerPortalError(
          "VALIDATION_FAILED",
          `Naukri job ${jobId} already appears in application history`,
        );
      }
      const state = await readJobState(page, jobId, desired.sourceUrl);
      if (state.hideApplyButton) {
        throw new CareerPortalError(
          "CAPABILITY_UNAVAILABLE",
          "Naukri does not expose an apply control for this job",
        );
      }
      return {
        [change.field]: {
          sourceUrl: desired.sourceUrl,
          applied: false,
          resume: "current",
          questionnaireAnswers: {},
        },
      };
    }
    const profile = await this.readProfile(
      page,
      request.changes.map((change) => change.field),
    );
    return Object.fromEntries(
      request.changes.map((change) => [
        change.field,
        profile[change.field],
      ]),
    );
  }

  async executeMutation(
    page: BrowserPage,
    request: MutationRequest,
    resumeMaxBytes: number,
    resumeDirectory: string | undefined,
  ): Promise<void> {
    if (request.kind === "save_job") {
      await this.applySavedJobChange(page, onlyChange(request));
      return;
    }
    if (request.kind === "application") {
      await this.applyJobApplication(page, onlyChange(request));
      return;
    }
    await this.applyChanges(
      page,
      request.changes,
      resumeMaxBytes,
      resumeDirectory,
    );
  }

  private async applySavedJobChange(
    page: BrowserPage,
    change: FieldChange,
  ): Promise<void> {
    if (change.operation !== "set") {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "Saved-job changes require a set operation",
      );
    }
    const jobId = mutationJobId(change.field, "job", "saved");
    const desired = parseSchema(savedJobMutation, change.value);
    const before = await readJobState(page, jobId, desired.sourceUrl);
    if (before.saved === desired.saved) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        `Naukri job ${jobId} already has the requested saved state`,
      );
    }
    let submitted = false;
    try {
      await page.click("button[class*='save-job-button']");
      submitted = true;
      const after = await readJobState(page, jobId, desired.sourceUrl);
      if (after.saved !== desired.saved) {
        throw new CareerPortalError(
          "OUTCOME_UNKNOWN",
          `Naukri did not conclusively report job ${jobId} as ${
            desired.saved ? "saved" : "unsaved"
          }`,
        );
      }
    } catch (error: unknown) {
      if (error instanceof CareerPortalError) throw error;
      if (submitted) {
        throw new CareerPortalError(
          "OUTCOME_UNKNOWN",
          `Naukri may have changed the saved state for job ${jobId}; re-read saved jobs before retrying`,
        );
      }
      throw error;
    }
  }

  private async applyJobApplication(
    page: BrowserPage,
    change: FieldChange,
  ): Promise<void> {
    if (change.operation !== "set") {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "Application submission requires a set operation",
      );
    }
    const jobId = mutationJobId(
      change.field,
      "application",
      "submission",
    );
    const desired = parseSchema(applicationMutation, change.value);
    if (
      desired.coverLetter !== undefined ||
      Object.keys(desired.questionnaireAnswers ?? {}).length > 0 ||
      desired.resume !== "current"
    ) {
      throw new CareerPortalError(
        "CAPABILITY_UNAVAILABLE",
        "This Naukri application requires an unverified cover-letter, questionnaire, or resume-selection flow; no partial application was attempted",
      );
    }
    const state = await readJobState(page, jobId, desired.sourceUrl);
    if (state.hideApplyButton) {
      throw new CareerPortalError(
        "CAPABILITY_UNAVAILABLE",
        "Naukri does not expose an apply control for this job",
      );
    }
    let submitted = false;
    try {
      await page.click("#apply-button");
      submitted = true;
      const applications = await this.readAccountData(page, "applications");
      const applied = Array.isArray(applications) &&
        applications.some((entry) =>
          isRecord(entry) && scalarString(entry.jobId) === jobId
        );
      if (!applied) {
        throw new CareerPortalError(
          "OUTCOME_UNKNOWN",
          "Naukri did not add the job to application history. The job may require questionnaire answers or an external application flow; no further action was attempted.",
        );
      }
    } catch (error: unknown) {
      if (error instanceof CareerPortalError) throw error;
      if (submitted) {
        throw new CareerPortalError(
          "OUTCOME_UNKNOWN",
          `Naukri may have applied to job ${jobId}; inspect application history before retrying`,
        );
      }
      throw error;
    }
  }

  override async readProfile(
    page: BrowserPage,
    fields?: readonly string[],
  ): Promise<Record<string, unknown>> {
    await this.assertSafePage(page);
    const payload = await page.gotoAndCaptureJson(
      this.profileUrl,
      profileApiPath,
    ) as NaukriProfilePayload;
    if (!Array.isArray(payload.profile) || !Array.isArray(payload.employments)) {
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        "Naukri profile API response shape was not recognized",
      );
    }
    const profile = payload.profile[0] ?? {};
    const history = payload.employments.map((employment) => ({
      id: requiredString(employment.employmentId, "employmentId"),
      title: requiredString(employment.designation, "designation"),
      company: requiredString(employment.organization, "organization"),
      description: employment.jobDescription ?? "",
      skills: splitSkills(employment.keySkills),
      startDate: employment.startDate ?? null,
      endDate: employment.endDate ?? null,
      current: !employment.endDate,
      employmentType: normalizeEmploymentType(employment.employmentType),
      experienceType: employment.experienceType ?? null,
      salary: employment.salary === null || employment.salary === undefined
        ? null
        : String(employment.salary),
      currency: normalizeCurrency(employment.currency),
      location: recordValue(employment.location),
      department: recordValue(employment.department),
      roleCategory: recordValue(employment.roleCategory),
      role: recordValue(employment.role),
      noticePeriod: !employment.endDate
        ? recordValue(profile.noticePeriod)
        : null,
    }));
    const projects = (payload.projects ?? []).map((project) => ({
      id: requiredString(project.projectId, "projectId"),
      employmentId: project.eduExpId ?? null,
      title: project.projectTitle ?? "",
      client: project.clientName ?? "",
      startDate: project.startDate ?? null,
      endDate: project.endDate ?? null,
      current: !project.endDate,
      description: project.projectDetails ?? "",
      location: project.projectLocation ?? "",
      onsite: project.isOnSiteProject ?? null,
      employmentType: project.employmentType ?? null,
      teamSize: project.teamSize ?? null,
      role: recordValue(project.role),
      roleDescription: project.roleDesc ?? "",
      skills: splitSkills(project.skills),
    }));
    const latest = history[0];
    const values: Record<string, unknown> = {
      headline: profile.resumeHeadline,
      summary: profile.summary,
      skills: splitSkills(profile.keySkills),
      "employment.history": history,
      "employment.title": latest?.title,
      "employment.company": latest?.company,
      "employment.description": latest?.description,
      "project.history": projects,
      "education.history": (payload.educations ?? []).map((education) => ({
        id: education.educationId,
        school: education.entityInstitute?.value ?? education.institute,
        degree: education.course?.value,
        specialization: education.specialisation?.value,
        startYear: education.yearOfStart,
        completionYear: education.yearOfCompletion,
        courseType: education.courseType ?? null,
        gradingSystem: recordValue(education.grade),
        marks: education.marks === undefined ? null : String(education.marks),
      })),
      "education.school":
        payload.educations?.[0]?.entityInstitute?.value ??
        payload.educations?.[0]?.institute,
      "education.degree": payload.educations?.[0]?.course?.value,
      "jobPreferences.titles":
        profile.desiredRole?.flatMap((role) => role.value ? [role.value] : []) ??
        [],
      "jobPreferences.locations":
        profile.locationPrefId?.flatMap(
          (location) => location.value ? [location.value] : [],
        ) ?? [],
      "resume.current": profile.cvInfo?.isAvailable
        ? profile.cvInfo.fileName
        : undefined,
      "careerProfile": {
        industry: profile.entityIndustry?.value ?? null,
        department: profile.entityDepartment?.value ?? null,
        roleCategory: profile.entityRoleCategory?.value ?? null,
        role: profile.entityRole?.value ?? null,
        desiredJobTypes: profile.desiredJobType ?? [],
        desiredEmploymentTypes: profile.desiredEmploymentType ?? [],
        preferredRoles:
          profile.desiredRole?.flatMap((role) =>
            role.value ? [role.value] : []
          ) ?? [],
        preferredLocations:
          profile.locationPrefId?.flatMap((location) =>
            location.value ? [location.value] : []
          ) ?? [],
        expectedSalary: profile.absoluteExpectedCtc === undefined
          ? null
          : String(profile.absoluteExpectedCtc),
        expectedSalaryCurrency: profile.expectedCtcCurrency ?? null,
      },
      "personalDetails": {
        gender: profile.gender ?? null,
        birthDate: profile.birthDate ?? null,
        maritalStatus: profile.maritalStatus ?? null,
        category: profile.category ?? null,
        permanentAddress: profile.contactAddress ?? null,
        hometown: profile.mailCity ?? null,
        pincode: profile.pincode ?? null,
        workPermits:
          profile.workPermitForCountry?.flatMap((country) =>
            country.value ? [country.value] : []
          ) ?? [],
      },
      "certification.history": (payload.certifications ?? []).map(
        (certification) => ({
          id: certification.certificationId,
          name: recordValue(certification.course),
          provider: recordValue(certification.vendor),
          completionId: certification.completionId ?? null,
          url: certification.url ?? null,
          issueDate: certification.issueDate ?? null,
          expiryDate: certification.expiryDate ?? null,
        }),
      ),
      "language.history": (payload.languages ?? []).map((language) => ({
        id: language.languageId,
        name: recordValue(language.lang),
        proficiency: recordValue(language.proficiency),
        abilities: Array.isArray(language.ability)
          ? language.ability
          : Object.entries(language.ability ?? {}).flatMap(([ability, enabled]) =>
            enabled ? [ability] : []
          ),
      })),
      "itSkills": (payload.itskills ?? []).map((skill) => ({
        id: skill.skillId,
        name: skill.skill,
        version: skill.version,
        lastUsedYear: skill.lastUsed?.value,
        experienceYears: skill.experienceTime?.year,
        experienceMonths: skill.experienceTime?.month,
      })),
    };
    for (const skill of values.itSkills as Array<Record<string, unknown>>) {
      if (typeof skill.id === "string") {
        values[`itSkill.${skill.id}`] = skill;
      }
    }
    for (const employment of history) {
      values[`employment.${employment.id}`] = employment;
      values[`employment.${employment.id}.title`] = employment.title;
      values[`employment.${employment.id}.company`] = employment.company;
      values[`employment.${employment.id}.description`] =
        employment.description;
      values[`employment.${employment.id}.dates`] = {
        startDate: employment.startDate,
        endDate: employment.endDate,
        current: employment.current,
      };
      values[`employment.${employment.id}.employmentType`] =
        employment.employmentType;
      values[`employment.${employment.id}.skills`] = employment.skills;
      values[`employment.${employment.id}.salary`] = {
        amount: employment.salary,
        currency: employment.currency,
      };
      values[`employment.${employment.id}.noticePeriod`] =
        employment.noticePeriod;
      values[`employment.${employment.id}.location`] = employment.location;
      values[`employment.${employment.id}.department`] =
        employment.department;
      values[`employment.${employment.id}.roleCategory`] =
        employment.roleCategory;
      values[`employment.${employment.id}.role`] = employment.role;
    }
    for (const project of projects) {
      values[`project.${project.id}`] = project;
      values[`project.${project.id}.title`] = project.title;
      values[`project.${project.id}.description`] = project.description;
    }
    for (const education of values["education.history"] as Array<
      Record<string, unknown>
    >) {
      if (typeof education.id === "string") {
        values[`education.${education.id}`] = education;
      }
    }
    for (const certification of values["certification.history"] as Array<
      Record<string, unknown>
    >) {
      if (typeof certification.id === "string") {
        values[`certification.${certification.id}`] = certification;
      }
    }
    return fields
      ? Object.fromEntries(fields.map((field) => [field, values[field]]))
      : values;
  }

  override async applyChanges(
    page: BrowserPage,
    changes: FieldChange[],
    resumeMaxBytes: number,
    resumeDirectory: string | undefined,
  ): Promise<void> {
    const employmentChanges = changes.filter((change) =>
      change.field === "employment.add" ||
      /^employment\.[^.]+(?:\.(?:title|company|description|dates|employmentType|skills|salary|noticePeriod))?$/.test(
        change.field,
      ),
    );
    const projectChanges = changes.filter((change) =>
      change.field === "project.add" ||
      /^project\.[^.]+(?:\.(?:title|description))?$/.test(change.field)
    );
    const profileChanges = changes.filter((change) =>
      ["headline", "summary", "skills"].includes(change.field)
    );
    const itSkillChanges = changes.filter((change) =>
      change.field === "itSkill.add" ||
      /^itSkill\.[A-Za-z0-9_-]+$/.test(change.field)
    );
    const educationChanges = changes.filter((change) =>
      change.field === "education.add" ||
      /^education\.[A-Za-z0-9_-]+$/.test(change.field)
    );
    const certificationChanges = changes.filter((change) =>
      change.field === "certification.add" ||
      /^certification\.[A-Za-z0-9_-]+$/.test(change.field)
    );
    const careerProfileChanges = changes.filter((change) =>
      change.field === "careerProfile"
    );
    const otherChanges = changes.filter((change) =>
      !employmentChanges.includes(change) &&
      !projectChanges.includes(change) &&
      !itSkillChanges.includes(change) &&
      !educationChanges.includes(change) &&
      !certificationChanges.includes(change) &&
      !careerProfileChanges.includes(change) &&
      !profileChanges.includes(change)
    );
    const completed: string[] = [];
    const ordered = [
      ...otherChanges,
      ...employmentChanges,
      ...projectChanges,
      ...itSkillChanges,
      ...educationChanges,
      ...certificationChanges,
      ...careerProfileChanges,
      ...profileChanges,
    ];
    for (const change of ordered) {
      try {
        if (employmentChanges.includes(change)) {
          await this.applyEmploymentChange(page, change);
        } else if (projectChanges.includes(change)) {
          await this.applyProjectChange(page, change);
        } else if (itSkillChanges.includes(change)) {
          await this.applyItSkillChange(page, change);
        } else if (educationChanges.includes(change)) {
          await this.applyEducationChange(page, change);
        } else if (certificationChanges.includes(change)) {
          await this.applyCertificationChange(page, change);
        } else if (careerProfileChanges.includes(change)) {
          await this.applyCareerProfileChange(page, change);
        } else if (profileChanges.includes(change)) {
          await this.applyProfileChange(page, change);
        } else {
          await super.applyChanges(
            page,
            [change],
            resumeMaxBytes,
            resumeDirectory,
          );
        }
        completed.push(change.field);
      } catch (error: unknown) {
        if (completed.length > 0) {
          throw new CareerPortalError(
            "OUTCOME_UNKNOWN",
            `Mutation stopped. Completed fields: ${completed.join(", ")}; failed or uncertain field: ${change.field}. Re-read provider state before retrying.`,
          );
        }
        if (error instanceof CareerPortalError) throw error;
        throw new CareerPortalError(
          "PROVIDER_CHANGED",
          `Naukri UI selector failed while updating ${change.field}: ${
            error instanceof Error ? error.message : "unknown browser error"
          }`,
        );
      }
    }
  }

  private async applyCareerProfileChange(
    page: BrowserPage,
    change: FieldChange,
  ): Promise<void> {
    if (change.operation !== "set") {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "careerProfile must be replaced with a complete validated value",
      );
    }
    const input = parseSchema(careerProfileInput, change.value);
    let submitted = false;
    try {
      await this.openLazyProfileSection(
        page,
        "Career profile",
        '[aria-label="Edit career profile"]',
      );
      await page.click('[aria-label="Edit career profile"]');
      await page.waitForFirst(".profileEditDrawer.model_open");
      if (input.industry !== undefined) {
        await page.selectOption(
          "#industryFor",
          "#listbox_industry",
          input.industry,
        );
      }
      if (input.department !== undefined) {
        await page.selectOption(
          "#fareaDroopeFor",
          "#listbox_fareaDroope",
          input.department,
        );
      }
      if (input.roleCategory !== undefined) {
        await page.selectOption(
          "#roleCategoryDroopeFor",
          "#listbox_roleCategoryDroope",
          input.roleCategory,
        );
      }
      if (input.role !== undefined) {
        await page.selectOption(
          "#roleDroopeFor",
          "#listbox_roleDroope",
          input.role,
        );
      }
      if (input.jobTypes !== undefined) {
        await page.setChecked(
          "#permanent",
          input.jobTypes.includes("permanent"),
        );
        await page.setChecked(
          "#contractual",
          input.jobTypes.includes("contractual"),
        );
      }
      if (input.employmentTypes !== undefined) {
        await page.setChecked(
          "#fullTime",
          input.employmentTypes.includes("full_time"),
        );
        await page.setChecked(
          "#partTime",
          input.employmentTypes.includes("part_time"),
        );
      }
      if (input.preferredRoles !== undefined) {
        const chipSelector =
          ".roleSuggCont + .chipsContainer .chip";
        const removeSelector =
          ".roleSuggCont + .chipsContainer a.material-icons.close";
        await page.waitForFirst(chipSelector);
        const desired = new Set(input.preferredRoles.map(normalizeSkill));
        const current = await page.texts(
          ".roleSuggCont + .chipsContainer .tagTxt",
        );
        let count = current.length;
        for (let index = current.length - 1; index >= 0; index -= 1) {
          if (!desired.has(normalizeSkill(current[index]!))) {
            await page.clickAt(removeSelector, index);
            count -= 1;
            await page.waitForCount(chipSelector, count);
          }
        }
        const retained = new Set(
          (await page.texts(
            ".roleSuggCont + .chipsContainer .tagTxt",
          )).map(normalizeSkill),
        );
        for (const preferredRole of input.preferredRoles) {
          if (retained.has(normalizeSkill(preferredRole))) continue;
          const beforeCount = await page.count(chipSelector);
          await page.fill("#roleSugg", "");
          await page.typeText("#roleSugg", preferredRole);
          await page.waitForFirst("#sugLst_roleSugg [role='option']");
          await page.selectOption(
            "#roleSugg",
            "#sugLst_roleSugg",
            preferredRole,
          );
          await page.waitForCount(chipSelector, beforeCount + 1);
          retained.add(normalizeSkill(preferredRole));
        }
      }
      await page.click("#saveDesiredProfile");
      submitted = true;
      await page.waitForHidden(".profileEditDrawer.model_open");
      const after = await this.readProfileWithRetry(page, ["careerProfile"]);
      if (!careerProfileMatches(after.careerProfile, input)) {
        throw new CareerPortalError(
          "OUTCOME_UNKNOWN",
          "Naukri accepted careerProfile, but the provider state did not conclusively match it.",
        );
      }
    } catch (error: unknown) {
      if (error instanceof CareerPortalError) throw error;
      if (submitted) {
        throw new CareerPortalError(
          "OUTCOME_UNKNOWN",
          "Naukri may have updated careerProfile, but verification failed.",
        );
      }
      throw error;
    }
  }

  private async applyProfileChange(
    page: BrowserPage,
    change: FieldChange,
  ): Promise<void> {
    if (change.operation !== "set") {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        `${change.field} must be replaced with a validated value`,
      );
    }
    let submitted = false;
    try {
      if (change.field === "skills") {
        const skills = naukriSkillsField.parse(change.value);
        const before = await this.readProfile(page, ["skills"]);
        const existingSkills = Array.isArray(before.skills)
          ? before.skills.filter((skill): skill is string =>
            typeof skill === "string"
          )
          : [];
        await this.openLazyProfileSection(
          page,
          "Key skills",
          ".keySkills .edit.icon",
        );
        await page.click(".keySkills .edit.icon");
        await page.waitForFirst(".keySkillsEdit.model_open");
        const chipSelector = ".keySkillsEdit .chipsContainer .chip";
        const removeSelector =
          ".keySkillsEdit .chipsContainer a.material-icons.close";
        if (existingSkills.length > 0) {
          await page.waitForFirst(chipSelector);
        }
        const desired = new Set(skills.map(normalizeSkill));
        const current = await page.texts(
          ".keySkillsEdit .chipsContainer .tagTxt",
        );
        let chipCount = current.length;
        for (let index = current.length - 1; index >= 0; index -= 1) {
          if (!desired.has(normalizeSkill(current[index]!))) {
            await page.clickAt(removeSelector, index);
            chipCount -= 1;
            await page.waitForCount(chipSelector, chipCount);
          }
        }
        const retained = new Set(
          (await page.texts(
            ".keySkillsEdit .chipsContainer .tagTxt",
          )).map(normalizeSkill),
        );
        for (const skill of skills) {
          if (retained.has(normalizeSkill(skill))) continue;
          const beforeCount = await page.count(chipSelector);
          await page.fill(".keySkillsEdit #keySkillSugg", skill);
          await page.press(".keySkillsEdit #keySkillSugg", ",");
          await page.waitForCount(chipSelector, beforeCount + 1);
          retained.add(normalizeSkill(skill));
        }
        await page.click(".keySkillsEdit #saveKeySkills");
        submitted = true;
        await page.waitForHidden(".keySkillsEdit.model_open");
      } else {
        const value = (change.field === "headline"
          ? shortTextField
          : naukriSummaryField).parse(change.value);
        const selectors = change.field === "headline"
          ? {
              label: "Resume headline",
              edit: ".resumeHeadline .edit.icon",
              drawer: ".resumeHeadlineEdit.model_open",
              input: ".resumeHeadlineEdit textarea",
              save: ".resumeHeadlineEdit button.btn-dark-ot",
            }
          : {
              label: "Profile summary",
              edit: ".profileSummary .edit.icon",
              drawer: ".profileSummaryEdit.model_open",
              input: ".profileSummaryEdit textarea",
              save: ".profileSummaryEdit button.btn-dark-ot",
            };
        await this.openLazyProfileSection(
          page,
          selectors.label,
          selectors.edit,
        );
        await page.click(selectors.edit);
        await page.waitForFirst(selectors.drawer);
        await page.fill(selectors.input, value);
        await page.click(selectors.save);
        submitted = true;
        await page.waitForHidden(selectors.drawer);
      }
      const after = await this.readProfileWithRetry(page, [change.field]);
      const expected = change.field === "skills"
        ? naukriSkillsField.parse(change.value)
        : change.value;
      const verified = Array.isArray(expected)
        ? normalizedStringSetEquals(after[change.field], expected)
        : normalize(after[change.field]) === normalize(expected);
      if (!verified) {
        throw new CareerPortalError(
          "OUTCOME_UNKNOWN",
          `Naukri accepted ${change.field}, but it was not conclusively observed. Completed fields: none; uncertain fields: ${change.field}.`,
        );
      }
    } catch (error: unknown) {
      if (error instanceof CareerPortalError) throw error;
      if (submitted) {
        throw new CareerPortalError(
          "OUTCOME_UNKNOWN",
          `Naukri may have updated ${change.field}, but verification failed. Completed fields: none; uncertain fields: ${change.field}.`,
        );
      }
      throw error;
    }
  }

  private async applyEmploymentChange(
    page: BrowserPage,
    change: FieldChange,
  ): Promise<void> {
    if (change.field === "employment.add") {
      await this.addEmployment(page, change);
      return;
    }
    const match =
      /^employment\.([^.]+)(?:\.(title|company|description|dates|employmentType|skills|salary|noticePeriod))?$/.exec(
        change.field,
      );
    if (!match?.[1]) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        `Unsupported Naukri employment field ${change.field}`,
      );
    }
    const id = match[1];
    const attribute = match[2];
    validateEmploymentChange(attribute, change);
    const snapshot = await this.readProfile(page, ["employment.history"]);
    const history = snapshot["employment.history"];
    if (!Array.isArray(history)) {
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        "Naukri employment history could not be read",
      );
    }
    const index = history.findIndex(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "id" in entry &&
        entry.id === id,
    );
    if (index < 0) {
      throw new CareerPortalError(
        "STATE_DRIFT",
        `Naukri employment ${id} no longer exists`,
      );
    }
    const currentEntry = history[index];
    if (
      (attribute === "salary" || attribute === "skills" ||
        attribute === "noticePeriod") &&
      isEmploymentRecord(currentEntry) &&
      (!currentEntry.current ||
        (attribute === "salary" &&
          currentEntry.employmentType !== "full_time"))
    ) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        attribute === "salary"
          ? "Naukri exposes salary only for current full-time employment"
          : `Naukri exposes employment ${attribute} only for current employment`,
      );
    }
    await this.openEmploymentSection(page);
    await page.waitForFirst("#lazyEmployment [aria-label^='Edit employment:']");
    await page.clickAt(
      "#lazyEmployment [aria-label^='Edit employment:']",
      index,
    );
    await page.waitForFirst(".employmentLayer.model_open");
    if (!attribute && change.operation === "remove") {
      await page.click(".employmentLayer a.delete");
      const confirm =
        ".lightbox.model_open.flipOpen:not(.employmentLayer) button.btn-dark-ot";
      await page.waitFor(confirm);
      await page.click(confirm);
    } else {
      if (!attribute || change.operation !== "set") {
        throw new CareerPortalError(
          "VALIDATION_FAILED",
          "Employment updates require a set operation; deleting an entry requires removing employment.<id>",
        );
      }
      await this.fillEmploymentAttribute(page, attribute, change.value);
      await page.click("#submitEmployment");
      await page.waitForHidden(".employmentLayer.model_open");
    }
    await page.waitForFirst("#lazyEmployment");
    const after = await this.readProfileWithRetry(
      page,
      attribute ? [change.field] : ["employment.history"],
    );
    const verified = attribute
      ? verifyEmploymentAttribute(
        attribute,
        after[change.field],
        change.value,
      )
      : Array.isArray(after["employment.history"]) &&
        !after["employment.history"].some(
          (entry) =>
            typeof entry === "object" &&
            entry !== null &&
            "id" in entry &&
            entry.id === id,
        );
    if (!verified) {
      throw new CareerPortalError(
        "OUTCOME_UNKNOWN",
        `Naukri accepted the employment submission but ${change.field} was not conclusively verified`,
      );
    }
  }

  private async addEmployment(
    page: BrowserPage,
    change: FieldChange,
  ): Promise<void> {
    if (change.operation !== "set") {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "employment.add requires a set operation",
      );
    }
    const input = parseEmploymentInput(change.value);
    const before = await this.readProfile(page, ["employment.history"]);
    const beforeIds = new Set(
      Array.isArray(before["employment.history"])
        ? before["employment.history"].flatMap((entry) =>
          isEmploymentRecord(entry) ? [entry.id] : []
        )
        : [],
    );
    let submitted = false;
    try {
      await this.openEmploymentSection(page);
      await page.click("#add-employment");
      await page.waitFor(".employmentLayer.model_open");
      await this.fillEmploymentForm(page, input);
      await page.click("#submitEmployment");
      submitted = true;
      await page.waitForHidden(".employmentLayer.model_open");
      await page.waitFor("#lazyEmployment");
      const after = await this.readProfileWithRetry(
        page,
        ["employment.history"],
      );
      const added = Array.isArray(after["employment.history"]) &&
        after["employment.history"].some((entry) =>
          isEmploymentRecord(entry) &&
          !beforeIds.has(entry.id) &&
          addedEmploymentMatches(entry, input)
        );
      if (!added) {
        throw new CareerPortalError(
          "OUTCOME_UNKNOWN",
          "Naukri accepted the employment submission but the new entry was not conclusively verified",
        );
      }
    } catch (error: unknown) {
      if (error instanceof CareerPortalError) throw error;
      if (submitted) {
        throw new CareerPortalError(
          "OUTCOME_UNKNOWN",
          "Naukri may have added the employment entry, but verification failed",
        );
      }
      throw error;
    }
  }

  private async fillEmploymentAttribute(
    page: BrowserPage,
    attribute: string,
    value: unknown,
  ): Promise<void> {
    if (attribute === "title" || attribute === "company" ||
      attribute === "description") {
      const schema = attribute === "description" ? textField : shortTextField;
      const selector = {
        title: "#designationSugg",
        company: "#companySugg",
        description: "#jobDescription",
      }[attribute]!;
      await page.fill(selector, schema.parse(value));
      return;
    }
    if (attribute === "dates") {
      await this.fillEmploymentDates(page, parseEmploymentDates(value));
      return;
    }
    if (attribute === "employmentType") {
      await selectEmploymentType(page, parseSchema(employmentType, value));
      return;
    }
    if (attribute === "salary") {
      const input = parseSchema(salary, value);
      await page.click(".currency-dropdown");
      await page.clickAt(".currency-option", input.currency === "INR" ? 0 : 1);
      await page.fill("#totalAbsCtc_id", input.amount);
      return;
    }
    if (attribute === "skills") {
      await replaceEmploymentSkills(page, stringListField.parse(value));
      return;
    }
    if (attribute === "noticePeriod") {
      const notice = parseSchema(noticePeriod, value);
      await page.selectOption(
        "#noticePeriodFor",
        "#listbox_noticePeriod",
        notice,
      );
      return;
    }
    throw new CareerPortalError(
      "VALIDATION_FAILED",
      `Unsupported employment attribute ${attribute}`,
    );
  }

  private async fillEmploymentForm(
    page: BrowserPage,
    input: z.infer<typeof employmentInput>,
  ): Promise<void> {
    await page.click(`label[for="${input.current ? "yes" : "no"}"]`);
    await selectEmploymentType(page, input.employmentType);
    await page.fill("#companySugg", input.company);
    await page.fill("#designationSugg", input.title);
    await this.fillEmploymentDates(page, input);
    if (input.description !== undefined) {
      await page.fill("#jobDescription", input.description);
    }
    if (input.current && input.salary !== undefined) {
      await page.click(".currency-dropdown");
      await page.clickAt(".currency-option", input.currency === "INR" ? 0 : 1);
      await page.fill("#totalAbsCtc_id", input.salary);
    }
    if (input.current && input.skills !== undefined) {
      await replaceEmploymentSkills(page, input.skills);
    }
  }

  private async fillEmploymentDates(
    page: BrowserPage,
    input: z.infer<typeof employmentDates>,
  ): Promise<void> {
    await page.click(`label[for="${input.current ? "yes" : "no"}"]`);
    await selectMonthDate(page, "started", input.startDate);
    if (!input.current) {
      await selectMonthDate(page, "workedTill", input.endDate!);
    }
  }

  private async openEmploymentSection(page: BrowserPage): Promise<void> {
    const selector =
      '.quickLink .collection-item:has-text("Employment") .text';
    await page.waitForFirst(selector);
    await page.click(selector);
    await page.waitForFirst("#lazyEmployment");
  }

  private async openLazyProfileSection(
    page: BrowserPage,
    label: string,
    editSelector: string,
  ): Promise<void> {
    if (await page.isVisible(editSelector)) return;
    const selector =
      `.quickLink .collection-item:has-text("${label}") .text`;
    await page.waitForFirst(selector);
    await page.click(selector);
    await page.waitForFirst(editSelector);
  }

  private async readProfileWithRetry(
    page: BrowserPage,
    fields: readonly string[],
  ): Promise<Record<string, unknown>> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.readProfile(page, fields);
      } catch (error: unknown) {
        lastError = error;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }
    throw lastError;
  }

  private async applyProjectChange(
    page: BrowserPage,
    change: FieldChange,
  ): Promise<void> {
    if (change.field === "project.add") {
      if (change.operation !== "set") {
        throw new CareerPortalError(
          "VALIDATION_FAILED",
          "project.add requires a set operation",
        );
      }
      const input = parseSchema(projectInput, change.value);
      const snapshot = await this.readProfile(page, [
        "employment.history",
        "project.history",
      ]);
      const history = snapshot["employment.history"];
      const projects = snapshot["project.history"];
      const employment = Array.isArray(history)
        ? history.find((entry) =>
          isEmploymentRecord(entry) && entry.id === input.employmentId
        )
        : undefined;
      if (!employment || !Array.isArray(projects)) {
        throw new CareerPortalError(
          "STATE_DRIFT",
          `Naukri employment ${input.employmentId} no longer exists`,
        );
      }
      const beforeIds = new Set(projects.flatMap((entry) =>
        isRecord(entry) && typeof entry.id === "string" ? [entry.id] : []
      ));
      await openProjectSection(page);
      await page.click("#lazyProject span.add");
      await page.waitForFirst(".profileEditDrawer.model_open");
      await fillProjectForm(
        page,
        input,
        `${employment.title} - ${employment.company}`,
      );
      await page.click("#submitProject");
      await page.waitForHidden(".profileEditDrawer.model_open");
      const after = await this.readProfileWithRetry(
        page,
        ["project.history"],
      );
      const added = Array.isArray(after["project.history"]) &&
        after["project.history"].some((entry) =>
          isRecord(entry) &&
          typeof entry.id === "string" &&
          !beforeIds.has(entry.id) &&
          normalize(entry.title) === normalize(input.title) &&
          entry.employmentId === input.employmentId &&
          sameMonth(entry.startDate, input.startDate) &&
          (input.current || sameMonth(entry.endDate, input.endDate))
        );
      if (!added) {
        throw new CareerPortalError(
          "OUTCOME_UNKNOWN",
          "Naukri accepted the project submission but the attached project was not conclusively verified",
        );
      }
      return;
    }

    const match =
      /^project\.([A-Za-z0-9_-]+)(?:\.(title|description))?$/.exec(
        change.field,
      );
    if (!match?.[1]) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        `Unsupported Naukri project field ${change.field}`,
      );
    }
    const projectId = match[1];
    const attribute = match[2];
    if (
      attribute &&
      (change.operation !== "set" || typeof change.value !== "string")
    ) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        `project.${attribute} requires a string set operation`,
      );
    }
    if (!attribute && change.operation !== "remove") {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "Deleting a project requires removing project.<id>",
      );
    }
    const snapshot = await this.readProfile(page, ["project.history"]);
    const projects = snapshot["project.history"];
    const index = Array.isArray(projects)
      ? projects.findIndex((entry) =>
        isRecord(entry) && entry.id === projectId
      )
      : -1;
    if (index < 0) {
      throw new CareerPortalError(
        "STATE_DRIFT",
        `Naukri project ${projectId} no longer exists`,
      );
    }
    await openProjectSection(page);
    await page.clickAt('#lazyProject [aria-label^="Edit project:"]', index);
    await page.waitForFirst(".profileEditDrawer.model_open");
    if (!attribute) {
      await page.click(".profileEditDrawer.model_open a.delete");
      const confirm =
        ".lightbox.model_open.flipOpen:not(.profileEditDrawer) button.btn-dark-ot";
      await page.waitFor(confirm);
      await page.click(confirm);
    } else {
      await page.fill(
        attribute === "title" ? "#projectTitle" : "#projectDetails",
        (attribute === "title" ? shortTextField : textField).parse(
          change.value,
        ),
      );
      await page.click("#submitProject");
      await page.waitForHidden(".profileEditDrawer.model_open");
    }
    const after = await this.readProfileWithRetry(
      page,
      attribute ? [change.field] : ["project.history"],
    );
    const verified = attribute
      ? normalize(after[change.field]) === normalize(change.value)
      : Array.isArray(after["project.history"]) &&
        !after["project.history"].some((entry) =>
          isRecord(entry) && entry.id === projectId
        );
    if (!verified) {
      throw new CareerPortalError(
        "OUTCOME_UNKNOWN",
        `Naukri project mutation ${change.field} was not conclusively verified`,
      );
    }
  }

  private async applyItSkillChange(
    page: BrowserPage,
    change: FieldChange,
  ): Promise<void> {
    if (change.operation !== "set") {
      throw new CareerPortalError(
        "CAPABILITY_UNAVAILABLE",
        "The current Naukri IT-skill editor does not expose a verified delete control",
      );
    }
    const input = parseSchema(itSkillInput, change.value);
    const snapshot = await this.readProfile(page);
    const skills = snapshot.itSkills;
    if (!Array.isArray(skills)) {
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        "Naukri IT skills could not be read",
      );
    }
    const adding = change.field === "itSkill.add";
    const skillId = adding
      ? undefined
      : /^itSkill\.([A-Za-z0-9_-]+)$/.exec(change.field)?.[1];
    const index = skillId
      ? skills.findIndex((entry) => isRecord(entry) && entry.id === skillId)
      : -1;
    if (!adding && index < 0) {
      throw new CareerPortalError(
        "STATE_DRIFT",
        `Naukri IT skill ${skillId ?? ""} no longer exists`,
      );
    }
    if (adding && skills.length >= 10) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "Naukri currently limits the profile to 10 IT skills",
      );
    }
    const quickLink =
      '.quickLink .collection-item:has-text("IT skills") .text';
    await page.waitForFirst(quickLink);
    await page.click(quickLink);
    if (adding) {
      await page.waitForFirst('#lazyITSkills [aria-label="Add IT skills"]');
      await page.click('#lazyITSkills [aria-label="Add IT skills"]');
    } else {
      const existing = skills[index];
      if (!isRecord(existing) || typeof existing.name !== "string") {
        throw new CareerPortalError(
          "PROVIDER_CHANGED",
          `Naukri IT skill ${skillId ?? ""} omitted its name`,
        );
      }
      const editSelector = `#lazyITSkills [aria-label=${
        JSON.stringify(`Edit IT skill: ${existing.name}`)
      }]`;
      await page.waitForFirst(editSelector);
      await page.click(editSelector);
    }
    await page.waitForFirst(".profileEditDrawer.model_open");
    const existingEntry = !adding && index >= 0 ? skills[index] : undefined;
    const nameChanged = !isRecord(existingEntry) ||
      normalize(existingEntry.name) !== normalize(input.name);
    if (adding || nameChanged) {
      await page.fill("#itSkillSugg", "");
      await page.typeText("#itSkillSugg", input.name);
      await page.waitForFirst("#sugLst_itSkillSugg [role='option']");
      await page.selectOption(
        "#itSkillSugg",
        "#sugLst_itSkillSugg",
        input.name,
      );
    }
    await page.fill("#version", input.version ?? "");
    await page.selectOption(
      "#lastUsedDroopeFor",
      "#listbox_lastUsedDroope",
      String(input.lastUsedYear),
    );
    await page.selectOption(
      "#expYearDroopeFor",
      "#listbox_expYearDroope",
      `${input.experienceYears} ${
        input.experienceYears <= 1 ? "Year" : "Years"
      }`,
    );
    await page.selectOption(
      "#expMonthDroopeFor",
      "#listbox_expMonthDroope",
      `${input.experienceMonths} ${
        input.experienceMonths <= 1 ? "Month" : "Months"
      }`,
    );
    await page.click("#saveITSkills");
    await page.waitForHidden(".profileEditDrawer.model_open");
    const after = await this.readProfileWithRetry(page, ["itSkills"]);
    const updated = after.itSkills;
    const verified = Array.isArray(updated) && updated.some((entry) =>
      isRecord(entry) &&
      (adding ? !skills.some((before) =>
        isRecord(before) && before.id === entry.id
      ) : entry.id === skillId) &&
      normalize(entry.name) === normalize(input.name) &&
      normalize(entry.version) === normalize(input.version ?? "") &&
      entry.lastUsedYear === input.lastUsedYear &&
      entry.experienceYears === input.experienceYears &&
      entry.experienceMonths === input.experienceMonths
    );
    if (!verified) {
      throw new CareerPortalError(
        "OUTCOME_UNKNOWN",
        `Naukri IT skill ${change.field} was not conclusively verified`,
      );
    }
  }

  private async applyEducationChange(
    page: BrowserPage,
    change: FieldChange,
  ): Promise<void> {
    const adding = change.field === "education.add";
    const id = adding
      ? undefined
      : /^education\.([A-Za-z0-9_-]+)$/.exec(change.field)?.[1];
    const snapshot = await this.readProfile(page, ["education.history"]);
    const history = snapshot["education.history"];
    if (!Array.isArray(history)) {
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        "Naukri education history could not be read",
      );
    }
    const index = id
      ? history.findIndex((entry) => isRecord(entry) && entry.id === id)
      : -1;
    if (!adding && index < 0) {
      throw new CareerPortalError("STATE_DRIFT", `Education ${id} is missing`);
    }
    if (change.operation === "set") parseSchema(educationInput, change.value);
    await page.click('.quickLink .collection-item:has-text("Education")');
    await page.waitFor("#lazyEducation");
    if (adding) {
      await page.click("#lazyEducation span.add");
    } else {
      await page.clickAt(
        '#lazyEducation [aria-label^="Edit education:"]',
        index,
      );
    }
    await page.waitFor(".profileEditDrawer.model_open");
    if (change.operation === "remove") {
      await page.click(".profileEditDrawer.model_open a.delete");
      const confirm =
        ".lightbox.model_open.flipOpen:not(.profileEditDrawer) button.btn-dark-ot";
      await page.waitFor(confirm);
      await page.click(confirm);
    } else {
      await fillEducationForm(
        page,
        parseSchema(educationInput, change.value),
      );
      await page.click("#saveEducation");
    }
    await page.waitFor("#lazyEducation");
    const after = await this.readProfile(page, ["education.history"]);
    const records = after["education.history"];
    const verified = change.operation === "remove"
      ? Array.isArray(records) &&
        !records.some((entry) => isRecord(entry) && entry.id === id)
      : Array.isArray(records) &&
        records.some((entry) =>
          isRecord(entry) &&
          (adding
            ? !history.some((before) =>
              isRecord(before) && before.id === entry.id
            )
            : entry.id === id) &&
          educationMatches(
            entry,
            parseSchema(educationInput, change.value),
          )
        );
    if (!verified) {
      throw new CareerPortalError(
        "OUTCOME_UNKNOWN",
        `Naukri education mutation ${change.field} was not verified`,
      );
    }
  }

  private async applyCertificationChange(
    page: BrowserPage,
    change: FieldChange,
  ): Promise<void> {
    const adding = change.field === "certification.add";
    const id = adding
      ? undefined
      : /^certification\.([A-Za-z0-9_-]+)$/.exec(change.field)?.[1];
    const snapshot = await this.readProfile(page, ["certification.history"]);
    const history = snapshot["certification.history"];
    if (!Array.isArray(history)) {
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        "Naukri certification history could not be read",
      );
    }
    const index = id
      ? history.findIndex((entry) => isRecord(entry) && entry.id === id)
      : -1;
    if (!adding && index < 0) {
      throw new CareerPortalError(
        "STATE_DRIFT",
        `Certification ${id} is missing`,
      );
    }
    if (change.operation === "set") {
      parseSchema(certificationInput, change.value);
    }
    await page.click('.quickLink .collection-item:has-text("Accomplishments")');
    await page.waitFor("#lazyAccomplishment");
    if (adding) {
      await page.click('[aria-label="Add certification"]');
    } else {
      await page.clickAt('[aria-label="Edit certification"]', index);
    }
    await page.waitFor(".profileEditDrawer.model_open");
    if (change.operation === "remove") {
      await page.click(".profileEditDrawer.model_open a.delete");
    } else {
      await fillCertificationForm(
        page,
        parseSchema(certificationInput, change.value),
      );
      await page.click("#saveCertificationsBtn");
    }
    await page.waitFor("#lazyAccomplishment");
    const after = await this.readProfile(page, ["certification.history"]);
    const records = after["certification.history"];
    const verified = change.operation === "remove"
      ? Array.isArray(records) &&
        !records.some((entry) => isRecord(entry) && entry.id === id)
      : Array.isArray(records) &&
        records.some((entry) =>
          isRecord(entry) &&
          (adding
            ? !history.some((before) =>
              isRecord(before) && before.id === entry.id
            )
            : entry.id === id) &&
          certificationMatches(
            entry,
            parseSchema(certificationInput, change.value),
          )
        );
    if (!verified) {
      throw new CareerPortalError(
        "OUTCOME_UNKNOWN",
        `Naukri certification mutation ${change.field} was not verified`,
      );
    }
  }

  protected readonly selectors: WorkflowSelectors = {
    authenticated: "[data-ga-track='Profile']",
    challenge: [
      "iframe[src*='captcha']",
      ".captcha",
      "input[name='otp']",
    ],
    fields: {
      headline: {
        read: ".resumeHeadline .widgetCont",
        edit: ".resumeHeadline .edit.icon",
        input: "textarea[name='resumeHeadline']",
        save: ".resumeHeadlineEdit .btn-dark-ot",
        schema: shortTextField,
      },
      summary: {
        read: ".profileSummary .widgetCont",
        edit: ".profileSummary .edit.icon",
        input: "textarea[name='profileSummary']",
        save: ".profileSummaryEdit .btn-dark-ot",
        schema: textField,
      },
      skills: {
        read: ".keySkills .chip",
        readMany: true,
        edit: ".keySkills .edit.icon",
        input: "input[name='keySkills']",
        save: ".keySkillsEdit .btn-dark-ot",
        schema: stringListField,
      },
      "employment.title": {
        read: ".employment > :first-child .designation",
        edit: ".employment > :first-child .edit.icon",
        input: "input[name='designation']",
        save: ".employmentEdit .btn-dark-ot",
        schema: shortTextField,
      },
      "employment.company": {
        read: ".employment > :first-child .company",
        edit: ".employment > :first-child .edit.icon",
        input: "input[name='organization']",
        save: ".employmentEdit .btn-dark-ot",
        schema: shortTextField,
      },
      "employment.description": {
        read: ".employment > :first-child .jobDescription",
        edit: ".employment > :first-child .edit.icon",
        input: "textarea[name='jobDescription']",
        save: ".employmentEdit .btn-dark-ot",
        schema: textField,
      },
      "education.school": {
        read: ".education > :first-child .institute",
        edit: ".education > :first-child .edit.icon",
        input: "input[name='institute']",
        save: ".educationEdit .btn-dark-ot",
        schema: shortTextField,
      },
      "education.degree": {
        read: ".education > :first-child .course",
        edit: ".education > :first-child .edit.icon",
        input: "input[name='course']",
        save: ".educationEdit .btn-dark-ot",
        schema: shortTextField,
      },
      "jobPreferences.titles": {
        read: ".careerProfile .desiredRole",
        edit: ".careerProfile .edit.icon",
        input: "input[name='desiredRole']",
        save: ".careerProfileEdit .btn-dark-ot",
        schema: stringListField.max(5),
      },
      "jobPreferences.locations": {
        read: ".careerProfile .preferredLocations",
        edit: ".careerProfile .edit.icon",
        input: "input[name='preferredLocations']",
        save: ".careerProfileEdit .btn-dark-ot",
        schema: stringListField.max(10),
      },
    },
    resume: {
      current: ".resumeDetails .resume-name",
      edit: ".resumeDetails .updateResume",
      input: "input[type='file'][accept*='.pdf']",
    },
  };
}

function splitSkills(value: string | undefined): string[] {
  return value?.split(",").map((skill) => skill.trim()).filter(Boolean) ?? [];
}

function requiredString(value: string | undefined, field: string): string {
  if (!value) {
    throw new CareerPortalError(
      "PROVIDER_CHANGED",
      `Naukri employment record is missing ${field}`,
    );
  }
  return value;
}

function normalize(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
    : "";
}

function normalizeSkill(value: string): string {
  return normalize(value).toLowerCase();
}

function normalizedStringSetEquals(
  actual: unknown,
  expected: string[],
): boolean {
  if (!Array.isArray(actual) || actual.some((value) =>
    typeof value !== "string"
  )) {
    return false;
  }
  const actualSet = new Set((actual as string[]).map(normalizeSkill));
  const expectedSet = new Set(expected.map(normalizeSkill));
  return actualSet.size === expectedSet.size &&
    [...expectedSet].every((value) => actualSet.has(value));
}

const monthDate = z.string().regex(
  /^\d{4}-(?:0[1-9]|1[0-2])$/,
  "Date must use YYYY-MM",
);

const employmentType = z.enum(["full_time", "internship"]);
const noticePeriod = z.enum([
  "15 Days or less",
  "1 Month",
  "2 Months",
  "3 Months",
  "More than 3 Months",
  "Serving Notice Period",
]);

const employmentDates = z.object({
  startDate: monthDate,
  current: z.boolean(),
  endDate: monthDate.optional(),
}).strict().superRefine((value, context) => {
  if (value.current && value.endDate !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "Current employment must not include an end date",
    });

  }
  if (!value.current && value.endDate === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "Previous employment requires an end date",
    });

  }
  if (value.endDate !== undefined && value.endDate < value.startDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "Employment end date must not precede its start date",
    });
  }
});

const careerProfileInput = z.object({
  industry: shortTextField.optional(),
  department: shortTextField.optional(),
  roleCategory: shortTextField.optional(),
  role: shortTextField.optional(),
  jobTypes: z.array(z.enum(["permanent", "contractual"])).min(1).max(2)
    .optional(),
  employmentTypes: z.array(z.enum(["full_time", "part_time"])).min(1).max(2)
    .optional(),
  preferredRoles: z.array(shortTextField).min(1).max(3).optional(),
}).strict().refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  "careerProfile must include at least one supported field",
);

const salary = z.object({
  amount: z.string().regex(/^\d{1,12}$/, "Salary must be whole currency units"),
  currency: z.enum(["INR", "USD"]),
}).strict();

const savedJobMutation = z.object({
  sourceUrl: z.string().url(),
  saved: z.boolean(),
}).strict();

const applicationMutation = z.object({
  sourceUrl: z.string().url(),
  resume: z.literal("current").default("current"),
  coverLetter: z.string().trim().min(1).max(4_000).optional(),
  questionnaireAnswers: z.record(
    z.string().trim().min(1).max(200),
    z.string().trim().min(1).max(2_000),
  ).default({}),
}).strict();

const employmentInput = z.object({
  company: shortTextField,
  title: shortTextField,
  description: textField.optional(),
  startDate: monthDate,
  current: z.boolean(),
  endDate: monthDate.optional(),
  employmentType,
  skills: stringListField.optional(),
  salary: z.string().regex(
    /^\d{1,12}$/,
    "Salary must be whole currency units",
  ).optional(),
  currency: z.enum(["INR", "USD"]).optional(),
}).strict().superRefine((value, context) => {
  const parsedDates = employmentDates.safeParse({
    startDate: value.startDate,
    current: value.current,
    endDate: value.endDate,
  });

  if (!parsedDates.success) {
    for (const issue of parsedDates.error.issues) {
      context.addIssue({ ...issue });
    }
  }
  if (!value.current && (value.salary !== undefined ||
    value.currency !== undefined || value.skills !== undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Naukri exposes salary, currency, and skills only for current employment",
    });
  }
  if ((value.salary === undefined) !== (value.currency === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Salary amount and currency must be supplied together",
    });
  }
  if (value.salary !== undefined && value.employmentType !== "full_time") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["salary"],
      message: "Salary is supported only for current full-time employment",
    });
  }
});

const projectInput = z.object({
  employmentId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
  title: shortTextField,
  client: shortTextField.optional(),
  startDate: monthDate,
  current: z.boolean(),
  endDate: monthDate.optional(),
  description: textField.optional(),
  location: shortTextField.optional(),
  onsite: z.boolean().optional(),
  employmentType: z.enum([
    "full_time",
    "part_time",
    "contractual",
  ]).optional(),
}).strict().superRefine((value, context) => {
  const dates = employmentDates.safeParse({
    startDate: value.startDate,
    current: value.current,
    endDate: value.endDate,
  });

  if (!dates.success) {
    for (const issue of dates.error.issues) {
      context.addIssue({ ...issue });
    }
  }
});

const itSkillInput = z.object({
  name: z.string().trim().min(1).max(100),
  version: z.string().trim().max(50).optional(),
  lastUsedYear: z.number().int().min(1950).max(2100),
  experienceYears: z.number().int().min(0).max(50),
  experienceMonths: z.number().int().min(0).max(11),
}).strict();

const educationInput = z.object({
  level: shortTextField,
  institute: shortTextField,
  course: shortTextField,
  specialization: shortTextField.optional(),
  courseType: z.enum(["full_time", "part_time", "correspondence"]),
  startYear: z.number().int().min(1950).max(2100),
  completionYear: z.number().int().min(1950).max(2100),
  gradingSystem: shortTextField.optional(),
}).strict().refine(
  (value) => value.completionYear >= value.startYear,
  "Education completion year must not precede its start year",
);

const certificationInput = z.object({
  name: shortTextField,
  provider: shortTextField,
  completionId: z.string().trim().max(200).optional(),
  url: z.string().url().max(2_000).optional(),
  issueDate: monthDate,
  expiryDate: monthDate.optional(),
  doesNotExpire: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.doesNotExpire && value.expiryDate !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Non-expiring certifications must not include expiryDate",
    });
  }
  if (!value.doesNotExpire && value.expiryDate === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Expiring certifications require expiryDate",
    });
  }
  if (value.expiryDate && value.expiryDate < value.issueDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Certification expiry must not precede issue date",
    });
  }
});

const monthLabels = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

async function selectEmploymentType(
  page: BrowserPage,
  type: z.infer<typeof employmentType>,
): Promise<void> {
  const id = type === "full_time"
    ? "expType_Full-time_F"
    : "expType_Internship_I";
  await page.click(`label[for="${id}"]`);
}

async function selectMonthDate(
  page: BrowserPage,
  prefix: "started" | "workedTill",
  date: string,
): Promise<void> {
  const [year, monthValue] = date.split("-");
  const month = monthLabels[Number(monthValue) - 1];
  if (!year || !month) {
    throw new CareerPortalError(
      "VALIDATION_FAILED",
      `Invalid employment date ${date}`,
    );
  }
  await page.selectOption(
    `#${prefix}YearFor`,
    `#listbox_${prefix}Year`,
    year,
  );
  await page.selectOption(
    `#${prefix}MonthFor`,
    `#listbox_${prefix}Month`,
    month,
  );
}

async function replaceEmploymentSkills(
  page: BrowserPage,
  skills: string[],
): Promise<void> {
  const removeSelector =
    ".employmentLayer.model_open a.material-icons.close";
  const existing = await page.count(removeSelector);
  for (let index = existing - 1; index >= 0; index -= 1) {
    await page.clickAt(removeSelector, index);
  }
  for (const skill of skills) {
    await page.fill(".employmentLayer.model_open #keySkillSugg", skill);
    await page.press(
      ".employmentLayer.model_open #keySkillSugg",
      "Enter",
    );
  }
}

async function openProjectSection(page: BrowserPage): Promise<void> {
  const selector = '.quickLink .collection-item:has-text("Projects") .text';
  await page.waitForFirst(selector);
  await page.click(selector);
  await page.waitForFirst("#lazyProject span.add");
}

async function fillProjectForm(
  page: BrowserPage,
  input: z.infer<typeof projectInput>,
  employmentLabel: string,
): Promise<void> {
  await page.fill("#projectTitle", input.title);
  await page.selectOption(
    "#eduExpIdFor",
    "#listbox_eduExpId",
    employmentLabel,
  );
  if (input.client !== undefined) {
    await page.fill("#clientName", "");
    await page.typeText("#clientName", input.client);
    await page.waitForFirst("#sugLst_clientName [role='option']");
    await page.selectOption(
      "#clientName",
      "#sugLst_clientName",
      input.client,
    );
  }
  await page.click(`label[for="${input.current ? "inprogress" : "finished"}"]`);
  await selectProjectMonthDate(page, "projStart", input.startDate);
  if (!input.current) {
    await selectProjectMonthDate(page, "projEnd", input.endDate!);
  }
  if (input.description !== undefined) {
    await page.fill("#projectDetails", input.description);
  }
  if (input.location !== undefined) {
    await page.fill("#projectLocation", input.location);
  }
  if (input.onsite !== undefined) {
    await page.click(`label[for="${input.onsite ? "onsite" : "offsite"}"]`);
  }
  if (input.employmentType !== undefined) {
    const id = {
      full_time: "fullTime",
      part_time: "partTime",
      contractual: "contractual",
    }[input.employmentType];
    await page.click(`label[for="${id}"]`);
  }
}

async function selectProjectMonthDate(
  page: BrowserPage,
  prefix: "projStart" | "projEnd",
  date: string,
): Promise<void> {
  const [year, monthValue] = date.split("-");
  const month = monthLabels[Number(monthValue) - 1];
  if (!year || !month) {
    throw new CareerPortalError(
      "VALIDATION_FAILED",
      `Invalid project date ${date}`,
    );
  }
  await page.selectOption(
    `#${prefix}YearFor`,
    `#listbox_${prefix}Year`,
    year,
  );
  await page.selectOption(
    `#${prefix}MonthFor`,
    `#listbox_${prefix}Month`,
    month,
  );
}

async function fillEducationForm(
    page: BrowserPage,
    input: z.infer<typeof educationInput>,
  ): Promise<void> {
    await page.selectOption("#highEduFor", "#listbox_highEdu", input.level);
    await page.fill("#institute", input.institute);
    await page.press("#institute", "Enter");
    await page.selectOption("#crsFor", "#listbox_crs", input.course);
    if (input.specialization !== undefined) {
      await page.selectOption(
        "#specializationFor",
        "#listbox_specialization",
        input.specialization,
      );
    }
    await page.click(`label[for="${input.courseType}"]`);
    await page.selectOption(
      "#yosFieldFor",
      "#listbox_yosField",
      String(input.startYear),
    );
    await page.selectOption(
      "#yopFieldFor",
      "#listbox_yopField",
      String(input.completionYear),
    );
    if (input.gradingSystem !== undefined) {
      await page.selectOption(
        "#gradeFieldFor",
        "#listbox_gradeField",
        input.gradingSystem,
      );
    }
}

async function fillCertificationForm(
    page: BrowserPage,
    input: z.infer<typeof certificationInput>,
  ): Promise<void> {
    await page.fill("#certName", input.name);
    await page.press("#certName", "Enter");
    await page.fill("#certiFrom", input.provider);
    await page.press("#certiFrom", "Enter");
    await page.fill("#certifications-comp-id_0", input.completionId ?? "");
    await page.fill("#certifications-url_0", input.url ?? "");
    await selectCertificationDate(page, "fromDate", input.issueDate);
    await page.setChecked("#doesNotExpire", input.doesNotExpire);
    if (!input.doesNotExpire) {
      await selectCertificationDate(page, "toDate", input.expiryDate!);
    }
}

async function selectCertificationDate(
    page: BrowserPage,
    part: "fromDate" | "toDate",
    date: string,
  ): Promise<void> {
    const [year, monthValue] = date.split("-");
    const month = monthLabels[Number(monthValue) - 1];
    if (!year || !month) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        `Invalid certification date ${date}`,
      );
    }
    const prefix = `certifications-${part}`;
    await page.selectOption(
      `#${prefix}-month-0For`,
      `#listbox_${prefix}-month-0`,
      month,
    );
    await page.selectOption(
      `#${prefix}-year-0For`,
      `#listbox_${prefix}-year-0`,
      year,
    );
}

function educationMatches(
    entry: Record<string, unknown>,
    input: z.infer<typeof educationInput>,
  ): boolean {
    return normalize(entry.school) === normalize(input.institute) &&
      normalize(entry.degree) === normalize(input.course) &&
      entry.startYear === input.startYear &&
      entry.completionYear === input.completionYear;
}

function certificationMatches(
    entry: Record<string, unknown>,
    input: z.infer<typeof certificationInput>,
  ): boolean {
    return normalize(entry.name) === normalize(input.name) &&
      normalize(entry.provider) === normalize(input.provider) &&
      sameMonth(entry.issueDate, input.issueDate) &&
      (input.doesNotExpire ||
        sameMonth(entry.expiryDate, input.expiryDate));
}

function careerProfileMatches(
  value: unknown,
  expected: z.infer<typeof careerProfileInput>,
): boolean {
  if (!isRecord(value)) return false;
  const scalarFields = ["industry", "department", "roleCategory", "role"] as const;
  for (const field of scalarFields) {
    if (
      expected[field] !== undefined &&
      normalize(value[field]) !== normalize(expected[field])
    ) {
      return false;
    }
  }
  if (
    expected.jobTypes !== undefined &&
    !sameNormalizedSet(value.desiredJobTypes, expected.jobTypes)
  ) {
    return false;
  }
  if (
    expected.employmentTypes !== undefined &&
    !sameNormalizedSet(value.desiredEmploymentTypes, expected.employmentTypes)
  ) {
    return false;
  }
  if (
    expected.preferredRoles !== undefined &&
    !sameNormalizedSet(value.preferredRoles, expected.preferredRoles)
  ) {
    return false;
  }
  return true;
}

function sameNormalizedSet(actual: unknown, expected: string[]): boolean {
  if (!Array.isArray(actual)) return false;
  const normalizeChoice = (value: unknown) =>
    normalize(value).toLowerCase().replace(/[\s-]+/g, "_");
  return JSON.stringify(actual.map(normalizeChoice).sort()) ===
    JSON.stringify(expected.map(normalizeChoice).sort());
}

function parseEmploymentDates(
  value: unknown,
): z.infer<typeof employmentDates> {
  return parseSchema(employmentDates, value);
}

function parseEmploymentInput(
  value: unknown,
): z.infer<typeof employmentInput> {
  return parseSchema(employmentInput, value);
}

function parseSchema<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new CareerPortalError(
      "VALIDATION_FAILED",
      result.error.issues.map((issue) => issue.message).join("; "),
    );
  }
  return result.data;
}

function isEmploymentRecord(
  value: unknown,
): value is {
  id: string;
  title: string;
  company: string;
  startDate: string | null;
  endDate: string | null;
  current: boolean;
  description?: string;
  employmentType?: unknown;
  skills?: unknown;
  salary?: unknown;
  currency?: unknown;
} {
  return typeof value === "object" && value !== null &&
    "id" in value && typeof value.id === "string" &&
    "title" in value && typeof value.title === "string" &&
    "company" in value && typeof value.company === "string" &&
    "startDate" in value &&
    "endDate" in value &&
    "current" in value && typeof value.current === "boolean";
}

function addedEmploymentMatches(
  entry: ReturnTypeGuard<typeof isEmploymentRecord>,
  input: z.infer<typeof employmentInput>,
): boolean {
  if (
    normalize(entry.title) !== normalize(input.title) ||
    normalize(entry.company) !== normalize(input.company) ||
    !sameMonth(entry.startDate, input.startDate) ||
    entry.current !== input.current ||
    (!input.current && !sameMonth(entry.endDate, input.endDate)) ||
    entry.employmentType !== input.employmentType
  ) {
    return false;
  }
  if (input.description !== undefined &&
    normalize(entry.description) !== normalize(input.description)) {
    return false;
  }
  if (input.skills !== undefined &&
    !verifyEmploymentAttribute("skills", entry.skills, input.skills)) {
    return false;
  }
  if (input.salary !== undefined &&
    !verifyEmploymentAttribute("salary", {
      amount: entry.salary,
      currency: entry.currency,
    }, {
      amount: input.salary,
      currency: input.currency,
    })) {
    return false;
  }
  return true;
}

type ReturnTypeGuard<T> = T extends (
  value: unknown,
) => value is infer Guarded ? Guarded : never;

function sameMonth(actual: unknown, expected: unknown): boolean {
  return typeof actual === "string" &&
    typeof expected === "string" &&
    actual.slice(0, 7) === expected;
}

function verifyEmploymentAttribute(
  attribute: string,
  actual: unknown,
  expected: unknown,
): boolean {
  if (attribute === "dates") {
    const dates = parseEmploymentDates(expected);
    return typeof actual === "object" && actual !== null &&
      "startDate" in actual && sameMonth(actual.startDate, dates.startDate) &&
      "endDate" in actual &&
      (dates.current
        ? actual.endDate === null
        : sameMonth(actual.endDate, dates.endDate)) &&
      "current" in actual && actual.current === dates.current;
  }
  if (attribute === "skills") {
    const expectedSkills = stringListField.parse(expected);
    return Array.isArray(actual) &&
      actual.length === expectedSkills.length &&
      actual.every((skill, index) =>
        normalize(skill) === normalize(expectedSkills[index])
      );
  }
  if (attribute === "employmentType") {
    return actual === parseSchema(employmentType, expected);
  }
  if (attribute === "salary") {
    const expectedSalary = parseSchema(salary, expected);
    return typeof actual === "object" && actual !== null &&
      "amount" in actual &&
      normalize(String(actual.amount)) === normalize(expectedSalary.amount) &&
      "currency" in actual &&
      actual.currency === expectedSalary.currency;
  }
  return normalize(actual) === normalize(expected);
}

function normalizeEmploymentType(value: string | undefined): string | null {
  const normalized = normalize(value).toLowerCase().replace(/[-\s]+/g, "_");
  if (normalized === "full_time" || normalized === "internship") {
    return normalized;
  }
  return value ?? null;
}

function normalizeCurrency(
  value: string | { value?: string } | null | undefined,
): string | null {
  const raw = typeof value === "string" ? value : value?.value;
  const normalized = raw?.trim().toUpperCase();
  if (normalized === "₹" || normalized === "INR") return "INR";
  if (normalized === "$" || normalized === "USD") return "USD";
  return raw ?? null;
}

function recordValue(
  value: string | { value?: string } | null | undefined,
): string | null {
  if (typeof value === "string") return value.trim() || null;
  return value?.value?.trim() || null;
}

function validateEmploymentChange(
  attribute: string | undefined,
  change: FieldChange,
): void {
  if (!attribute) {
    if (change.operation !== "remove") {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "Deleting an employment entry requires removing employment.<id>",
      );
    }
    return;
  }
  if (change.operation !== "set") {
    throw new CareerPortalError(
      "VALIDATION_FAILED",
      `employment.${attribute} requires a set operation`,
    );
  }
  if (attribute === "title" || attribute === "company") {
    parseSchema(shortTextField, change.value);
  } else if (attribute === "description") {
    parseSchema(textField, change.value);
  } else if (attribute === "dates") {
    parseEmploymentDates(change.value);
  } else if (attribute === "employmentType") {
    parseSchema(employmentType, change.value);
  } else if (attribute === "skills") {
    parseSchema(stringListField, change.value);
  } else if (attribute === "noticePeriod") {
    parseSchema(noticePeriod, change.value);
  } else if (attribute === "salary") {
    parseSchema(salary, change.value);
  } else {
    throw new CareerPortalError(
      "VALIDATION_FAILED",
      `Unsupported employment attribute ${attribute}`,
    );
  }
}

function onlyChange(request: MutationRequest): FieldChange {
  if (request.changes.length !== 1 || !request.changes[0]) {
    throw new CareerPortalError(
      "VALIDATION_FAILED",
      `${request.kind} requires exactly one field change`,
    );
  }
  return request.changes[0];
}

function mutationJobId(
  field: string,
  prefix: "job" | "application",
  suffix: "saved" | "submission",
): string {
  const match = new RegExp(
    `^${prefix}\\.([A-Za-z0-9_-]{1,80})\\.${suffix}$`,
  ).exec(field);
  if (!match?.[1]) {
    throw new CareerPortalError(
      "VALIDATION_FAILED",
      `Invalid ${prefix} mutation field ${field}`,
    );
  }
  return match[1];
}

async function readJobState(
  page: BrowserPage,
  jobId: string,
  sourceUrl: string,
): Promise<{ saved: boolean; hideApplyButton: boolean }> {
  assertProviderUrl("naukri", sourceUrl);
  const parsedUrl = new URL(sourceUrl);
  if (!parsedUrl.pathname.includes(jobId)) {
    throw new CareerPortalError(
      "VALIDATION_FAILED",
      "Naukri job sourceUrl does not match the mutation job ID",
    );
  }
  const payload = await page.gotoAndCaptureJson(
    sourceUrl,
    `/jobapi/v4/job/${jobId}`,
  );
  if (!isRecord(payload) || !isRecord(payload.jobDetails)) {
    throw new CareerPortalError(
      "PROVIDER_CHANGED",
      "Naukri job detail response shape was not recognized",
    );
  }
  const details = payload.jobDetails;
  if (scalarString(details.jobId) !== jobId) {
    throw new CareerPortalError(
      "PROVIDER_CHANGED",
      "Naukri job detail response ID did not match the requested job",
    );
  }
  return {
    saved: details.savedJobFlag === true || details.savedJobFlag === 1,
    hideApplyButton: details.hideApplyButton === true,
  };
}

function decodeNaukriPageToken(token: string | undefined): number {
  if (!token) return 1;
  const decoded = Buffer.from(token, "base64url").toString("utf8");
  const match = /^naukri:(\d{1,4})$/.exec(decoded);
  const page = Number(match?.[1]);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100) {
    throw new CareerPortalError(
      "VALIDATION_FAILED",
      "Invalid Naukri page token",
    );
  }
  return page;
}

function parseApplicationHistory(payload: unknown): Array<{
  jobId: string;
  title: string;
  company: string;
  locations: string[];
  status: string | null;
  appliedAt: string | null;
  open: boolean;
  applyType: string | null;
}> {
  if (!isRecord(payload) || !Array.isArray(payload.applyDetails)) {
    throw new CareerPortalError(
      "PROVIDER_CHANGED",
      "Naukri application history response shape was not recognized",
    );
  }
  return payload.applyDetails.map((entry) => {
    if (!isRecord(entry)) {
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        "Naukri application history contained an invalid entry",
      );
    }
    const jobId = scalarString(entry.jobId);
    const title = scalarString(entry.jobTitle);
    const company = scalarString(entry.company);
    if (!jobId || !title || !company) {
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        "Naukri application history entry omitted required fields",
      );
    }
    return {
      jobId,
      title,
      company,
      locations: Array.isArray(entry.location)
        ? entry.location.flatMap((value) => {
          const location = scalarString(value);
          return location ? [location] : [];
        })
        : scalarString(entry.location)?.split(",").map((value) => value.trim())
          .filter(Boolean) ?? [],
      status: scalarString(entry.status) ?? null,
      appliedAt: scalarString(entry.jobActivityDate) ?? null,
      open: entry.isOpen === true || entry.isOpen === 1,
      applyType: scalarString(entry.applyType) ?? null,
    };
  });
}

function parseRecruiterMessages(payload: unknown): Array<{
  id: string;
  conversationId: string | null;
  receivedAt: string | null;
  read: boolean;
  messageType: string | null;
  subject: string;
  title: string | null;
  sender: { name: string | null; email: string | null; type: string | null };
  recruiter: {
    name: string | null;
    designation: string | null;
    location: string | null;
  };
  company: string | null;
  job: {
    id: string | null;
    title: string | null;
    location: string | null;
    skills: string[];
    workMode: string | null;
  };
  applied: boolean;
  interested: boolean;
}> {
  if (
    !isRecord(payload) ||
    !isRecord(payload.successResponse) ||
    !Array.isArray(payload.successResponse.inbox)
  ) {
    throw new CareerPortalError(
      "PROVIDER_CHANGED",
      "Naukri recruiter-message response shape was not recognized",
    );
  }
  return payload.successResponse.inbox.slice(0, 25).map((entry) => {
    if (!isRecord(entry)) {
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        "Naukri recruiter-message response contained an invalid entry",
      );
    }
    const id = scalarString(entry.uniqueId) ??
      scalarString(entry.messageId) ??
      scalarString(entry.mailId);
    const subject = scalarString(entry.subject) ??
      scalarString(entry.titleText);
    if (!id || !subject) {
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        "Naukri recruiter-message entry omitted its ID or subject",
      );
    }
    const sender: Record<string, unknown> =
      Array.isArray(entry.sender) && isRecord(entry.sender[0])
      ? entry.sender[0]
      : {};
    const recruiter: Record<string, unknown> = isRecord(entry.vCardInfo)
      ? entry.vCardInfo
      : {};
    const company: Record<string, unknown> = isRecord(entry.companyDetails)
      ? entry.companyDetails
      : {};
    const job: Record<string, unknown> = isRecord(entry.jobDetails)
      ? entry.jobDetails
      : {};
    const apply: Record<string, unknown> = isRecord(job.applyUrlData)
      ? job.applyUrlData
      : {};
    return {
      id,
      conversationId: scalarString(entry.conversationId) ?? null,
      receivedAt: scalarString(entry.dateTime) ?? null,
      read: entry.isRead === true || entry.isRead === 1,
      messageType: scalarString(entry.messageType) ?? null,
      subject,
      title: scalarString(entry.titleText) ?? null,
      sender: {
        name: scalarString(sender.name) ?? null,
        email: scalarString(sender.email) ?? null,
        type: scalarString(sender.type) ?? null,
      },
      recruiter: {
        name: scalarString(recruiter.vname) ?? null,
        designation: scalarRecordValue(recruiter.designation) ?? null,
        location: scalarRecordValue(recruiter.location) ?? null,
      },
      company: scalarString(company.companyName) ?? null,
      job: {
        id: scalarString(apply.jobId) ?? null,
        title: scalarString(job.jobTitle) ?? null,
        location: scalarString(job.jobLocation) ?? null,
        skills: scalarString(job.jobKeySkills)?.split(",").map((skill) =>
          skill.trim()
        ).filter(Boolean) ?? [],
        workMode: scalarString(job.workMode) ?? null,
      },
      applied: entry.isApplied === true || entry.isApplied === 1,
      interested: entry.interested === true || entry.interested === 1,
    };
  });
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function scalarRecordValue(value: unknown): string | undefined {
  if (isRecord(value)) return scalarString(value.value);
  return scalarString(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
