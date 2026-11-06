import {
  SelectorWorkflow,
  shortTextField,
  stringListField,
  textField,
  type WorkflowSelectors,
} from "./workflow-base.js";
import type { BrowserPage } from "./types.js";
import type {
  AccountSnapshot,
  FieldChange,
  JobDetails,
  MutationRequest,
} from "../types.js";
import { CareerPortalError } from "../errors.js";
import { z } from "zod";

export class LinkedInBrowserWorkflow extends SelectorWorkflow {
  readonly provider = "linkedin" as const;
  readonly loginUrl = "https://www.linkedin.com/login";
  readonly profileUrl = "https://www.linkedin.com/in/me/";

  override async isAuthenticated(page: BrowserPage): Promise<boolean> {
    const url = new URL(page.url());
    return url.protocol === "https:" &&
      (url.hostname === "linkedin.com" ||
        url.hostname.endsWith(".linkedin.com")) &&
      (
        url.pathname === "/feed/" ||
        url.pathname === "/feed/foryou/" ||
        url.pathname.startsWith("/in/")
      );
  }

  override async readProfile(
    page: BrowserPage,
    fields?: readonly string[],
  ): Promise<Record<string, unknown>> {
    const requested = new Set(fields ?? [
      "headline",
      "summary",
      "skills",
      "employment.title",
      "employment.company",
      "employment.description",
      "education.school",
      "education.degree",
      "jobPreferences.titles",
      "jobPreferences.locations",
    ]);
    const values: Record<string, unknown> = {};
    const needsMain = [...requested].some((field) =>
      ["headline", "summary", "jobPreferences.titles",
        "jobPreferences.locations"].includes(field)
    );
    if (needsMain) {
      await page.goto(this.profileUrl);
      await this.assertSafePage(page);
      await page.waitFor("div[id$='Topcard']");
      if (requested.has("summary")) {
        await page.waitForFirst("div[id$='About']");
      }
      const topcard = await page.texts("div[id$='Topcard'] p");
      if (requested.has("headline")) values.headline = topcard[0];
      if (requested.has("jobPreferences.titles")) {
        await page.click("text=Show details");
        await page.waitForFirst("dialog:has-text('Open to Work')");
        const details = await page.text("dialog:has-text('Open to Work')");
        values["jobPreferences.titles"] = extractPreferenceList(
          details,
          "Job titles",
          "Location types",
        );
      }
      if (requested.has("jobPreferences.locations")) {
        if (!requested.has("jobPreferences.titles")) {
          await page.click("text=Show details");
          await page.waitForFirst("dialog:has-text('Open to Work')");
        }
        const details = await page.text("dialog:has-text('Open to Work')");
        values["jobPreferences.locations"] = extractPreferenceList(
          details,
          "Locations",
          "Employment types",
        );
      }
      if (requested.has("summary")) {
        await page.goto(this.profileUrl);
        await this.assertSafePage(page);
        await page.waitForFirst("[aria-label='Edit about']");
        await page.click("[aria-label='Edit about']");
        const input =
          "[role='textbox'][contenteditable='true'][aria-label='About']";
        await page.waitForFirst(input);
        values.summary = await page.text(input);
      }
    }
    if (requested.has("skills") || requested.has("skill.history")) {
      await page.goto(`${this.profileUrl}details/skills/`);
      await this.assertSafePage(page);
      await page.waitForFirst(
        "main [aria-label^='Edit '][aria-label$=' skill']",
      );
      const labels = await page.attributes(
        "main [aria-label^='Edit '][aria-label$=' skill']",
        "aria-label",
      );
      if (requested.has("skills")) {
        values.skills = labels.flatMap((label) => {
          const match = /^Edit (.+) skill$/.exec(label);
          return match?.[1] ? [match[1]] : [];
        });
      }
      if (requested.has("skill.history")) {
        const hrefs = await page.attributes(
          "main [aria-label^='Edit '][aria-label$=' skill']",
          "href",
        );
        values["skill.history"] = labels.flatMap((label, index) => {
          const name = /^Edit (.+) skill$/.exec(label)?.[1];
          const id = linkedInEntityId(hrefs[index], "skills");
          return name && id ? [{ id, name }] : [];
        });
      }
    }
    if (
      requested.has("employment.history") ||
      requested.has("employment.title") ||
      requested.has("employment.company") ||
      requested.has("employment.description")
    ) {
      await page.goto(`${this.profileUrl}details/experience/`);
      await this.assertSafePage(page);
      await page.waitForFirst(
        "main [aria-label^='Edit '][aria-label*=' at ']",
      );
      const entries = await page.attributes(
        "main [aria-label^='Edit '][aria-label*=' at ']",
        "aria-label",
      );
      const hrefs = await page.attributes(
        "main [aria-label^='Edit '][aria-label*=' at ']",
        "href",
      );
      const texts = await page.texts("main p");
      const latest = entries[0] && /^Edit (.+) at (.+)$/.exec(entries[0]);
      if (requested.has("employment.history")) {
        const history: Array<Record<string, unknown>> = [];
        for (const [index, href] of hrefs.slice(0, 25).entries()) {
          const label = entries[index] ?? "";
          const match = /^Edit (.+) at (.+)$/.exec(label);
          const id = linkedInEntityId(href, "experience");
          if (!match?.[1] || !match[2] || !id) {
            throw new CareerPortalError(
              "PROVIDER_CHANGED",
              "LinkedIn employment entry omitted its stable edit identity",
            );
          }
          await page.goto(href);
          await this.assertSafePage(page);
          await page.waitForFirst("input[placeholder='Role title']");
          const descriptionSelector =
            "[role='textbox'][contenteditable='true'][aria-label^='Description']";
          await page.waitForFirst(descriptionSelector);
          const dates = await page.values("select");
          history.push({
            id,
            title: (await page.values(
              "input[placeholder='Role title']",
            ))[0] ?? match[1],
            company: (await page.values(
              "input[placeholder='Organization name']",
            ))[0] ?? match[2],
            location: (await page.values(
              "input[placeholder='City, region, or Remote']",
            ))[0] ?? null,
            description: await page.text(descriptionSelector) ?? "",
            locationType: dates[0] || null,
            employmentType: dates[1] || null,
            startMonth: numericSelect(dates[2]),
            startYear: dates[3] || null,
            current: await page.isVisible(
              "input[type='checkbox'] >> nth=0:checked",
            ),
            endMonth: dates.length >= 6 ? numericSelect(dates[4]) : null,
            endYear: dates.length >= 6 ? dates[5] || null : null,
          });
        }
        values["employment.history"] = history;
      }
      if (requested.has("employment.title")) {
        values["employment.title"] = latest?.[1];
      }
      if (requested.has("employment.company")) {
        values["employment.company"] = latest?.[2] ?? texts[2];
      }
      if (requested.has("employment.description")) {
        values["employment.description"] = texts[5];
      }
    }
    if (
      requested.has("education.history") ||
      requested.has("education.school") ||
      requested.has("education.degree")
    ) {
      await page.goto(`${this.profileUrl}details/education/`);
      await this.assertSafePage(page);
      await page.waitForFirst("main [aria-label^='Edit education ']");
      const entries = await page.attributes(
        "main [aria-label^='Edit education ']",
        "aria-label",
      );
      const hrefs = await page.attributes(
        "main [aria-label^='Edit education ']",
        "href",
      );
      const texts = await page.texts("main p");
      if (requested.has("education.history")) {
        const history: Array<Record<string, unknown>> = [];
        for (const [index, href] of hrefs.slice(0, 25).entries()) {
          const id = linkedInEntityId(href, "education");
          const school = entries[index]?.replace(/^Edit education /, "");
          if (!id || !school) {
            throw new CareerPortalError(
              "PROVIDER_CHANGED",
              "LinkedIn education entry omitted its stable edit identity",
            );
          }
          await page.goto(href);
          await this.assertSafePage(page);
          await page.waitForFirst(
            "input[placeholder='Ex: Boston University']",
          );
          const dates = await page.values("select");
          history.push({
            id,
            school: (await page.values(
              "input[placeholder='Ex: Boston University']",
            ))[0] ?? school,
            degree: (await page.values(
              "input[placeholder='Ex: Bachelor of Science']",
            ))[0] ?? null,
            fieldOfStudy: (await page.values(
              "input[placeholder='Ex: Business']",
            ))[0] ?? null,
            description: (await page.values(
              "textarea[aria-label^='Description']",
            ))[0] ?? "",
            startMonth: numericSelect(dates[0]),
            startYear: dates[1] || null,
            endMonth: numericSelect(dates[2]),
            endYear: dates[3] || null,
          });
        }
        values["education.history"] = history;
      }
      if (requested.has("education.school")) {
        values["education.school"] = entries[0]?.replace(
          /^Edit education /,
          "",
        ) ?? texts[1];
      }
      if (requested.has("education.degree")) {
        values["education.degree"] = texts[2];
      }
    }
    return values;
  }

