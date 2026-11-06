import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  mutationPreviewSchema,
  searchJobsSchema,
} from "../src/schemas.js";

describe("input validation", () => {
  it("applies conservative defaults", () => {
    expect(searchJobsSchema.parse({
      provider: "linkedin",
      query: "engineer",
    })).toMatchObject({ limit: 10 });
    expect(loadConfig({} as NodeJS.ProcessEnv)).toMatchObject({
      CAREER_PORTAL_MUTATIONS_ENABLED: false,
      CAREER_PORTAL_MAX_RESULTS: 25,
      CAREER_PORTAL_READS_PER_MINUTE: 20,
    });
  });

  it("caps query, result, and mutation sizes", () => {
    expect(() =>
      searchJobsSchema.parse({
        provider: "naukri",
        query: "engineer",
        limit: 26,
      }),
    ).toThrow();
    expect(() =>
      mutationPreviewSchema.parse({
        provider: "naukri",
        kind: "profile",
        changes: Array.from({ length: 26 }, (_, index) => ({
          field: `field${index}`,
          operation: "remove",
        })),
      }),
    ).toThrow();
  });

  it("requires values only for set operations", () => {
    expect(() =>
      mutationPreviewSchema.parse({
        provider: "linkedin",
        kind: "profile",
        changes: [{ field: "headline", operation: "set" }],
      }),
    ).toThrow();
    expect(() =>
      mutationPreviewSchema.parse({
        provider: "linkedin",
        kind: "profile",
        changes: [{
          field: "headline",
          operation: "remove",
          value: "unexpected",
        }],
      }),
    ).toThrow();
  });

  it("accepts bounded stable provider IDs in mutation fields", () => {
    expect(() =>
      mutationPreviewSchema.parse({
        provider: "naukri",
        kind: "experience",
        changes: [{
          field:
            "employment.4c9709c9018bfdc6100a9d07224bc142d1d0d0644bc9415b5c4f31944917d4da.title",
          operation: "set",
          value: "Engineer",
        }],
      })
    ).not.toThrow();
    expect(() =>
      mutationPreviewSchema.parse({
        provider: "linkedin",
        kind: "message",
        changes: [{
          field: "message.thread-1.send",
          operation: "set",
          value: {
            threadUrl:
              "https://www.linkedin.com/messaging/thread/thread-1/",
            recipient: "Recruiter",
            text: "I am interested.",
          },
        }],
      })
    ).not.toThrow();
  });

  it("requires encrypted storage and a resume root for browser adapters", () => {
    expect(() =>
      loadConfig({
        CAREER_PORTAL_NAUKRI_BROWSER_ENABLED: "true",
      } as NodeJS.ProcessEnv),
    ).toThrowError("SESSION_KEY");
    expect(() =>
      loadConfig({
        CAREER_PORTAL_NAUKRI_BROWSER_ENABLED: "true",
        CAREER_PORTAL_SESSION_KEY: "key",
        CAREER_PORTAL_SESSION_FILE: "sessions.enc",
      } as NodeJS.ProcessEnv),
    ).toThrowError("RESUME_DIRECTORY");
  });
});
