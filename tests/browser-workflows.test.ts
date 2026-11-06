import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LinkedInBrowserWorkflow } from "../src/browser/linkedin-workflow.js";
import { NaukriBrowserWorkflow } from "../src/browser/naukri-workflow.js";
import type { BrowserPage } from "../src/browser/types.js";

class FixturePage implements BrowserPage {
  currentUrl: string;
  readonly actions: string[] = [];
  readonly textSelectors: string[] = [];
  failClicks = false;
  failWait = false;
  persistFilledValue = true;
  failAfterClicks?: number;
  clickCount = 0;
  addingEmployment = false;
  employmentCurrent = true;
  selectedCurrency = "INR";
  readonly filled = new Map<string, string>();
  readonly selected = new Map<string, string>();
  readonly checked = new Map<string, boolean>();
  readonly employmentSkills: string[] = [];
  jobId = "job-1";
  jobSaved = false;
  hideApplyButton = false;
  accountApplications: Array<Record<string, unknown>> = [];
  jobPayload = {
    jobDetails: [{
      jobId: "job-1",
      title: "Platform Engineer",
      companyName: "Example",
      jdURL: "/job-listings-platform-engineer-job-1",
      placeholders: [{ type: "location", label: "Bengaluru" }],
    }],
  };
  employment = {
    employmentId: "employment-1",
    designation: "Engineer",
    organization: "Example",
    jobDescription: "",
    startDate: "2020-01",
    endDate: null as string | null,
    employmentType: "Full-time",
  };
  private submittedValue?: string;
  private uploadedName?: string;
  skillDeleted = false;
  employmentDeleted = false;
  educationDeleted = false;
  addedSkill?: string;
  sentMessage?: string;
  activeRecipient = "Recruiter";
  constructor(provider: "linkedin" | "naukri") {
    this.currentUrl = provider === "linkedin"
      ? "https://www.linkedin.com/in/me/"
      : "https://www.naukri.com/mnjuser/profile";
  }
  async goto(url: string) { this.currentUrl = url; }
  url() { return this.currentUrl; }
  async title() { return "Platform Engineer | Example | LinkedIn"; }
  async text(selector: string) {
    this.textSelectors.push(selector);
    if (selector.includes("resume-name")) return this.uploadedName;
    if (selector.includes("aria-label^='Description'")) {
      return this.filled.get(selector) ?? "Built services";
    }
    if (selector.includes("Open to Work")) {
      return "Job titlesSoftware Engineer · Java DeveloperLocation typesOn-site · HybridLocationsBelgaumEmployment typesFull-timeRecruiters only";
    }
    if (selector.includes("Contact info")) return "Contact infoWebsite example.com";
    return this.submittedValue;
  }
  async texts(selector: string) {
    if (this.currentUrl.includes("/jobs/view/")) {
      return [
        "Example",
        "Platform Engineer",
        "Bengaluru · 1 day ago",
        "Promoted",
        "Description Build reliable platforms.",
      ];
    }
    if (selector.includes("Topcard")) return ["Engineer", "Bengaluru | Hybrid"];
    if (selector.includes("About")) return ["Profile summary"];
    if (this.currentUrl.includes("/details/experience/")) {
      return [
        "Experience",
        "Engineer",
        "Example",
        "2020 - Present",
        "Bengaluru",
        "Built services",
      ];
    }
    if (this.currentUrl.includes("/details/education/")) {
      return ["Education", "Example University", "Engineering"];
    }
    if (this.currentUrl.includes("/messaging/")) {
      if (selector === "main h3") return ["Recruiter"];
      if (selector === "main button") {
        const option =
          `Open the options list in your conversation with ${this.activeRecipient}`;
        return [option, option, "Send"];
      }
      return ["Recruiter", "Platform Engineer opportunity"];
    }
    return [];
  }
  async attributes(selector: string, name?: string) {
    if (selector.includes("/jobs/view/")) {
      if (selector.includes("Apply")) {
        return ["https://www.linkedin.com/jobs/view/job-1/apply/"];
      }
      return name === "aria-label"
        ? ["Platform Engineer", "Platform Engineer"]
        : [
          "https://www.linkedin.com/jobs/view/4455793886/",
          "https://www.linkedin.com/jobs/view/4455793886/",
        ];
    }
    if (selector.includes("Apply")) {
      return ["https://www.linkedin.com/jobs/view/job-1/apply/"];
    }
    if (selector.includes("skill")) {
      if (this.skillDeleted) return [];
      const names = [
        "TypeScript",
        ...(this.addedSkill ? [this.addedSkill] : []),
      ];
      return name === "href"
        ? names.map((_, index) =>
          `https://www.linkedin.com/in/example/details/skills/edit/forms/${
            index + 5
          }/`
        )
        : names.map((value) => `Edit ${value} skill`);
    }
    if (selector.includes("Options for the message from")) {
      return this.sentMessage
        ? [`Options for the message from Me: ${this.sentMessage}`]
        : ["Options for the message from Recruiter: Hello"];
    }
    if (selector.includes("education")) {
      if (this.educationDeleted) return [];
      return name === "href"
        ? [
          "https://www.linkedin.com/in/me/details/education/edit/forms/603262473/",
        ]
        : ["Edit education Example University"];
    }
    if (selector.includes(" at ")) {
      if (this.employmentDeleted) return [];
      return name === "href"
        ? [
          "https://www.linkedin.com/in/me/details/experience/edit/forms/2902455479/",
        ]
        : ["Edit Engineer at Example"];
    }
    return [];
  }
  async values(selector: string) {
    if (selector === "select") {
      const monthValue = (value?: string) => value === "January" ? "1" : value;
      return [
        this.selected.get("select >> nth=0") ?? "",
        this.selected.get("select >> nth=1") ?? "",
        monthValue(this.selected.get("select >> nth=2")) ?? "",
        this.selected.get("select >> nth=3") ?? "",
      ];
    }
    if (selector.includes("Role title")) {
      return [this.filled.get(selector) ?? "Engineer"];
    }
    if (selector.includes("Organization name")) {
      return [this.filled.get(selector) ?? "Example"];
    }
    if (selector.includes("Boston University")) {
      return [this.filled.get(selector) ?? "Example University"];
    }
    if (selector.includes("Bachelor of Science")) {
      return [this.filled.get(selector) ?? "Engineering"];
    }
    if (selector.includes("Business")) {
      return [this.filled.get(selector) ?? "Software Engineering"];
    }
    if (selector.includes("Description")) {
      return [this.filled.get(selector) ?? "Built services"];
    }
    return [];
  }
  async click(selector: string) {
    this.clickCount += 1;
    if (
      this.failClicks ||
      (this.failAfterClicks !== undefined &&
        this.clickCount > this.failAfterClicks)
    ) {
      throw new Error("selector not found");
    }
    this.actions.push(`click:${selector}`);
    if (selector === "[aria-label='Add a skill']") {
      this.currentUrl =
        "https://www.linkedin.com/in/example/skills/edit/forms/new/";
    }
    if (selector.includes("Delete from profile?")) this.skillDeleted = true;
    if (selector.includes("Delete role") && selector.includes("button")) {
      this.employmentDeleted = true;
    }
    if (
      selector.includes("Delete education") &&
      selector.includes("dialog")
    ) {
      this.educationDeleted = true;
    }
    if (
      selector.startsWith("button:has-text('Save')") &&
      this.currentUrl.includes("/skills/edit/forms/new/")
    ) {
      this.addedSkill = this.filled.get(
        "input[placeholder='Skill (ex: Project Management)']",
      );
    }
    if (selector === "button:text-is('Send')") {
      this.sentMessage = this.filled.get(
        "[contenteditable='true'][aria-label='Write a message…']",
      );
    }
    if (selector === "#add-employment") this.addingEmployment = true;
    if (selector === "button[class*='save-job-button']") {
      this.jobSaved = !this.jobSaved;
    }
    if (selector === "#apply-button") {
      this.accountApplications.push({
        jobId: this.jobId,
        jobTitle: "Platform Engineer",
        company: "Example",
        location: "Bengaluru",
        status: "Applied",
        isOpen: true,
      });
    }
    if (selector === 'label[for="yes"]') this.employmentCurrent = true;
    if (selector === 'label[for="no"]') this.employmentCurrent = false;
    if (selector === 'label[for="expType_Full-time_F"]') {
      this.employment.employmentType = "Full-time";
    }
    if (selector === 'label[for="expType_Internship_I"]') {
      this.employment.employmentType = "Internship";
    }
  }
  async clickAt(selector: string, index: number) {
    this.actions.push(`clickAt:${selector}:${index}`);
    if (selector === "main h3") {
      this.currentUrl =
        "https://www.linkedin.com/messaging/thread/thread-1/";
    }
    if (selector === ".currency-option") {
      this.selectedCurrency = index === 0 ? "INR" : "USD";
    }
  }
  async selectOption(
    inputSelector: string,
    listboxSelector: string,
    label: string,
  ) {
    this.actions.push(`select:${inputSelector}:${listboxSelector}:${label}`);
    this.selected.set(inputSelector, label);
  }
  async selectNative(selector: string, label: string) {
    this.actions.push(`selectNative:${selector}:${label}`);
    this.selected.set(selector, label);
  }
  async selectRoleOption(label: string) {
    this.actions.push(`selectRole:${label}`);
  }
  async fill(selector: string, value: string) {
    this.actions.push(`fill:${selector}:${value}`);
    this.filled.set(selector, value);
    if (this.persistFilledValue) this.submittedValue = value;
  }
  async typeText(selector: string, value: string) {
    this.actions.push(`type:${selector}:${value}`);
    this.filled.set(selector, value);
  }
  async setChecked(selector: string, checked: boolean) {
    this.actions.push(`check:${selector}:${checked}`);
    this.checked.set(selector, checked);
  }
  async press(selector: string, key: string) {
    this.actions.push(`press:${selector}:${key}`);
    if (
      key === "Enter" &&
      selector === ".employmentLayer.model_open #keySkillSugg"
    ) {
      const skill = this.filled.get(selector);
      if (skill) this.employmentSkills.push(skill);
    }
  }
  async setInputFiles(selector: string, path: string) {
    this.actions.push(`upload:${selector}:${path}`);
    this.uploadedName = path.replace(/^.*[\\/]/, "");
  }
  async waitFor(selector: string) {
    if (this.failWait && this.clickCount >= 2) {
      throw new Error("verification selector missing");
    }
    this.actions.push(`wait:${selector}`);
  }
  async waitForFirst(selector: string) {
    if (this.failWait && this.clickCount >= 2) {
      throw new Error("verification selector missing");
    }
    this.actions.push(`waitFirst:${selector}`);
  }
  async waitForCount(selector: string, count: number) {
    this.actions.push(`waitCount:${selector}:${count}`);
  }
  async waitForHidden(selector: string) {
    if (this.failWait && this.clickCount >= 2) {
      throw new Error("verification selector missing");
    }
    this.actions.push(`waitHidden:${selector}`);
  }
  async isVisible(selector: string) {
    if (
      selector === ".resumeHeadline .edit.icon" ||
      selector === ".profileSummary .edit.icon" ||
      selector === ".keySkills .edit.icon"
    ) {
      return true;
    }
    if (
      selector ===
        "[contenteditable='true'][aria-label='Write a message…']" &&
      this.currentUrl.includes("/messaging/thread/")
    ) {
      return true;
    }
    if (selector.includes("checkbox") && selector.includes(":checked")) {
      return this.checked.get("input[type='checkbox'] >> nth=0") ?? true;
    }
    return false;
  }
  async count() { return 1; }
  async getJson() {
    const employments = this.addingEmployment
      ? [this.addedEmployment(), this.employment]
      : [{
          ...this.employment,
          salary: this.filled.get("#totalAbsCtc_id") ?? null,
          currency: this.filled.has("#totalAbsCtc_id")
            ? this.selectedCurrency
            : null,
        }];
    return {
      profile: [{
        resumeHeadline: this.submittedValue,
        summary: this.submittedValue,
        keySkills: this.employmentSkills.join(","),
        noticePeriod: { id: 2, value: "1 Month" },
        cvInfo: { fileName: "resume.pdf", isAvailable: true },
        desiredRole: [{ value: "Engineer" }],
        locationPrefId: [{ value: "Bengaluru" }],
        entityIndustry: {
          value: this.selected.get("#industryFor") ?? "Software",
        },
        entityDepartment: {
          value: this.selected.get("#fareaDroopeFor") ?? "Engineering",
        },
        entityRoleCategory: {
          value: this.selected.get("#roleCategoryDroopeFor") ?? "Engineering",
        },
        entityRole: {
          value: this.selected.get("#roleDroopeFor") ?? "Engineer",
        },
        desiredJobType: this.checked.has("#permanent")
          ? [
              ...(this.checked.get("#permanent") ? ["permanent"] : []),
              ...(this.checked.get("#contractual") ? ["contractual"] : []),
            ]
          : ["permanent"],
        desiredEmploymentType: this.checked.has("#fullTime")
          ? [
              ...(this.checked.get("#fullTime") ? ["full_time"] : []),
              ...(this.checked.get("#partTime") ? ["part_time"] : []),
            ]
          : ["full_time"],
      }],
      employments,
      projects: [{
        projectId: "project-1",
        eduExpId: "employment-1",
        projectTitle: "Platform Migration",
        projectDetails: "Migrated platform services",
        startDate: "2023-01",
        endDate: null,
      }],
      itskills: [],
      educations: [{
        educationId: "education-1",
        institute: "Example University",
        course: { value: "Engineering" },
      }],
    };
  }
  async gotoAndCaptureJson(url: string, responsePath: string) {
    this.currentUrl = url;
    if (responsePath === "/jobapi/v3/search" ||
      responsePath === "/jobapi/v2/search/recom-jobs") {
      return this.jobPayload;
    }
    if (responsePath === "/jobapi/v3/user/savedJobs/detail") {
      return {
        list: this.jobSaved ? this.jobPayload.jobDetails : [],
      };
    }
    if (responsePath ===
      "/cloudgateway-apply/whtma-services/v0/applyapi/v5/history") {
      return { applyDetails: this.accountApplications };
    }
    if (responsePath.includes("ni-inboxusermails-svc-tmpl")) {
      return {
        successResponse: {
          inbox: [{
            uniqueId: "message-1",
            conversationId: "conversation-1",
            dateTime: "2026-10-07T10:00:00Z",
            isRead: 0,
            messageType: "NVITE",
            subject: "Platform Engineer opportunity",
            titleText: "New role",
            sender: [{
              name: "Recruiter",
              email: "recruiter@example.com",
              type: "RECRUITER",
            }],
            vCardInfo: {
              vname: "Recruiter",
              designation: "Talent Partner",
              location: "Bengaluru",
            },
            companyDetails: { companyName: "Example" },
            jobDetails: {
              jobTitle: "Platform Engineer",
              jobLocation: "Bengaluru",
              jobKeySkills: "TypeScript,Node.js",
              workMode: "Hybrid",
              applyUrlData: { jobId: "job-1" },
            },
            isApplied: false,
            interested: false,
          }],
        },
      };
    }
    if (responsePath === `/jobapi/v4/job/${this.jobId}`) {
      return {
        jobDetails: {
          jobId: this.jobId,
          savedJobFlag: this.jobSaved ? 1 : 0,
          hideApplyButton: this.hideApplyButton,
        },
      };
    }
    return this.getJson();
  }

