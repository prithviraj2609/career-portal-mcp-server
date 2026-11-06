import { describe, expect, it } from "vitest";
import type { HttpClient } from "../src/http.js";
import {
  LinkedInAdapter,
  parseLinkedInCards,
  parseLinkedInDetails,
} from "../src/providers/linkedin.js";
import {
  NaukriAdapter,
  parseNaukriJsonLd,
} from "../src/providers/naukri.js";
import {
  buildNaukriSearchUrl,
  parseNaukriSearchPayload,
} from "../src/providers/naukri-search.js";

const linkedinCard = `
<li>
  <div class="base-card" data-entity-urn="urn:li:jobPosting:12345">
    <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/software-engineer-12345?trk=test"></a>
    <h3 class="base-search-card__title">Software Engineer</h3>
    <h4 class="base-search-card__subtitle">Example &amp; Co</h4>
    <span class="job-search-card__location">Bengaluru, India</span>
    <time datetime="2026-10-01"></time>
  </div>
</li>`;

const linkedinDetail = `
<h2 class="top-card-layout__title">Software Engineer</h2>
<a class="topcard__org-name-link">Example &amp; Co</a>
<span class="topcard__flavor--bullet">Bengaluru</span>
<div class="show-more-less-html__markup"><p>Build safe systems.</p></div>`;

const naukriHtml = `
<script type="application/ld+json">
{
  "@type": "JobPosting",
  "title": "Platform Engineer",
  "description": "<p>Build platforms</p>",
  "datePosted": "2026-10-02",
  "employmentType": "FULL_TIME",
  "hiringOrganization": { "name": "Acme" },
  "identifier": { "value": "n-789" },
  "jobLocation": { "address": { "addressLocality": "Pune", "addressCountry": "IN" } },
  "url": "https://www.naukri.com/job-listings-platform-engineer-n-789"
}
</script>`;

const naukriSearchPayload = {
  jobDetails: [{
    jobId: "987654321",
    title: "Senior Software Engineer",
    companyName: "Example Systems",
    jdURL: "/job-listings-senior-software-engineer-example-systems-987654321",
    createdDate: "2 Days Ago",
    placeholders: [
      { type: "location", label: "Bengaluru" },
      { type: "salary", label: "Not disclosed" },
    ],
    tagsAndSkills: "TypeScript, distributed systems",
  }],
};

function mockHttp(body: string): HttpClient {
  return {
    get: async () => ({
      status: 200,
      headers: new Headers(),
      body,
    }),
  };
}

describe("LinkedInAdapter", () => {
  it("normalizes public search cards", () => {
    expect(parseLinkedInCards(linkedinCard)).toEqual([
      expect.objectContaining({
        provider: "linkedin",
        providerJobId: "12345",
        title: "Software Engineer",
        company: "Example & Co",
        locations: ["Bengaluru, India"],
      }),
    ]);
  });

  it("rejects off-provider URLs from public markup", () => {
    expect(() =>
      parseLinkedInCards(
        linkedinCard.replace(
          "https://www.linkedin.com/jobs/view/software-engineer-12345?trk=test",
          "https://evil.example/jobs/view/software-engineer-12345",
        ),
      ),
    ).toThrowError("untrusted URL host");
  });

  it("normalizes public job details", () => {
    expect(parseLinkedInDetails("12345", linkedinDetail)).toEqual(
      expect.objectContaining({
        providerJobId: "12345",
        description: "Build safe systems.",
      }),
    );
  });

  it("uses bounded opaque pagination", async () => {
    const adapter = new LinkedInAdapter(mockHttp(linkedinCard));
    const page = await adapter.searchJobs({ query: "engineer", limit: 1 });
    expect(page.jobs).toHaveLength(1);
    expect(page.nextPageToken).toBeTypeOf("string");
  });

  it("reports authenticated reads as unsupported", async () => {
    const adapter = new LinkedInAdapter(mockHttp(""));
    await expect(adapter.readAccount("profile")).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
    });
  });
});

describe("NaukriAdapter", () => {
  it("reports public search unavailable when anonymous access is blocked", async () => {
    const adapter = new NaukriAdapter(mockHttp(""));
    expect(
      adapter.capabilities().find((item) => item.operation === "search_jobs"),
    ).toMatchObject({
      support: "unsupported",
      enabled: false,
    });
    await expect(adapter.searchJobs({ query: "engineer", limit: 10 }))
      .rejects.toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
  });

  it("builds the provider search page URL with bounded filters", () => {
    const url = new URL(buildNaukriSearchUrl({
      query: "Software Engineer",
      location: "Bengaluru",
      postedWithinDays: 7,
      remoteMode: "hybrid",
      limit: 10,
    }, 2));
    expect(url.pathname).toBe(
      "/software-engineer-jobs-in-bengaluru",
    );
    expect(url.searchParams.get("k")).toBe("Software Engineer");
    expect(url.searchParams.get("l")).toBe("Bengaluru");
    expect(url.searchParams.get("pageNo")).toBe("2");
  });

  it("normalizes the intercepted Naukri jobDetails response", () => {
    expect(parseNaukriSearchPayload(naukriSearchPayload, 10, 1)).toEqual({
      jobs: [expect.objectContaining({
        provider: "naukri",
        providerJobId: "987654321",
        title: "Senior Software Engineer",
        company: "Example Systems",
        locations: ["Bengaluru"],
        salary: "Not disclosed",
      })],
    });
  });

  it("returns empty only for a recognized empty jobs array", () => {
    expect(parseNaukriSearchPayload({ jobDetails: [] }, 10, 1)).toEqual({
      jobs: [],
    });
    expect(() =>
      parseNaukriSearchPayload({ status: "success" }, 10, 1)
    ).toThrowError("recognized jobs array");
  });

  it("fails when non-empty jobs use an unrecognized shape", () => {
    expect(() =>
      parseNaukriSearchPayload({ jobDetails: [{ unknown: true }] }, 10, 1)
    ).toThrowError("unrecognized shape");
  });

  it("delegates search to the isolated anonymous search client", async () => {
    const search = async () => ({
      jobs: parseNaukriSearchPayload(naukriSearchPayload, 10, 1).jobs,
    });
    const adapter = new NaukriAdapter(mockHttp(""), { search });
    expect(
      adapter.capabilities().find((item) => item.operation === "search_jobs"),
    ).toMatchObject({ enabled: true });
    await expect(adapter.searchJobs({ query: "engineer", limit: 10 })).resolves
      .toMatchObject({ jobs: [expect.objectContaining({ provider: "naukri" })] });
  });

  it("normalizes JSON-LD job postings", () => {
    expect(parseNaukriJsonLd(naukriHtml)).toEqual([
      expect.objectContaining({
        provider: "naukri",
        providerJobId: "n-789",
        title: "Platform Engineer",
        company: "Acme",
        locations: ["Pune, IN"],
      }),
    ]);
  });

  it("rejects off-provider JSON-LD URLs", () => {
    expect(() =>
      parseNaukriJsonLd(
        naukriHtml.replace(
          "https://www.naukri.com/job-listings-platform-engineer-n-789",
          "https://evil.example/job-listings-platform-engineer-n-789",
        ),
      ),
    ).toThrowError("untrusted URL host");
  });

  it("reads job details from mocked public HTML", async () => {
    const adapter = new NaukriAdapter(mockHttp(naukriHtml));
    await expect(adapter.getJobDetails("n-789")).resolves.toEqual(
      expect.objectContaining({
        description: "Build platforms",
        applyUrl:
          "https://www.naukri.com/job-listings-platform-engineer-n-789",
      }),
    );
  });
});