  async readAccountData(
    page: BrowserPage,
    kind: AccountSnapshot["kind"],
  ): Promise<unknown> {
    if (kind === "recommended_jobs") {
      return readLinkedInJobLinks(
        page,
        "https://www.linkedin.com/jobs/collections/recommended/",
      );
    }
    if (kind === "saved_jobs") {
      return readLinkedInJobLinks(
        page,
        "https://www.linkedin.com/jobs-tracker/",
      );
    }
    if (kind === "applications") {
      await page.goto("https://www.linkedin.com/jobs-tracker/");
      await this.assertSafePage(page);
      await page.waitForFirst("text=Applied");
      await page.clickAt("text=Applied", 0);
      return readLinkedInJobLinksFromCurrentPage(page);
    }
    if (kind === "recruiter_messages") {
      await page.goto("https://www.linkedin.com/messaging/");
      await this.assertSafePage(page);
      await page.waitForFirst("main h3");
      const headings = await page.texts("main h3");
      const conversations: Array<Record<string, unknown>> = [];
      for (const index of headings.slice(0, 20).keys()) {
        await page.clickAt("main h3", index);
        await this.assertSafePage(page);
        const url = new URL(page.url());
        const match = /^\/messaging\/thread\/([^/]+)\/?$/.exec(url.pathname);
        if (!match?.[1]) continue;
        const recipients = activeConversationRecipients(
          await page.texts("main button"),
        );
        if (recipients.length !== 1) continue;
        conversations.push({
          id: decodeURIComponent(match[1]),
          recipient: recipients[0],
          threadUrl: url.toString(),
          writable: await page.isVisible(
            "[contenteditable='true'][aria-label='Write a message…']",
          ),
        });
      }
      return conversations;
    }
    if (kind === "visibility_contact_settings") {
      await page.goto(this.profileUrl);
      await this.assertSafePage(page);
      await page.waitForFirst("text=Contact info");
      await page.click("text=Contact info");
      await page.waitForFirst("dialog:has-text('Contact info')");
      return {
        contactInfo: await page.text("dialog:has-text('Contact info')"),
      };
    }
    throw new CareerPortalError(
      "CAPABILITY_UNAVAILABLE",
      `LinkedIn ${kind} read is not yet mapped to a stable first-party surface`,
    );
  }

