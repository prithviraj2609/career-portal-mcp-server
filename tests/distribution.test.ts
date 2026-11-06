import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface PackageMetadata {
  name?: string;
  description?: string;
  license?: string;
  repository?: unknown;
  engines?: Record<string, string>;
  files?: string[];
  bin?: Record<string, string>;
}

describe("distribution metadata", () => {
  it("defines an allowlisted package surface and executable bins", async () => {
    const metadata = JSON.parse(
      await readFile("package.json", "utf8"),
    ) as PackageMetadata;
    expect(metadata).toMatchObject({
      name: "@adobe/career-portal-mcp",
      license: "MIT",
      engines: { node: ">=22.0.0" },
      bin: {
        "career-portal-mcp": "./dist/index.js",
        "career-portal-mcp-secure": "./dist/secure-launcher.js",
      },
    });
    expect(metadata.description).toBeTruthy();
    expect(metadata.repository).toBeTruthy();
    expect(metadata.files).toEqual(
      expect.arrayContaining([
        "dist/",
        "config/",
        "docs/",
        "README.md",
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
      ]),
    );
    expect(metadata.files).not.toEqual(
      expect.arrayContaining(["node_modules/", "tests/", "coverage/"]),
    );
  });

  it("keeps the sample MCP config valid and placeholder-only", async () => {
    const text = await readFile("config/mcp-config.example.json", "utf8");
    const config = JSON.parse(text) as {
      mcpServers?: Record<string, {
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        tools?: string[];
      }>;
    };
    const server = config.mcpServers?.["career-portal"];
    expect(server).toMatchObject({
      command: "node",
      tools: ["*"],
    });
    expect(server?.args?.[0]).toContain("<ABSOLUTE_PACKAGE_PATH>");
    expect(server?.env?.CAREER_PORTAL_SESSION_KEY_FILE).toContain(
      "<ABSOLUTE_STATE_PATH>",
    );
    expect(server?.env).not.toHaveProperty("CAREER_PORTAL_SESSION_KEY");
    expect(text).not.toMatch(
      /(?:password|cookie|bearer|eyJ[A-Za-z0-9_-]{10,})/i,
    );
  });
});
