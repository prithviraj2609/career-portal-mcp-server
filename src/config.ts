import { z } from "zod";

const booleanValue = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const envSchema = z.object({
  CAREER_PORTAL_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10000),
  CAREER_PORTAL_MAX_RESULTS: z.coerce.number().int().min(1).max(50).default(25),
  CAREER_PORTAL_READS_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(20),
  CAREER_PORTAL_MUTATIONS_ENABLED: booleanValue,
  CAREER_PORTAL_MUTATION_CONFIRMATION_TTL_MS: z.coerce.number().int().min(30000).max(600000).default(300000),
  CAREER_PORTAL_LINKEDIN_BROWSER_ENABLED: booleanValue,
  CAREER_PORTAL_NAUKRI_BROWSER_ENABLED: booleanValue,
  CAREER_PORTAL_RESUME_MAX_BYTES: z.coerce.number().int().min(1024).max(10_485_760).default(5_242_880),
  CAREER_PORTAL_RESUME_DIRECTORY: z.string().min(1).optional(),
  CAREER_PORTAL_SESSION_KEY: z.string().optional(),
  CAREER_PORTAL_SESSION_FILE: z.string().optional(),
  CAREER_PORTAL_USER_AGENT: z.string().min(5).max(200).default("CareerPortalMCP/0.1"),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const config = envSchema.parse(env);
  if (
    (config.CAREER_PORTAL_LINKEDIN_BROWSER_ENABLED ||
      config.CAREER_PORTAL_NAUKRI_BROWSER_ENABLED) &&
    (!config.CAREER_PORTAL_SESSION_KEY ||
      !config.CAREER_PORTAL_SESSION_FILE)
  ) {
    throw new Error(
      "Browser adapters require CAREER_PORTAL_SESSION_KEY and CAREER_PORTAL_SESSION_FILE",
    );
  }
  if (
    config.CAREER_PORTAL_NAUKRI_BROWSER_ENABLED &&
    !config.CAREER_PORTAL_RESUME_DIRECTORY
  ) {
    throw new Error(
      "Naukri browser adapter requires CAREER_PORTAL_RESUME_DIRECTORY",
    );
  }
  return config;
}