  async getJobDetails(page: BrowserPage, jobId: string): Promise<JobDetails> {
    if (!/^\d{1,30}$/.test(jobId)) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "LinkedIn job ID must be numeric",
      );
    }
    const sourceUrl = `https://www.linkedin.com/jobs/view/${jobId}/`;
    await page.goto(sourceUrl);
    await this.assertSafePage(page);
    await page.waitForFirst(
      "main button[aria-label*='job'], main a[aria-label*='Apply']",
    );
    await page.waitForFirst("main h2:has-text('About the job')");
    await page.waitForFirst("main p");
    const text = await page.texts("main p");
    const titleParts = (await page.title()).split(" | ");
    const title = titleParts[0] || text[1];
    const company = titleParts[1] || text[0];
    const description = text
      .filter((value) => value.length >= 300)
      .sort((left, right) => right.length - left.length)[0] ??
      text.find((value) => value.includes("Description"));
    if (!title || !company || !description) {
      throw new CareerPortalError(
        "PROVIDER_CHANGED",
        "LinkedIn authenticated job detail page omitted required fields",
      );
    }
    const location = text[2]?.split("·")[0]?.trim();
    const applyUrls = await page.attributes(
      "main a[aria-label*='Apply']",
      "href",
    );
    return {
      provider: "linkedin",
      providerJobId: jobId,
      title,
      company,
      locations: location ? [location] : [],
      descriptionSnippet: description.slice(0, 280),
      description: description.replace(/^.*?Description\s*/, ""),
      detailAvailability: "available",
      sourceUrl,
      ...(applyUrls[0] ? { applyUrl: applyUrls[0] } : {}),
    };
  }

  async readMutationState(
    page: BrowserPage,
    request: MutationRequest,
  ): Promise<Record<string, unknown>> {
    if (request.kind === "job_preferences") {
      return this.readProfile(
        page,
        request.changes.map((change) => change.field),
      );
    }
    if (request.kind === "message") {
      return this.readMessageMutationState(page, request);
    }
    if (
      request.kind === "experience" ||
      request.kind === "education" ||
      request.kind === "skills"
    ) {
      return this.readEntityMutationState(page, request);
    }
    if (request.kind !== "save_job" || request.changes.length !== 1) {
      return this.readProfile(
        page,
        request.changes.map((change) => change.field),
      );
    }
    const change = request.changes[0]!;
    const { jobId, sourceUrl } = parseLinkedInSavedJob(change);
    await page.goto(sourceUrl);
    await this.assertSafePage(page);
    await page.waitForFirst(
      "main button[aria-label='Save the job'], main button[aria-label='Unsave the job']",
    );
    return {
      [change.field]: {
        sourceUrl,
        saved: await page.isVisible("main button[aria-label='Unsave the job']"),
        jobId,
      },
    };
  }

  async executeMutation(
    page: BrowserPage,
    request: MutationRequest,
    resumeMaxBytes: number,
    resumeDirectory: string | undefined,
  ): Promise<void> {
    if (request.kind === "job_preferences") {
      await this.executeJobPreferencesMutation(page, request);
      return;
    }
    if (request.kind === "profile") {
      await this.executeProfileMutation(page, request);
      return;
    }
    if (request.kind === "message") {
      await this.executeMessageMutation(page, request);
      return;
    }
    if (
      request.kind === "experience" ||
      request.kind === "education" ||
      request.kind === "skills"
    ) {
      await this.executeEntityMutation(page, request);
      return;
    }
    if (request.kind !== "save_job") {
      await this.applyChanges(
        page,
        request.changes,
        resumeMaxBytes,
        resumeDirectory,
      );
      return;
    }
    const { sourceUrl, saved } = parseLinkedInSavedJob(request.changes[0]!);
    await page.goto(sourceUrl);
    await this.assertSafePage(page);
    const before = await page.isVisible(
      "main button[aria-label='Unsave the job']",
    );
    if (before !== saved) {
      await page.click(
        saved
          ? "main button[aria-label='Save the job']"
          : "main button[aria-label='Unsave the job']",
      );
    }
    await page.waitFor(
      saved
        ? "main button[aria-label='Unsave the job']"
        : "main button[aria-label='Save the job']",
    );
  }

  private async executeProfileMutation(
    page: BrowserPage,
    request: MutationRequest,
  ): Promise<void> {
    for (const change of request.changes) {
      if (!["headline", "summary"].includes(change.field)) {
        throw new CareerPortalError(
          "VALIDATION_FAILED",
          `LinkedIn does not support profile field ${change.field}`,
        );
      }

      const value = change.operation === "remove"
        ? ""
        : parseMutationValue(
          change.field === "headline" ? shortTextField : textField,
          change.value,
          change.field,
        );
      const edit = change.field === "headline"
        ? "[aria-label='Edit profile']"
        : "[aria-label='Edit about']";
      const input = change.field === "headline"
        ? "[role='textbox'][contenteditable='true']"
        : "[role='textbox'][contenteditable='true'][aria-label='About']";
      let submitted = false;
      try {
        await page.goto(this.profileUrl);
        await this.assertSafePage(page);
        await page.waitForFirst(edit);
        await page.click(edit);
        await page.waitForFirst(input);
        await page.fill(input, value);
        const save = "button:has-text('Save'):visible";
        await page.waitForFirst(save);
        await page.click(save);
        submitted = true;
        await page.waitForHidden(input);
        await page.goto(this.profileUrl);
        await this.assertSafePage(page);
        const state = await this.readProfile(page, [change.field]);
        if (normalizeLinkedInText(state[change.field]) !==
          normalizeLinkedInText(value)) {
          throw new CareerPortalError(
            "OUTCOME_UNKNOWN",
            `LinkedIn accepted ${change.field}, but the requested value was not conclusively observed`,
          );
        }
      } catch (error: unknown) {
        if (error instanceof CareerPortalError) throw error;
        throw new CareerPortalError(
          submitted ? "OUTCOME_UNKNOWN" : "PROVIDER_CHANGED",
          submitted
            ? `LinkedIn may have updated ${change.field}, but verification failed`
            : `LinkedIn ${change.field} editor changed: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
        );
      }
    }
  }

  private async executeJobPreferencesMutation(
    page: BrowserPage,
    request: MutationRequest,
  ): Promise<void> {
    const change = request.changes[0];
    const supportedFields = [
      "jobPreferences.titles",
      "jobPreferences.locations",
    ];
    if (
      request.changes.length !== 1 ||
      !change ||
      !supportedFields.includes(change.field) ||
      change.operation !== "set"
    ) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "LinkedIn job preferences support one titles or locations set operation",
      );
    }
    const requested = parseMutationValue(
      stringListField.max(5),
      change.value,
      change.field,
    );
    const before = await this.readProfile(page, [
      "jobPreferences.titles",
      change.field,
    ]);
    const displayedTitles = parseMutationValue(
      z.array(z.string()),
      before["jobPreferences.titles"],
      "current jobPreferences.titles",
    );
    const displayed = parseMutationValue(
      z.array(z.string()),
      before[change.field],
      `current ${change.field}`,
    );
    await page.goto(this.profileUrl);
    await this.assertSafePage(page);
    await page.waitForFirst("text=Show details");
    await page.click("text=Show details");
    await page.waitForFirst("[aria-label='Edit Open to Work preferences']");
    await page.click("[aria-label='Edit Open to Work preferences']");
    await page.waitForFirst("[aria-label='Edit job preferences']");
    await page.click("[aria-label='Edit job preferences']");
    const dialog = "dialog:has-text('Edit job preferences')";
    await page.waitForFirst(dialog);
    const desired = new Set(requested.map(normalizeLinkedInText));
    const labels = `${dialog} label`;
    const allLabels = await page.texts(labels);
    const labelOffset = change.field === "jobPreferences.titles"
      ? 0
      : displayedTitles.length + 3;
    const current = allLabels.slice(
      labelOffset,
      labelOffset + displayed.length,
    );
    const retained = new Set<string>();
    for (let index = current.length - 1; index >= 0; index -= 1) {
      const normalized = normalizeLinkedInText(current[index]);
      if (!desired.has(normalized) || retained.has(normalized)) {
        await page.clickAt(labels, labelOffset + index);
      } else {
        retained.add(normalized);
      }
    }
    const isTitle = change.field === "jobPreferences.titles";
    for (const value of requested) {
      if (retained.has(normalizeLinkedInText(value))) continue;
      const add = `${dialog} button:has-text('${
        isTitle ? "Add title" : "Add location"
      }')`;
      await page.waitForFirst(add);
      await page.click(add);
      const input = `${dialog} input[placeholder='${
        isTitle ? "Add title" : "Add location"
      }']`;
      await page.waitForFirst(input);
      await page.typeText(input, value);
      await page.waitForFirst("[role='listbox']:visible [role='option']");
      await page.selectRoleOption(value);
      retained.add(normalizeLinkedInText(value));
    }
    const save = `${dialog} button:has-text('Save'):visible`;
    await page.waitForFirst(save);
    await page.click(save);
    await page.waitForHidden(dialog);
    const after = await this.readProfile(page, [change.field]);
    if (!sameLinkedInStringSet(after[change.field], requested)) {
      throw new CareerPortalError(
        "OUTCOME_UNKNOWN",
        `LinkedIn accepted ${change.field}, but the requested values were not conclusively observed`,
      );
    }
  }

  private async readMessageMutationState(
    page: BrowserPage,
    request: MutationRequest,
  ): Promise<Record<string, unknown>> {
    if (request.changes.length !== 1) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "LinkedIn message sends require exactly one change",
      );
    }
    const change = request.changes[0]!;
    const message = parseLinkedInMessage(change);
    await page.goto(message.threadUrl);
    await this.assertSafePage(page);
    await page.waitForFirst("main");
    await assertActiveMessageRecipient(page, message.recipient);
    const composer = "[contenteditable='true'][aria-label='Write a message…']";
    await page.waitForFirst(composer);
    return {
      [change.field]: {
        threadUrl: message.threadUrl,
        recipient: message.recipient,
        messageCount: (await messageOptionLabels(page)).length,
        composerAvailable: true,
      },
    };
  }

  private async executeMessageMutation(
    page: BrowserPage,
    request: MutationRequest,
  ): Promise<void> {
    if (request.changes.length !== 1) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "LinkedIn message sends require exactly one change",
      );
    }
    const change = request.changes[0]!;
    const message = parseLinkedInMessage(change);
    await page.goto(message.threadUrl);
    await this.assertSafePage(page);
    await page.waitForFirst("main");
    await assertActiveMessageRecipient(page, message.recipient);
    const composer = "[contenteditable='true'][aria-label='Write a message…']";
    await page.waitForFirst(composer);
    await page.fill(composer, message.text);
    await page.waitForFirst("button:text-is('Send')");
    await page.click("button:text-is('Send')");
    const labels = await messageOptionLabels(page);
    if (!labels.some((label) => label.endsWith(`: ${message.text}`))) {
      throw new CareerPortalError(
        "OUTCOME_UNKNOWN",
        "LinkedIn accepted the send action but the exact message was not observed in the target thread",
      );
    }
  }

  private async readEntityMutationState(
    page: BrowserPage,
    request: MutationRequest,
  ): Promise<Record<string, unknown>> {
    const historyField = request.kind === "experience"
      ? "employment.history"
      : request.kind === "education"
      ? "education.history"
      : "skill.history";
    const profile = await this.readProfile(page, [historyField]);
    const history = z.array(z.object({ id: z.string() }).passthrough()).parse(
      profile[historyField],
    );
    return Object.fromEntries(request.changes.map((change) => {
      if (change.field.endsWith(".add")) return [change.field, undefined];
      const id = entityChangeId(change.field);
      return [change.field, history.find((entry) => entry.id === id)];
    }));
  }

  private async executeEntityMutation(
    page: BrowserPage,
    request: MutationRequest,
  ): Promise<void> {
    const kind = z.enum(["experience", "education", "skills"]).parse(
      request.kind,
    );
    if (request.changes.length !== 1) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "LinkedIn entity mutations require exactly one change per confirmation",
      );
    }
    const change = request.changes[0]!;
    if (kind === "experience") {
      await this.mutateEmployment(page, change);
    } else if (kind === "education") {
      await this.mutateEducation(page, change);
    } else {
      await this.mutateSkill(page, change);
    }
    await this.verifyEntityMutation(page, kind, change);
  }

  private async mutateEmployment(
    page: BrowserPage,
    change: FieldChange,
  ): Promise<void> {
    const id = entityChangeId(change.field);
    if (change.field === "employment.add") {
      requireSet(change, "LinkedIn employment additions");
      const value = parseMutationValue(
        employmentValue,
        change.value,
        "employment.add",
      );
      await page.goto(`${this.profileUrl}details/experience/`);
      await page.waitForFirst("[aria-label='Add a position or career break']");
      await page.click("[aria-label='Add a position or career break']");
      await page.waitForFirst("text=Add role");
      await page.click("text=Add role");
      await page.waitForFirst("input[placeholder='Role title']");
      await fillEmployment(page, value);
      await saveLinkedInEntity(page, "input[placeholder='Role title']");
      return;
    }
    if (!id) invalidEntityField(change.field);
    await page.goto(
      `${this.profileUrl}details/experience/edit/forms/${id}/`,
    );
    await page.waitForFirst("input[placeholder='Role title']");
    if (change.operation === "remove") {
      await page.click("button:has-text('Delete')");
      await page.waitForFirst("dialog:has-text('Delete role')");
      await page.click(
        "dialog:has-text('Delete role') button:has-text('Delete')",
      );
      return;
    }
    requireSet(change, "LinkedIn employment updates");
    await fillEmployment(
      page,
      parseMutationValue(
        employmentUpdateValue,
        change.value,
        change.field,
      ),
    );
    await saveLinkedInEntity(page, "input[placeholder='Role title']");
  }

  private async mutateEducation(
    page: BrowserPage,
    change: FieldChange,
  ): Promise<void> {
    const id = entityChangeId(change.field);
    if (change.field === "education.add") {
      requireSet(change, "LinkedIn education additions");
      const value = parseMutationValue(
        educationValue,
        change.value,
        "education.add",
      );
      await page.goto(`${this.profileUrl}details/education/edit/forms/new/`);
      await page.waitForFirst("input[placeholder='Ex: Boston University']");
      await fillEducation(page, value);
      await page.selectOption(
        "input[placeholder='Ex: Boston University']",
        "[role='listbox']",
        value.school,
      );
      await saveLinkedInEntity(
        page,
        "input[placeholder='Ex: Boston University']",
      );
      return;
    }
    if (!id) invalidEntityField(change.field);
    await page.goto(`${this.profileUrl}details/education/edit/forms/${id}/`);
    await page.waitForFirst("input[placeholder='Ex: Boston University']");
    if (change.operation === "remove") {
      await page.click("button:has-text('Delete education')");
      await page.waitForFirst("dialog:has-text('Delete education')");
      await page.click(
        "dialog:has-text('Delete education') button:has-text('Delete')",
      );
      return;
    }
    requireSet(change, "LinkedIn education updates");
    await fillEducation(
      page,
      parseMutationValue(educationUpdateValue, change.value, change.field),
    );
    await saveLinkedInEntity(
      page,
      "input[placeholder='Ex: Boston University']",
    );
  }

  private async mutateSkill(
    page: BrowserPage,
    change: FieldChange,
  ): Promise<void> {
    const id = entityChangeId(change.field);
    if (change.field === "skill.add") {
      requireSet(change, "LinkedIn skill additions");
      const name = parseMutationValue(
        shortTextField,
        change.value,
        "skill.add",
      );
      await page.goto(`${this.profileUrl}details/skills/`);
      await page.waitForFirst("[aria-label='Add a skill']");
      await page.click("[aria-label='Add a skill']");
      await page.waitForFirst(
        "input[placeholder='Skill (ex: Project Management)']",
      );
      const input = "input[placeholder='Skill (ex: Project Management)']";
      await page.fill(input, "");
      await page.typeText(input, name);
      await page.waitForFirst("[role='listbox']:visible [role='option']");
      await page.selectRoleOption(name);
      await saveLinkedInEntity(
        page,
        input,
      );
      return;
    }
    if (!id || change.operation !== "remove") {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        "LinkedIn skills support skill.add set or skill.<id> remove",
      );
    }
    const history = await this.readProfile(page, ["skill.history"]);
    const entry = z.array(z.object({
      id: z.string(),
      name: z.string(),
    })).parse(history["skill.history"]).find((item) => item.id === id);
    if (!entry) {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        `LinkedIn skill ${id} does not exist`,
      );
    }
    await page.goto(`${this.profileUrl}details/skills/edit/forms/${id}/`);
    await page.waitForFirst("button:has-text('Delete skill')");
    await page.click("button:has-text('Delete skill')");
    await page.waitForFirst("dialog:has-text('Delete from profile?')");
    await page.click(
      "dialog:has-text('Delete from profile?') button:has-text('Delete')",
    );
  }

  private async verifyEntityMutation(
    page: BrowserPage,
    kind: "experience" | "education" | "skills",
    change: FieldChange,
  ): Promise<void> {
    const historyField = kind === "experience"
      ? "employment.history"
      : kind === "education"
      ? "education.history"
      : "skill.history";
    const profile = await this.readProfile(page, [historyField]);
    const history = z.array(
      z.record(z.string(), z.unknown()),
    ).parse(profile[historyField]);
    const id = entityChangeId(change.field);
    const expected = change.operation === "set" &&
        typeof change.value === "object" && change.value !== null
      ? change.value as Record<string, unknown>
      : undefined;
    const matched = change.field === "skill.add" &&
        typeof change.value === "string"
      ? history.find((entry) => entry.name === change.value)
      : change.field.endsWith(".add")
      ? history.find((entry) =>
        expected &&
        Object.entries(expected).every(([field, value]) =>
          entry[field] === value
        )
      )
      : history.find((entry) => entry.id === id);
    const verified = change.operation === "remove"
      ? matched === undefined
      : matched !== undefined &&
        (!expected ||
          Object.entries(expected).every(([field, value]) =>
            (matched as Record<string, unknown>)[field] === value
          ));
    if (!verified) {
      throw new CareerPortalError(
        "OUTCOME_UNKNOWN",
        `LinkedIn accepted the ${change.field} submission but the requested entity state was not conclusively observed`,
      );
    }
  }

  protected readonly selectors: WorkflowSelectors = {
    authenticated: "nav.global-nav",
    challenge: [
      "iframe[src*='captcha']",
      "form[action*='checkpoint']",
      "[data-test-id='challenge-page']",
    ],
    fields: {
      headline: {
        read: "div[id$='Topcard'] p >> nth=0",
        edit: "[aria-label='Edit profile']",
        input: "[role='textbox'][contenteditable='true']",
        save: "button:has-text('Save')",
        schema: shortTextField,
      },
      summary: {
        read: "div[id$='About'] p >> nth=0",
        edit: "[aria-label='Edit about']",
        input: "[role='textbox'][contenteditable='true'][aria-label='About']",
        save: "button:has-text('Save')",
        schema: textField,
      },
      skills: {
        read: "#skills ~ .pvs-list__outer-container .mr1.t-bold span[aria-hidden='true']",
        readMany: true,
        edit: "button[aria-label*='Edit skills']",
        input: "input[placeholder*='Skill']",
        save: "button[aria-label='Save']",
        schema: stringListField,
      },
      "employment.title": {
        read: "#experience ~ .pvs-list__outer-container > ul > li:first-child .t-bold span[aria-hidden='true']",
        edit: "#experience ~ .pvs-list__outer-container > ul > li:first-child button[aria-label*='Edit experience']",
        input: "input[name='title']",
        save: "button[aria-label='Save']",
        schema: shortTextField,
      },
      "employment.company": {
        read: "#experience ~ .pvs-list__outer-container > ul > li:first-child .t-normal span[aria-hidden='true']",
        edit: "#experience ~ .pvs-list__outer-container > ul > li:first-child button[aria-label*='Edit experience']",
        input: "input[name='companyName']",
        save: "button[aria-label='Save']",
        schema: shortTextField,
      },
      "employment.description": {
        read: "#experience ~ .pvs-list__outer-container > ul > li:first-child .inline-show-more-text",
        edit: "#experience ~ .pvs-list__outer-container > ul > li:first-child button[aria-label*='Edit experience']",
        input: "textarea[name='description']",
        save: "button[aria-label='Save']",
        schema: textField,
      },
      "education.school": {
        read: "#education ~ .pvs-list__outer-container > ul > li:first-child .t-bold span[aria-hidden='true']",
        edit: "#education ~ .pvs-list__outer-container > ul > li:first-child button[aria-label*='Edit education']",
        input: "input[name='schoolName']",
        save: "button[aria-label='Save']",
        schema: shortTextField,
      },
      "education.degree": {
        read: "#education ~ .pvs-list__outer-container > ul > li:first-child .t-normal span[aria-hidden='true']",
        edit: "#education ~ .pvs-list__outer-container > ul > li:first-child button[aria-label*='Edit education']",
        input: "input[name='degreeName']",
        save: "button[aria-label='Save']",
        schema: shortTextField,
      },
      "jobPreferences.titles": {
        read: "[data-view-name='open-to-work']",
        edit: "button[aria-label*='Open to work']",
        input: "input[placeholder*='Job title']",
        save: "button[aria-label='Save']",
        schema: stringListField.max(5),
      },
      "jobPreferences.locations": {
        read: "[data-view-name='open-to-work']",
        edit: "button[aria-label*='Open to work']",
        input: "input[placeholder*='Location']",
        save: "button[aria-label='Save']",
        schema: stringListField.max(5),
      },
    },
  };
}

