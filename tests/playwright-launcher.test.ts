import { describe, expect, it } from "vitest";
import {
  assertProviderUrl,
  sanitizeStorageState,
} from "../src/browser/playwright-launcher.js";

describe("provider browser confinement", () => {
  it("retains only provider cookies in serialized state", () => {
    const sanitized = JSON.parse(sanitizeStorageState("linkedin", JSON.stringify({
      cookies: [
        { name: "li", value: "1", domain: ".linkedin.com", path: "/" },
        { name: "sso", value: "2", domain: ".identity.example", path: "/" },
      ],
      origins: [{ origin: "https://www.linkedin.com", localStorage: [] }],
    }))) as { cookies: Array<{ name: string }> };
    expect(sanitized.cookies.map((cookie) => cookie.name)).toEqual(["li"]);
  });

  it("rejects unexpected persisted origins", () => {
    expect(() =>
      sanitizeStorageState("naukri", JSON.stringify({
        cookies: [],
        origins: [{ origin: "https://accounts.example.test", localStorage: [] }],
      }))
    ).toThrowError(/approved HTTPS provider origin/);
  });

  it("allows HTTPS provider subdomains and rejects redirects elsewhere", () => {
    expect(() =>
      assertProviderUrl("linkedin", "https://www.linkedin.com/in/me/")
    ).not.toThrow();
    expect(() =>
      assertProviderUrl("linkedin", "http://www.linkedin.com/in/me/")
    ).toThrow();
    expect(() =>
      assertProviderUrl("linkedin", "https://linkedin.com.example.test/")
    ).toThrow();
  });
});