  private addedEmployment() {
    const startYear = this.selected.get("#startedYearFor") ?? "2024";
    const startMonth = monthNumber(
      this.selected.get("#startedMonthFor") ?? "Jan",
    );
    const endYear = this.selected.get("#workedTillYearFor");
    const endMonth = this.selected.get("#workedTillMonthFor");
    return {
      employmentId: "employment-2",
      designation: this.filled.get("#designationSugg") ?? "",
      organization: this.filled.get("#companySugg") ?? "",
      jobDescription: this.filled.get("#jobDescription") ?? "",
      startDate: `${startYear}-${startMonth}`,
      endDate: this.employmentCurrent || !endYear || !endMonth
        ? null
        : `${endYear}-${monthNumber(endMonth)}`,
      employmentType: this.employment.employmentType,
      keySkills: this.employmentSkills.join(","),
      salary: this.filled.get("#totalAbsCtc_id") ?? null,
      currency: this.filled.has("#totalAbsCtc_id")
        ? this.selectedCurrency
        : null,
    };
  }
}

function monthNumber(label: string): string {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return String(months.indexOf(label) + 1).padStart(2, "0");
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe.each([
  ["LinkedIn", new LinkedInBrowserWorkflow()],
  ["Naukri", new NaukriBrowserWorkflow()],
])("%s browser workflow", (_name, workflow) => {
  it("recognizes the Naukri authenticated landing route", async () => {
    if (workflow.provider !== "naukri") return;
    const page = new FixturePage("naukri");
    page.currentUrl = "https://www.naukri.com/mnjuser/homepage";
    await expect(workflow.isAuthenticated(page)).resolves.toBe(true);
    page.currentUrl = "https://www.naukri.com/nlogin/login";
    await expect(workflow.isAuthenticated(page)).resolves.toBe(false);
  });

  it("recognizes LinkedIn's current authenticated feed route", async () => {
    if (workflow.provider !== "linkedin") return;
    const page = new FixturePage("linkedin");
    page.currentUrl = "https://www.linkedin.com/feed/foryou/";
    await expect(workflow.isAuthenticated(page)).resolves.toBe(true);
    page.currentUrl = "https://www.linkedin.com/login";
    await expect(workflow.isAuthenticated(page)).resolves.toBe(false);
  });

  it("reads authenticated LinkedIn job details", async () => {
    if (!(workflow instanceof LinkedInBrowserWorkflow)) return;
    const page = new FixturePage("linkedin");
    await expect(workflow.getJobDetails(page, "4455793886")).resolves.toEqual(
      expect.objectContaining({
        provider: "linkedin",
        providerJobId: "4455793886",
        title: "Platform Engineer",
        company: "Example",
        description: "Build reliable platforms.",
      }),
    );
  });

  it("reads LinkedIn saved-job state without mutating it", async () => {
    if (!(workflow instanceof LinkedInBrowserWorkflow)) return;
    const page = new FixturePage("linkedin");
    await expect(workflow.readMutationState(page, {
      provider: "linkedin",
      kind: "save_job",
      changes: [{
        field: "job.4455793886.saved",
        operation: "set",
        value: {
          sourceUrl: "https://www.linkedin.com/jobs/view/4455793886/",
          saved: true,
        },
      }],
    })).resolves.toEqual({
      "job.4455793886.saved": {
        sourceUrl: "https://www.linkedin.com/jobs/view/4455793886/",
        saved: false,
        jobId: "4455793886",
      },
    });
    expect(page.actions).not.toContain(
      "click:main button[aria-label='Save the job']",
    );
  });

  it("reads current LinkedIn preferences, jobs, messages, and contact data", async () => {
    if (!(workflow instanceof LinkedInBrowserWorkflow)) return;
    const page = new FixturePage("linkedin");
    await expect(workflow.readProfile(page, [
      "jobPreferences.titles",
      "jobPreferences.locations",
    ])).resolves.toEqual({
      "jobPreferences.titles": ["Software Engineer", "Java Developer"],
      "jobPreferences.locations": ["Belgaum"],
    });
    await expect(workflow.readAccountData(page, "recommended_jobs"))
      .resolves.toEqual([{
        id: "4455793886",
        title: "Platform Engineer",
        sourceUrl: "https://www.linkedin.com/jobs/view/4455793886/",
      }]);
    await expect(workflow.readAccountData(page, "applications"))
      .resolves.toEqual([{
        id: "4455793886",
        title: "Platform Engineer",
        sourceUrl: "https://www.linkedin.com/jobs/view/4455793886/",
      }]);
    await expect(workflow.readAccountData(page, "recruiter_messages"))
      .resolves.toEqual([
        {
          id: "thread-1",
          recipient: "Recruiter",
          threadUrl:
            "https://www.linkedin.com/messaging/thread/thread-1/",
          writable: true,
        },
      ]);
    await expect(
      workflow.readAccountData(page, "visibility_contact_settings"),
    ).resolves.toEqual({ contactInfo: "Contact infoWebsite example.com" });
  });

  it("reads LinkedIn entity histories with stable IDs", async () => {
    if (!(workflow instanceof LinkedInBrowserWorkflow)) return;
    const page = new FixturePage("linkedin");
    await expect(workflow.readProfile(page, [
      "employment.history",
      "education.history",
      "skill.history",
    ])).resolves.toEqual({
      "employment.history": [expect.objectContaining({
        id: "2902455479",
        title: "Engineer",
        company: "Example",
        location: null,
        description: "Built services",
      })],
      "education.history": [expect.objectContaining({
        id: "603262473",
        school: "Example University",
        degree: "Engineering",
        fieldOfStudy: "Software Engineering",
        description: "Built services",
      })],
      "skill.history": [{ id: "5", name: "TypeScript" }],
    });
  });

  it("updates LinkedIn employment through its stable entity ID", async () => {
      if (!(workflow instanceof LinkedInBrowserWorkflow)) return;
      const page = new FixturePage("linkedin");
      await expect(workflow.executeMutation!(page, {
        provider: "linkedin",
        kind: "experience",
        changes: [{
          field: "employment.2902455479",
          operation: "set",
          value: { title: "Principal Engineer" },
        }],
      }, 1024, undefined)).resolves.toBeUndefined();
      expect(page.actions).toContain(
        "fill:input[placeholder='Role title']:Principal Engineer",
      );
  });

  it("adds and deletes LinkedIn employment entries", async () => {
    if (!(workflow instanceof LinkedInBrowserWorkflow)) return;
    const addPage = new FixturePage("linkedin");
    await expect(workflow.executeMutation!(addPage, {
      provider: "linkedin",
      kind: "experience",
      changes: [{
        field: "employment.add",
        operation: "set",
        value: {
          title: "Principal Engineer",
          company: "Example",
          startMonth: 1,
          startYear: "2024",
          current: true,
        },
      }],
    }, 1024, undefined)).resolves.toBeUndefined();
    expect(addPage.actions).toContain("click:text=Add role");

    const deletePage = new FixturePage("linkedin");
    await expect(workflow.executeMutation!(deletePage, {
      provider: "linkedin",
      kind: "experience",
      changes: [{
        field: "employment.2902455479",
        operation: "remove",
      }],
    }, 1024, undefined)).resolves.toBeUndefined();
  });

  it("updates LinkedIn education through its stable entity ID", async () => {
      if (!(workflow instanceof LinkedInBrowserWorkflow)) return;
      const page = new FixturePage("linkedin");
      await expect(workflow.executeMutation!(page, {
        provider: "linkedin",
        kind: "education",
        changes: [{
          field: "education.603262473",
          operation: "set",
          value: { degree: "Master of Engineering" },
        }],
      }, 1024, undefined)).resolves.toBeUndefined();
      expect(page.actions).toContain(
        "fill:input[placeholder='Ex: Bachelor of Science']:Master of Engineering",
      );
  });

  it("adds and deletes LinkedIn education entries", async () => {
    if (!(workflow instanceof LinkedInBrowserWorkflow)) return;
    const addPage = new FixturePage("linkedin");
    await expect(workflow.executeMutation!(addPage, {
      provider: "linkedin",
      kind: "education",
      changes: [{
        field: "education.add",
        operation: "set",
        value: { school: "Example University" },
      }],
    }, 1024, undefined)).resolves.toBeUndefined();

    const deletePage = new FixturePage("linkedin");
    await expect(workflow.executeMutation!(deletePage, {
      provider: "linkedin",
      kind: "education",
      changes: [{
        field: "education.603262473",
        operation: "remove",
      }],
    }, 1024, undefined)).resolves.toBeUndefined();
  });

  it("adds and deletes LinkedIn skills by stable identity", async () => {
      if (!(workflow instanceof LinkedInBrowserWorkflow)) return;
      const addPage = new FixturePage("linkedin");
      await expect(workflow.executeMutation!(addPage, {
        provider: "linkedin",
        kind: "skills",
        changes: [{
          field: "skill.add",
          operation: "set",
          value: "Distributed Systems",
        }],
      }, 1024, undefined)).resolves.toBeUndefined();

      const deletePage = new FixturePage("linkedin");
      await expect(workflow.executeMutation!(deletePage, {
        provider: "linkedin",
        kind: "skills",
        changes: [{
          field: "skill.5",
          operation: "remove",
        }],
      }, 1024, undefined)).resolves.toBeUndefined();
      expect(deletePage.actions).toContain(
        "click:dialog:has-text('Delete from profile?') button:has-text('Delete')",
      );
  });

  it("previews and sends an exact LinkedIn thread message", async () => {
    if (!(workflow instanceof LinkedInBrowserWorkflow)) return;
    const request = {
      provider: "linkedin" as const,
      kind: "message" as const,
      changes: [{
        field: "message.thread-1.send",
        operation: "set" as const,
        value: {
          threadUrl:
            "https://www.linkedin.com/messaging/thread/thread-1/",
          recipient: "Recruiter",
          text: "I am interested in the platform role.",
        },
      }],
    };
    const page = new FixturePage("linkedin");
    await expect(workflow.readMutationState(page, request)).resolves.toEqual({
      "message.thread-1.send": {
        threadUrl: "https://www.linkedin.com/messaging/thread/thread-1/",
        recipient: "Recruiter",
        messageCount: 1,
        composerAvailable: true,
      },
    });
    await expect(
      workflow.executeMutation!(page, request, 1024, undefined),
    ).resolves.toBeUndefined();
    expect(page.sentMessage).toBe("I am interested in the platform role.");
  });

  it("rejects a LinkedIn message when the recipient does not match the thread", async () => {
    if (!(workflow instanceof LinkedInBrowserWorkflow)) return;
    const page = new FixturePage("linkedin");
    await expect(workflow.readMutationState(page, {
      provider: "linkedin",
      kind: "message",
      changes: [{
        field: "message.thread-1.send",
        operation: "set",
        value: {
          threadUrl:
            "https://www.linkedin.com/messaging/thread/thread-1/",
          recipient: "Different Recruiter",
          text: "Hello",
        },
      }],
    })).rejects.toMatchObject({ code: "STATE_DRIFT" });
  });

  it("reads every supported profile field", async () => {
    const profile = await workflow.readProfile(new FixturePage(workflow.provider));
    expect(profile).toHaveProperty("headline");
    expect(profile).toHaveProperty("summary");
    expect(profile).toHaveProperty("skills");
    expect(profile).toHaveProperty("employment.title");
    if (workflow.provider === "naukri") {
      expect(profile["employment.history"]).toEqual([
        expect.objectContaining({
          id: "employment-1",
          title: "Engineer",
          company: "Example",
          current: true,
        }),
      ]);
    }
    expect(profile).toHaveProperty("education.school");
    expect(profile).toHaveProperty("jobPreferences.titles");
    if (workflow.provider === "naukri") {
      expect(profile).toHaveProperty("resume.current");
    } else {
      expect(profile).not.toHaveProperty("resume.current");
    }
  });

  it("applies a validated headline using provider selectors", async () => {
    const page = new FixturePage(workflow.provider);
    await workflow.applyChanges(
      page,
      [{
        field: "headline",
        operation: "set",
        value: "Principal Engineer",
      }],
      5_242_880,
      undefined,
    );
    expect(
      page.actions.some((action) => action.includes("Principal Engineer")),
    ).toBe(true);
  });

  it("reports selector failures as provider drift", async () => {
    const page = new FixturePage(workflow.provider);
    page.failClicks = true;
    await expect(
      workflow.applyChanges(
        page,
        [{ field: "summary", operation: "set", value: "About me" }],
        5_242_880,
        undefined,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_CHANGED" });
  });

  it("reports unknown outcome after save when verification fails", async () => {
    const page = new FixturePage(workflow.provider);
    page.failWait = true;
    await expect(
      workflow.applyChanges(
        page,
        [{ field: "headline", operation: "set", value: "Engineer" }],
        5_242_880,
        undefined,
      ),
    ).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });

  it("reports unknown outcome when the provider silently rejects a value", async () => {
    const page = new FixturePage(workflow.provider);
    page.persistFilledValue = false;
    await expect(
      workflow.applyChanges(
        page,
        [{ field: "headline", operation: "set", value: "Rejected value" }],
        5_242_880,
        undefined,
      ),
    ).rejects.toMatchObject({
      code: "OUTCOME_UNKNOWN",
      message: expect.stringContaining("uncertain fields: headline"),
    });
  });

  it("fails closed when an action redirects outside the provider", async () => {
    const page = new FixturePage(workflow.provider);
    const originalClick = page.click.bind(page);
    page.click = async (selector: string) => {
      await originalClick(selector);
      page.currentUrl = "https://identity.example.test/callback";
    };
    await expect(
      workflow.applyChanges(
        page,
        [{ field: "headline", operation: "set", value: "Engineer" }],
        5_242_880,
        undefined,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_CHANGED" });
  });

  it("reads only requested fields for an unrelated profile update", async () => {
    const page = new FixturePage(workflow.provider);
    const profile = await workflow.readProfile(page, ["headline"]);
    expect(Object.keys(profile)).toEqual(["headline"]);
    expect(
      page.textSelectors.some((selector) =>
        /employment|experience|education/i.test(selector)),
    ).toBe(false);
  });

  it("scopes employment and education reads to the deterministic first entry", async () => {
    const page = new FixturePage(workflow.provider);
    await workflow.readProfile(page, [
      "employment.title",
      "education.school",
    ]);
    if (workflow.provider === "naukri") {
      const profile = await workflow.readProfile(page, [
        "employment.title",
        "education.school",
      ]);
      expect(profile).toEqual({
        "employment.title": "Engineer",
        "education.school": "Example University",
      });
      return;
    }
    const profile = await workflow.readProfile(page, [
      "employment.title",
      "education.school",
    ]);
    expect(profile).toEqual({
      "employment.title": "Engineer",
      "education.school": "Example University",
    });
  });

  it("rejects invalid resume files before browser interaction", async () => {
    const directory = await mkdtemp(join(tmpdir(), "career-resume-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "resume.exe");
    await writeFile(path, "not a resume");
    const page = new FixturePage(workflow.provider);
    const errorCode =
      workflow.provider === "naukri"
        ? "VALIDATION_FAILED"
        : "CAPABILITY_UNAVAILABLE";
    await expect(
      workflow.applyChanges(
        page,
        [{ field: "resume.path", operation: "set", value: path }],
        5_242_880,
        directory,
      ),
    ).rejects.toMatchObject({ code: errorCode });
    expect(page.actions).toHaveLength(0);
  });

  it("uploads an allowed resume within the size cap", async () => {
    if (workflow.provider === "linkedin") {
      await expect(
        workflow.applyChanges(
          new FixturePage(workflow.provider),
          [{
            field: "resume.path",
            operation: "set",
            value: "resume.pdf",
          }],
          1024,
          undefined,
        ),
      ).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), "career-resume-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "resume.pdf");
    await writeFile(path, "%PDF-1.4 fixture");
    const page = new FixturePage(workflow.provider);
    await workflow.applyChanges(
      page,
      [{ field: "resume.path", operation: "set", value: path }],
      1024,
      directory,
    );
    expect(
      page.actions.some((action) => action.startsWith("upload:")),
    ).toBe(true);
  });

  it("rejects resume files outside the configured directory", async () => {
    if (workflow.provider === "linkedin") return;
    const allowed = await mkdtemp(join(tmpdir(), "career-allowed-"));
    const outside = await mkdtemp(join(tmpdir(), "career-outside-"));
    temporaryDirectories.push(allowed, outside);
    const path = join(outside, "resume.pdf");
    await writeFile(path, "%PDF-1.4 fixture");
    const page = new FixturePage(workflow.provider);
    await expect(
      workflow.applyChanges(
        page,
        [{ field: "resume.path", operation: "set", value: path }],
        1024,
        allowed,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(page.actions).toHaveLength(0);
  });

  it("reports completed fields when a later write fails", async () => {
    const page = new FixturePage(workflow.provider);
    page.failAfterClicks = 2;
    await expect(
      workflow.applyChanges(
        page,
        [
          { field: "headline", operation: "set", value: "Engineer" },
          { field: "summary", operation: "set", value: "Summary" },
        ],
        1024,
        undefined,
      ),
    ).rejects.toMatchObject({
      code: "OUTCOME_UNKNOWN",
      message: expect.stringContaining("headline"),
    });
  });

    it("updates Naukri employment dates atomically", async () => {
      if (workflow.provider !== "naukri") return;
      const page = new FixturePage("naukri");
      await workflow.applyChanges(
        page,
        [{
          field: "employment.employment-1.dates",
          operation: "set",
          value: {
            startDate: "2020-01",
            current: true,
          },
        }],
        1024,
        undefined,
      );
      expect(page.actions).toContain('click:label[for="yes"]');
      expect(page.actions).toContain(
        "select:#startedYearFor:#listbox_startedYear:2020",
      );
      expect(page.actions).toContain(
        "select:#startedMonthFor:#listbox_startedMonth:Jan",
      );
      expect(page.actions).toContain("click:#submitEmployment");
    });

    it("updates previous Naukri employment with a required end date", async () => {
      if (workflow.provider !== "naukri") return;
      const page = new FixturePage("naukri");
      page.employment.endDate = "2023-09";
      await workflow.applyChanges(
        page,
        [{
          field: "employment.employment-1.dates",
          operation: "set",
          value: {
            startDate: "2020-01",
            endDate: "2023-09",
            current: false,
          },
        }],
        1024,
        undefined,
      );
      expect(page.actions).toContain('click:label[for="no"]');
      expect(page.actions).toContain(
        "select:#workedTillYearFor:#listbox_workedTillYear:2023",
      );
      expect(page.actions).toContain(
        "select:#workedTillMonthFor:#listbox_workedTillMonth:Sep",
      );
    });

    it("rejects invalid Naukri employment date ranges before editing", async () => {
      if (workflow.provider !== "naukri") return;
      const page = new FixturePage("naukri");
      await expect(
        workflow.applyChanges(
          page,
          [{
            field: "employment.employment-1.dates",
            operation: "set",
            value: {
              startDate: "2024-01",
              endDate: "2023-12",
              current: false,
            },
          }],
          1024,
          undefined,
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      expect(page.actions).toHaveLength(0);
    });

    it("adds a current Naukri employment entry", async () => {
      if (workflow.provider !== "naukri") return;
      const page = new FixturePage("naukri");
      await workflow.applyChanges(
        page,
        [{
          field: "employment.add",
          operation: "set",
          value: {
            company: "New Company",
            title: "Senior Engineer",
            startDate: "2024-09",
            current: true,
            employmentType: "full_time",
            description: "Platform engineering",
            skills: ["TypeScript"],
            salary: "2500000",
            currency: "INR",
          },
        }],
        1024,
        undefined,
      );
      expect(page.actions).toContain("click:#add-employment");
      expect(page.actions).toContain("fill:#companySugg:New Company");
      expect(page.actions).toContain("fill:#designationSugg:Senior Engineer");
      expect(page.actions).toContain("fill:#totalAbsCtc_id:2500000");
      expect(page.actions).toContain(
        "press:.employmentLayer.model_open #keySkillSugg:Enter",
      );
      expect(page.actions).toContain("click:#submitEmployment");
    });

    it("adds a previous Naukri employment entry with an end date", async () => {
      if (workflow.provider !== "naukri") return;
      const page = new FixturePage("naukri");
      await workflow.applyChanges(
        page,
        [{
          field: "employment.add",
          operation: "set",
          value: {
            company: "Previous Company",
            title: "Engineer",
            startDate: "2021-04",
            endDate: "2024-08",
            current: false,
            employmentType: "full_time",
          },
        }],
        1024,
        undefined,
      );
      expect(page.actions).toContain('click:label[for="no"]');
      expect(page.actions).toContain(
        "select:#workedTillMonthFor:#listbox_workedTillMonth:Aug",
      );
    });

    it("updates Naukri salary and currency together", async () => {
      if (workflow.provider !== "naukri") return;
      const page = new FixturePage("naukri");
      await workflow.applyChanges(
        page,
        [{
          field: "employment.employment-1.salary",
          operation: "set",
          value: { amount: "2500000", currency: "USD" },
        }],
        1024,
        undefined,
      );
      expect(page.actions).toContain("clickAt:.currency-option:1");
      expect(page.actions).toContain("fill:#totalAbsCtc_id:2500000");
    });

    it("rejects salary updates for previous Naukri employment", async () => {
      if (workflow.provider !== "naukri") return;
      const page = new FixturePage("naukri");
      page.employment.endDate = "2023-09";
      await expect(
        workflow.applyChanges(
          page,
          [{
            field: "employment.employment-1.salary",
            operation: "set",
            value: { amount: "2500000", currency: "INR" },
          }],
          1024,
          undefined,
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      expect(page.actions).toHaveLength(0);
    });

    it("searches Naukri through the authenticated page response", async () => {
      if (!(workflow instanceof NaukriBrowserWorkflow)) return;
      const page = new FixturePage("naukri");
      await expect(
        workflow.searchJobs(page, {
          query: "platform engineer",
          location: "Bengaluru",
          limit: 10,
        }),
      ).resolves.toEqual({
        jobs: [expect.objectContaining({
          providerJobId: "job-1",
          title: "Platform Engineer",
        })],
      });
      expect(page.currentUrl).toContain("platform-engineer-jobs");
    });

    it("reads Naukri recommendations, saved jobs, and applications", async () => {
      if (!(workflow instanceof NaukriBrowserWorkflow)) return;
      const page = new FixturePage("naukri");
      page.jobSaved = true;
      page.accountApplications.push({
        jobId: "job-1",
        jobTitle: "Platform Engineer",
        company: "Example",
        location: "Bengaluru",
        status: "Applied",
        isOpen: true,
      });
      await expect(workflow.readAccountData(page, "recommended_jobs"))
        .resolves.toEqual([
          expect.objectContaining({ providerJobId: "job-1" }),
        ]);
      await expect(workflow.readAccountData(page, "saved_jobs"))
        .resolves.toEqual([
          expect.objectContaining({ providerJobId: "job-1" }),
        ]);
      await expect(workflow.readAccountData(page, "applications"))
        .resolves.toEqual([
          expect.objectContaining({
            jobId: "job-1",
            status: "Applied",
          }),
        ]);
      await expect(workflow.readAccountData(page, "recruiter_messages"))
        .resolves.toEqual([
          expect.objectContaining({
            id: "message-1",
            subject: "Platform Engineer opportunity",
            company: "Example",
            read: false,
          }),
        ]);
    });

    it("saves a Naukri job only through the mutation workflow", async () => {
      if (!(workflow instanceof NaukriBrowserWorkflow)) return;
      const page = new FixturePage("naukri");
      const request = {
        provider: "naukri" as const,
        kind: "save_job" as const,
        changes: [{
          field: "job.job-1.saved",
          operation: "set" as const,
          value: {
            sourceUrl:
              "https://www.naukri.com/job-listings-platform-engineer-job-1",
            saved: true,
          },
        }],
      };
      await expect(workflow.readMutationState(page, request)).resolves.toEqual({
        "job.job-1.saved": {
          sourceUrl:
            "https://www.naukri.com/job-listings-platform-engineer-job-1",
          saved: false,
        },
      });
      await workflow.executeMutation(page, request, 1024, undefined);
      expect(page.jobSaved).toBe(true);
      expect(page.actions).toContain(
        "click:button[class*='save-job-button']",
      );
    });

    it("submits a direct Naukri application and verifies history", async () => {
      if (!(workflow instanceof NaukriBrowserWorkflow)) return;
      const page = new FixturePage("naukri");
      const request = {
        provider: "naukri" as const,
        kind: "application" as const,
        changes: [{
          field: "application.job-1.submission",
          operation: "set" as const,
          value: {
            sourceUrl:
              "https://www.naukri.com/job-listings-platform-engineer-job-1",
            resume: "current" as const,
            questionnaireAnswers: {},
          },
        }],
      };
      await workflow.executeMutation(page, request, 1024, undefined);
      expect(page.actions).toContain("click:#apply-button");
      expect(page.accountApplications).toHaveLength(1);
    });

    it("fails closed for unverified questionnaire application flows", async () => {
      if (!(workflow instanceof NaukriBrowserWorkflow)) return;
      const page = new FixturePage("naukri");
      await expect(
        workflow.executeMutation(
          page,
          {
            provider: "naukri",
            kind: "application",
            changes: [{
              field: "application.job-1.submission",
              operation: "set",
              value: {
                sourceUrl:
                  "https://www.naukri.com/job-listings-platform-engineer-job-1",
                questionnaireAnswers: {
                  "Years of experience": "5",
                },
              },
            }],
          },
          1024,
          undefined,
        ),
      ).rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
      expect(page.actions).not.toContain("click:#apply-button");
    });

    it("updates the current Naukri notice period", async () => {
      if (!(workflow instanceof NaukriBrowserWorkflow)) return;
      const page = new FixturePage("naukri");
      await workflow.applyChanges(
        page,
        [{
          field: "employment.employment-1.noticePeriod",
          operation: "set",
          value: "1 Month",
        }],
        1024,
        undefined,
      );
      expect(page.actions).toContain(
        "select:#noticePeriodFor:#listbox_noticePeriod:1 Month",
      );
    });

    it("reads projects attached to Naukri employment", async () => {
      if (!(workflow instanceof NaukriBrowserWorkflow)) return;
      const page = new FixturePage("naukri");
      const profile = await workflow.readProfile(page, ["project.history"]);
      expect(profile["project.history"]).toEqual([
        expect.objectContaining({
          id: "project-1",
          employmentId: "employment-1",
          title: "Platform Migration",
        }),
      ]);
    });

    it("rejects invalid attached-project dates before editing", async () => {
      if (!(workflow instanceof NaukriBrowserWorkflow)) return;
      const page = new FixturePage("naukri");
      await expect(
        workflow.applyChanges(
          page,
          [{
            field: "project.add",
            operation: "set",
            value: {
              employmentId: "employment-1",
              title: "Invalid project",
              startDate: "2025-01",
              endDate: "2024-12",
              current: false,
            },
          }],
          1024,
          undefined,
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      expect(page.actions).toHaveLength(0);
    });

    it("validates Naukri IT-skill experience before editing", async () => {
      if (!(workflow instanceof NaukriBrowserWorkflow)) return;
      const page = new FixturePage("naukri");
      await expect(
        workflow.applyChanges(
          page,
          [{
            field: "itSkill.add",
            operation: "set",
            value: {
              name: "TypeScript",
              lastUsedYear: 2026,
              experienceYears: 5,
              experienceMonths: 12,
            },
          }],
          1024,
          undefined,
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      expect(page.actions).toHaveLength(0);
    });

    it("validates Naukri education dates before editing", async () => {
      if (!(workflow instanceof NaukriBrowserWorkflow)) return;
      const page = new FixturePage("naukri");
      await expect(workflow.applyChanges(page, [{
        field: "education.add",
        operation: "set",
        value: {
          level: "Graduation",
          institute: "Example University",
          course: "Engineering",
          courseType: "full_time",
          startYear: 2025,
          completionYear: 2024,
        },
      }], 1024, undefined)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      expect(page.actions).toHaveLength(0);
    });

    it("validates Naukri certification expiry before editing", async () => {
      if (!(workflow instanceof NaukriBrowserWorkflow)) return;
      const page = new FixturePage("naukri");
      await expect(workflow.applyChanges(page, [{
        field: "certification.add",
        operation: "set",
        value: {
          name: "Cloud Certification",
          provider: "Example",
          issueDate: "2025-01",
          expiryDate: "2024-12",
          doesNotExpire: false,
        },
      }], 1024, undefined)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      expect(page.actions).toHaveLength(0);
    });

    it("updates supported Naukri career-profile fields atomically", async () => {
      if (!(workflow instanceof NaukriBrowserWorkflow)) return;
      const page = new FixturePage("naukri");
      await workflow.applyChanges(page, [{
        field: "careerProfile",
        operation: "set",
        value: {
          industry: "Information Technology",
          department: "Engineering",
          roleCategory: "Software Development",
          role: "Backend Developer",
          jobTypes: ["permanent"],
          employmentTypes: ["full_time", "part_time"],
        },
      }], 1024, undefined);
      expect(page.actions).toContain(
        "select:#industryFor:#listbox_industry:Information Technology",
      );
      expect(page.actions).toContain("check:#contractual:false");
      expect(page.actions).toContain("check:#partTime:true");
      expect(page.actions).toContain("click:#saveDesiredProfile");
    });

    it("rejects an empty Naukri career-profile update", async () => {
      if (!(workflow instanceof NaukriBrowserWorkflow)) return;
      const page = new FixturePage("naukri");
      await expect(workflow.applyChanges(page, [{
        field: "careerProfile",
        operation: "set",
        value: {},
      }], 1024, undefined)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
      expect(page.actions).toHaveLength(0);
    });
});