function parseLinkedInSavedJob(change: FieldChange): {
  jobId: string;
  sourceUrl: string;
  saved: boolean;
} {
  const match = /^job\.(\d{1,30})\.saved$/.exec(change.field);
  if (
    change.operation !== "set" ||
    !match?.[1] ||
    typeof change.value !== "object" ||
    change.value === null ||
    !("sourceUrl" in change.value) ||
    !("saved" in change.value) ||
    typeof change.value.sourceUrl !== "string" ||
    typeof change.value.saved !== "boolean"
  ) {
    throw new CareerPortalError(
      "VALIDATION_FAILED",
      "LinkedIn save changes require job.<numeric-id>.saved and {sourceUrl,saved}",
    );
  }
  const url = new URL(change.value.sourceUrl);
  const sourceMatch = /^\/jobs\/view\/(\d{1,30})\/?$/.exec(url.pathname);
  if (
    url.protocol !== "https:" ||
    !(url.hostname === "linkedin.com" ||
      url.hostname.endsWith(".linkedin.com")) ||
    sourceMatch?.[1] !== match[1]
  ) {
    throw new CareerPortalError(
      "VALIDATION_FAILED",
      "LinkedIn sourceUrl must match the requested job ID",
    );
  }
  return {
    jobId: match[1],
    sourceUrl: url.toString(),
    saved: change.value.saved,
  };
}

  const optionalShortText = z.string().trim().min(1).max(200).optional();
  const optionalDescription = z.string().max(2_000).optional();
  const month = z.number().int().min(1).max(12);
  const year = z.string().regex(/^\d{4}$/);

  const employmentUpdateValue = z.object({
    title: optionalShortText,
    company: optionalShortText,
    location: optionalShortText,
    description: optionalDescription,
    locationType: z.enum(["On-site", "Hybrid", "Remote"]).optional(),
    employmentType: z.enum([
      "Full-time",
      "Part-time",
      "Self-employed",
      "Freelance",
      "Internship",
      "Apprenticeship",
    ]).optional(),
    startMonth: month.optional(),
    startYear: year.optional(),
    current: z.boolean().optional(),
    endMonth: month.optional(),
    endYear: year.optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, {
    message: "At least one employment field is required",
  }).refine(
    (value) => value.current !== false ||
      (value.endMonth !== undefined && value.endYear !== undefined),
    { message: "Previous employment requires endMonth and endYear" },
  );

  const employmentValue = employmentUpdateValue.and(z.object({
    title: shortTextField,
    company: shortTextField,
    startMonth: month,
    startYear: year,
    current: z.boolean(),
  }));

  const educationUpdateValue = z.object({
    school: optionalShortText,
    degree: optionalShortText,
    fieldOfStudy: optionalShortText,
    description: z.string().max(1_000).optional(),
    startMonth: month.optional(),
    startYear: year.optional(),
    endMonth: month.optional(),
    endYear: year.optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, {
    message: "At least one education field is required",
  });

  const educationValue = educationUpdateValue.and(z.object({
    school: shortTextField,
  }));

  type EmploymentValue = z.infer<typeof employmentUpdateValue>;
  type EducationValue = z.infer<typeof educationUpdateValue>;

  async function fillEmployment(
    page: BrowserPage,
    value: EmploymentValue,
  ): Promise<void> {
    if (value.title !== undefined) {
      await page.fill("input[placeholder='Role title']", value.title);
    }
    if (value.company !== undefined) {
      await page.fill("input[placeholder='Organization name']", value.company);
    }
    if (value.location !== undefined) {
      await page.fill(
        "input[placeholder='City, region, or Remote']",
        value.location,
      );
    }
    if (value.description !== undefined) {
      const selector =
        "[role='textbox'][contenteditable='true'][aria-label^='Description']";
      await page.waitForFirst(selector);
      await page.fill(
        selector,
        value.description,
      );
    }
    if (value.locationType !== undefined) {
      await page.selectNative("select >> nth=0", value.locationType);
    }
    if (value.employmentType !== undefined) {
      await page.selectNative("select >> nth=1", value.employmentType);
    }
    if (value.startMonth !== undefined) {
      await page.selectNative("select >> nth=2", monthName(value.startMonth));
    }
    if (value.startYear !== undefined) {
      await page.selectNative("select >> nth=3", value.startYear);
    }
    if (value.current !== undefined) {
      await page.setChecked(
        "input[type='checkbox'] >> nth=0",
        value.current,
      );
    }
    if (value.current === false) {
      await page.selectNative("select >> nth=4", monthName(value.endMonth!));
      await page.selectNative("select >> nth=5", value.endYear!);
    }
  }

  async function fillEducation(
    page: BrowserPage,
    value: EducationValue,
  ): Promise<void> {
    if (value.school !== undefined) {
      await page.fill(
        "input[placeholder='Ex: Boston University']",
        value.school,
      );
    }
    if (value.degree !== undefined) {
      await page.fill(
        "input[placeholder='Ex: Bachelor of Science']",
        value.degree,
      );
    }
    if (value.fieldOfStudy !== undefined) {
      await page.fill("input[placeholder='Ex: Business']", value.fieldOfStudy);
    }
    if (value.description !== undefined) {
      await page.fill(
        "textarea[aria-label^='Description']",
        value.description,
      );
    }
    if (value.startMonth !== undefined) {
      await page.selectNative("select >> nth=0", monthName(value.startMonth));
    }
    if (value.startYear !== undefined) {
      await page.selectNative("select >> nth=1", value.startYear);
    }
    if (value.endMonth !== undefined) {
      await page.selectNative("select >> nth=2", monthName(value.endMonth));
    }
    if (value.endYear !== undefined) {
      await page.selectNative("select >> nth=3", value.endYear);
    }
  }

  async function saveLinkedInEntity(
    page: BrowserPage,
    editorSelector: string,
  ): Promise<void> {
    const save = "button:has-text('Save'):visible";
    await page.waitForFirst(save);
    await page.click(save);
    await page.waitForHidden(editorSelector);
  }

  function entityChangeId(field: string): string | undefined {
    return /^(?:employment|education|skill)\.(\d{1,30})$/.exec(field)?.[1];
  }

  function invalidEntityField(field: string): never {
    throw new CareerPortalError(
      "VALIDATION_FAILED",
      `Unsupported LinkedIn entity field ${field}`,
    );
  }

  function requireSet(change: FieldChange, operation: string): void {
    if (change.operation !== "set") {
      throw new CareerPortalError(
        "VALIDATION_FAILED",
        `${operation} require a set operation`,
      );
    }
  }

  function parseMutationValue<T>(
      schema: z.ZodType<T>,
      value: unknown,
      field: string,
    ): T {
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        throw new CareerPortalError(
          "VALIDATION_FAILED",
          `Invalid LinkedIn ${field} value: ${
            parsed.error.issues.map((issue) => issue.message).join("; ")
          }`,
        );
      }
      return parsed.data;
  }

  function monthName(value: number): string {
    return [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ][value - 1]!;
  }

  function numericSelect(value: string | undefined): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12
      ? parsed
      : null;
  }

