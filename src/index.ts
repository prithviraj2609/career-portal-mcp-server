#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StderrAuditSink } from "./audit.js";
import { LinkedInBrowserWorkflow } from "./browser/linkedin-workflow.js";
import { NaukriBrowserWorkflow } from "./browser/naukri-workflow.js";
import { PlaywrightLauncher } from "./browser/playwright-launcher.js";
import { BrowserSessionManager } from "./browser/session-manager.js";
import type { ProviderBrowserWorkflow } from "./browser/types.js";
import { loadConfig } from "./config.js";
import { ResilientHttpClient } from "./http.js";
import { MutationManager } from "./mutations.js";
import { LinkedInAdapter } from "./providers/linkedin.js";
import { NaukriAdapter } from "./providers/naukri.js";
import { BrowserEnabledAdapter } from "./providers/browser-enabled.js";
import type { ProviderAdapter } from "./providers/provider.js";
import { RateLimiter } from "./rate-limiter.js";
import {
  EncryptedFileSessionStore,
  MemorySessionStore,
  type SessionStore,
} from "./security.js";
import { CareerPortalService } from "./service.js";
import { registerTools } from "./tools.js";
import type { ProviderName } from "./types.js";

export function createService(
  env: NodeJS.ProcessEnv = process.env,
): {
  service: CareerPortalService;
  sessionStore: SessionStore;
} {
  const config = loadConfig(env);
  const audit = new StderrAuditSink();
  const limiter = new RateLimiter(config.CAREER_PORTAL_READS_PER_MINUTE);
  const http = new ResilientHttpClient(
    config.CAREER_PORTAL_REQUEST_TIMEOUT_MS,
    config.CAREER_PORTAL_USER_AGENT,
    limiter,
  );
  const sessionStore =
    config.CAREER_PORTAL_SESSION_FILE && config.CAREER_PORTAL_SESSION_KEY
      ? new EncryptedFileSessionStore(
          config.CAREER_PORTAL_SESSION_FILE,
          config.CAREER_PORTAL_SESSION_KEY,
        )
      : new MemorySessionStore();
  const workflows: ProviderBrowserWorkflow[] = [
    new LinkedInBrowserWorkflow(),
    new NaukriBrowserWorkflow(),
  ];
  const browserSessions = new BrowserSessionManager(
    new PlaywrightLauncher(),
    sessionStore,
    new Map(workflows.map((workflow) => [workflow.provider, workflow])),
    new Set([
      ...(config.CAREER_PORTAL_LINKEDIN_BROWSER_ENABLED
        ? (["linkedin"] as const)
        : []),
      ...(config.CAREER_PORTAL_NAUKRI_BROWSER_ENABLED
        ? (["naukri"] as const)
        : []),
    ]),
  );
  const adapters: ProviderAdapter[] = [
    new BrowserEnabledAdapter(
      new LinkedInAdapter(http),
      browserSessions,
      config.CAREER_PORTAL_RESUME_MAX_BYTES,
      config.CAREER_PORTAL_RESUME_DIRECTORY,
      config.CAREER_PORTAL_MUTATIONS_ENABLED,
    ),
    new BrowserEnabledAdapter(
      new NaukriAdapter(http),
      browserSessions,
      config.CAREER_PORTAL_RESUME_MAX_BYTES,
      config.CAREER_PORTAL_RESUME_DIRECTORY,
      config.CAREER_PORTAL_MUTATIONS_ENABLED,
    ),
  ];
  const providers = new Map<ProviderName, ProviderAdapter>(
    adapters.map((adapter) => [adapter.name, adapter]),
  );
  const mutations = new MutationManager(
    config.CAREER_PORTAL_MUTATIONS_ENABLED,
    config.CAREER_PORTAL_MUTATION_CONFIRMATION_TTL_MS,
    providers,
    audit,
  );
  return {
    service: new CareerPortalService(
      providers,
      mutations,
      audit,
      config.CAREER_PORTAL_MAX_RESULTS,
      browserSessions,
    ),
    sessionStore,
  };
}

async function main(): Promise<void> {
  const { service } = createService();
  const server = new Server(
    { name: "career-portal-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  registerTools(server, service);
  await server.connect(new StdioServerTransport());
}

const entryPoint = process.argv[1];
if (entryPoint && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `CareerPortalMCP failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
}
