import { describe, expect, it, vi } from "vitest";
import { BrowserSessionManager } from "../src/browser/session-manager.js";
import type {
  BrowserHandle,
  BrowserLauncher,
  BrowserPage,
  ProviderBrowserWorkflow,
} from "../src/browser/types.js";
import { MemorySessionStore } from "../src/security.js";

class FixturePage implements BrowserPage {
  currentUrl = "about:blank";
  authenticated = true;
  challenged = false;
  async goto(url: string) { this.currentUrl = url; }
  url() {
    return this.challenged
      ? "https://provider.test/checkpoint"
      : this.currentUrl;
  }
  async title() { return "Fixture"; }
  async text() { return undefined; }
  async texts() { return []; }
  async attributes() { return []; }
  async values() { return []; }
  async click() {}
  async clickAt() {}
  async selectOption() {}
  async selectNative() {}
  async selectRoleOption() {}
  async fill() {}
  async typeText() {}
  async setChecked() {}
  async press() {}
  async setInputFiles() {}
  async waitFor() {}
  async waitForFirst() {}
  async waitForCount() {}
  async waitForHidden() {}
  async isVisible(selector: string) {
    if (selector === "authenticated") return this.authenticated;
    if (selector === "challenge") return this.challenged;
    return false;
  }
  async count() { return 1; }
  async getJson() { return {}; }
  async gotoAndCaptureJson() { return {}; }
}

class FixtureLauncher implements BrowserLauncher {
  readonly pages: FixturePage[] = [];
  extraPages: FixturePage[] = [];
  nextAuthenticated = true;
  launch = vi.fn(async (): Promise<BrowserHandle> => {
    const page = new FixturePage();
    page.authenticated = this.nextAuthenticated;
    this.pages.push(page);
    return {
      page,
      pages: () => [page, ...this.extraPages],
      storageState: async () => '{"cookies":[{"name":"session"}]}',
      close: async () => undefined,
    };
  });
}

const workflow: ProviderBrowserWorkflow = {
  provider: "linkedin",
  loginUrl: "https://provider.test/login",
  authStatusUrl: "https://provider.test/home",
  profileUrl: "https://provider.test/profile",
  isAuthenticated: async (page) => page.isVisible("authenticated"),
  assertSafePage: async (page) => {
    if (await page.isVisible("challenge")) {
      throw Object.assign(new Error("challenge"), {
        code: "ANTI_BOT_CHALLENGE",
      });
    }
  },
  readProfile: async () => ({ headline: "Engineer" }),
  applyChanges: async () => undefined,
};

function createFixture(
  launcher: FixtureLauncher,
  store = new MemorySessionStore(),
) {
  return {
    manager: new BrowserSessionManager(
      launcher,
      store,
      new Map([["linkedin", workflow]]),
      new Set(["linkedin"]),
    ),
    store,
  };
}

describe("BrowserSessionManager", () => {
  it("persists state only after manual login completes", async () => {
    const launcher = new FixtureLauncher();
    const fixture = createFixture(launcher);
    await fixture.manager.startInteractiveLogin("linkedin");
    expect(await fixture.store.get("linkedin", "default")).toBeUndefined();
    await fixture.manager.completeInteractiveLogin("linkedin");
    expect(await fixture.store.get("linkedin", "default")).toContain("session");
  });

  it("persists the context when authentication completes in a second page", async () => {
    const launcher = new FixtureLauncher();
    launcher.nextAuthenticated = false;
    const authenticated = new FixturePage();
    authenticated.authenticated = true;
    authenticated.currentUrl = "https://provider.test/home";
    launcher.extraPages = [authenticated];
    const fixture = createFixture(launcher);
    await fixture.manager.startInteractiveLogin("linkedin");
    await fixture.manager.completeInteractiveLogin("linkedin");
    expect(await fixture.store.get("linkedin", "default")).toContain("session");
  });

  it("reports only approved page locations when login is incomplete", async () => {
    const launcher = new FixtureLauncher();
    launcher.nextAuthenticated = false;
    const fixture = createFixture(launcher);
    await fixture.manager.startInteractiveLogin("linkedin");
    await expect(fixture.manager.completeInteractiveLogin("linkedin"))
      .rejects.toMatchObject({
        code: "AUTH_REQUIRED",
        message: expect.stringContaining("https://provider.test/login"),
      });
  });

  it("reports expired authentication without exposing state", async () => {
    const launcher = new FixtureLauncher();
    const fixture = createFixture(launcher);
    await fixture.store.set("linkedin", "default", '{"cookies":[]}');
    launcher.nextAuthenticated = false;
    await expect(fixture.manager.authStatus("linkedin")).resolves.toBe("expired");
  });

  it("uses the provider authentication landing route for status checks", async () => {
    const launcher = new FixtureLauncher();
    const fixture = createFixture(launcher);
    await fixture.store.set("linkedin", "default", '{"cookies":[]}');
    await expect(fixture.manager.authStatus("linkedin")).resolves.toBe(
      "authenticated",
    );
    expect(launcher.pages[0]?.currentUrl).toBe("https://provider.test/home");
  });

  it("uses a headed browser for Naukri account operations", async () => {
    const launcher = new FixtureLauncher();
    const store = new MemorySessionStore();
    const naukriWorkflow = {
      ...workflow,
      provider: "naukri" as const,
    };
    const manager = new BrowserSessionManager(
      launcher,
      store,
      new Map([["naukri", naukriWorkflow]]),
      new Set(["naukri"]),
    );
    await store.set("naukri", "default", '{"cookies":[]}');
    await manager.withAuthenticatedPage("naukri", async () => "ok");
    expect(launcher.launch).toHaveBeenCalledWith(
      "naukri",
      true,
      '{"cookies":[]}',
    );
  });

  it("uses a headed browser for LinkedIn account operations", async () => {
    const launcher = new FixtureLauncher();
    const fixture = createFixture(launcher);
    await fixture.store.set("linkedin", "default", '{"cookies":[]}');
    await fixture.manager.withAuthenticatedPage("linkedin", async () => "ok");
    expect(launcher.launch).toHaveBeenCalledWith(
      "linkedin",
      true,
      '{"cookies":[]}',
    );
  });

  it("stops login completion on provider challenges", async () => {
    const launcher = new FixtureLauncher();
    const fixture = createFixture(launcher);
    await fixture.manager.startInteractiveLogin("linkedin");
    launcher.pages[0]!.challenged = true;
    await expect(
      fixture.manager.completeInteractiveLogin("linkedin"),
    ).rejects.toMatchObject({ code: "ANTI_BOT_CHALLENGE" });
    expect(await fixture.store.get("linkedin", "default")).toBeUndefined();
  });

  it("does not launch disabled providers", async () => {
    const launcher = new FixtureLauncher();
    const fixture = createFixture(launcher);
    await expect(fixture.manager.authStatus("naukri")).resolves.toBe("disabled");
    expect(launcher.launch).not.toHaveBeenCalled();
  });

  it("deletes the encrypted provider session on logout", async () => {
    const launcher = new FixtureLauncher();
    const fixture = createFixture(launcher);
    await fixture.store.set("linkedin", "default", "encrypted-state");
    await fixture.manager.logout("linkedin");
    expect(await fixture.store.get("linkedin", "default")).toBeUndefined();
  });
});