async function readLinkedInJobLinks(
  page: BrowserPage,
  url: string,
): Promise<Array<{ id: string; title: string | null; sourceUrl: string }>> {
  await page.goto(url);
  return readLinkedInJobLinksFromCurrentPage(page);
}

async function readLinkedInJobLinksFromCurrentPage(
  page: BrowserPage,
): Promise<Array<{ id: string; title: string | null; sourceUrl: string }>> {
  const selector = "main a[href*='/jobs/view/']";
  await page.waitForFirst("main");
  const hrefs = await page.attributes(selector, "href");
  const labels = await page.attributes(selector, "aria-label");
  const seen = new Set<string>();
  return hrefs.slice(0, 25).flatMap((href, index) => {
    const match = /\/jobs\/view\/(\d+)/.exec(href);
    if (!match?.[1] || seen.has(match[1])) return [];
    seen.add(match[1]);
    return [{
      id: match[1],
      title: labels[index] ?? null,
      sourceUrl: new URL(href, "https://www.linkedin.com").toString(),
    }];
  });
}

function linkedInEntityId(
  href: string | undefined,
  kind: "experience" | "education" | "skills",
): string | undefined {
  if (!href) return undefined;
  const url = new URL(href, "https://www.linkedin.com");
  if (
    url.protocol !== "https:" ||
    !(url.hostname === "linkedin.com" ||
      url.hostname.endsWith(".linkedin.com"))
  ) {
    return undefined;
  }
  return new RegExp(
    `/details/${kind}/edit/forms/(\\d{1,30})/?$`,
  ).exec(url.pathname)?.[1];
}

function extractPreferenceList(
  text: string | undefined,
  start: string,
  end: string,
): string[] {
  if (!text) return [];
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from < 0 || to < 0) return [];
  return text.slice(from + start.length, to).split("·").map((value) =>
    value.trim()
  ).filter(Boolean);
}

function normalizeLinkedInText(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
    : "";
}

function sameLinkedInStringSet(
  actual: unknown,
  expected: string[],
): boolean {
  if (!Array.isArray(actual) || actual.some((value) =>
    typeof value !== "string"
  )) {
    return false;
  }
  return JSON.stringify(
    (actual as string[]).map(normalizeLinkedInText).sort(),
  ) === JSON.stringify(expected.map(normalizeLinkedInText).sort());
}

const linkedInMessageValue = z.object({
  threadUrl: z.string().url().max(1_000),
  recipient: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(3_000),
}).strict();

function parseLinkedInMessage(change: FieldChange): {
  threadUrl: string;
  threadId: string;
  recipient: string;
  text: string;
} {
  requireSet(change, "LinkedIn message sends");
  const value = parseMutationValue(
    linkedInMessageValue,
    change.value,
    change.field,
  );
  const fieldMatch = /^message\.([A-Za-z0-9=_-]{1,300})\.send$/.exec(
    change.field,
  );
  const url = new URL(value.threadUrl);
  const pathMatch = /^\/messaging\/thread\/([^/]+)\/?$/.exec(url.pathname);
  if (
    !fieldMatch?.[1] ||
    url.protocol !== "https:" ||
    !(url.hostname === "linkedin.com" ||
      url.hostname.endsWith(".linkedin.com")) ||
    decodeURIComponent(pathMatch?.[1] ?? "") !== fieldMatch[1]
  ) {
    throw new CareerPortalError(
      "VALIDATION_FAILED",
      "LinkedIn message field and threadUrl must identify the same linkedin.com messaging thread",
    );
  }
  return {
    threadUrl: url.toString(),
    threadId: fieldMatch[1],
    recipient: value.recipient,
    text: value.text,
  };
}

async function assertActiveMessageRecipient(
  page: BrowserPage,
  recipient: string,
): Promise<void> {
  const expected = `Open the options list in your conversation with ${recipient}`;
  const matches = (await page.texts("main button")).filter((text) =>
    text === expected
  ).length;
  if (matches < 2) {
    throw new CareerPortalError(
      "STATE_DRIFT",
      "LinkedIn active thread does not match the confirmed recipient",
    );
  }
}

function activeConversationRecipients(buttonTexts: string[]): string[] {
  const prefix = "Open the options list in your conversation with ";
  const counts = new Map<string, number>();
  for (const text of buttonTexts) {
    if (!text.startsWith(prefix)) continue;
    const recipient = text.slice(prefix.length).trim();
    counts.set(recipient, (counts.get(recipient) ?? 0) + 1);
  }
  return [...counts.entries()].flatMap(([recipient, count]) =>
    count >= 2 ? [recipient] : []
  );
}

function messageOptionLabels(page: BrowserPage): Promise<string[]> {
  return page.attributes(
    "main [aria-label^='Options for the message from ']",
    "aria-label",
  );
}
